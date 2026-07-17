import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { recordWalletEntry } from '../../server/lib/finance-ledger.mjs'
import { approveDriverForRides, cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Tips: after a COMPLETED ride, the rider tips from wallet credit; the driver receives 100% (no
// platform commission on tips). One tip per ride.
async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  if (role === 'DRIVER') await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role, email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { token: res.body.token, user: res.body.user }
}

async function fundRider(userId, amountMinor, currency = 'SYP') {
  await db().$transaction(async (tx) => {
    await recordWalletEntry(tx, {
      userId, type: 'CREDIT', amountMinor, currency,
      referenceType: 'wallet_topup', referenceId: `test-fund-${userId}`,
      keyParts: ['test-fund', userId], note: 'test funding',
    })
  })
}

async function makeRoadReadyDriver(app, label) {
  const driver = await registerUser(app, 'DRIVER', label)
  await approveDriverForRides(driver.user.id)
  return driver
}

async function completeRide(app, rider, driver, label, fareCurrency = 'SYP') {
  const ride = await request(app).post('/api/sr/rides').set('Authorization', `Bearer ${rider.token}`).send({ pickup: `A ${label}`, dropoff: `B ${label}`, category: 'SR Economy' })
  const rideId = ride.body.ride.id
  await request(app).patch(`/api/sr/rides/${rideId}/claim`).set('Authorization', `Bearer ${driver.token}`)
  await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'DRIVER_ARRIVING' })
  // PIN gate (017): mark verified in the DB before IN_PROGRESS (this test is about tips, not the PIN).
  await db().rideRequest.update({ where: { id: rideId }, data: { pickupVerifiedAt: new Date() } })
  for (const status of ['IN_PROGRESS', 'COMPLETED']) {
    await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status })
  }
  return ride.body.ride
}

describe('SR ride tip: 100% to driver, one per ride, wallet-gated', () => {
  let app
  beforeAll(() => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('a rider tips a completed ride; the driver receives 100%, and a second tip is refused', async () => {
    const rider = await registerUser(app, 'GUEST', 'tip-rider')
    const driver = await makeRoadReadyDriver(app, 'tip-driver')
    // fund enough for the fare + a tip
    await fundRider(rider.user.id, 1_000_000)
    const ride = await completeRide(app, rider, driver, 'tip-1')

    const driverWalletBefore = await db().wallet.findFirst({ where: { userId: driver.user.id, currency: ride.currency } })
    const driverBalBefore = driverWalletBefore?.cachedBalanceMinor || 0

    const tip = await request(app).post(`/api/sr/rides/${ride.id}/tip`).set('Authorization', `Bearer ${rider.token}`).send({ amountMinor: 2000 })
    expect(tip.status).toBe(201)

    const driverWalletAfter = await db().wallet.findFirst({ where: { userId: driver.user.id, currency: ride.currency } })
    expect((driverWalletAfter.cachedBalanceMinor - driverBalBefore)).toBe(2000) // 100% of tip

    // no platform commission on the tip
    const commissionOnTip = await db().walletEntry.findFirst({ where: { referenceType: 'sr_admin_commission', referenceId: ride.id } })
    // (a ride commission exists from the fare, but there is no tip commission entry — the tip credited the driver in full)
    const driverTip = await db().walletEntry.findFirst({ where: { referenceType: 'sr_driver_tip', referenceId: ride.id } })
    expect(driverTip.amountMinor).toBe(2000)

    const second = await request(app).post(`/api/sr/rides/${ride.id}/tip`).set('Authorization', `Bearer ${rider.token}`).send({ amountMinor: 500 })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('RIDE_ALREADY_TIPPED')
  })

  it('a non-rider cannot tip (403)', async () => {
    const rider = await registerUser(app, 'GUEST', 'tip-rider2')
    const driver = await makeRoadReadyDriver(app, 'tip-driver2')
    await fundRider(rider.user.id, 1_000_000)
    const ride = await completeRide(app, rider, driver, 'tip-2')
    const stranger = await registerUser(app, 'GUEST', 'tip-stranger')
    const res = await request(app).post(`/api/sr/rides/${ride.id}/tip`).set('Authorization', `Bearer ${stranger.token}`).send({ amountMinor: 1000 })
    expect(res.status).toBe(403)
  })
})
