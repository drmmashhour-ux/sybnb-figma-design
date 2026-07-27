import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { PAYOUT_AUDIT_ACTIONS } from '../../server/lib/host-payout.mjs'
import { cleanupTestUsers, seedMatchedReconciliation, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Fix F1 — disburse idempotency. A retried / double-clicked disburse of the SAME payout must not record a
// second INITIATED transition. The first INITIATED atomically claims the payout; the second finds it already
// moved and is rejected (409 PAYOUT_ALREADY_IN_PROGRESS) with no duplicate transition and no second pay-instruction.

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const FROZEN_METHOD = { type: 'sham_cash', receiverName: 'HonestHost', phone: '0999000111', version: 1 }

describe('payout disburse idempotency (F1)', () => {
  let app, verifier, releaser, reconciler, stranger, guestId, hostId, listingId
  const bookingIds = []

  const mkUser = async (role, label) => {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `F1 ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } }, phoneHash: `f1-${Math.random().toString(36).slice(2)}` } })
    trackTestUser(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }

  async function disbursableBooking() {
    await db().user.update({ where: { id: hostId }, data: { payoutMethod: FROZEN_METHOD } })
    const booking = await db().booking.create({ data: { listingId, guestId, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD' } })
    bookingIds.push(booking.id)
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guestId, provider: 'stripe', providerRef: `pi_f1_${booking.id.slice(0, 8)}`, status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: verifier.id }))
    await db().payout.update({ where: { bookingId: booking.id }, data: { status: 'RELEASED', releaseDate: new Date(), releasedById: releaser.id } })
    await seedMatchedReconciliation({ bookingId: booking.id, matchedById: reconciler.id, grossMinor: 120_00 })
    return booking
  }

  const disburse = (bookingId, token) => request(app).post(`/api/admin/payouts/${bookingId}/disburse`).set(auth(token)).send({ transition: 'INITIATED', reason: 'f1 test' })
  const initiatedCount = (bookingId) => db().adminAuditLog.count({ where: { action: PAYOUT_AUDIT_ACTIONS.INITIATED, entityId: bookingId } })

  beforeAll(async () => {
    app = testApp()
    verifier = await mkUser('ADMIN', 'f1-verifier')
    releaser = await mkUser('ADMIN', 'f1-releaser')
    reconciler = await mkUser('ADMIN', 'f1-reconciler')
    stranger = await mkUser('ADMIN', 'f1-stranger')
    guestId = (await mkUser('GUEST', 'f1-guest')).id
    hostId = (await mkUser('HOST', 'f1-host')).id
    const listing = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'F1', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
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

  it('the FIRST disburse succeeds and records exactly one INITIATED transition', async () => {
    const booking = await disbursableBooking()
    const res = await disburse(booking.id, stranger.token)
    expect(res.status).toBe(201)
    expect(await initiatedCount(booking.id)).toBe(1)
  })

  it('a RETRIED disburse of the same payout is REJECTED (409) with NO duplicate transition', async () => {
    const booking = await disbursableBooking()
    const first = await disburse(booking.id, stranger.token)
    expect(first.status).toBe(201)
    const second = await disburse(booking.id, stranger.token) // retry / double-click
    expect(second.status, 'a second disburse of an already-disbursing payout must be refused').toBe(409)
    expect(second.body.error?.code).toBe('PAYOUT_ALREADY_IN_PROGRESS')
    expect(await initiatedCount(booking.id), 'exactly one INITIATED transition — no duplicate pay instruction').toBe(1)
  })

  it('two CONCURRENT disburses of the same payout produce exactly one success', async () => {
    const booking = await disbursableBooking()
    const [a, b] = await Promise.all([disburse(booking.id, stranger.token), disburse(booking.id, stranger.token)])
    const statuses = [a.status, b.status].sort()
    expect(statuses, 'exactly one 201 and one 409').toEqual([201, 409])
    expect(await initiatedCount(booking.id), 'only one INITIATED transition recorded').toBe(1)
  })
})
