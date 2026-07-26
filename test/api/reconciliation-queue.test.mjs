import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Fix E, Slice 3 — surface the reconciliation state so a mismatch cannot sit unnoticed.
//   - an ADMIN-only reconciliation QUEUE lists payments needing attention (unreconciled-eligible + MISMATCH,
//     with reason); fully MATCHED payments are excluded.
//   - the daily report gains mismatch + unreconciled counts.
// The RECONCILIATION_MISMATCH audit already exists (slice 2) — this only READS/surfaces, no state change.

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

describe('reconciliation queue + daily-report surfacing (Fix E slice 3)', () => {
  let app, admin, reconciler, guestId, hostId, listingId
  let matchedBooking, mismatchBooking, unreconciledBooking
  const bookingIds = []

  const mkUser = async (role, label) => {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `E3 ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } }, phoneHash: `e3-${Math.random().toString(36).slice(2)}` } })
    trackTestUser(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }

  async function settle(verifierId) {
    const booking = await db().booking.create({ data: { listingId, guestId, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD' } })
    bookingIds.push(booking.id)
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guestId, provider: 'stripe', providerRef: `pi_e3_${booking.id.slice(0, 8)}`, status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: verifierId }))
    return db().payment.findUnique({ where: { bookingId: booking.id } })
  }

  const reconcile = (bookingId, body) => request(app).post(`/api/admin/payments/${bookingId}/reconcile`).set(auth(reconciler.token)).send(body)
  const queue = (token) => request(app).get('/api/admin/reconciliation-queue').set(auth(token))
  const dailyReport = (token) => request(app).get('/api/admin/daily-report').set(auth(token))

  beforeAll(async () => {
    app = testApp()
    admin = await mkUser('ADMIN', 'e3-admin')
    reconciler = await mkUser('ADMIN', 'e3-reconciler')
    guestId = (await mkUser('GUEST', 'e3-guest')).id
    hostId = (await mkUser('HOST', 'e3-host')).id
    const listing = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'E3', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
    listingId = listing.id

    const matchedPayment = await settle(admin.id)
    matchedBooking = matchedPayment.bookingId
    await reconcile(matchedBooking, { statementRef: matchedPayment.settlementRef, amount: matchedPayment.grossMinor, currency: matchedPayment.currency })

    const mismatchPayment = await settle(admin.id)
    mismatchBooking = mismatchPayment.bookingId
    await reconcile(mismatchBooking, { statementRef: mismatchPayment.settlementRef, amount: mismatchPayment.grossMinor - 100, currency: mismatchPayment.currency })

    const unrec = await settle(admin.id)
    unreconciledBooking = unrec.bookingId // settled, never reconciled
  })

  afterAll(async () => {
    await db().reconciliationRecord.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().payout.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().payment.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().walletEntry.deleteMany({ where: { referenceId: { in: bookingIds } } }).catch(() => {})
    await db().adminAuditLog.deleteMany({ where: { entityId: { in: bookingIds } } }).catch(() => {})
    await db().paymentProof.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().booking.deleteMany({ where: { id: { in: bookingIds } } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: listingId } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('(a) a MISMATCH surfaces in the queue with its reason; an UNRECONCILED one too; a MATCHED one does NOT', async () => {
    const res = await queue(admin.token)
    expect(res.status).toBe(200)
    const byBooking = Object.fromEntries((res.body.items || []).map((i) => [i.bookingId, i]))

    expect(byBooking[mismatchBooking], 'the mismatched payment must be surfaced').toBeTruthy()
    expect(byBooking[mismatchBooking].status).toBe('MISMATCH')
    expect(byBooking[mismatchBooking].reason).toBe('UNDERPAYMENT')

    expect(byBooking[unreconciledBooking], 'the never-reconciled payment must be surfaced').toBeTruthy()
    expect(byBooking[unreconciledBooking].status).toBe('UNRECONCILED')

    expect(byBooking[matchedBooking], 'a fully MATCHED payment must NOT appear in the queue').toBeUndefined()
  })

  it('(b) the daily report includes mismatch + unreconciled reconciliation counts', async () => {
    const res = await dailyReport(admin.token)
    expect(res.status).toBe(200)
    const facts = res.body.report?.facts
    expect(facts.reconciliationMismatches, 'mismatch count present and counts our mismatch').toBeGreaterThanOrEqual(1)
    expect(facts.reconciliationUnreconciled, 'unreconciled count present and counts our unreconciled').toBeGreaterThanOrEqual(1)
  })

  it('the reconciliation queue is ADMIN-only', async () => {
    const guestToken = createSessionToken({ id: guestId })
    const res = await queue(guestToken)
    expect(res.status).toBe(403)
  })
})
