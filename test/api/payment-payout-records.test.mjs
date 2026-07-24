import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof, strCommissionRateForBooking } from '../../server/lib/finance-ledger.mjs'
import { buildStayStatement } from '../../server/lib/stay-statements.mjs'
import { backfillPaymentsPayouts } from '../../scripts/backfill-payments-payouts.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// M5 — the Payment/Payout records are the FROZEN financial statement for a settled booking. Statements
// render from them, so an issued booking keeps its terms even after the commission policy rate changes
// (this is the M2 retroactive-restatement gap being closed). A one-time backfill carries pre-M5 bookings
// in from their frozen wallet entries. Money is integer minor units + currency; the rate is frozen as
// parts-per-million.

const XC = 'XC' // synthetic country so the activated commission policy can't touch real jurisdictions

describe('M5 — frozen Payment/Payout statement records', () => {
  let app, host, guest, admin, listing
  async function createUser(role, label) {
    const user = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `T ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(user.id)
    return { token: createSessionToken(user), user }
  }
  // Deterministic split: gross 120.00 = rent 100.00 + cleaning 20.00. At 13% commission = 15.60.
  async function settle({ status = 'REQUESTED', checkOut = null } = {}) {
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD', checkOut } })
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guest.user.id, provider: 'stripe', providerRef: 'pi_m5_capture', status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: admin.user.id }))
    if (status !== 'REQUESTED') await db().booking.update({ where: { id: booking.id }, data: { status } })
    return booking
  }

  beforeAll(async () => {
    app = testApp()
    host = await createUser('HOST', 'm5-host'); guest = await createUser('GUEST', 'm5-guest'); admin = await createUser('ADMIN', 'm5-admin')
    // Non-instant STAYS in a synthetic country; cleaning fee declared so the split is deterministic.
    listing = await db().listing.create({ data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'شقة', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: XC, cleaningFeeMinor: 20_00 } } })
  })
  afterAll(async () => {
    const bookingIds = (await db().booking.findMany({ where: { guestId: guest.user.id }, select: { id: true } })).map((b) => b.id)
    await db().payout.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().payment.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().walletEntry.deleteMany({ where: { wallet: { userId: { in: [host.user.id, guest.user.id, admin.user.id] } } } }).catch(() => {})
    await db().jurisdictionCommissionPolicy.deleteMany({ where: { country: XC } }).catch(() => {})
    await db().paymentProof.deleteMany({ where: { userId: guest.user.id } })
    await db().booking.deleteMany({ where: { guestId: guest.user.id } })
    await db().listing.deleteMany({ where: { id: listing.id } })
    await cleanupTestUsers()
  })

  it('settlement writes a frozen Payment + Payout with the M2 base and parts-per-million rate', async () => {
    const booking = await settle()
    const payment = await db().payment.findUnique({ where: { bookingId: booking.id } })
    expect(payment.grossMinor).toBe(120_00)
    expect(payment.accommodationMinor).toBe(100_00)
    expect(payment.cleaningFeeMinor).toBe(20_00)
    expect(payment.commissionBaseMinor).toBe(120_00)      // accom + cleaning (M2)
    expect(payment.commissionRateParts).toBe(130_000)      // 13% frozen
    expect(payment.commissionAmountMinor).toBe(15_60)      // 13% of 120.00
    expect(payment.hostPayoutMinor).toBe(104_40)           // 120.00 − 15.60
    expect(payment.settlementRef).toBe('pi_m5_capture')
    expect(payment.source).toBe('live')

    const payout = await db().payout.findUnique({ where: { bookingId: booking.id } })
    expect(payout.status).toBe('PENDING_HOLD')
    expect(payout.amountMinor).toBe(104_40)                // net (no processing fee here)
    expect(payout.hostId).toBe(host.user.id)
  })

  it('frozen commission survives a later policy rate change (no restatement)', async () => {
    const booking = await settle()
    const payment = await db().payment.findUnique({ where: { bookingId: booking.id } })
    expect(payment.commissionRateParts).toBe(130_000)

    // Activate a DIFFERENT live rate (25%) for this jurisdiction, effective before the booking.
    await db().jurisdictionCommissionPolicy.create({ data: { country: XC, serviceType: 'STAY', policyType: 'FLAT', flatRateParts: 250_000, effectiveFrom: new Date('2020-01-01'), active: true, legallyReviewedById: admin.user.id, legallyReviewedAt: new Date() } })

    const bookingWithListing = await db().booking.findUnique({ where: { id: booking.id }, include: { listing: true } })
    const liveRate = await strCommissionRateForBooking(db(), bookingWithListing)
    expect(liveRate).toBeCloseTo(0.25) // the LIVE rate genuinely changed

    // The frozen record is unmoved, and the statement rendered from it shows the 13% commission, not 25%.
    const stillFrozen = await db().payment.findUnique({ where: { bookingId: booking.id } })
    expect(stillFrozen.commissionRateParts).toBe(130_000)
    expect(stillFrozen.commissionAmountMinor).toBe(15_60)

    const period = { periodType: 'ANNUAL', periodStart: new Date('2020-01-01'), periodEnd: new Date('2999-01-01') }
    const statement = await buildStayStatement(db(), { hostId: host.user.id, ...period })
    const line = statement.lines.find((l) => l.bookingId === booking.id)
    expect(line.commissionMinor).toBe(15_60) // frozen, NOT 30_00 (25% of 120.00)
    expect(line.source).toBe('live')

    await db().jurisdictionCommissionPolicy.deleteMany({ where: { country: XC } })
  })

  it('backfill recreates records from frozen wallet entries for a pre-M5 booking', async () => {
    const booking = await settle()
    // Simulate a pre-M5 booking: drop the M5 records, leaving the frozen wallet entries in place.
    await db().payout.delete({ where: { bookingId: booking.id } })
    await db().payment.delete({ where: { bookingId: booking.id } })

    const result = await backfillPaymentsPayouts()
    expect(result.created).toBeGreaterThanOrEqual(1)

    const payment = await db().payment.findUnique({ where: { bookingId: booking.id } })
    expect(payment).toBeTruthy()
    expect(payment.source).toBe('backfill')
    expect(payment.commissionAmountMinor).toBe(15_60) // read from the frozen booking_admin_share entry
    const payout = await db().payout.findUnique({ where: { bookingId: booking.id } })
    expect(payout.source).toBe('backfill')
    expect(payout.amountMinor).toBe(104_40)
  })

  it('releasing a payout transitions the Payout record to RELEASED and audits it', async () => {
    const past = new Date(Date.now() - 60 * 86_400_000)
    const booking = await settle({ status: 'COMPLETED', checkOut: past })
    const res = await request(app).patch(`/api/admin/payouts/${booking.id}/release`).set('Authorization', `Bearer ${admin.token}`).send({})
    expect(res.status).toBe(200)

    const payout = await db().payout.findUnique({ where: { bookingId: booking.id } })
    expect(payout.status).toBe('RELEASED')
    expect(payout.releaseDate).not.toBeNull()
    expect(payout.releasedById).toBe(admin.user.id)

    const audit = await db().adminAuditLog.findFirst({ where: { action: 'ADMIN_PAYOUT_RELEASED', entityId: booking.id } })
    expect(audit).toBeTruthy()
  })
})
