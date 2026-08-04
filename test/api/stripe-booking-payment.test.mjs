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
    const legacyVerificationGrant1 = await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'GUEST', email, password: 'correct-horse-battery' })
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
    const adminShare = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: booking.id, type: 'CREDIT' } })
    expect(adminShare).not.toBeNull()
    expect(adminShare.amountMinor).toBe(10_00)
  })

  it('converts an open-checkout placeholder into the approved proof instead of losing a delayed payment', async () => {
    const guest = await registerGuest('stripe-placeholder')
    const booking = await makePendingBooking(guest.id, 1205)
    const session = paidBookingSession(`cs_test_${Date.now()}_PLACEHOLDER`, booking.id, 100_00)
    const placeholder = await db().paymentProof.create({
      data: {
        bookingId: booking.id,
        userId: guest.id,
        provider: 'stripe_checkout',
        status: 'PENDING_PROOF',
        amountMinor: 100_00,
        currency: 'USD',
        providerRef: session.id,
      },
    })

    const approved = await finalizeStripeSession(session)

    expect(approved.id).toBe(placeholder.id)
    expect(approved.provider).toBe('stripe')
    expect(approved.status).toBe('APPROVED')
    expect(await statusOf(booking.id)).toBe('CONFIRMED')
    expect(await db().paymentProof.count({ where: { bookingId: booking.id } })).toBe(1)
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

  it('fails closed and rolls back when no platform ADMIN account exists', async () => {
    await db().userRole.deleteMany({ where: { role: 'ADMIN' } })
    const guest = await registerGuest('stripe-no-admin')
    const booking = await makePendingBooking(guest.id, 1240)
    const session = paidBookingSession(`cs_test_${Date.now()}_NO_ADMIN`, booking.id, 100_00)

    await expect(finalizeStripeSession(session)).rejects.toMatchObject({ code: 'PLATFORM_ACCOUNT_MISSING', statusCode: 503 })
    expect(await statusOf(booking.id)).toBe('PAYMENT_PENDING')
    expect(await db().paymentProof.count({ where: { provider: 'stripe', providerRef: session.id } })).toBe(0)
    expect(await db().walletEntry.count({ where: { referenceId: booking.id } })).toBe(0)
  })

  it('fail-closed: Stripe HTTP endpoints return 503 when Stripe is not configured (no keys in this env)', async () => {
    // The webhook needs no auth — requireStripe() fails closed before any processing.
    const webhook = await request(app).post('/api/payments/stripe/webhook').send({})
    expect(webhook.status).toBe(503)
  })
})
