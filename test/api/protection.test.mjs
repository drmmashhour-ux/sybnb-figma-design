import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
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
  await verifyEmailForTest(app, email)
  const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  await fundWallet(res.body.user.id)
  return { token: res.body.token, user: res.body.user }
}

async function registerDriver(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role: 'DRIVER', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  await approveDriverForRides(res.body.user.id)
  return { token: res.body.token, user: res.body.user }
}

async function bootstrapAdmin(label) {
  const admin = await db().user.create({
    data: { email: uniqueTestEmail(label), displayName: 'Protection Admin', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'ADMIN' } } },
    include: { roles: true },
  })
  trackTestUser(admin.id)
  return createSessionToken(admin)
}

async function requestRide(app, riderToken, label) {
  const res = await request(app).post('/api/sr/rides').set('Authorization', `Bearer ${riderToken}`).send({ pickup: `Malki ${label}`, dropoff: `Mezzeh ${label}`, category: 'SR Economy' })
  return res.body.ride
}

async function completeRide(app, rider, driver, label) {
  const ride = await requestRide(app, rider.token, label)
  await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
  await request(app).patch(`/api/driver/rides/${ride.id}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'DRIVER_ARRIVING' })
  await db().rideRequest.update({ where: { id: ride.id }, data: { pickupVerifiedAt: new Date() } })
  for (const status of ['IN_PROGRESS', 'COMPLETED']) {
    await request(app).patch(`/api/driver/rides/${ride.id}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status })
  }
  return ride
}

const walletBalance = async (userId, currency = 'SYP') => {
  const w = await db().wallet.findUnique({ where: { userId_currency: { userId, currency } } })
  return w?.cachedBalanceMinor || 0
}

