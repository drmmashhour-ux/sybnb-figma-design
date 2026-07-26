import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Refund separation of duties: the admin APPROVING a dispute refund must not be the person who OPENED it
// (the booking's guest). An admin who is also the booking's guest could otherwise open a dispute on their
// own booking and approve their own refund. A DISTINCT admin approving a guest-opened dispute still works.

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

describe('dispute refund — separation of duties (approver != opener)', () => {
  let app
  let hostId
  const userIds = []
  const listingIds = []
  const bookingIds = []
  const disputeIds = []

  const mkUser = async (role, label) => {
    const u = await db().user.create({
      data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `SoD ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } }, phoneHash: `sod-${Math.random().toString(36).slice(2)}` },
    })
    trackTestUser(u.id)
    userIds.push(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }
  async function confirmedBookingFor(guestId) {
    const listing = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'SoD', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
    listingIds.push(listing.id)
    const checkOut = new Date(Date.now() + 5 * 86_400_000)
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId, status: 'CONFIRMED', amountMinor: 100_00, currency: 'USD', checkOut } })
    bookingIds.push(booking.id)
    return booking
  }

  beforeAll(async () => {
    app = testApp()
    hostId = (await mkUser('HOST', 'sod-host')).id
  })
  afterAll(async () => {
    await db().adminAuditLog.deleteMany({ where: { entityType: 'disputes', entityId: { in: disputeIds } } }).catch(() => {})
    await db().walletEntry.deleteMany({ where: { referenceId: { in: bookingIds } } }).catch(() => {})
    await db().dispute.deleteMany({ where: { id: { in: disputeIds } } }).catch(() => {})
    await db().booking.deleteMany({ where: { id: { in: bookingIds } } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: { in: listingIds } } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('the SAME user (booking guest + admin) opening then approving their own refund is REJECTED (403)', async () => {
    const adminGuest = await mkUser('ADMIN', 'sod-admin-guest') // ADMIN role, and will be the booking's guest
    const booking = await confirmedBookingFor(adminGuest.id)

    const opened = await request(app).post('/api/disputes').set(auth(adminGuest.token)).send({ bookingId: booking.id, reason: 'self-opened dispute' })
    expect(opened.status, 'opener (the booking guest) can open the dispute').toBe(201)
    const disputeId = opened.body.dispute.id
    disputeIds.push(disputeId)

    // the same user, who also holds ADMIN, tries to approve the refund on the dispute they opened
    const approve = await request(app).patch(`/api/admin/disputes/${disputeId}`).set(auth(adminGuest.token)).send({ decision: 'REFUND' })
    expect(approve.status, 'self open+approve must be forbidden').toBe(403)
    expect(approve.body.error?.code).toBe('DISPUTE_SELF_APPROVAL_FORBIDDEN')

    const d = await db().dispute.findUnique({ where: { id: disputeId } })
    expect(d.status, 'the dispute stays OPEN — no refund happened').toBe('OPEN')
  })

  it('a DISTINCT admin approving a guest-opened dispute still refunds and emits DISPUTE_REFUNDED', async () => {
    const guest = await mkUser('GUEST', 'sod-guest')
    const otherAdmin = await mkUser('ADMIN', 'sod-other-admin')
    const booking = await confirmedBookingFor(guest.id)

    const opened = await request(app).post('/api/disputes').set(auth(guest.token)).send({ bookingId: booking.id, reason: 'genuine dispute' })
    expect(opened.status).toBe(201)
    const disputeId = opened.body.dispute.id
    disputeIds.push(disputeId)

    const approve = await request(app).patch(`/api/admin/disputes/${disputeId}`).set(auth(otherAdmin.token)).send({ decision: 'REFUND' })
    expect(approve.status, 'a distinct admin can approve the refund').toBe(200)
    expect(approve.body.dispute?.status).toBe('RESOLVED_REFUNDED')

    const audit = await db().adminAuditLog.findFirst({ where: { action: 'DISPUTE_REFUNDED', entityType: 'disputes', entityId: disputeId } })
    expect(audit, 'DISPUTE_REFUNDED audit is still emitted').toBeTruthy()
    expect(audit.actorUserId).toBe(otherAdmin.id)
  })
})
