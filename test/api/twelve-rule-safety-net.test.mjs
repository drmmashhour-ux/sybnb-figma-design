import { readFileSync } from 'node:fs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// M7 — real assertions against the AS-BUILT 12-rule money/booking safety-net (docs/architecture/
// STR_MONEY_MODEL.md). This does not change behaviour; it pins the guarantees that already exist so a
// future refactor can't silently regress them. R6 (convert-then-sum) is covered as a pure unit in
// test/unit/money-sum-mixed-currency.test.mjs.

function isoDay(offsetDays) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

describe('M7 — 12-rule safety-net (as built)', () => {
  let app
  beforeAll(async () => { app = await testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  async function guestToken(tag) {
    const email = uniqueTestEmail(tag)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, id: res.body.user.id }
  }

  async function stayListing(tag) {
    const email = uniqueTestEmail(`${tag}-host`)
    await verifyEmailForTest(app, email, 'staff-login')
    const host = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
    trackTestUser(host.body.user.id)
    const listing = await db().listing.create({
      data: { ownerId: host.body.user.id, division: 'STAYS', titleAr: 'شقة اختبار', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } },
    })
    return { hostId: host.body.user.id, listingId: listing.id }
  }

  // R1 — no double-book: an overlapping-dates request is rejected once dates are held.
  it('R1 — rejects an overlapping booking for the same listing/dates', async () => {
    const { token } = await guestToken('r1-guest')
    const { listingId } = await stayListing('r1')
    const first = await request(app).post('/api/bookings').set('authorization', `Bearer ${token}`)
      .send({ listingId, checkIn: isoDay(20), checkOut: isoDay(24) })
    expect(first.status).toBe(201)

    const { token: token2 } = await guestToken('r1-guest2')
    const overlap = await request(app).post('/api/bookings').set('authorization', `Bearer ${token2}`)
      .send({ listingId, checkIn: isoDay(22), checkOut: isoDay(26) }) // overlaps [20,24)
    expect(overlap.status).toBe(409)
    expect(overlap.body.error.code).toBe('BOOKING_DATES_UNAVAILABLE')
  })

  // R2 — concurrency: two simultaneous requests for the same dates yield EXACTLY one winner. The
  // transaction-scoped advisory lock (pg_advisory_xact_lock) serializes them so the loser sees the hold.
  it('R2 — two simultaneous requests for the same dates → exactly one winner', async () => {
    const { token: tA } = await guestToken('r2-a')
    const { token: tB } = await guestToken('r2-b')
    const { listingId } = await stayListing('r2')
    const dates = { listingId, checkIn: isoDay(40), checkOut: isoDay(43) }
    const [a, b] = await Promise.all([
      request(app).post('/api/bookings').set('authorization', `Bearer ${tA}`).send(dates),
      request(app).post('/api/bookings').set('authorization', `Bearer ${tB}`).send(dates),
    ])
    const created = [a, b].filter((r) => r.status === 201)
    const rejected = [a, b].filter((r) => r.status === 409)
    expect(created).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].body.error.code).toBe('BOOKING_DATES_UNAVAILABLE')
  })

  // R8 — settlement: no booking is marked paid without a real settlement reference, and paid→CONFIRMED
  // routes through the M6 host-consent gate (not the deferred M3-B authorize→capture). Asserted at the
  // source of the single paid transition so a refactor can't drop either guard.
  it('R8 — approvePaymentProof enforces a settlement ref and the M6 consent gate', () => {
    const ledger = readFileSync(new URL('../../server/lib/finance-ledger.mjs', import.meta.url), 'utf8')
    expect(ledger).toMatch(/assertRealSettlementReference\(/)          // no paid without a real ref
    expect(ledger).toMatch(/latestHostContractConsent\(/)             // paid→CONFIRMED via M6 gate
    expect(ledger).toMatch(/STR_HOST_CONTRACT_VERSION/)               // consent must match the live version
  })

  // R12 — cancellation/refund EXISTS today (guest self-cancel). A cancelled paid booking issues a guest
  // REFUND wallet entry (net of any late-cancel fee). This pins the built flow; the deferred host-side and
  // dispute-driven refunds are Part 2.
  it('R12 — cancelling a paid booking issues a guest REFUND', async () => {
    const { token, id: guestId } = await guestToken('r12-guest')
    const { listingId } = await stayListing('r12')
    const booking = await db().booking.create({ data: { listingId, guestId, status: 'PAYMENT_PENDING', amountMinor: 100_00, currency: 'USD', checkIn: new Date(isoDay(60)), checkOut: new Date(isoDay(63)) } })
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guestId, provider: 'stripe', providerRef: 'pi_r12_capture', status: 'PENDING_ADMIN_REVIEW', amountMinor: 100_00, currency: 'USD' } })
    // Approve without an instant-book/consent gate (listing is non-instant) → REQUESTED, cancellable.
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: guestId }))

    const res = await request(app).patch(`/api/bookings/${booking.id}/cancel`).set('authorization', `Bearer ${token}`).send({})
    expect(res.status).toBeLessThan(400)

    const refund = await db().walletEntry.findFirst({ where: { wallet: { userId: guestId }, type: 'REFUND', referenceId: booking.id } })
    expect(refund).toBeTruthy()
    expect(refund.amountMinor).toBeGreaterThan(0)

    await db().walletEntry.deleteMany({ where: { wallet: { userId: guestId } } }).catch(() => {})
    await db().paymentProof.deleteMany({ where: { bookingId: booking.id } })
    await db().booking.deleteMany({ where: { id: booking.id } })
  })
})
