import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'
import { releaseAbandonedHolds } from '../../server/lib/booking-lifecycle.mjs'
import { NOTIFICATION_AUDIT_ACTION } from '../../server/lib/notifications.mjs'

// SYB-003 — the transactional notifications are wired to authoritative events AFTER they commit, and
// record a delivery status. In the test env the mailer is not configured, so delivery is SUPPRESSED —
// which still proves the wiring, the audit, and (critically) that the workflow is never blocked.

async function createUser(role, label, withEmail = true) {
  const user = await db().user.create({
    data: { email: withEmail ? uniqueTestEmail(label) : null, passwordHash: hashPassword('correct-horse-battery'), displayName: `Test ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', locale: 'en-US', roles: { create: { role } } },
  })
  trackTestUser(user.id)
  return { token: createSessionToken(user), user }
}

const deliveryFor = (id) => db().adminAuditLog.findFirst({ where: { action: NOTIFICATION_AUDIT_ACTION, entityId: id }, orderBy: { createdAt: 'desc' } })

describe('SYB-003 — notifications wired to authoritative events (best-effort, non-blocking)', () => {
  let app, host, guest, admin, releaser, listing
  beforeAll(async () => {
    app = testApp()
    admin = await createUser('ADMIN', 'notif-admin')
    releaser = await createUser('ADMIN', 'notif-releaser') // D2.1: a distinct admin on record so disburse has provenance
    host = await createUser('HOST', 'notif-host')
    guest = await createUser('GUEST', 'notif-guest')
    await db().user.update({ where: { id: host.user.id }, data: { payoutMethod: { type: 'sham_cash', receiverName: 'H', phone: '099', version: 1 } } })
    listing = await db().listing.create({ data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'إشعار', titleEn: 'Notif Stay', priceMinor: 50_00, currency: 'USD', status: 'APPROVED' } })
  })
  afterAll(async () => { await cleanupTestUsers() })

  it('an abandoned-hold release records a delivery event and still restores inventory', async () => {
    const b = await db().booking.create({ data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', amountMinor: 50_00, currency: 'USD', createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } })
    const released = await releaseAbandonedHolds({ id: b.id })
    expect(released).toBe(1) // workflow completed
    expect((await db().booking.findUnique({ where: { id: b.id } })).status).toBe('CANCELLED')
    const delivery = await deliveryFor(b.id)
    expect(delivery).toBeTruthy()
    expect(delivery.after.event).toBe('PAYMENT_HOLD_EXPIRED')
    expect(delivery.after.status).toBeTruthy() // SUPPRESSED/SENT/NO_CHANNEL/FAILED — a status is recorded
  })

  it('a manual payout disbursement records a delivery event and still completes', async () => {
    const b = await db().booking.create({ data: { listingId: listing.id, guestId: guest.user.id, status: 'COMPLETED', amountMinor: 50_00, currency: 'USD' } })
    // D1: disburse requires a frozen destination snapshot on the payout — provide one so this notification test disburses.
    await db().payout.create({ data: { bookingId: b.id, hostId: host.user.id, amountMinor: 50_00, currency: 'USD', status: 'PENDING_HOLD', releasedById: releaser.user.id, destinationSnapshot: { type: 'sham_cash', receiverName: 'Omar', phone: '0988', version: 1 } } })
    const res = await request(app).post(`/api/admin/payouts/${b.id}/disburse`).set('Authorization', `Bearer ${admin.token}`).send({ transition: 'INITIATED', reason: 'notify test' })
    expect(res.status).toBe(201) // workflow completed regardless of delivery
    const delivery = await deliveryFor(b.id)
    expect(delivery).toBeTruthy()
    expect(delivery.after.event).toBe('PAYOUT_INITIATED')
  })

  it('a delivery record never contains the raw email or personal data', async () => {
    const b = await db().booking.create({ data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', amountMinor: 50_00, currency: 'USD', createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } })
    await releaseAbandonedHolds({ id: b.id })
    const delivery = await deliveryFor(b.id)
    // recipientRef is a user id, not the email address.
    expect(JSON.stringify(delivery)).not.toContain(guest.user.email)
  })
})
