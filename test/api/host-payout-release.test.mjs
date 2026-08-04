import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { encryptPayoutAccount, payoutAccountLast4 } from '../../server/lib/payout-account.mjs'
import { recordWalletEntry } from '../../server/lib/finance-ledger.mjs'
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
    const booking = await db().booking.create({
      data: { listingId: listing.id, guestId: guest.id, status: 'COMPLETED', amountMinor: 100_00, currency: 'USD', checkIn, checkOut },
    })
    const proof = await db().paymentProof.create({
      data: { bookingId: booking.id, userId: guest.id, provider: 'test', providerRef: `paid-${booking.id}`, status: 'APPROVED', amountMinor: 100_00, currency: 'USD' },
    })
    await db().$transaction((tx) => recordWalletEntry(tx, {
      userId: host.id, type: 'HOLD', amountMinor: 9_000, currency: 'USD', referenceType: 'booking_payout',
      referenceId: booking.id, keyParts: ['test-payout-hold', booking.id, proof.id], note: 'approval-time payout snapshot',
    }))
    return booking
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

  it('fails closed when a completed booking has no approved payment or payout snapshot', async () => {
    const number = '0955000999'
    await setHostPayout({ type: 'sham_cash', accountHolder: 'Host Owner', last4: payoutAccountLast4(number), ...encryptPayoutAccount(number) })
    const checkOut = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
    const booking = await db().booking.create({ data: {
      listingId: listing.id, guestId: guest.id, status: 'COMPLETED', amountMinor: 100_00, currency: 'USD',
      checkIn: new Date(checkOut.getTime() - 86400000), checkOut,
    } })
    const res = await request(app).patch(`/api/admin/payouts/${booking.id}/release`)
      .set('Authorization', `Bearer ${admin.token}`).send({ payoutRef: 'SHAM-NO-PAYMENT' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('PAYOUT_APPROVED_PAYMENT_REQUIRED')
    expect(await db().walletEntry.count({ where: { referenceId: booking.id, type: { in: ['RELEASE', 'DEBIT'] } } })).toBe(0)
  })

  it('refuses payout while the booking has an open dispute', async () => {
    const number = '0955000888'
    await setHostPayout({ type: 'sham_cash', accountHolder: 'Host Owner', last4: payoutAccountLast4(number), ...encryptPayoutAccount(number) })
    const booking = await makeEligibleBooking()
    await db().dispute.create({ data: { subjectType: 'STR_BOOKING', bookingId: booking.id, openedByUserId: guest.id, reason: 'open payout-blocking dispute' } })
    const res = await request(app).patch(`/api/admin/payouts/${booking.id}/release`)
      .set('Authorization', `Bearer ${admin.token}`).send({ payoutRef: 'SHAM-DISPUTED' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('PAYOUT_NOT_ELIGIBLE')
    expect(await db().walletEntry.count({ where: { referenceType: 'booking_payout_disbursement', referenceId: booking.id } })).toBe(0)
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
    const disbursement = await db().walletEntry.findFirst({ where: { referenceType: 'booking_payout_disbursement', referenceId: booking.id, type: 'DEBIT' } })
    expect(disbursement?.amountMinor).toBe(release.amountMinor)
    const repeat = await request(app).patch(`/api/admin/payouts/${booking.id}/release`)
      .set('Authorization', `Bearer ${admin.token}`).send({ payoutRef: 'SHAM-REF-DIFFERENT' })
    expect(repeat.status).toBe(409)
    expect(repeat.body.error.code).toBe('PAYOUT_ALREADY_DISBURSED')
    expect(await db().walletEntry.count({ where: { referenceType: 'booking_payout_disbursement', referenceId: booking.id } })).toBe(1)

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

  // A manual admin hold must ACTUALLY stop the disbursement (it used to be a UI-only note).
  it('refuses release while a payout is on manual hold, then allows it once the hold is removed', async () => {
    const number = '0955000111'
    await setHostPayout({
      type: 'sham_cash',
      accountHolder: 'Host Owner',
      last4: payoutAccountLast4(number),
      ...encryptPayoutAccount(number),
      updatedAt: new Date().toISOString(),
    })
    const booking = await makeEligibleBooking()

    const hold = await request(app)
      .post(`/api/admin/bookings/${booking.id}/payout-hold`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ held: true })
    expect(hold.status).toBe(200)
    expect(hold.body.payoutHeld).toBe(true)

    const blocked = await request(app)
      .patch(`/api/admin/payouts/${booking.id}/release`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ payoutRef: 'SHAM-REF-HELD' })
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe('PAYOUT_ON_MANUAL_HOLD')
    const noRelease = await db().walletEntry.findFirst({
      where: { referenceType: 'booking_payout', referenceId: booking.id, type: 'RELEASE' },
    })
    expect(noRelease).toBeNull() // money did NOT move

    const unhold = await request(app)
      .post(`/api/admin/bookings/${booking.id}/payout-hold`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ held: false })
    expect(unhold.body.payoutHeld).toBe(false)

    const ok = await request(app)
      .patch(`/api/admin/payouts/${booking.id}/release`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ payoutRef: 'SHAM-REF-UNHELD' })
    expect(ok.status).toBe(200)
  })

  // An admin note is really delivered into the booking's message thread (was a local-only outbox before).
  it('delivers an admin note into the booking message thread as an ADMIN message', async () => {
    const booking = await makeEligibleBooking()
    const res = await request(app)
      .post(`/api/admin/bookings/${booking.id}/message`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ target: 'guest', body: 'SYBNB team note: your booking is under review.' })
    expect(res.status).toBe(201)
    expect(res.body.message.senderRole).toBe('ADMIN')

    const thread = await db().messageThread.findFirst({
      where: { OR: [{ bookingId: booking.id }, { listingId: listing.id, guestId: guest.id }] },
      include: { messages: true },
    })
    expect(thread).not.toBeNull()
    expect(thread.messages.some((m) => m.senderRole === 'ADMIN' && m.body.includes('under review'))).toBe(true)
  })

  it('rejects an empty admin note', async () => {
    const booking = await makeEligibleBooking()
    const res = await request(app)
      .post(`/api/admin/bookings/${booking.id}/message`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ target: 'guest', body: '   ' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MESSAGE_BODY_REQUIRED')
  })
})
