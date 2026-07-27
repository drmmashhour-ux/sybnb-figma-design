import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { recordHostContractConsent } from '../../server/lib/host-consent.mjs'
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

  // Regression for the CRITICAL cross-mechanism double-refund fix (disputes.mjs): a dispute REFUND on an
  // STR booking must atomically move the booking to CANCELLED, so the booking's OWN guest-cancel refund
  // path (keyed differently, and thus not blocked by the subject-keyed dispute-refund idempotency guard)
  // can no longer pay the guest a second time. Before the fix, dispute-refund left the booking CONFIRMED
  // and a subsequent cancel issued a second `booking_refund` credit.
  describe('STR booking: dispute refund is not double-paid by a later guest cancel', () => {
    async function setUpConfirmedPaidBooking(adminId, label) {
      const hostEmail = uniqueTestEmail(`${label}-host`)
      await verifyEmailForTest(app, hostEmail, 'staff-login')
      const hostRes = await request(app).post('/api/auth/register').send({ role: 'HOST', email: hostEmail, password: 'correct-horse-battery' })
      trackTestUser(hostRes.body.user.id)

      const guestEmail = uniqueTestEmail(`${label}-guest`)
      await verifyEmailForTest(app, guestEmail)
      const guestRes = await request(app).post('/api/auth/register').send({ role: 'GUEST', email: guestEmail, password: 'correct-horse-battery' })
      trackTestUser(guestRes.body.user.id)

      const listing = await db().listing.create({
        // instantBookEnabled so approvePaymentProof transitions the booking straight to CONFIRMED
        // (otherwise it lands in REQUESTED, which is not disputable).
        data: { ownerId: hostRes.body.user.id, division: 'STAYS', titleAr: 'اختبار النزاع', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: true },
      })
      // M6/M3-A: instant-book auto-confirm requires the host's current-version contract consent (the host
      // would have accepted it at publish). Record it so approvePaymentProof confirms rather than degrading.
      await recordHostContractConsent(db(), { userId: hostRes.body.user.id, action: 'publish' })
      const checkIn = new Date()
      checkIn.setUTCDate(checkIn.getUTCDate() + 30) // well before the free-cancellation cutoff → a plain cancel would fully refund
      const booking = await db().booking.create({
        data: {
          listingId: listing.id,
          guestId: guestRes.body.user.id,
          status: 'PAYMENT_PENDING', // approvePaymentProof claims PAYMENT_PENDING → CONFIRMED exactly once
          checkIn,
          checkOut: new Date(checkIn.getTime() + 2 * 24 * 60 * 60 * 1000),
          amountMinor: 100_00,
          currency: 'USD',
        },
      })
      const proof = await db().paymentProof.create({
        data: { bookingId: booking.id, userId: guestRes.body.user.id, provider: 'sham_cash', status: 'PENDING_ADMIN_REVIEW', amountMinor: 100_00, currency: 'USD' },
      })
      await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: adminId }))
      return { bookingId: booking.id, guestId: guestRes.body.user.id, guestToken: guestRes.body.token }
    }

    it('dispute-refunding a CONFIRMED booking cancels it, and a later cancel refunds nothing (no double refund)', async () => {
      const admin = await db().user.create({
        data: { email: uniqueTestEmail('booking-dispute-admin'), displayName: 'Booking Dispute Admin', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'ADMIN' } } },
        include: { roles: true },
      })
      trackTestUser(admin.id)
      const adminToken = createSessionToken(admin)

      const { bookingId, guestId, guestToken } = await setUpConfirmedPaidBooking(admin.id, 'bk-dispute')

      // Guest opens a dispute on the confirmed booking; a DISTINCT admin refunds it — F2.1 forbids the payment
      // verifier (admin, above) from also approving the refund, so a second adjudicating admin resolves it.
      const resolverToken = await bootstrapAdmin('bk-dispute-resolver')
      const dispute = (await request(app).post('/api/disputes').set('Authorization', `Bearer ${guestToken}`).send({ bookingId, reason: 'host misrepresented the stay' })).body.dispute
      expect(dispute.subjectType).toBe('STR_BOOKING')
      const resolve = await request(app).patch(`/api/admin/disputes/${dispute.id}`).set('Authorization', `Bearer ${resolverToken}`).send({ decision: 'REFUND', note: 'valid complaint' })
      expect(resolve.status).toBe(200)
      expect(resolve.body.dispute.status).toBe('RESOLVED_REFUNDED')

      // The booking is now CANCELLED, and the guest was credited exactly once, keyed on the booking.
      expect((await db().booking.findUnique({ where: { id: bookingId } })).status).toBe('CANCELLED')
      const disputeRefunds = await db().walletEntry.findMany({ where: { referenceType: 'dispute_refund', referenceId: bookingId } })
      expect(disputeRefunds).toHaveLength(1)
      const balanceAfterRefund = (await db().wallet.findUnique({ where: { userId_currency: { userId: guestId, currency: 'USD' } } }))?.cachedBalanceMinor || 0

      // A subsequent guest cancel must NOT issue a second refund: the booking is no longer cancellable.
      const cancel = await request(app).patch(`/api/bookings/${bookingId}/cancel`).set('Authorization', `Bearer ${guestToken}`).send({})
      expect(cancel.status).toBe(400)
      expect(cancel.body.error.code).toBe('BOOKING_NOT_CANCELLABLE')

      // No booking_refund credit was ever created, and the balance is unchanged since the single dispute refund.
      const bookingRefunds = await db().walletEntry.findMany({ where: { referenceType: 'booking_refund', referenceId: bookingId } })
      expect(bookingRefunds).toHaveLength(0)
      const balanceAfterCancel = (await db().wallet.findUnique({ where: { userId_currency: { userId: guestId, currency: 'USD' } } }))?.cachedBalanceMinor || 0
      expect(balanceAfterCancel).toBe(balanceAfterRefund)
    })
  })
})
