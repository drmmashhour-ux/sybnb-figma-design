import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, seedMatchedReconciliation, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Fix F2.1 — extend the F2 money-actor exclusion to the dispute refund-approve path. A prior money-actor on
// the booking's payout (releaser / payment-verifier / reconciler / disburser) or the booking guest must not
// approve a DISPUTE refund either — 403 REFUND_DUAL_CONTROL_REQUIRED. Fix C (opener != approver) stays intact,
// both apply. Booking disputes only (dispute.bookingId); the frozen SR/ride dispute path is untouched.

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const FROZEN_METHOD = { type: 'sham_cash', receiverName: 'HonestHost', phone: '0999000111', version: 1 }

describe('dispute refund money-actor exclusion (F2.1)', () => {
  let app, verifier, releaser, disburser, reconciler, ruler, guestId, hostId, listingId
  const bookingIds = []
  const disputeIds = []

  const mkUser = async (role, label) => {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `F21 ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } }, phoneHash: `f21-${Math.random().toString(36).slice(2)}` } })
    trackTestUser(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }

  // A CONFIRMED booking with a payout carrying every money-actor + a guest-opened dispute (OPEN).
  async function disputedBooking({ openedBy = guestId } = {}) {
    const booking = await db().booking.create({ data: { listingId, guestId, status: 'CONFIRMED', amountMinor: 100_00, currency: 'USD' } })
    bookingIds.push(booking.id)
    await db().paymentProof.create({ data: { bookingId: booking.id, userId: guestId, provider: 'sham_cash', status: 'APPROVED', reviewedById: verifier.id, reviewedAt: new Date(), amountMinor: 100_00, currency: 'USD' } })
    await db().payout.create({ data: { bookingId: booking.id, hostId, amountMinor: 80_00, currency: 'USD', status: 'DISBURSED', releasedById: releaser.id, disbursedById: disburser.id, destinationSnapshot: FROZEN_METHOD } })
    await seedMatchedReconciliation({ bookingId: booking.id, matchedById: reconciler.id, grossMinor: 100_00 })
    const dispute = await db().dispute.create({ data: { bookingId: booking.id, openedByUserId: openedBy, reason: 'host misrepresented the stay', subjectType: 'STR_BOOKING', status: 'OPEN' } })
    disputeIds.push(dispute.id)
    return { booking, dispute }
  }

  const resolve = (disputeId, token) => request(app).patch(`/api/admin/disputes/${disputeId}`).set(auth(token)).send({ decision: 'REFUND', note: 'valid complaint' })
  const auditFor = (action, id) => db().adminAuditLog.findFirst({ where: { action, entityId: id } })

  beforeAll(async () => {
    app = testApp()
    verifier = await mkUser('ADMIN', 'f21-verifier')
    releaser = await mkUser('ADMIN', 'f21-releaser')
    disburser = await mkUser('ADMIN', 'f21-disburser')
    reconciler = await mkUser('ADMIN', 'f21-reconciler')
    ruler = await mkUser('ADMIN', 'f21-ruler') // distinct from every money-actor
    guestId = (await mkUser('GUEST', 'f21-guest')).id
    hostId = (await mkUser('HOST', 'f21-host')).id
    const listing = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'F21', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: true, metadata: { country: 'SY' } } })
    listingId = listing.id
  })
  afterAll(async () => {
    await db().dispute.deleteMany({ where: { id: { in: disputeIds } } }).catch(() => {})
    await db().reconciliationRecord.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().payout.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().payment.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().walletEntry.deleteMany({ where: { referenceId: { in: bookingIds } } }).catch(() => {})
    await db().adminAuditLog.deleteMany({ where: { entityId: { in: [...bookingIds, ...disputeIds] } } }).catch(() => {})
    await db().paymentProof.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().booking.deleteMany({ where: { id: { in: bookingIds } } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: listingId } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('(a) a prior money-actor (the disburser, not the opener) approving a dispute refund is REFUSED (403 REFUND_DUAL_CONTROL_REQUIRED)', async () => {
    const { dispute } = await disputedBooking()
    const res = await resolve(dispute.id, disburser.token) // disburser is a money-actor but NOT the opener
    expect(res.status, 'a money-actor must not approve the dispute refund').toBe(403)
    expect(res.body.error?.code).toBe('REFUND_DUAL_CONTROL_REQUIRED')
  })

  it('(b) Fix C still holds: the opener approving their own dispute is REFUSED (403 DISPUTE_SELF_APPROVAL_FORBIDDEN)', async () => {
    const { dispute } = await disputedBooking({ openedBy: ruler.id }) // opened by the admin who will approve
    const res = await resolve(dispute.id, ruler.token)
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('DISPUTE_SELF_APPROVAL_FORBIDDEN')
  })

  it('(c) a DISTINCT non-money-actor admin approving a valid dispute refund SUCCEEDS and emits DISPUTE_REFUNDED', async () => {
    const { booking, dispute } = await disputedBooking()
    const res = await resolve(dispute.id, ruler.token)
    expect(res.status, 'a distinct admin may adjudicate the refund').toBe(200)
    expect(res.body.dispute.status).toBe('RESOLVED_REFUNDED')
    expect(await auditFor('DISPUTE_REFUNDED', dispute.id), 'the refund is audited').toBeTruthy()
    expect((await db().booking.findUnique({ where: { id: booking.id } })).status).toBe('CANCELLED')
  })
})
