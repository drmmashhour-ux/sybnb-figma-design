import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { PAYOUT_AUDIT_ACTIONS } from '../../server/lib/host-payout.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// D1 — the payout DESTINATION must be frozen at verify (Payout creation) and never re-read live at disburse.
// (a) A host who changes User.payoutMethod after verify must NOT be able to redirect the disbursement.
// (b) A payout with no frozen destination must be refused (403), never disbursed against a live method.

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const FROZEN_METHOD = { type: 'sham_cash', receiverName: 'HonestHost', phone: '0999000111', version: 1 }
const REDIRECTED_METHOD = { type: 'bank_transfer', receiverName: 'Attacker', accountRef: 'ATTACKER-IBAN-999', version: 1 }

describe('payout destination freeze (D1)', () => {
  let app
  let adminId
  let adminToken
  let verifierId // D2: a distinct admin verifies the payment, so the disbursing admin can pass dual control
  let guestId
  let hostId
  let listingId
  const bookingIds = []
  const userIds = []

  const mkUser = async (role, label) => {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `D1 ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } }, phoneHash: `d1-${Math.random().toString(36).slice(2)}` } })
    trackTestUser(u.id)
    userIds.push(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }

  async function settledBooking(hostPayoutMethod) {
    await db().user.update({ where: { id: hostId }, data: { payoutMethod: hostPayoutMethod } })
    const booking = await db().booking.create({ data: { listingId, guestId, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD' } })
    bookingIds.push(booking.id)
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guestId, provider: 'stripe', providerRef: `pi_d1_${booking.id.slice(0, 8)}`, status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: verifierId }))
    return booking
  }

  const disburse = (bookingId) => request(app).post(`/api/admin/payouts/${bookingId}/disburse`).set(auth(adminToken)).send({ transition: 'INITIATED', reason: 'd1 test' })
  const recordedMethod = async (bookingId) => {
    const audit = await db().adminAuditLog.findFirst({ where: { action: PAYOUT_AUDIT_ACTIONS.INITIATED, entityId: bookingId }, orderBy: { createdAt: 'desc' } })
    return audit?.after?.method
  }

  beforeAll(async () => {
    app = testApp()
    const admin = await mkUser('ADMIN', 'd1-admin')
    adminId = admin.id
    adminToken = admin.token
    verifierId = (await mkUser('ADMIN', 'd1-verifier')).id
    guestId = (await mkUser('GUEST', 'd1-guest')).id
    hostId = (await mkUser('HOST', 'd1-host')).id
    const listing = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'D1', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
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

  it('(a) a host payoutMethod change after verify is IGNORED at disburse (funds target the frozen snapshot)', async () => {
    const booking = await settledBooking(FROZEN_METHOD) // verify freezes sham_cash
    await db().user.update({ where: { id: hostId }, data: { payoutMethod: REDIRECTED_METHOD } }) // host tries to redirect
    const res = await disburse(booking.id)
    expect(res.status).toBe(201)
    expect(await recordedMethod(booking.id), 'disburse must target the FROZEN destination, not the live redirected one').toBe('sham_cash')
  })

  it('(b) a payout with no frozen destination is REJECTED (403 PAYOUT_DESTINATION_MISSING) — no live fallback', async () => {
    const booking = await settledBooking(null) // host had no payout method at verify → null snapshot
    const res = await disburse(booking.id)
    expect(res.status, 'a null frozen destination must be rejected, never disbursed against a live method').toBe(403)
    expect(res.body.error?.code).toBe('PAYOUT_DESTINATION_MISSING')
  })
})
