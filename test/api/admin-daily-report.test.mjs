import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// AD3 — the AI daily report: every FIGURE is a real record count/aggregate; the model may only phrase them,
// never produce a number. This is the AI-guardrail proof: the report's figures reconcile EXACTLY to the
// underlying tables, and the numbers exist without the model (the AI is not configured in tests, so the
// narrative is the deterministic template — yet the figures are still correct). Admin-only.

describe('AD3 — admin daily report (real data only)', () => {
  let app, admin, host, guest
  async function createUser(role, label) {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `T ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    return { token: createSessionToken(u), id: u.id }
  }
  const created = {}
  beforeAll(async () => {
    app = testApp()
    admin = await createUser('ADMIN', 'ad3-admin'); host = await createUser('HOST', 'ad3-host'); guest = await createUser('GUEST', 'ad3-guest')
    const approved = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'شقة', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', metadata: { country: 'SY' } } })
    created.approvedListing = approved.id
    // Known records the report must count: a new booking, a pending-review listing, a pending proof, a
    // pending-hold payout, and an open dispute.
    created.booking = (await db().booking.create({ data: { listingId: approved.id, guestId: guest.id, status: 'PAYMENT_PENDING', amountMinor: 100_00, currency: 'USD' } })).id
    created.pendingListing = (await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'قيد المراجعة', priceMinor: 100_00, currency: 'USD', status: 'PENDING_REVIEW', metadata: { country: 'SY' } } })).id
    created.proof = (await db().paymentProof.create({ data: { bookingId: created.booking, userId: guest.id, provider: 'sham_cash', status: 'PENDING_ADMIN_REVIEW', amountMinor: 100_00, currency: 'USD' } })).id
    created.payout = (await db().payout.create({ data: { bookingId: created.booking, hostId: host.id, amountMinor: 104_40, currency: 'USD', status: 'PENDING_HOLD', releasedById: admin.id } })).id
    created.dispute = (await db().dispute.create({ data: { subjectType: 'STR_BOOKING', bookingId: created.booking, openedByUserId: guest.id, reason: 'test dispute', status: 'OPEN' } })).id
  })
  afterAll(async () => {
    await db().dispute.deleteMany({ where: { id: created.dispute } }).catch(() => {})
    await db().payout.deleteMany({ where: { id: created.payout } }).catch(() => {})
    await db().paymentProof.deleteMany({ where: { id: created.proof } }).catch(() => {})
    await db().booking.deleteMany({ where: { id: created.booking } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: { in: [created.approvedListing, created.pendingListing] } } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('every figure reconciles EXACTLY to the underlying records (no model-produced number)', async () => {
    const res = await request(app).get('/api/admin/daily-report').set('authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    const facts = res.body.report.facts
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    // Independently re-count each figure straight from the tables — the report must equal the records.
    const [newBookings, pendingListings, pendingProofs, payoutHold, openDisputes] = await Promise.all([
      db().booking.count({ where: { createdAt: { gte: dayAgo } } }),
      db().listing.count({ where: { status: 'PENDING_REVIEW' } }),
      db().paymentProof.count({ where: { status: 'PENDING_ADMIN_REVIEW' } }),
      db().payout.aggregate({ where: { status: 'PENDING_HOLD' }, _count: { _all: true }, _sum: { amountMinor: true } }),
      db().dispute.count({ where: { status: 'OPEN' } }),
    ])
    expect(facts.newBookings24h).toBe(newBookings)
    expect(facts.pendingListingReviews).toBe(pendingListings)
    expect(facts.pendingPaymentProofs).toBe(pendingProofs)
    expect(facts.pendingReviewsTotal).toBe(pendingListings + pendingProofs)
    expect(facts.payoutsPendingHoldCount).toBe(payoutHold._count._all)
    expect(facts.payoutsPendingHoldMinor).toBe(payoutHold._sum.amountMinor || 0)
    expect(facts.openDisputes).toBe(openDisputes)

    // The known records I created are included (non-zero), and every figure is an integer, not an estimate.
    expect(facts.newBookings24h).toBeGreaterThanOrEqual(1)
    expect(facts.openDisputes).toBeGreaterThanOrEqual(1)
    for (const v of Object.values(facts)) expect(Number.isInteger(v)).toBe(true)
    expect(res.body.report.source).toBe('records')
  })

  it('the narrative only phrases the facts — numbers exist without the model (AI not configured → template)', async () => {
    const res = await request(app).get('/api/admin/daily-report').set('authorization', `Bearer ${admin.token}`)
    // The AI is not configured in tests, so the narrative is the deterministic template; the numbers came
    // from the data layer regardless. The narrative restates the same figures (never its own).
    expect(res.body.report.narrative.source).toBe('template')
    expect(res.body.report.narrative.messageEn).toContain(String(res.body.report.facts.newBookings24h))
    expect(res.body.report.narrative.messageEn).toContain(String(res.body.report.facts.openDisputes))
  })

  it('a non-admin cannot reach the daily report', async () => {
    const asGuest = await request(app).get('/api/admin/daily-report').set('authorization', `Bearer ${guest.token}`)
    expect(asGuest.status).toBe(403)
    const asHost = await request(app).get('/api/admin/daily-report').set('authorization', `Bearer ${host.token}`)
    expect(asHost.status).toBe(403)
  })
})
