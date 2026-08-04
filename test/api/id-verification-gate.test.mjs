import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Policy: guests are NOT required to upload an ID document to book or pay -- same as Airbnb/Booking,
// which never ask a guest for identity documents to make a reservation. (Identity/ownership
// verification remains a HOST-side concern during listing.) This locks in that a guest with no ID
// document on file can still pay, so the gate never silently returns.
describe('Payment endpoints do NOT require a guest ID document', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function setUpUnpaidBooking() {
    const hostEmail = uniqueTestEmail('id-gate-host')
    const legacyVerificationGrant1 = await verifyEmailForTest(app, hostEmail, 'staff-login')
    const hostRes = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1,
      role: 'HOST',
      email: hostEmail,
      password: 'correct-horse-battery',
    })
    trackTestUser(hostRes.body.user.id)

    const guestEmail = uniqueTestEmail('id-gate-guest')
    const legacyVerificationGrant2 = await verifyEmailForTest(app, guestEmail)
    const guestRes = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant2,
      role: 'GUEST',
      email: guestEmail,
      password: 'correct-horse-battery',
    })
    const guestId = guestRes.body.user.id
    const guestToken = guestRes.body.token
    trackTestUser(guestId)

    const listing = await db().listing.create({
      data: {
        ownerId: hostRes.body.user.id,
        division: 'STAYS',
        titleAr: 'اختبار التحقق من الهوية',
        priceMinor: 50_00,
        currency: 'USD',
        status: 'APPROVED',
      },
    })

    const booking = await db().booking.create({
      data: {
        listingId: listing.id,
        guestId,
        status: 'PAYMENT_PENDING',
        amountMinor: 50_00,
        currency: 'USD',
      },
    })

    return { bookingId: booking.id, guestId, guestToken }
  }

  it('does not reject a Stripe checkout session for a guest with no ID document', async () => {
    const { bookingId, guestToken } = await setUpUnpaidBooking()

    const res = await request(app)
      .post('/api/payments/stripe/create-checkout-session')
      .set('authorization', `Bearer ${guestToken}`)
      .send({ bookingId, origin: 'https://sybnb.app' })

    // Stripe is not configured in the test environment, so this returns 503 STRIPE_NOT_CONFIGURED --
    // NOT the old 403 ID_VERIFICATION_REQUIRED. The important assertion is that the request is never
    // blocked for lack of an ID document.
    expect(res.body.error?.code).not.toBe('ID_VERIFICATION_REQUIRED')
  })

  it('accepts a local-wallet payment proof even when the guest has no ID document on file', async () => {
    const { bookingId, guestToken } = await setUpUnpaidBooking()

    const res = await request(app)
      .post('/api/payments/local-wallet-proof')
      .set('authorization', `Bearer ${guestToken}`)
      .send({ bookingId, providerRef: `test-ref-${bookingId}` })

    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
  })
})
