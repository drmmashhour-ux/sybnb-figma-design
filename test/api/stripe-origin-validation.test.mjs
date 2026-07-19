import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Regression coverage for an open-redirect fix: POST /api/payments/stripe/create-checkout-session
// and POST /api/wallet/topup/stripe-checkout both build a Stripe Checkout success_url/cancel_url
// directly from the client-supplied `origin` field with no validation. An attacker could pass
// origin: 'https://evil.example' and, right after a REAL captured payment, the guest would be
// redirected to that attacker-controlled URL with the Stripe session id in the query string --
// prime real estate for a post-payment phishing page. The fix validates `origin` against the same
// allow-list CORS_ORIGINS already uses for CORS. STRIPE_SECRET_KEY is deliberately unset in the
// test environment (.env.test), so these tests only exercise the origin check itself: a bad origin
// must be rejected before ever reaching the Stripe API, and a good origin must pass the origin
// check and fail LATER with STRIPE_NOT_CONFIGURED (proving the origin gate isn't over-rejecting).
describe('Stripe checkout endpoints validate `origin` against the CORS allow-list (open-redirect fix)', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  async function registerHost(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  describe('POST /api/payments/stripe/create-checkout-session', () => {
    it('rejects an attacker-controlled origin (open-redirect attempt) before ever reaching Stripe', async () => {
      const host = await registerHost('stripe-origin-host-1')
      const guest = await registerGuest('stripe-origin-guest-1')
      const listing = await db().listing.create({
        data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'اختبار الأصل', priceMinor: 50_00, currency: 'USD', status: 'APPROVED' },
      })
      const booking = await db().booking.create({
        data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', amountMinor: 50_00, currency: 'USD' },
      })

      const res = await request(app)
        .post('/api/payments/stripe/create-checkout-session')
        .set('authorization', `Bearer ${guest.token}`)
        .send({ bookingId: booking.id, origin: 'https://evil.example' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('STRIPE_SESSION_ORIGIN_NOT_ALLOWED')
    })

    it('accepts a real allowed origin (passes the origin gate, fails later on Stripe not being configured in tests)', async () => {
      const host = await registerHost('stripe-origin-host-2')
      const guest = await registerGuest('stripe-origin-guest-2')
      const listing = await db().listing.create({
        data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'اختبار الأصل', priceMinor: 50_00, currency: 'USD', status: 'APPROVED' },
      })
      const booking = await db().booking.create({
        data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', amountMinor: 50_00, currency: 'USD' },
      })
      // Contact info is required before payment can start (see booking-contact.test.mjs) -- set it
      // here so this test actually reaches the origin/Stripe-config checks it's exercising.
      await request(app)
        .patch(`/api/bookings/${booking.id}/contact`)
        .set('authorization', `Bearer ${guest.token}`)
        .send({ guestName: 'Origin Test Guest', guestPhone: '+963991112233' })

      const res = await request(app)
        .post('/api/payments/stripe/create-checkout-session')
        .set('authorization', `Bearer ${guest.token}`)
        .send({ bookingId: booking.id, origin: 'http://127.0.0.1:3050' })

      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe('STRIPE_NOT_CONFIGURED')
    })
  })

  describe('POST /api/wallet/topup/stripe-checkout', () => {
    it('rejects an attacker-controlled origin before ever reaching Stripe', async () => {
      const guest = await registerGuest('stripe-origin-guest-3')

      const res = await request(app)
        .post('/api/wallet/topup/stripe-checkout')
        .set('authorization', `Bearer ${guest.token}`)
        .send({ baseMinor: 100, origin: 'https://evil.example' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('STRIPE_SESSION_ORIGIN_NOT_ALLOWED')
    })

    it('accepts a real allowed origin (passes the origin gate, fails later on Stripe not being configured in tests)', async () => {
      const guest = await registerGuest('stripe-origin-guest-4')

      const res = await request(app)
        .post('/api/wallet/topup/stripe-checkout')
        .set('authorization', `Bearer ${guest.token}`)
        .send({ baseMinor: 100, origin: 'http://127.0.0.1:3050' })

      expect(res.status).toBe(503)
      expect(res.body.error.code).toBe('STRIPE_NOT_CONFIGURED')
    })
  })
})
