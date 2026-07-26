import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Fix E, Slice 2 — a payout may only be disbursed once its payment has an independently reconciled, MATCHED
// received-funds record, and the reconciler is folded into maker!=checker.
//   (a) no MATCHED reconciliation           -> 403 PAYOUT_NOT_RECONCILED
//   (b) reconciler also disburses            -> 403 PAYOUT_DUAL_CONTROL_REQUIRED
//   (c) MISMATCH-only (no MATCHED)           -> 403 PAYOUT_NOT_RECONCILED
//   (d) MATCHED + a distinct disburser       -> SUCCEEDS
//   plus the manual reconcile endpoint computes MATCHED / MISMATCH from the frozen Payment (never asserted).

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const FROZEN_METHOD = { type: 'sham_cash', receiverName: 'HonestHost', phone: '0999000111', version: 1 }

describe('payout reconciliation gate + reconcile endpoint (Fix E slice 2)', () => {
  let app, verifier, releaser, reconciler, stranger, guestId, hostId, listingId
  const bookingIds = []

  const mkUser = async (role, label) => {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `E2 ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } }, phoneHash: `e2-${Math.random().toString(36).slice(2)}` } })
    trackTestUser(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }

  // Settle a booking (Payment + Payout + reviewedById) and record the releaser on the payout.
  async function settledReleasedBooking({ verifierId, releaserId }) {
    await db().user.update({ where: { id: hostId }, data: { payoutMethod: FROZEN_METHOD } })
    const booking = await db().booking.create({ data: { listingId, guestId, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD' } })
    bookingIds.push(booking.id)
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guestId, provider: 'stripe', providerRef: `pi_e2_${booking.id.slice(0, 8)}`, status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: verifierId }))
    await db().payout.update({ where: { bookingId: booking.id }, data: { status: 'RELEASED', releaseDate: new Date(), releasedById: releaserId } })
    const payment = await db().payment.findUnique({ where: { bookingId: booking.id } })
    return { booking, payment }
  }

  const disburse = (bookingId, token) => request(app).post(`/api/admin/payouts/${bookingId}/disburse`).set(auth(token)).send({ transition: 'INITIATED', reason: 'e2 test' })
  const reconcile = (bookingId, token, body) => request(app).post(`/api/admin/payments/${bookingId}/reconcile`).set(auth(token)).send(body)

  beforeAll(async () => {
    app = testApp()
    verifier = await mkUser('ADMIN', 'e2-verifier')
    releaser = await mkUser('ADMIN', 'e2-releaser')
    reconciler = await mkUser('ADMIN', 'e2-reconciler')
    stranger = await mkUser('ADMIN', 'e2-stranger')
    guestId = (await mkUser('GUEST', 'e2-guest')).id
    hostId = (await mkUser('HOST', 'e2-host')).id
    const listing = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'E2', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
    listingId = listing.id
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

  it('(a) disburse with NO MATCHED reconciliation is REFUSED (403 PAYOUT_NOT_RECONCILED)', async () => {
    const { booking } = await settledReleasedBooking({ verifierId: verifier.id, releaserId: releaser.id })
    const res = await disburse(booking.id, stranger.token)
    expect(res.status, 'money must not leave until the received funds are reconciled').toBe(403)
    expect(res.body.error?.code).toBe('PAYOUT_NOT_RECONCILED')
  })

  it('(b) the reconciler cannot also disburse (403 PAYOUT_DUAL_CONTROL_REQUIRED)', async () => {
    const { booking, payment } = await settledReleasedBooking({ verifierId: verifier.id, releaserId: releaser.id })
    await db().reconciliationRecord.create({ data: { bookingId: booking.id, paymentId: payment.id, statementRef: payment.settlementRef, amountMinor: payment.grossMinor, currency: payment.currency, source: 'manual', status: 'MATCHED', matchedById: reconciler.id, matchedAt: new Date() } })
    const res = await disburse(booking.id, reconciler.token)
    expect(res.status, 'the admin who reconciled the funds must not also disburse them').toBe(403)
    expect(res.body.error?.code).toBe('PAYOUT_DUAL_CONTROL_REQUIRED')
  })

  it('(c) a MISMATCH-only payment stays blocked (403 PAYOUT_NOT_RECONCILED)', async () => {
    const { booking, payment } = await settledReleasedBooking({ verifierId: verifier.id, releaserId: releaser.id })
    // Reconcile with an underpayment -> a MISMATCH row, no MATCHED.
    const rec = await reconcile(booking.id, reconciler.token, { statementRef: payment.settlementRef, amount: payment.grossMinor - 100, currency: payment.currency })
    expect(rec.status).toBe(201)
    expect(rec.body.status).toBe('MISMATCH')
    expect(rec.body.reason).toBe('UNDERPAYMENT')
    const res = await disburse(booking.id, stranger.token)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('PAYOUT_NOT_RECONCILED')
  })

  it('(d) MATCHED (via the reconcile endpoint) + a DISTINCT disburser SUCCEEDS', async () => {
    const { booking, payment } = await settledReleasedBooking({ verifierId: verifier.id, releaserId: releaser.id })
    const rec = await reconcile(booking.id, reconciler.token, { statementRef: payment.settlementRef, amount: payment.grossMinor, currency: payment.currency })
    expect(rec.status).toBe(201)
    expect(rec.body.status).toBe('MATCHED')
    const res = await disburse(booking.id, stranger.token) // != verifier/releaser/reconciler
    expect(res.status, 'a distinct disburser may move reconciled funds').toBe(201)
  })

  it('the reconcile endpoint is ADMIN-only', async () => {
    const { booking, payment } = await settledReleasedBooking({ verifierId: verifier.id, releaserId: releaser.id })
    const guestToken = createSessionToken({ id: guestId })
    const res = await reconcile(booking.id, guestToken, { statementRef: payment.settlementRef, amount: payment.grossMinor, currency: payment.currency })
    expect(res.status).toBe(403)
  })
})
