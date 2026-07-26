import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// D2 — maker != checker at disburse. The admin who moves the money must differ from BOTH the admin who
// verified the payment (PaymentProof.reviewedById) and the admin who released the payout (Payout.releasedById).
// (a) the releaser disbursing their own release must be refused (403).
// (b) the verifier disbursing what they verified must be refused (403).
// (c) a DISTINCT admin may disburse; the actor is recorded on Payout.disbursedById and the D1 destination holds.

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const FROZEN_METHOD = { type: 'sham_cash', receiverName: 'HonestHost', phone: '0999000111', version: 1 }

describe('payout dual control — maker != checker at disburse (D2)', () => {
  let app
  let verifier // approves the payment proof
  let releaser // releases the payout
  let stranger // a third, independent admin
  let guestId
  let hostId
  let listingId
  const bookingIds = []

  const mkUser = async (role, label) => {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `D2 ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } }, phoneHash: `d2-${Math.random().toString(36).slice(2)}` } })
    trackTestUser(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }

  // Settle a booking with `verifierId` as the payment reviewer, then simulate the RELEASE step recording
  // `releaserId` on the frozen payout — so both prior-actor identities are on record for the disburse guard.
  async function settledReleasedBooking({ verifierId, releaserId }) {
    await db().user.update({ where: { id: hostId }, data: { payoutMethod: FROZEN_METHOD } })
    const booking = await db().booking.create({ data: { listingId, guestId, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD' } })
    bookingIds.push(booking.id)
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guestId, provider: 'stripe', providerRef: `pi_d2_${booking.id.slice(0, 8)}`, status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: verifierId }))
    await db().payout.update({ where: { bookingId: booking.id }, data: { status: 'RELEASED', releaseDate: new Date(), releasedById: releaserId } })
    return booking
  }

  const disburse = (bookingId, token) => request(app).post(`/api/admin/payouts/${bookingId}/disburse`).set(auth(token)).send({ transition: 'INITIATED', reason: 'd2 test' })

  beforeAll(async () => {
    app = testApp()
    verifier = await mkUser('ADMIN', 'd2-verifier')
    releaser = await mkUser('ADMIN', 'd2-releaser')
    stranger = await mkUser('ADMIN', 'd2-stranger')
    guestId = (await mkUser('GUEST', 'd2-guest')).id
    hostId = (await mkUser('HOST', 'd2-host')).id
    const listing = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'D2', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
    listingId = listing.id
  })
  afterAll(async () => {
    await db().payout.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().payment.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().walletEntry.deleteMany({ where: { referenceId: { in: bookingIds } } }).catch(() => {})
    await db().adminAuditLog.deleteMany({ where: { entityId: { in: bookingIds } } }).catch(() => {})
    await db().paymentProof.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().booking.deleteMany({ where: { id: { in: bookingIds } } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: listingId } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('(a) the RELEASER cannot disburse their own release (403 PAYOUT_DUAL_CONTROL_REQUIRED)', async () => {
    const booking = await settledReleasedBooking({ verifierId: verifier.id, releaserId: releaser.id })
    const res = await disburse(booking.id, releaser.token)
    expect(res.status, 'the admin who released the payout must not also disburse it').toBe(403)
    expect(res.body.error?.code).toBe('PAYOUT_DUAL_CONTROL_REQUIRED')
  })

  it('(b) the VERIFIER cannot disburse what they verified (403 PAYOUT_DUAL_CONTROL_REQUIRED)', async () => {
    const booking = await settledReleasedBooking({ verifierId: verifier.id, releaserId: releaser.id })
    const res = await disburse(booking.id, verifier.token)
    expect(res.status, 'the admin who verified the payment must not also disburse the payout').toBe(403)
    expect(res.body.error?.code).toBe('PAYOUT_DUAL_CONTROL_REQUIRED')
  })

  it('(c) a DISTINCT admin may disburse; disbursedById is recorded and the D1 destination still holds', async () => {
    const booking = await settledReleasedBooking({ verifierId: verifier.id, releaserId: releaser.id })
    const res = await disburse(booking.id, stranger.token)
    expect(res.status, 'a third independent admin must be able to disburse').toBe(201)
    const payout = await db().payout.findUnique({ where: { bookingId: booking.id } })
    expect(payout.disbursedById, 'the disbursing actor is recorded for audit symmetry').toBe(stranger.id)
    expect(payout.destinationSnapshot?.type, 'the frozen D1 destination is unchanged').toBe('sham_cash')
  })

  it('(d) a payout with NO verifier and NO releaser on record is REFUSED (403 PAYOUT_PROVENANCE_REQUIRED)', async () => {
    // A frozen destination but no provenance: dual control cannot be established, so a single admin must
    // not be able to push it through. This is the fail-closed counterpart to D1's no-fallback rule.
    const booking = await db().booking.create({ data: { listingId, guestId, status: 'COMPLETED', amountMinor: 120_00, currency: 'USD' } })
    bookingIds.push(booking.id)
    await db().payout.create({ data: { bookingId: booking.id, hostId, amountMinor: 120_00, currency: 'USD', status: 'PENDING_HOLD', destinationSnapshot: FROZEN_METHOD } })
    const res = await disburse(booking.id, stranger.token)
    expect(res.status, 'a payout with no verifier/releaser on record must not be disbursable by a single admin').toBe(403)
    expect(res.body.error?.code).toBe('PAYOUT_PROVENANCE_REQUIRED')
  })
})
