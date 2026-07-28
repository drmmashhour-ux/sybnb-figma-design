import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { finalizeStripeSession } from '../../server/routes/payments.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// P5 — Stripe booking card-payment logic, tested locally WITHOUT live Stripe (no keys required).
// The capture model is IMMEDIATE CAPTURE via Checkout Sessions: `finalizeStripeSession(session)`
// runs only when session.payment_status === 'paid', creates a `stripe` proof, auto-approves it, and
// confirms the booking. It takes a plain session object and makes NO live Stripe call, so duplicate /
// delayed / out-of-order `checkout.session.completed` webhooks and replay are all exercised here with
// fabricated sessions — the same pattern test/api/wallet-topup-card.test.mjs uses for top-ups.
//
// NOTE: authorize→capture is NOT implemented (no capture_method:'manual', no separate capture call).
// Whether STR needs a hold-then-capture is the open P5 product decision; this suite proves the
// current immediate-capture path is correct + idempotent, and that the HTTP endpoints fail closed
// when Stripe is unconfigured.

function paidBookingSession(id, bookingId, sypTotalMinor) {
  return { id, payment_status: 'paid', payment_intent: `pi_test_${id}`, metadata: { bookingId, sypTotalMinor: String(sypTotalMinor) } }
}

describe('P5: Stripe booking card payment (immediate capture) — correctness + idempotency + fail-closed', () => {
  let app
  let host

  beforeAll(async () => {
    app = testApp()
    // An admin must exist so approvePaymentProof can credit the platform commission.
    const admin = await db().user.create({
      data: { email: uniqueTestEmail('stripe-admin'), displayName: 'Stripe Admin', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'ADMIN' } } },
    })
    trackTestUser(admin.id)
    host = await db().user.create({
      data: { email: uniqueTestEmail('stripe-host'), displayName: 'Stripe Host', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'HOST' } } },
    })
    trackTestUser(host.id)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }

  async function makeListing() {
    return db().listing.create({
      data: { ownerId: host.id, division: 'STAYS', titleAr: 'وحدة ستريب', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: true },
    })
  }

  async function makePendingBooking(guestId, dayOffset) {
    const listing = await makeListing()
    const checkIn = new Date()
    checkIn.setUTCDate(checkIn.getUTCDate() + dayOffset)
    checkIn.setUTCHours(0, 0, 0, 0)
    return db().booking.create({
      data: { listingId: listing.id, guestId, status: 'PAYMENT_PENDING', checkIn, checkOut: new Date(checkIn.getTime() + 2 * 86400000), amountMinor: 100_00, currency: 'USD' },
    })
  }

  const statusOf = async (id) => (await db().booking.findUnique({ where: { id } }))?.status

  it('successful card payment: a paid session confirms the booking via an auto-approved stripe proof', async () => {
    const guest = await registerGuest('stripe-ok')
    const booking = await makePendingBooking(guest.id, 1200)
    const session = paidBookingSession(`cs_test_${Date.now()}_OK`, booking.id, 100_00)

    const approved = await finalizeStripeSession(session)
    expect(approved).not.toBeNull()

    expect(await statusOf(booking.id)).toBe('CONFIRMED')
    const proof = await db().paymentProof.findFirst({ where: { provider: 'stripe', providerRef: session.id } })
    expect(proof.status).toBe('APPROVED')
    // The split ran: host payout HELD, platform commission credited.
    const hold = await db().walletEntry.findFirst({ where: { referenceType: 'booking_payout', referenceId: booking.id, type: 'HOLD' } })
    expect(hold).not.toBeNull()
  })

  it('duplicate / delayed webhook: replaying the same session does NOT create a second proof or payout', async () => {
    const guest = await registerGuest('stripe-dup')
    const booking = await makePendingBooking(guest.id, 1210)
    const session = paidBookingSession(`cs_test_${Date.now()}_DUP`, booking.id, 100_00)

    await finalizeStripeSession(session)
    await finalizeStripeSession(session) // duplicate/delayed webhook delivery
    await finalizeStripeSession(session) // out-of-order re-delivery

    const proofs = await db().paymentProof.count({ where: { provider: 'stripe', providerRef: session.id } })
    expect(proofs).toBe(1)
    const holds = await db().walletEntry.count({ where: { referenceType: 'booking_payout', referenceId: booking.id, type: 'HOLD' } })
    expect(holds).toBe(1)
    expect(await statusOf(booking.id)).toBe('CONFIRMED')
  })

  it('unpaid session (payment failure after booking creation): no proof, booking stays PAYMENT_PENDING', async () => {
    const guest = await registerGuest('stripe-unpaid')
    const booking = await makePendingBooking(guest.id, 1220)
    const session = paidBookingSession(`cs_test_${Date.now()}_UNPAID`, booking.id, 100_00)
    session.payment_status = 'unpaid'

    const result = await finalizeStripeSession(session)
    expect(result).toBeNull()
    expect(await statusOf(booking.id)).toBe('PAYMENT_PENDING')
    const proofs = await db().paymentProof.count({ where: { bookingId: booking.id } })
    expect(proofs).toBe(0)
  })

  it('out-of-order: a late session for an already-CONFIRMED booking does not double-pay', async () => {
    const guest = await registerGuest('stripe-ooo')
    const booking = await makePendingBooking(guest.id, 1230)
    // First session confirms it.
    await finalizeStripeSession(paidBookingSession(`cs_test_${Date.now()}_A`, booking.id, 100_00))
    expect(await statusOf(booking.id)).toBe('CONFIRMED')
    // A DIFFERENT late session for the same (now non-pending) booking is a no-op.
    const late = await finalizeStripeSession(paidBookingSession(`cs_test_${Date.now()}_B`, booking.id, 100_00))
    expect(late).toBeNull()
    const holds = await db().walletEntry.count({ where: { referenceType: 'booking_payout', referenceId: booking.id, type: 'HOLD' } })
    expect(holds).toBe(1) // still exactly one payout
  })

  it('fail-closed: Stripe HTTP endpoints return 503 when Stripe is not configured (no keys in this env)', async () => {
    // The webhook needs no auth — requireStripe() fails closed before any processing.
    const webhook = await request(app).post('/api/payments/stripe/webhook').send({})
    expect(webhook.status).toBe(503)
  })
})
