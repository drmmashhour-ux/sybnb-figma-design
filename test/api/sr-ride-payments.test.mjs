import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { recordWalletEntry } from '../../server/lib/finance-ledger.mjs'
import { chargeCompletedRide, srRideFinanceSplit } from '../../server/lib/sr-payments.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
  approveDriverForRides,
} from '../support/testServer.mjs'

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  let verificationGrant
  if (role === 'GUEST') verificationGrant = await verifyEmailForTest(app, email)
  if (role === 'DRIVER') verificationGrant = await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ verificationGrant, role, email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

// Drivers must be ID-verified to claim/work a ride (requireVerifiedDriver). Self-registration leaves
// idDocumentStatus null, so approve directly — same fixture shortcut other suites use.
async function registerVerifiedDriver(app, label) {
  const driver = await registerUser(app, 'DRIVER', label)
  await approveDriverForRides(driver.user.id)
  return driver
}

// The platform commission (15%) is CREDITed to an ADMIN wallet on completion — production always has
// an admin; the test DB needs one bootstrapped (ADMIN cannot self-register).
async function ensurePlatformAdmin() {
  const existing = await db().userRole.findFirst({ where: { role: 'ADMIN' }, select: { userId: true } })
  if (existing) return existing.userId
  const admin = await db().user.create({
    data: {
      email: uniqueTestEmail('sr-pay-admin'),
      displayName: 'SR Payments Admin',
      referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'ADMIN' } },
      wallets: { create: { currency: 'SYP' } },
    },
  })
  trackTestUser(admin.id)
  return admin.id
}

async function fundRider(riderId, amountMinor, currency = 'SYP') {
  await db().$transaction((tx) =>
    recordWalletEntry(tx, {
      userId: riderId,
      type: 'CREDIT',
      amountMinor,
      currency,
      referenceType: 'test_topup',
      referenceId: `topup-${riderId}-${amountMinor}`,
      keyParts: ['test-topup', riderId, String(amountMinor), currency],
      note: 'test wallet top-up',
    }),
  )
}

async function requestRide(app, riderToken, label) {
  return request(app)
    .post('/api/sr/rides')
    .set('Authorization', `Bearer ${riderToken}`)
    .send({ pickup: `Malki ${label}`, dropoff: `Mezzeh ${label}`, category: 'SR Economy' })
}

