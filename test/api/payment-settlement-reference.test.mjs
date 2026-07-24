import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { settlementReference, assertRealSettlementReference, assertStripeLivemodeForProduction, SETTLEMENT_REFERENCE_REQUIRED_CODE } from '../../server/lib/payment-gateway.mjs'
import { STR_HOST_CONTRACT_VERSION, recordHostContractConsent } from '../../server/lib/host-consent.mjs'
import { cleanupTestUsers, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// M3-A — a booking may be marked paid/approved/CONFIRMED ONLY with a REAL settlement reference:
// Stripe = the captured payment_intent/charge id (pi_/ch_), never the cs_ session id; Sham Cash = the
// admin-approved proof. Test-mode Stripe settlement is rejected in production via the livemode flag. And
// the paid→CONFIRMED path must not bypass the M6 host-accept gate (non-instant → REQUESTED).

describe('M3-A — settlement reference gateway (pure)', () => {
  it('a Stripe proof needs a real capture id (pi_/ch_), not a cs_ session id', () => {
    expect(settlementReference({ provider: 'stripe', providerRef: 'cs_test_123' })).toBeNull()
    expect(settlementReference({ provider: 'stripe', providerRef: 'pi_live_123' })).toBe('pi_live_123')
    expect(settlementReference({ provider: 'stripe', providerRef: '' })).toBeNull()
  })
  it('a manual (sham_cash) proof is settled by the admin-approved proof itself', () => {
    expect(settlementReference({ provider: 'sham_cash', id: 'proof-1' })).toBe('proof-1')
  })
  it('assertStripeLivemodeForProduction rejects test-mode in production', () => {
    expect(() => assertStripeLivemodeForProduction({ livemode: false }, { isProduction: true })).toThrow()
    expect(() => assertStripeLivemodeForProduction({ livemode: true }, { isProduction: true })).not.toThrow()
    expect(() => assertStripeLivemodeForProduction({ livemode: false }, { isProduction: false })).not.toThrow()
  })
})

describe('M3-A — approvePaymentProof enforces a real settlement reference + does not bypass M6', () => {
  let host, guest, admin, listing, instantListing, consentedHost, consentedInstantListing
  async function createUser(role, label) {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `T ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    return u
  }
  async function pendingBooking(listingId) {
    return db().booking.create({ data: { listingId, guestId: guest.id, status: 'PAYMENT_PENDING', amountMinor: 100_00, currency: 'USD' } })
  }
  async function proof(bookingId, provider, providerRef) {
    return db().paymentProof.create({ data: { bookingId, userId: guest.id, provider, providerRef, status: 'PENDING_ADMIN_REVIEW', amountMinor: 100_00, currency: 'USD' } })
  }

  beforeAll(async () => {
    host = await createUser('HOST', 'm3-host'); guest = await createUser('GUEST', 'm3-guest'); admin = await createUser('ADMIN', 'm3-admin')
    listing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'ت', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
    // instantListing's host (host) has NO current contract consent -> stale-consent instant-book case.
    instantListing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'ت', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: true, metadata: { country: 'SY' } } })
    // consentedHost HAS recorded current-version consent -> safe instant-book auto-confirm.
    consentedHost = await createUser('HOST', 'm3-chost')
    await recordHostContractConsent(db(), { userId: consentedHost.id, action: 'publish' })
    consentedInstantListing = await db().listing.create({ data: { ownerId: consentedHost.id, division: 'STAYS', titleAr: 'ت', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: true, metadata: { country: 'SY' } } })
  })
  afterAll(async () => {
    await db().walletEntry.deleteMany({ where: { wallet: { userId: { in: [host.id, guest.id, consentedHost.id] } } } }).catch(() => {})
    await db().paymentProof.deleteMany({ where: { userId: guest.id } })
    await db().booking.deleteMany({ where: { guestId: guest.id } })
    await db().listing.deleteMany({ where: { id: { in: [listing.id, instantListing.id, consentedInstantListing.id] } } })
    await cleanupTestUsers()
  })

  it('REJECTS approving a Stripe proof whose ref is a cs_ session id (no real capture)', async () => {
    const b = await pendingBooking(listing.id)
    const p = await proof(b.id, 'stripe', 'cs_test_nocapture')
    await expect(db().$transaction((tx) => approvePaymentProof(tx, { proofId: p.id, actorUserId: admin.id }))).rejects.toMatchObject({ code: SETTLEMENT_REFERENCE_REQUIRED_CODE })
    expect((await db().booking.findUnique({ where: { id: b.id } })).status).toBe('PAYMENT_PENDING') // never paid
  })

  it('approves a Stripe proof with a real capture id → non-instant booking goes to REQUESTED (M6 gate, not CONFIRMED)', async () => {
    const b = await pendingBooking(listing.id)
    const p = await proof(b.id, 'stripe', 'pi_real_capture_1')
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: p.id, actorUserId: admin.id }))
    expect((await db().booking.findUnique({ where: { id: b.id } })).status).toBe('REQUESTED') // routes through host accept
  })

  it('approves a Sham Cash proof (admin-reviewed settlement, no providerRef needed)', async () => {
    const b = await pendingBooking(listing.id)
    const p = await proof(b.id, 'sham_cash', null)
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: p.id, actorUserId: admin.id }))
    expect((await db().booking.findUnique({ where: { id: b.id } })).status).toBe('REQUESTED')
  })

  it('an instant-book with STALE host consent does NOT auto-confirm — it degrades to REQUESTED (re-consent)', async () => {
    // instantListing's host never recorded current-version consent, so the current terms are un-consented.
    const b = await pendingBooking(instantListing.id)
    const p = await proof(b.id, 'stripe', 'pi_real_capture_2')
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: p.id, actorUserId: admin.id }))
    const booking = await db().booking.findUnique({ where: { id: b.id } })
    expect(booking.status).toBe('REQUESTED') // NOT CONFIRMED — host must re-accept the current terms
    expect(booking.metadata?.termsSnapshot).toBeUndefined() // no terms frozen at an un-consented rate
  })

  it('an instant-book with CURRENT host consent auto-confirms and FREEZES the terms snapshot', async () => {
    const b = await pendingBooking(consentedInstantListing.id)
    const p = await proof(b.id, 'stripe', 'pi_real_capture_3')
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: p.id, actorUserId: admin.id }))
    const booking = await db().booking.findUnique({ where: { id: b.id } })
    expect(booking.status).toBe('CONFIRMED')
    expect(booking.metadata.termsSnapshot.baseVersion).toBe(STR_HOST_CONTRACT_VERSION)
    expect(typeof booking.metadata.termsSnapshot.commissionRate).toBe('number')
  })
})
