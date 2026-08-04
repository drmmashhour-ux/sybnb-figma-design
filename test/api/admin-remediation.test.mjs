import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { recordWalletEntry } from '../../server/lib/finance-ledger.mjs'
import {
  cleanupTestUsers,
  fundWallet,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// Admin remediation controls: suspend blocks a session; listing take-down removes it from search;
// force-cancel refunds correctly (capped + admin-share reversed + idempotent); needs-attention flags
// a stuck booking, a no-payout-method host, and a deliberately imbalanced wallet.
describe('Admin remediation controls', () => {
  let app
  let admin

  beforeAll(async () => {
    app = testApp()
    admin = await makeUser('rem-admin', 'ADMIN')
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

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    const legacyVerificationGrant1 = await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }

  function futureWindow(offsetDays) {
    const checkIn = new Date()
    checkIn.setUTCDate(checkIn.getUTCDate() + offsetDays)
    checkIn.setUTCHours(0, 0, 0, 0)
    return { checkIn, checkOut: new Date(checkIn.getTime() + 2 * 86400000) }
  }

  // --- A1: suspend blocks the user's session ---
  it('A1: suspending a user invalidates their session, and non-admins cannot do it', async () => {
    const victim = await makeUser('rem-victim', 'HOST')
    // Their token works before suspension.
    const before = await request(app).get('/api/host/overview').set('Authorization', `Bearer ${victim.token}`)
    expect(before.status).toBe(200)

    // A non-admin cannot suspend anyone.
    const denied = await request(app)
      .post(`/api/admin/users/${victim.id}/status`)
      .set('Authorization', `Bearer ${victim.token}`)
      .send({ status: 'SUSPENDED' })
    expect(denied.status).toBe(403)

    // Admin suspends → 200.
    const suspend = await request(app)
      .post(`/api/admin/users/${victim.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'SUSPENDED', reason: 'policy' })
    expect(suspend.status).toBe(200)
    expect(suspend.body.user.status).toBe('SUSPENDED')

    // The victim's old token is now dead (session invalidated + non-ACTIVE account).
    const after = await request(app).get('/api/host/overview').set('Authorization', `Bearer ${victim.token}`)
    expect(after.status).toBe(401)
  })

  // --- A2: listing take-down removes it from search ---
  it('A2: pausing an approved listing removes it from public search', async () => {
    const host = await makeUser('rem-host-listing', 'HOST')
    const listing = await db().listing.create({
      data: { ownerId: host.id, division: 'STAYS', titleAr: 'وحدة الإخفاء', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' },
    })

    const searchBefore = await request(app).get('/api/listings?division=STAYS')
    expect(searchBefore.body.listings.some((l) => l.id === listing.id)).toBe(true)

    const pause = await request(app)
      .post(`/api/admin/listings/${listing.id}/status`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'PAUSED', reason: 'complaint' })
    expect(pause.status).toBe(200)
    expect(pause.body.listing.status).toBe('PAUSED')

    const searchAfter = await request(app).get('/api/listings?division=STAYS')
    expect(searchAfter.body.listings.some((l) => l.id === listing.id)).toBe(false)
  })

  // --- A3: force-cancel refunds correctly (capped + admin-share reversed + idempotent) ---
  it('A3: force-cancel refunds the guest, reverses the admin share, and is idempotent', async () => {
    const host = await makeUser('rem-host-cancel', 'HOST')
    const listing = await db().listing.create({
      data: { ownerId: host.id, division: 'STAYS', titleAr: 'وحدة الإلغاء', priceMinor: 120_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: true },
    })
    const guest = await registerGuest('rem-cancel-guest')
    const win = futureWindow(700)

    // Book → pay (local wallet) → admin approve (this credits the admin share + holds host payout).
    const created = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn: win.checkIn.toISOString(), checkOut: win.checkOut.toISOString(), currency: 'USD' })
    expect(created.status).toBe(201)
    const bookingId = created.body.booking.id

    await db().user.update({ where: { id: guest.id }, data: { idDocumentRef: 'rem-id-ref' } })
    await request(app)
      .post('/api/payments/local-wallet-proof')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId, providerRef: `rem-ref-${bookingId}` })
    const proof = await db().paymentProof.findFirst({ where: { bookingId } })
    const approve = await request(app)
      .patch(`/api/admin/review-queue/payment/${proof.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED', shamCashAccountMinor: proof.amountMinor })
    expect(approve.status).toBe(200)

    const adminShareBefore = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: bookingId, type: 'CREDIT' } })
    expect(adminShareBefore).not.toBeNull()

    // Force-cancel.
    const cancel = await request(app)
      .post(`/api/admin/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reason: 'admin remediation' })
    expect(cancel.status).toBe(200)
    expect((await db().booking.findUnique({ where: { id: bookingId } })).status).toBe('CANCELLED')

    // Guest refund == amount actually paid (capped), recorded once.
    const refunds = await db().walletEntry.findMany({ where: { referenceType: 'booking_refund', referenceId: bookingId, type: 'REFUND' } })
    expect(refunds.length).toBe(1)
    expect(refunds[0].amountMinor).toBe(proof.amountMinor)

    // Admin share reversed.
    const reversal = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share_reversal', referenceId: bookingId, type: 'DEBIT' } })
    expect(reversal).not.toBeNull()

    // Idempotent: a repeat is rejected and moves no more money.
    const again = await request(app)
      .post(`/api/admin/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ reason: 'again' })
    expect(again.status).toBe(400)
    expect(again.body.error.code).toBe('BOOKING_NOT_CANCELLABLE')
    const refundsAfter = await db().walletEntry.count({ where: { referenceType: 'booking_refund', referenceId: bookingId, type: 'REFUND' } })
    expect(refundsAfter).toBe(1)
  })

  // --- B: needs-attention flags stuck booking + no-payout host + imbalanced wallet ---
  it('B: needs-attention flags a stuck booking, a no-payout host, and an imbalanced wallet', async () => {
    // (a) a PAYMENT_PENDING booking older than the 2h threshold.
    const host = await makeUser('rem-na-host', 'HOST')
    const listing = await db().listing.create({
      data: { ownerId: host.id, division: 'STAYS', titleAr: 'وحدة عالقة', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' },
    })
    const guest = await makeUser('rem-na-guest', 'GUEST')
    const win = futureWindow(650)
    const stuck = await db().booking.create({
      data: {
        listingId: listing.id, guestId: guest.id, status: 'PAYMENT_PENDING',
        amountMinor: 100_00, currency: 'USD', checkIn: win.checkIn, checkOut: win.checkOut,
        createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      },
    })

    // (b) a HOST holding money but with NO payout method.
    const payoutlessHost = await makeUser('rem-na-payoutless', 'HOST')
    await fundWallet(payoutlessHost.id, 500_00, 'USD')

    // (c) a wallet whose cached balance is deliberately out of sync with its ledger entries.
    const imbalanced = await makeUser('rem-na-imbalanced', 'GUEST')
    await fundWallet(imbalanced.id, 300_00, 'USD') // creates a correct CREDIT + cachedBalance
    await db().wallet.update({
      where: { userId_currency: { userId: imbalanced.id, currency: 'USD' } },
      data: { cachedBalanceMinor: 999_99 }, // tamper so cached ≠ Σ(entry deltas)
    })

    const res = await request(app).get('/api/admin/needs-attention').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)

    expect(res.body.items.stuckBookings.some((b) => b.id === stuck.id)).toBe(true)
    expect(res.body.items.noPayoutMethodHosts.some((h) => h.userId === payoutlessHost.id)).toBe(true)
    expect(res.body.items.imbalancedWallets.some((w) => w.userId === imbalanced.id)).toBe(true)
    expect(res.body.counts.stuckPayments).toBeGreaterThanOrEqual(1)
    expect(res.body.counts.noPayoutMethodHosts).toBeGreaterThanOrEqual(1)
    expect(res.body.counts.imbalancedWallets).toBeGreaterThanOrEqual(1)
  })

  it('B: needs-attention detects an imbalanced zero-balance wallet', async () => {
    const user = await makeUser('rem-na-zero-imbalanced', 'GUEST')
    await fundWallet(user.id, 123, 'USD')
    await db().wallet.update({
      where: { userId_currency: { userId: user.id, currency: 'USD' } },
      data: { cachedBalanceMinor: 0 },
    })

    const res = await request(app).get('/api/admin/needs-attention').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.items.imbalancedWallets.some((wallet) => wallet.userId === user.id)).toBe(true)
  })

  it('revenue summary includes card processing fee credits', async () => {
    await db().$transaction((tx) => recordWalletEntry(tx, {
      userId: admin.id,
      type: 'CREDIT',
      amountMinor: 7,
      currency: 'USD',
      referenceType: 'card_processing_fee',
      referenceId: `topup-fee-${admin.id}`,
      keyParts: ['test-card-processing-fee', admin.id],
      note: 'test card processing fee',
    }))
    const res = await request(app).get('/api/admin/revenue-summary').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    const usd = res.body.revenue.byCurrency.find((row) => row.currency === 'USD')
    expect(usd).toBeTruthy()
    expect(usd.totalRevenueMinor).toBeGreaterThanOrEqual(7)
  })

  it('persists audited AI section controls and builds the daily executive report', async () => {
    const updated = await request(app)
      .put('/api/admin/ai-controls')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ section: 'finance', enabled: true })
    expect(updated.status).toBe(200)
    expect(updated.body.controls.find((item) => item.section === 'finance')?.enabled).toBe(true)

    const audit = await db().adminAuditLog.findFirst({ where: { action: 'AI_SECTION_CONTROL_UPDATED', entityId: 'finance' }, orderBy: { createdAt: 'desc' } })
    expect(audit?.after).toMatchObject({ enabled: true, sensitiveActionsRequireApproval: true })

    const report = await request(app).get('/api/admin/ai-daily-report').set('Authorization', `Bearer ${admin.token}`)
    expect(report.status).toBe(200)
    expect(report.body.report.controls.find((item) => item.section === 'finance')?.enabled).toBe(true)
    expect(report.body.report.approvalRequired).toContain('payout releases')
    expect(report.body.text).toContain('SYBNB DAILY EXECUTIVE REPORT')
  })
})
