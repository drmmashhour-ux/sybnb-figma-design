import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { encryptPayoutAccount, payoutAccountLast4 } from '../../server/lib/payout-account.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
} from '../support/testServer.mjs'

// GAP 1: the host payout release is a real disbursement (mirrors the SR-driver release). It must
// refuse when the host has no payout method, require an external payoutRef and record it, and expose
// an ADMIN-only way to reveal the host's Sham Cash number (decrypted) for the actual transfer.
describe('Host payout release (disbursement) + ADMIN-only account reveal', () => {
  let app
  let host
  let admin
  let guest
  let listing

  beforeAll(async () => {
    app = testApp()
    host = await makeUser('payout-host', 'HOST')
    admin = await makeUser('payout-admin', 'ADMIN')
    guest = await makeUser('payout-guest', 'GUEST')
    listing = await db().listing.create({
      data: { ownerId: host.id, division: 'STAYS', titleAr: 'وحدة صرف', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' },
    })
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function makeUser(label, role) {
    const u = await db().user.create({
      data: { email: uniqueTestEmail(label), displayName: label, referralCode: uniqueTestReferralCode(), roles: { create: { role } } },
      include: { roles: true },
    })
    trackTestUser(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }

  // A COMPLETED booking whose checkout is well past the 14-day hold → payout-eligible now.
  async function makeEligibleBooking() {
    const checkOut = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
    const checkIn = new Date(checkOut.getTime() - 2 * 24 * 60 * 60 * 1000)
    return db().booking.create({
      data: { listingId: listing.id, guestId: guest.id, status: 'COMPLETED', amountMinor: 100_00, currency: 'USD', checkIn, checkOut },
    })
  }

  async function setHostPayout(payoutMethod) {
    await db().user.update({ where: { id: host.id }, data: { payoutMethod } })
  }

  it('refuses release without a payoutRef', async () => {
    const booking = await makeEligibleBooking()
    const res = await request(app)
      .patch(`/api/admin/payouts/${booking.id}/release`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('PAYOUT_REF_REQUIRED')
  })

  it('refuses release when the host has no payout method on file', async () => {
    await setHostPayout(null)
    const booking = await makeEligibleBooking()
    const res = await request(app)
      .patch(`/api/admin/payouts/${booking.id}/release`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ payoutRef: 'SHAM-REF-1' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('PAYOUT_METHOD_REQUIRED')
  })

  it('releases with a payout method + payoutRef and records the ref on the ledger + audit', async () => {
    const number = '0955123456'
    await setHostPayout({
      type: 'sham_cash',
      accountHolder: 'Host Owner',
      last4: payoutAccountLast4(number),
      ...encryptPayoutAccount(number),
      updatedAt: new Date().toISOString(),
    })
    const booking = await makeEligibleBooking()
    const res = await request(app)
      .patch(`/api/admin/payouts/${booking.id}/release`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ payoutRef: 'SHAM-REF-42' })
    expect(res.status).toBe(200)

    const release = await db().walletEntry.findFirst({
      where: { referenceType: 'booking_payout', referenceId: booking.id, type: 'RELEASE' },
    })
    expect(release).not.toBeNull()
    expect(release.note).toContain('SHAM-REF-42')

    const audit = await db().adminAuditLog.findFirst({
      where: { action: 'ADMIN_PAYOUT_RELEASED', entityId: booking.id },
    })
    expect(audit).not.toBeNull()
    expect(audit.after.payoutRef).toBe('SHAM-REF-42')
  })

  it('reveals the decrypted Sham Cash number to ADMIN only, and audits only the last4', async () => {
    const number = '0955777888'
    await setHostPayout({
      type: 'sham_cash',
      accountHolder: 'Host Owner',
      last4: payoutAccountLast4(number),
      ...encryptPayoutAccount(number),
      updatedAt: new Date().toISOString(),
    })
    const booking = await makeEligibleBooking()

    // A non-admin (guest) is forbidden from revealing the number.
    const denied = await request(app)
      .get(`/api/admin/payouts/${booking.id}/account`)
      .set('Authorization', `Bearer ${guest.token}`)
    expect(denied.status).toBe(403)

    // ADMIN gets the full decrypted number.
    const ok = await request(app)
      .get(`/api/admin/payouts/${booking.id}/account`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(ok.status).toBe(200)
    expect(ok.body.account.type).toBe('sham_cash')
    expect(ok.body.account.number).toBe(number)

    // The reveal is audited WITHOUT the number — only who revealed which host's account + last4.
    const audit = await db().adminAuditLog.findFirst({
      where: { action: 'ADMIN_PAYOUT_ACCOUNT_REVEALED', entityId: host.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
    expect(audit.after.last4).toBe(payoutAccountLast4(number))
    expect(JSON.stringify(audit.after)).not.toContain(number)
  })

  it('reveals a legacy plaintext-phone payout method as-is', async () => {
    await setHostPayout({ phone: '0912000111', receiverName: 'Legacy Host' })
    const booking = await makeEligibleBooking()
    const ok = await request(app)
      .get(`/api/admin/payouts/${booking.id}/account`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(ok.status).toBe(200)
    expect(ok.body.account.type).toBe('legacy')
    expect(ok.body.account.number).toBe('0912000111')
  })
})