async function driveToCompletion(app, driverToken, rideId) {
  await request(app).patch(`/api/sr/rides/${rideId}/claim`).set('Authorization', `Bearer ${driverToken}`)
  await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driverToken}`).send({ status: 'DRIVER_ARRIVING' })
  // PIN gate (017): tests not about the PIN mark it verified in the DB before the trip can start.
  await db().rideRequest.update({ where: { id: rideId }, data: { pickupVerifiedAt: new Date() } })
  await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driverToken}`).send({ status: 'IN_PROGRESS' })
  return request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driverToken}`).send({ status: 'COMPLETED' })
}

const walletBalance = async (userId, currency = 'SYP') => {
  const wallet = await db().wallet.findUnique({ where: { userId_currency: { userId, currency } } })
  return wallet?.cachedBalanceMinor || 0
}

describe('SR ride payments: cashless charge + driver settlement', () => {
  let app

  beforeAll(async () => {
    app = testApp()
    await ensurePlatformAdmin()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a rider with insufficient wallet credit cannot request a ride (402 INSUFFICIENT_CREDIT)', async () => {
    const rider = await registerUser(app, 'GUEST', 'poor-rider') // registered with a 0-balance wallet
    const res = await requestRide(app, rider.token, 'no-credit')
    expect(res.status).toBe(402)
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDIT')
  })

  it('a funded rider can request a ride, and claiming places a HOLD against the rider wallet', async () => {
    const rider = await registerUser(app, 'GUEST', 'funded-rider')
    await fundRider(rider.user.id, 10_000_000)
    const driver = await registerVerifiedDriver(app, 'hold-driver')

    const created = await requestRide(app, rider.token, 'hold')
    expect(created.status).toBe(201)
    const ride = created.body.ride

    const claim = await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
    expect(claim.status).toBe(200)

    const hold = await db().walletEntry.findFirst({ where: { referenceType: 'sr_ride_hold', referenceId: ride.id, type: 'HOLD' } })
    expect(hold).not.toBeNull()
    expect(hold.amountMinor).toBe(ride.fareMinor)
    // A HOLD does not move the cached balance; the rider's credit is untouched until completion.
    expect(await walletBalance(rider.user.id)).toBe(10_000_000)
  })

  it('a completed ride debits the rider the fare and credits driver 85% + platform 15% (ledger balances)', async () => {
    const rider = await registerUser(app, 'GUEST', 'charge-rider')
    await fundRider(rider.user.id, 10_000_000)
    const driver = await registerVerifiedDriver(app, 'charge-driver')

    const ride = (await requestRide(app, rider.token, 'charge')).body.ride
    const completed = await driveToCompletion(app, driver.token, ride.id)
    expect(completed.status).toBe(200)
    expect(completed.body.ride.status).toBe('COMPLETED')

    const split = srRideFinanceSplit(ride.fareMinor)
    expect(split.driverEarningMinor + split.adminCommissionMinor).toBe(ride.fareMinor)

    // Rider debited exactly the fare.
    expect(await walletBalance(rider.user.id)).toBe(10_000_000 - ride.fareMinor)
    // Driver credited exactly 85%.
    expect(await walletBalance(driver.user.id)).toBe(split.driverEarningMinor)
    // Platform credited exactly 15%.
    const commission = await db().walletEntry.findFirst({ where: { referenceType: 'sr_admin_commission', referenceId: ride.id, type: 'CREDIT' } })
    expect(commission).not.toBeNull()
    expect(commission.amountMinor).toBe(split.adminCommissionMinor)
  })

  it('charging is idempotent: settling a completed ride twice never double-charges', async () => {
    const rider = await registerUser(app, 'GUEST', 'idem-rider')
    await fundRider(rider.user.id, 10_000_000)
    const driver = await registerVerifiedDriver(app, 'idem-driver')

    const ride = (await requestRide(app, rider.token, 'idem')).body.ride
    await driveToCompletion(app, driver.token, ride.id)

    const riderAfterFirst = await walletBalance(rider.user.id)
    const driverAfterFirst = await walletBalance(driver.user.id)

    // The HTTP status machine already blocks a second COMPLETED (terminal state)...
    const secondComplete = await request(app)
      .patch(`/api/driver/rides/${ride.id}/status`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ status: 'COMPLETED' })
    expect(secondComplete.status).toBe(400)

    // ...and the money layer is independently idempotent: re-running the charge is a no-op.
    const fresh = await db().rideRequest.findUnique({ where: { id: ride.id } })
    const result = await db().$transaction((tx) => chargeCompletedRide(tx, fresh))
    expect(result.charged).toBe(false)
    expect(result.reason).toBe('already_charged')

    expect(await walletBalance(rider.user.id)).toBe(riderAfterFirst)
    expect(await walletBalance(driver.user.id)).toBe(driverAfterFirst)
    const fareEntries = await db().walletEntry.findMany({ where: { referenceType: 'sr_ride_fare', referenceId: ride.id } })
    expect(fareEntries).toHaveLength(1)
  })

  it('fails closed before moving fare money when the platform account is missing', async () => {
    const rider = await registerUser(app, 'GUEST', 'no-admin-rider')
    const driver = await registerVerifiedDriver(app, 'no-admin-driver')
    await fundRider(rider.user.id, 10_000)
    const ride = {
      id: crypto.randomUUID(), riderId: rider.user.id, driverId: driver.user.id,
      fareMinor: 1_000, currency: 'SYP', status: 'COMPLETED',
    }
    await db().userRole.deleteMany({ where: { role: 'ADMIN' } })
    try {
      await expect(db().$transaction((tx) => chargeCompletedRide(tx, ride))).rejects.toMatchObject({ code: 'PLATFORM_ACCOUNT_MISSING', statusCode: 503 })
      expect(await walletBalance(rider.user.id)).toBe(10_000)
      expect(await walletBalance(driver.user.id)).toBe(0)
      expect(await db().walletEntry.count({ where: { referenceId: ride.id } })).toBe(0)
    } finally {
      await ensurePlatformAdmin()
    }
  })

  it('the rider-facing ride payload never exposes commission or the driver share', async () => {
    const rider = await registerUser(app, 'GUEST', 'hidden-rider')
    await fundRider(rider.user.id, 10_000_000)
    const driver = await registerVerifiedDriver(app, 'hidden-driver')

    const ride = (await requestRide(app, rider.token, 'hidden')).body.ride
    await driveToCompletion(app, driver.token, ride.id)

    const view = await request(app).get(`/api/sr/rides/${ride.id}`).set('Authorization', `Bearer ${rider.token}`)
    expect(view.status).toBe(200)
    const serialized = JSON.stringify(view.body)
    expect(serialized).not.toMatch(/commission/i)
    expect(serialized).not.toMatch(/driverEarning/i)
    expect(serialized).not.toMatch(/adminShare|platformFee/i)
    expect(view.body.ride).not.toHaveProperty('adminCommissionMinor')
    expect(view.body.ride).not.toHaveProperty('driverEarningMinor')
  })

  it('admin SR payout: refuses without a payout method, then pays accrued earnings exactly once', async () => {
    const rider = await registerUser(app, 'GUEST', 'payout-rider')
    await fundRider(rider.user.id, 10_000_000)
    const driver = await registerVerifiedDriver(app, 'payout-driver')

    const ride = (await requestRide(app, rider.token, 'payout')).body.ride
    await driveToCompletion(app, driver.token, ride.id)
    const accrued = await walletBalance(driver.user.id)
    expect(accrued).toBeGreaterThan(0)

    // Mint an admin-capable session: context.roles is read fresh from the DB per request
    // (auth-context.mjs), so granting the ADMIN role to a staff account makes its existing token
    // admin-authorized on the next call.
    const staff = await registerUser(app, 'DRIVER', 'payout-admin')
    await db().userRole.create({ data: { userId: staff.user.id, role: 'ADMIN' } })
    const adminAuth = `Bearer ${staff.token}`

    // Refuses without a payout method on file.
    const noMethod = await request(app)
      .post(`/api/admin/sr-payouts/${driver.user.id}/release`)
      .set('Authorization', adminAuth)
      .send({ payoutRef: 'ref-1', currency: 'SYP' })
    expect(noMethod.status).toBe(400)
    expect(noMethod.body.error.code).toBe('PAYOUT_METHOD_REQUIRED')

    // Add a Sham Cash payout method.
    await db().driverProfile.upsert({
      where: { userId: driver.user.id },
      create: { userId: driver.user.id, payoutMethod: 'SHAM_CASH', payoutAccountRef: '0999-000-111' },
      update: { payoutMethod: 'SHAM_CASH', payoutAccountRef: '0999-000-111' },
    })

    // Pays the accrued balance once.
    const first = await request(app)
      .post(`/api/admin/sr-payouts/${driver.user.id}/release`)
      .set('Authorization', adminAuth)
      .send({ payoutRef: 'ref-1', currency: 'SYP' })
    expect(first.status).toBe(200)
    expect(first.body.walletEntry.amountMinor).toBe(accrued)
    expect(await walletBalance(driver.user.id)).toBe(0)

    // Idempotent: same payoutRef returns the same entry and never pays again.
    const retry = await request(app)
      .post(`/api/admin/sr-payouts/${driver.user.id}/release`)
      .set('Authorization', adminAuth)
      .send({ payoutRef: 'ref-1', currency: 'SYP' })
    expect(retry.status).toBe(200)
    expect(retry.body.walletEntry.id).toBe(first.body.walletEntry.id)
    expect(await walletBalance(driver.user.id)).toBe(0)

    // Never pays more than accrued (nothing left now).
    const nothing = await request(app)
      .post(`/api/admin/sr-payouts/${driver.user.id}/release`)
      .set('Authorization', adminAuth)
      .send({ payoutRef: 'ref-2', currency: 'SYP' })
    expect(nothing.status).toBe(400)
    expect(nothing.body.error.code).toBe('SR_PAYOUT_NOTHING_TO_PAY')
  })
})
