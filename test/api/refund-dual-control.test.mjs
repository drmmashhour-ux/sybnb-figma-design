import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof, recordWalletEntry } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, seedMatchedReconciliation, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Fix F2 — the admin booking-review refund (PATCH /api/admin/review-queue/booking/:id, decision REJECT) is a
// wallet-reversal money-out. It must (a) refuse an approver who is also a prior money-actor on the payout
// (releaser/verifier/reconciler/disburser) or the booking guest -> 403 REFUND_DUAL_CONTROL_REQUIRED; (b) couple
// to Payout state — a disbursed payout may only be refunded if the disbursed funds are recoverable via clawback,
// else the refund would exceed (received - already-disbursed) -> 422 REFUND_EXCEEDS_RECOVERABLE.

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const FROZEN_METHOD = { type: 'sham_cash', receiverName: 'HonestHost', phone: '0999000111', version: 1 }

describe('refund maker-checker + Payout-state coupling (F2)', () => {
  let app, verifier, releaser, reconciler, disburser, ruler, guestId, hostId, listingId
  const bookingIds = []

  const mkUser = async (role, label) => {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `F2 ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } }, phoneHash: `f2-${Math.random().toString(36).slice(2)}` } })
    trackTestUser(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }

  // A DISPUTED booking with an approved payment (so the review-refund path fires). Options set the payout's
  // disbursed state and whether a RELEASE wallet entry exists (the recoverable-clawback path).
  async function refundableBooking({ disbursed = false, withRelease = true } = {}) {
    await db().user.update({ where: { id: hostId }, data: { payoutMethod: FROZEN_METHOD } })
    const booking = await db().booking.create({ data: { listingId, guestId, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD' } })
    bookingIds.push(booking.id)
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guestId, provider: 'stripe', providerRef: `pi_f2_${booking.id.slice(0, 8)}`, status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: verifier.id }))
    if (withRelease) {
      await db().$transaction((tx) => recordWalletEntry(tx, { userId: hostId, type: 'RELEASE', amountMinor: 100_00, currency: 'USD', referenceType: 'booking_payout', referenceId: booking.id, keyParts: ['f2-release', booking.id], note: 'released' }))
    }
    await db().payout.update({ where: { bookingId: booking.id }, data: { releasedById: releaser.id, status: disbursed ? 'DISBURSED' : 'RELEASED', disbursedById: disbursed ? disburser.id : null } })
    await seedMatchedReconciliation({ bookingId: booking.id, matchedById: reconciler.id, grossMinor: 120_00 })
    await db().booking.update({ where: { id: booking.id }, data: { status: 'DISPUTED' } })
    return booking
  }

  const refund = (bookingId, token) => request(app).patch(`/api/admin/review-queue/booking/${bookingId}`).set(auth(token)).send({ decision: 'REJECT', note: 'ruling against — refund' })
  const refundEntry = (bookingId) => db().walletEntry.findFirst({ where: { referenceType: 'booking_refund', referenceId: bookingId, type: 'REFUND' } })
  const clawbackEntry = (bookingId) => db().walletEntry.findFirst({ where: { referenceType: 'booking_payout_clawback', referenceId: bookingId, type: 'DEBIT' } })

  beforeAll(async () => {
    app = testApp()
    verifier = await mkUser('ADMIN', 'f2-verifier')
    releaser = await mkUser('ADMIN', 'f2-releaser')
    reconciler = await mkUser('ADMIN', 'f2-reconciler')
    disburser = await mkUser('ADMIN', 'f2-disburser')
    ruler = await mkUser('ADMIN', 'f2-ruler') // distinct from every money-actor
    guestId = (await mkUser('GUEST', 'f2-guest')).id
    hostId = (await mkUser('HOST', 'f2-host')).id
    const listing = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'F2', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
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

  it('(a) a refund approved by a prior money-actor (the payment verifier) is REFUSED (403 REFUND_DUAL_CONTROL_REQUIRED)', async () => {
    const booking = await refundableBooking()
    const res = await refund(booking.id, verifier.token) // verifier == reviewedById, a money-actor
    expect(res.status, 'a money-actor must not approve the refund').toBe(403)
    expect(res.body.error?.code).toBe('REFUND_DUAL_CONTROL_REQUIRED')
  })

  it('(b) a refund on an already-DISBURSED payout with no recoverable clawback is REFUSED (422 REFUND_EXCEEDS_RECOVERABLE)', async () => {
    const booking = await refundableBooking({ disbursed: true, withRelease: false }) // disbursed, nothing to claw back
    const res = await refund(booking.id, ruler.token) // distinct admin, passes maker-checker
    expect(res.status, 'a disbursed payout with no clawback must not be silently refunded past the recoverable cap').toBe(422)
    expect(res.body.error?.code).toBe('REFUND_EXCEEDS_RECOVERABLE')
  })

  it('(c) a DISTINCT admin refunding an undisbursed booking SUCCEEDS and emits the refund entry', async () => {
    const booking = await refundableBooking()
    const res = await refund(booking.id, ruler.token)
    expect(res.status, 'a distinct admin may issue an in-bounds refund').toBe(200)
    expect(await refundEntry(booking.id), 'the guest refund is recorded').toBeTruthy()
  })

  it('(d) a refund on a DISBURSED payout WITH a recoverable clawback runs the clawback (not silent)', async () => {
    const booking = await refundableBooking({ disbursed: true, withRelease: true })
    const res = await refund(booking.id, ruler.token)
    expect(res.status).toBe(200)
    expect(await refundEntry(booking.id), 'the guest refund is recorded').toBeTruthy()
    expect(await clawbackEntry(booking.id), 'the disbursed host funds are clawed back — not a silent refund').toBeTruthy()
  })
})
