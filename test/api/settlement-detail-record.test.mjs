import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { SYP_PER_USD, sypMinorToRoundedUsdMinor } from '../../server/lib/currency.mjs'
import { cleanupTestUsers, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// M4 — the settlement detail is recorded on the booking (the payment record's additive home until M5):
// charged amount + currency + the applied single admin rate; when settled in SYP (Sham Cash), the
// USD-equivalent is stored too, so the record is self-explanatory and reproducible.

describe('M4 — settlement detail stored on the booking record', () => {
  let host, guest, admin, listing
  async function createUser(role, label) {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `T ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    return u
  }
  async function paidBooking(amountMinor, currency, provider, providerRef) {
    const b = await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'PAYMENT_PENDING', amountMinor, currency } })
    const p = await db().paymentProof.create({ data: { bookingId: b.id, userId: guest.id, provider, providerRef, status: 'PENDING_ADMIN_REVIEW', amountMinor, currency } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: p.id, actorUserId: admin.id }))
    return { booking: await db().booking.findUnique({ where: { id: b.id } }), proofId: p.id }
  }

  beforeAll(async () => {
    host = await createUser('HOST', 'm4-host'); guest = await createUser('GUEST', 'm4-guest'); admin = await createUser('ADMIN', 'm4-admin')
    // non-instant so approval lands in REQUESTED — settlement is recorded regardless of confirm status.
    listing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'ت', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
  })
  afterAll(async () => {
    await db().walletEntry.deleteMany({ where: { wallet: { userId: { in: [host.id, guest.id] } } } }).catch(() => {})
    await db().paymentProof.deleteMany({ where: { userId: guest.id } })
    await db().booking.deleteMany({ where: { guestId: guest.id } })
    await db().listing.deleteMany({ where: { id: listing.id } })
    await cleanupTestUsers()
  })

  it('a SYP Sham Cash settlement stores BOTH amounts + the applied rate (self-explanatory record)', async () => {
    const sypAmount = 1_500_000
    const { booking, proofId } = await paidBooking(sypAmount, 'SYP', 'sham_cash', null)
    const s = booking.metadata.settlement
    expect(s.chargedAmountMinor).toBe(sypAmount)
    expect(s.chargedCurrency).toBe('SYP')
    expect(s.settlementRateSypPerUsd).toBe(SYP_PER_USD)
    expect(s.usdAmountMinor).toBe(sypMinorToRoundedUsdMinor(sypAmount)) // reproducible USD-equivalent
    expect(s.settlementRef).toBe(proofId) // Sham Cash: the admin-approved proof is the reference
  })

  it('a USD Stripe settlement records the charged amount as-is with the capture id as the reference', async () => {
    const { booking } = await paidBooking(100_00, 'USD', 'stripe', 'pi_capture_m4')
    const s = booking.metadata.settlement
    expect(s.chargedCurrency).toBe('USD')
    expect(s.chargedAmountMinor).toBe(100_00)
    expect(s.usdAmountMinor).toBe(100_00) // already USD
    expect(s.settlementRateSypPerUsd).toBe(SYP_PER_USD)
    expect(s.settlementRef).toBe('pi_capture_m4')
  })
})
