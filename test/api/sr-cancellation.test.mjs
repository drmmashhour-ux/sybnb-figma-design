import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { computeRiderCancelFee, SR_CANCELLATION_CONFIG } from '../../server/lib/sr-cancellation.mjs'
import {
  approveDriverForRides,
  cleanupTestUsers,
  fundWallet,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

async function registerRider(app, label) {
  const email = uniqueTestEmail(label)
  const legacyVerificationGrant1 = await verifyEmailForTest(app, email)
  const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'GUEST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  await fundWallet(res.body.user.id)
  return { token: res.body.token, user: res.body.user }
}

async function registerDriver(app, label) {
  const email = uniqueTestEmail(label)
  const legacyVerificationGrant2 = await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant2, role: 'DRIVER', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  await approveDriverForRides(res.body.user.id)
  return { token: res.body.token, user: res.body.user }
}

async function requestRide(app, riderToken, label) {
  const res = await request(app)
    .post('/api/sr/rides')
    .set('Authorization', `Bearer ${riderToken}`)
    .send({ pickup: `Malki ${label}`, dropoff: `Mezzeh ${label}`, category: 'SR Economy' })
  return res.body.ride
}

async function claim(app, driverToken, rideId) {
  return request(app).patch(`/api/sr/rides/${rideId}/claim`).set('Authorization', `Bearer ${driverToken}`)
}

async function cancelAsRider(app, riderToken, rideId) {
  return request(app).post(`/api/sr/rides/${rideId}/cancel`).set('Authorization', `Bearer ${riderToken}`).send({})
}

const walletBalance = async (userId, currency = 'SYP') => {
  const w = await db().wallet.findUnique({ where: { userId_currency: { userId, currency } } })
  return w?.cachedBalanceMinor || 0
}

// Force a ride's driver-match anchor into the past so the grace window has elapsed.
async function expireGrace(rideId) {
  const past = new Date(Date.now() - (SR_CANCELLATION_CONFIG.graceWindowSeconds + 60) * 1000)
  await db().rideRequest.update({ where: { id: rideId }, data: { driverMatchedAt: past } })
}

describe('SR cancellation layer: rider grace/fee + driver re-dispatch/accountability', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  describe('rider cancels', () => {
    it('is free before a driver is matched (REQUESTED)', async () => {
      const rider = await registerRider(app, 'c-free-req')
      const ride = await requestRide(app, rider.token, 'free-req')
      const before = await walletBalance(rider.user.id)
      const res = await cancelAsRider(app, rider.token, ride.id)
      expect(res.status).toBe(200)
      expect(res.body.ride.status).toBe('CANCELLED')
      expect(res.body.cancellationFeeMinor).toBe(0)
      expect(await walletBalance(rider.user.id)).toBe(before) // not charged
    })

    it('is free within the grace window after a driver is matched', async () => {
      const rider = await registerRider(app, 'c-free-grace')
      const driver = await registerDriver(app, 'c-free-grace-drv')
      const ride = await requestRide(app, rider.token, 'free-grace')
      await claim(app, driver.token, ride.id) // driverMatchedAt = now, well within grace
      const riderBefore = await walletBalance(rider.user.id)
      const driverBefore = await walletBalance(driver.user.id)
      const res = await cancelAsRider(app, rider.token, ride.id)
      expect(res.status).toBe(200)
      expect(res.body.cancellationFeeMinor).toBe(0)
      expect(await walletBalance(rider.user.id)).toBe(riderBefore)
      expect(await walletBalance(driver.user.id)).toBe(driverBefore)
    })

    it('charges a late-cancel fee (100% to the driver) after the grace window', async () => {
      const rider = await registerRider(app, 'c-late')
      const driver = await registerDriver(app, 'c-late-drv')
      const ride = await requestRide(app, rider.token, 'late')
      await claim(app, driver.token, ride.id)
      await expireGrace(ride.id)

      const riderBefore = await walletBalance(rider.user.id)
      const driverBefore = await walletBalance(driver.user.id)
      const expectedFee = computeRiderCancelFee(ride.fareMinor)
      expect(expectedFee).toBeGreaterThan(0)

      const res = await cancelAsRider(app, rider.token, ride.id)
      expect(res.status).toBe(200)
      expect(res.body.ride.status).toBe('CANCELLED')
      expect(res.body.cancellationFeeMinor).toBe(expectedFee)

      // Rider debited exactly the fee; driver credited exactly the fee (no platform cut).
      expect(await walletBalance(rider.user.id)).toBe(riderBefore - expectedFee)
      expect(await walletBalance(driver.user.id)).toBe(driverBefore + expectedFee)

      const commission = await db().walletEntry.findFirst({ where: { referenceType: 'sr_admin_commission', referenceId: ride.id } })
      expect(commission).toBeNull() // no commission on a cancellation
    })

    it('cannot cancel once the trip is IN_PROGRESS', async () => {
      const rider = await registerRider(app, 'c-inprog')
      const driver = await registerDriver(app, 'c-inprog-drv')
      const ride = await requestRide(app, rider.token, 'inprog')
      await claim(app, driver.token, ride.id)
      await request(app).patch(`/api/driver/rides/${ride.id}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'DRIVER_ARRIVING' })
      await db().rideRequest.update({ where: { id: ride.id }, data: { pickupVerifiedAt: new Date() } })
      await request(app).patch(`/api/driver/rides/${ride.id}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'IN_PROGRESS' })

      const res = await cancelAsRider(app, rider.token, ride.id)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('RIDE_ALREADY_STARTED')
    })

    it('a stranger cannot cancel someone else’s ride', async () => {
      const rider = await registerRider(app, 'c-owner')
      const stranger = await registerRider(app, 'c-stranger')
      const ride = await requestRide(app, rider.token, 'owner')
      const res = await cancelAsRider(app, stranger.token, ride.id)
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('RIDE_NOT_FOUND')
    })
  })

  describe('driver cancels', () => {
    it('re-dispatches the ride, records the cancellation, and does not charge the rider', async () => {
      const rider = await registerRider(app, 'd-cancel-rider')
      const driver = await registerDriver(app, 'd-cancel-drv')
      const ride = await requestRide(app, rider.token, 'd-cancel')
      await claim(app, driver.token, ride.id)
      const riderBefore = await walletBalance(rider.user.id)

      const res = await request(app)
        .patch(`/api/driver/rides/${ride.id}/status`)
        .set('Authorization', `Bearer ${driver.token}`)
        .send({ status: 'CANCELLED', reason: 'too far' })
      expect(res.status).toBe(200)
      expect(res.body.redispatched).toBe(true)
      expect(res.body.ride.status).toBe('REQUESTED')
      expect(res.body.ride.driverId).toBeNull()

      // Rider was not charged.
      expect(await walletBalance(rider.user.id)).toBe(riderBefore)
      // The cancellation is on the accountability ledger.
      const count = await db().driverCancellation.count({ where: { driverId: driver.user.id, rideId: ride.id } })
      expect(count).toBe(1)
    })

    it('blocks the cancelling driver from re-claiming, but a different driver can take it', async () => {
      const rider = await registerRider(app, 'd-reclaim-rider')
      const driverA = await registerDriver(app, 'd-reclaim-A')
      const driverB = await registerDriver(app, 'd-reclaim-B')
      const ride = await requestRide(app, rider.token, 'd-reclaim')
      await claim(app, driverA.token, ride.id)
      await request(app).patch(`/api/driver/rides/${ride.id}/status`).set('Authorization', `Bearer ${driverA.token}`).send({ status: 'CANCELLED' })

      const reclaim = await claim(app, driverA.token, ride.id)
      expect(reclaim.status).toBe(409)
      expect(reclaim.body.error.code).toBe('DRIVER_CANNOT_RECLAIM')

      const otherClaim = await claim(app, driverB.token, ride.id)
      expect(otherClaim.status).toBe(200)
      expect(otherClaim.body.ride.status).toBe('DRIVER_ASSIGNED')
    })

    it('admin can read a driver’s cancellation count', async () => {
      const admin = await db().user.create({
        data: { email: uniqueTestEmail('cx-admin'), displayName: 'Cancel Admin', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'ADMIN' } } },
        include: { roles: true },
      })
      trackTestUser(admin.id)
      const adminToken = createSessionToken(admin)

      const rider = await registerRider(app, 'd-count-rider')
      const driver = await registerDriver(app, 'd-count-drv')
      const ride = await requestRide(app, rider.token, 'd-count')
      await claim(app, driver.token, ride.id)
      await request(app).patch(`/api/driver/rides/${ride.id}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'CANCELLED' })

      const res = await request(app).get(`/api/admin/drivers/${driver.user.id}/cancellations`).set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.count).toBeGreaterThanOrEqual(1)
      expect(res.body.recent[0].rideId).toBe(ride.id)
    })
  })
})