describe('Consumer protection: country config + dispute/refund', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  describe('country configuration', () => {
    it('exposes Syria operating rules', async () => {
      const res = await request(app).get('/api/config/country/SY')
      expect(res.status).toBe(200)
      expect(res.body.country.currency).toBe('SYP')
      expect(res.body.country.disputeWindowHours).toBe(48)
      expect(res.body.country.vehicleAgeLimits['SR Economy']).toBe(10)
      expect(res.body.country.rtl).toBe(true)
    })

    it('404s an unconfigured country', async () => {
      const res = await request(app).get('/api/config/country/ZZ')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('COUNTRY_NOT_CONFIGURED')
    })
  })

  describe('opening a dispute', () => {
    it('a rider opens a dispute on their completed ride', async () => {
      const rider = await registerRider(app, 'disp-rider')
      const driver = await registerDriver(app, 'disp-driver')
      const ride = await completeRide(app, rider, driver, 'disp-1')
      const res = await request(app).post('/api/disputes').set('Authorization', `Bearer ${rider.token}`).send({ rideId: ride.id, reason: 'driver took a long detour' })
      expect(res.status).toBe(201)
      expect(res.body.dispute.status).toBe('OPEN')
      expect(res.body.dispute.subjectType).toBe('SR_RIDE')
    })

    it('a stranger cannot dispute a ride they were not on', async () => {
      const rider = await registerRider(app, 'disp-owner')
      const stranger = await registerRider(app, 'disp-stranger')
      const driver = await registerDriver(app, 'disp-driver2')
      const ride = await completeRide(app, rider, driver, 'disp-2')
      const res = await request(app).post('/api/disputes').set('Authorization', `Bearer ${stranger.token}`).send({ rideId: ride.id, reason: 'x' })
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('RIDE_NOT_FOUND')
    })

    it('cannot dispute a ride that is not completed', async () => {
      const rider = await registerRider(app, 'disp-incomplete')
      const ride = await requestRide(app, rider.token, 'disp-3') // REQUESTED, never completed
      const res = await request(app).post('/api/disputes').set('Authorization', `Bearer ${rider.token}`).send({ rideId: ride.id, reason: 'x' })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('RIDE_NOT_DISPUTABLE')
    })

    it('refuses a second open dispute for the same ride', async () => {
      const rider = await registerRider(app, 'disp-dup')
      const driver = await registerDriver(app, 'disp-dup-drv')
      const ride = await completeRide(app, rider, driver, 'disp-4')
      const first = await request(app).post('/api/disputes').set('Authorization', `Bearer ${rider.token}`).send({ rideId: ride.id, reason: 'a' })
      expect(first.status).toBe(201)
      const second = await request(app).post('/api/disputes').set('Authorization', `Bearer ${rider.token}`).send({ rideId: ride.id, reason: 'b' })
      expect(second.status).toBe(409)
      expect(second.body.error.code).toBe('DISPUTE_ALREADY_OPEN')
    })
  })

  describe('admin adjudication', () => {
    it('refunds the rider (capped at the fare) and closes the dispute — once', async () => {
      const adminToken = await bootstrapAdmin('refund-admin')
      const rider = await registerRider(app, 'refund-rider')
      const driver = await registerDriver(app, 'refund-driver')
      const ride = await completeRide(app, rider, driver, 'refund-1')
      const chargedBalance = await walletBalance(rider.user.id) // funded minus fare

      const dispute = (await request(app).post('/api/disputes').set('Authorization', `Bearer ${rider.token}`).send({ rideId: ride.id, reason: 'overcharged' })).body.dispute
      const resolve = await request(app).patch(`/api/admin/disputes/${dispute.id}`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'REFUND', note: 'goodwill' })
      expect(resolve.status).toBe(200)
      expect(resolve.body.dispute.status).toBe('RESOLVED_REFUNDED')
      expect(resolve.body.dispute.refundMinor).toBe(ride.fareMinor)

      // Rider credited exactly the fare back (refund entry is keyed on the ride/subject).
      expect(await walletBalance(rider.user.id)).toBe(chargedBalance + ride.fareMinor)
      const refundEntry = await db().walletEntry.findFirst({ where: { referenceType: 'dispute_refund', referenceId: ride.id } })
      expect(refundEntry.amountMinor).toBe(ride.fareMinor)

      // Re-resolving the SAME dispute is refused.
      const again = await request(app).patch(`/api/admin/disputes/${dispute.id}`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'REFUND' })
      expect(again.status).toBe(409)
      expect(again.body.error.code).toBe('DISPUTE_ALREADY_RESOLVED')

      // And a SECOND dispute on the already-refunded ride is blocked at open time — no double refund.
      const reopen = await request(app).post('/api/disputes').set('Authorization', `Bearer ${rider.token}`).send({ rideId: ride.id, reason: 'trying again' })
      expect(reopen.status).toBe(409)
      expect(reopen.body.error.code).toBe('SUBJECT_ALREADY_REFUNDED')
      // Balance unchanged — still exactly one refund.
      expect(await walletBalance(rider.user.id)).toBe(chargedBalance + ride.fareMinor)
    })

    it('rejects a dispute without any refund', async () => {
      const adminToken = await bootstrapAdmin('reject-admin')
      const rider = await registerRider(app, 'reject-rider')
      const driver = await registerDriver(app, 'reject-driver')
      const ride = await completeRide(app, rider, driver, 'reject-1')
      const balanceBefore = await walletBalance(rider.user.id)

      const dispute = (await request(app).post('/api/disputes').set('Authorization', `Bearer ${rider.token}`).send({ rideId: ride.id, reason: 'unfounded' })).body.dispute
      const resolve = await request(app).patch(`/api/admin/disputes/${dispute.id}`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'REJECT', note: 'fare was correct' })
      expect(resolve.status).toBe(200)
      expect(resolve.body.dispute.status).toBe('RESOLVED_REJECTED')
      expect(await walletBalance(rider.user.id)).toBe(balanceBefore) // no refund
    })

    it('a non-admin cannot adjudicate a dispute', async () => {
      const rider = await registerRider(app, 'noadmin-rider')
      const driver = await registerDriver(app, 'noadmin-driver')
      const ride = await completeRide(app, rider, driver, 'noadmin-1')
      const dispute = (await request(app).post('/api/disputes').set('Authorization', `Bearer ${rider.token}`).send({ rideId: ride.id, reason: 'x' })).body.dispute
      const res = await request(app).patch(`/api/admin/disputes/${dispute.id}`).set('Authorization', `Bearer ${rider.token}`).send({ decision: 'REFUND' })
      expect(res.status).toBe(403)
    })
  })
})
