import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// AD2 — the admin payout-release control + verify-payment-proof-before-confirmation. Both are admin-only and
// audited; release is gated by the eligibility/hold policy; approving a proof is what lets a booking leave
// PAYMENT_PENDING (gates confirmation). This pins the behaviour (the eligibility gate was only source-guarded
// before; release-transitions-and-audits is also covered by the M5 suite).

describe('AD2 — payout release + proof review control', () => {
  let app, admin, host, guest, listing
  async function createUser(role, label) {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `T ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    return { token: createSessionToken(u), id: u.id }
  }
  beforeAll(async () => {
    app = testApp()
    admin = await createUser('ADMIN', 'ad2-admin'); host = await createUser('HOST', 'ad2-host'); guest = await createUser('GUEST', 'ad2-guest')
    listing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'شقة', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
  })
  afterAll(async () => {
    await db().paymentProof.deleteMany({ where: { userId: guest.id } }).catch(() => {})
    await db().booking.deleteMany({ where: { guestId: guest.id } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: listing.id } })
    await cleanupTestUsers()
  })

  // ---- Payout release: eligibility gate + admin-only ----
  it('refuses to release a payout that is not yet eligible (PAYOUT_NOT_ELIGIBLE)', async () => {
    // A CONFIRMED (not COMPLETED, hold not elapsed) booking is not eligible for release.
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'CONFIRMED', amountMinor: 100_00, currency: 'USD', checkIn: new Date(), checkOut: new Date() } })
    const res = await request(app).patch(`/api/admin/payouts/${booking.id}/release`).set('authorization', `Bearer ${admin.token}`).send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('PAYOUT_NOT_ELIGIBLE')
    await db().booking.deleteMany({ where: { id: booking.id } })
  })

  it('a non-admin cannot release a payout', async () => {
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'COMPLETED', amountMinor: 100_00, currency: 'USD', checkIn: new Date(), checkOut: new Date() } })
    const res = await request(app).patch(`/api/admin/payouts/${booking.id}/release`).set('authorization', `Bearer ${host.token}`).send({})
    expect(res.status).toBe(403)
    await db().booking.deleteMany({ where: { id: booking.id } })
  })

  // ---- Verify payment proof before confirmation: approval gates the booking + audited + admin-only ----
  async function pendingProof() {
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'PAYMENT_PENDING', amountMinor: 100_00, currency: 'USD' } })
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guest.id, provider: 'sham_cash', status: 'PENDING_ADMIN_REVIEW', amountMinor: 100_00, currency: 'USD' } })
    return { booking, proof }
  }

  it('approving a payment proof moves the booking out of PAYMENT_PENDING and writes a REVIEW_APPROVED audit', async () => {
    const { booking, proof } = await pendingProof()
    // Sham Cash verify-before-confirmation: the admin reconciles the received balance before approving.
    const res = await request(app).patch(`/api/admin/review-queue/payment/${proof.id}`).set('authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED', shamCashReconciliation: { accountMinor: 100_00, source: 'admin-ui' } })
    expect(res.status).toBeLessThan(400)
    const paidProof = await db().paymentProof.findUnique({ where: { id: proof.id } })
    expect(paidProof.status).toBe('APPROVED')
    const paidBooking = await db().booking.findUnique({ where: { id: booking.id } })
    expect(paidBooking.status).not.toBe('PAYMENT_PENDING') // confirmation gate cleared (REQUESTED for non-instant)
    const audit = await db().adminAuditLog.findFirst({ where: { action: 'REVIEW_APPROVED', entityId: proof.id } })
    expect(audit).toBeTruthy()
    expect(audit.actorUserId).toBe(admin.id)
  })

  it('an unreviewed proof leaves the booking gated (PAYMENT_PENDING) — no confirmation without approval', async () => {
    const { booking } = await pendingProof()
    const stillPending = await db().booking.findUnique({ where: { id: booking.id } })
    expect(stillPending.status).toBe('PAYMENT_PENDING')
  })

  it('a non-admin cannot review a payment proof', async () => {
    const { proof } = await pendingProof()
    const res = await request(app).patch(`/api/admin/review-queue/payment/${proof.id}`).set('authorization', `Bearer ${host.token}`).send({ decision: 'APPROVED' })
    expect(res.status).toBe(403)
  })
})
