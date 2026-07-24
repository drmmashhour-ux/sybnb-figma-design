import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { STR_ADMIN_COMMISSION_RATE, bookingFinanceSplit, resolveStrCommissionRate, strCommissionRateForBooking } from '../../server/lib/finance-ledger.mjs'
import { resolveSrCommissionTiers, SR_COMMISSION_TIERS } from '../../server/lib/sr-payments.mjs'

// M1 — single-source STR commission via the STR-scoped JurisdictionCommissionPolicy (serviceType STAY).
// resolveStrCommissionRate returns the active FLAT policy's rate, else falls back to
// STR_ADMIN_COMMISSION_RATE (zero-behaviour-change until a policy is activated). STAY-scoped only —
// RIDE commission is untouched.

const TEST_COUNTRY = 'ZZ' // isolated from the real Syria (SY) rows so it can't affect other tests

describe('M1 — STR commission rate resolves from JurisdictionCommissionPolicy (STAY), else 13% fallback', () => {
  const created = []
  afterAll(async () => {
    if (created.length) await db().jurisdictionCommissionPolicy.deleteMany({ where: { id: { in: created } } })
  })

  it('falls back to STR_ADMIN_COMMISSION_RATE (0.13) when no active STAY policy exists', async () => {
    expect(STR_ADMIN_COMMISSION_RATE).toBe(0.13)
    const rate = await resolveStrCommissionRate(db(), { country: TEST_COUNTRY })
    expect(rate).toBe(0.13)
  })

  it('returns the active STAY FLAT policy rate (parts-per-million: 15% = 150,000)', async () => {
    const policy = await db().jurisdictionCommissionPolicy.create({
      data: { country: TEST_COUNTRY, serviceType: 'STAY', policyType: 'FLAT', flatRateParts: 150_000, effectiveFrom: new Date('2020-01-01'), active: true, note: 'test STAY policy' },
    })
    created.push(policy.id)
    const rate = await resolveStrCommissionRate(db(), { country: TEST_COUNTRY })
    expect(rate).toBeCloseTo(0.15, 10)
  })

  it('bookingFinanceSplit uses the passed commission rate (pure, synchronous)', () => {
    const booking = { amountMinor: 10_500, currency: 'USD', listing: { division: 'STAYS', metadata: {} }, metadata: {} }
    // rent ~= 10000 (10500 / 1.05), commission at 20% ~= 2000
    const at20 = bookingFinanceSplit(booking, 10_500, 0.20)
    const at13 = bookingFinanceSplit(booking, 10_500, 0.13)
    expect(at20.adminCommissionMinor).toBeGreaterThan(at13.adminCommissionMinor)
    expect(at13.adminCommissionMinor).toBe(Math.round(at13.stayAmountMinor * 0.13))
    expect(at20.adminCommissionMinor).toBe(Math.round(at20.stayAmountMinor * 0.20))
  })

  it('strCommissionRateForBooking reads the listing jurisdiction (defaults Syria)', async () => {
    const rate = await strCommissionRateForBooking(db(), { listing: { metadata: { country: 'SY' } } })
    expect(rate).toBe(0.13) // no active SY STAY policy in the test DB -> fallback
  })

  it('BOUNDARY: RIDE commission tiers are unaffected (still the hardcoded SR default)', async () => {
    const tiers = await resolveSrCommissionTiers(db(), { country: TEST_COUNTRY })
    expect(tiers).toEqual(SR_COMMISSION_TIERS)
  })
})
