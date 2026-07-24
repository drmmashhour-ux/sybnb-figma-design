import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// H6 / M6 v3 — the host bears the Stripe card processing fee: the frozen Payout net = gross − card fee.
// Local Sham Cash has no processing fee, so net = gross. This pins the as-built money behavior (unchanged;
// the change was disclosure) against the frozen M5 records.

describe('H6 — host-borne card fee (net = gross − cardFee)', () => {
  let host, guest, admin, listing
  async function createUser(role, label) {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `T ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    return u
  }
  async function paidBooking(provider, providerRef, processingFeeMinor) {
    const b = await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD' } })
    const p = await db().paymentProof.create({ data: { bookingId: b.id, userId: guest.id, provider, providerRef, status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: p.id, actorUserId: admin.id, paymentProcessingFeeMinor: processingFeeMinor }))
    return b.id
  }

  beforeAll(async () => {
    host = await createUser('HOST', 'cf-host'); guest = await createUser('GUEST', 'cf-guest'); admin = await createUser('ADMIN', 'cf-admin')
    listing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'شقة', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY', cleaningFeeMinor: 20_00 } } })
  })
  afterAll(async () => {
    const bIds = (await db().booking.findMany({ where: { guestId: guest.id }, select: { id: true } })).map((b) => b.id)
    await db().payout.deleteMany({ where: { bookingId: { in: bIds } } }).catch(() => {})
    await db().payment.deleteMany({ where: { bookingId: { in: bIds } } }).catch(() => {})
    await db().walletEntry.deleteMany({ where: { wallet: { userId: { in: [host.id, guest.id, admin.id] } } } }).catch(() => {})
    await db().paymentProof.deleteMany({ where: { userId: guest.id } })
    await db().booking.deleteMany({ where: { guestId: guest.id } })
    await db().listing.deleteMany({ where: { id: listing.id } })
    await cleanupTestUsers()
  })

  it('a Stripe card payment: net payout = gross − card fee (host absorbs it)', async () => {
    const cardFee = 5_00
    const bookingId = await paidBooking('stripe', 'pi_cardfee', cardFee)
    const payment = await db().payment.findUnique({ where: { bookingId } })
    const payout = await db().payout.findUnique({ where: { bookingId } })
    // Gross host payout = (accom + cleaning) − commission = 120.00 − 15.60 = 104.40.
    expect(payment.hostPayoutMinor).toBe(104_40)
    expect(payment.processingFeeMinor).toBe(cardFee)
    // Net (what is actually released) = gross − card fee.
    expect(payout.amountMinor).toBe(payment.hostPayoutMinor - cardFee)
    expect(payout.amountMinor).toBe(99_40)
  })

  it('a Sham Cash payment: no processing fee, net = gross', async () => {
    const bookingId = await paidBooking('sham_cash', null, 0)
    const payment = await db().payment.findUnique({ where: { bookingId } })
    const payout = await db().payout.findUnique({ where: { bookingId } })
    expect(payment.processingFeeMinor).toBe(0)
    expect(payout.amountMinor).toBe(payment.hostPayoutMinor) // net == gross
  })
})
