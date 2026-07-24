import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { resolveStayTaxLine, STAY_TAX_LINE_STATUS } from '../../server/lib/stay-tax-line.mjs'
import { bookingFinanceSplit, buildPayoutRow, platformFee } from '../../server/lib/finance-ledger.mjs'
import { computeTaxAmountMinor } from '../../server/lib/jurisdiction-pricing.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// M8 — the guest-facing STR tax capsule is MULTI-COMPONENT: each jurisdiction tax component (name, rate,
// taxable base) is one active JurisdictionTaxRate row, computed and displayed separately, summed to a
// total. Syria today is "tax treatment pending confirmation" (never a silent zero). Every component is
// pass-through — commission and host payout are invariant to the tax rates.

const XT = 'XT' // synthetic multi-tax country — never collides with real SY/CA data
const XZ = 'XZ' // synthetic no-tax country

describe('M8 — stay tax capsule (multi-component, pass-through)', () => {
  let app
  const SY_KEY = { division_countryCode_regionCode: { division: 'STR', countryCode: 'SY', regionCode: '' } }
  beforeAll(async () => {
    app = await testApp()
    // The shared test seeder overrides Syria to APPROVED/taxRequired:false so pre-gate tests keep passing.
    // This file targets the tax capsule specifically, so it restores Syria's PRODUCTION pending values
    // (taxRequired && !taxSatisfied) for its own assertions — per the seedApprovedJurisdictions contract.
    await db().jurisdictionComplianceProfile.upsert({
      where: SY_KEY,
      create: { division: 'STR', countryCode: 'SY', regionCode: '', status: 'APPROVED', taxRequired: true, taxSatisfied: false },
      update: { taxRequired: true, taxSatisfied: false },
    })
    // Synthetic multi-component jurisdiction: GST 5% + QST 9.975%, both on ACCOMMODATION_ONLY.
    await db().jurisdictionComplianceProfile.create({ data: { division: 'STR', countryCode: XT, regionCode: '', status: 'APPROVED', taxRequired: true, taxSatisfied: true } })
    await db().jurisdictionTaxRate.createMany({ data: [
      { country: XT, serviceType: 'STAY', taxType: 'GST', rateParts: 50_000 /* 5% */, calculationBase: 'ACCOMMODATION_ONLY', collectorType: 'PLATFORM', effectiveFrom: new Date('2020-01-01'), active: true },
      { country: XT, serviceType: 'STAY', taxType: 'QST', rateParts: 99_750 /* 9.975% */, calculationBase: 'ACCOMMODATION_ONLY', collectorType: 'PLATFORM', effectiveFrom: new Date('2020-01-01'), active: true },
    ] })
  })
  afterAll(async () => {
    await db().jurisdictionComplianceProfile.update({ where: SY_KEY, data: { taxRequired: false, taxSatisfied: false } }).catch(() => {})
    await db().jurisdictionTaxRate.deleteMany({ where: { country: { in: [XT, XZ] } } }).catch(() => {})
    await db().jurisdictionComplianceProfile.deleteMany({ where: { countryCode: { in: [XT, XZ] } } }).catch(() => {})
    await cleanupTestUsers()
  })

  // ---- Syria: pending confirmation, never a silent zero ----
  it('Syria resolves to PENDING_CONFIRMATION with no amount and no components', async () => {
    const line = await resolveStayTaxLine(db(), { country: 'SY', regionCode: '', accommodationMinor: 100_00, currency: 'USD' })
    expect(line.status).toBe(STAY_TAX_LINE_STATUS.PENDING_CONFIRMATION)
    expect(line.amountMinor).toBeNull() // explicitly not 0
    expect(line.components).toEqual([])
  })

  // ---- Multi-component (GST 5% + QST 9.975%): each computes + displays separately, and they sum ----
  it('a two-tax jurisdiction returns each component separately and sums them', async () => {
    const accommodationMinor = 200_00 // $200.00
    const line = await resolveStayTaxLine(db(), { country: XT, regionCode: '', accommodationMinor, totalBookingMinor: 250_00, currency: 'USD' })
    expect(line.status).toBe(STAY_TAX_LINE_STATUS.RESOLVED)
    expect(line.components).toHaveLength(2)

    const gst = line.components.find((c) => c.taxType === 'GST')
    const qst = line.components.find((c) => c.taxType === 'QST')
    expect(gst.amountMinor).toBe(computeTaxAmountMinor(accommodationMinor, 50_000)) // 5% of $200 = $10.00
    expect(qst.amountMinor).toBe(computeTaxAmountMinor(accommodationMinor, 99_750)) // 9.975% of $200 = $19.95
    expect(gst.amountMinor).toBe(10_00)
    expect(qst.amountMinor).toBe(19_95)
    // Total is the sum of the components — computed via the R6 currency-guarded sum.
    expect(line.amountMinor).toBe(gst.amountMinor + qst.amountMinor)
    expect(line.amountMinor).toBe(29_95)
  })

  // ---- ≥3 single-rate cases incl. the non-round 9.975% (rounding proof) ----
  it('single-rate components compute with correct rounding (incl. the fractional 9.975%)', () => {
    expect(computeTaxAmountMinor(100_00, 50_000)).toBe(5_00) // GST 5% of $100 = $5.00
    expect(computeTaxAmountMinor(100_00, 35_000)).toBe(3_50) // lodging 3.5% of $100 = $3.50
    // QST 9.975% of $100.01 = 997.59975 minor → rounds to 998 (proves fractional-rate rounding).
    expect(computeTaxAmountMinor(100_01, 99_750)).toBe(998)
    expect(computeTaxAmountMinor(100_00, 99_750)).toBe(9_98) // 9.975% of $100 = 997.5 → 998
  })

  // ---- No-tax jurisdiction: a legitimate zero, distinct from pending ----
  it('a jurisdiction whose profile does not require tax resolves to NONE', async () => {
    await db().jurisdictionComplianceProfile.create({ data: { division: 'STR', countryCode: XZ, regionCode: '', status: 'APPROVED', taxRequired: false, taxSatisfied: false } })
    const line = await resolveStayTaxLine(db(), { country: XZ, regionCode: '', accommodationMinor: 100_00, currency: 'USD' })
    expect(line.status).toBe(STAY_TAX_LINE_STATUS.NONE)
    expect(line.amountMinor).toBe(0)
  })

  // ---- Commission + host payout are INVARIANT to the tax rates (pass-through) ----
  it('commission and host payout do not depend on any tax component', () => {
    const rate = 0.13
    // platformFee takes no tax argument at all — the commission base is rent + cleaning only (M2).
    expect(platformFee(100_00, 20_00, rate)).toBe(Math.round((100_00 + 20_00) * rate))

    // Two otherwise-identical STAYS bookings, one priced with a tax present and one without. Tax feeds only
    // the DISCLOSURE taxesMinor figure — it must leave adminCommission and host payout byte-for-byte equal.
    const noTax = { amountMinor: 120_00, currency: 'USD', listing: { division: 'STAYS', metadata: { cleaningFeeMinor: 20_00 } } }
    const withTax = { amountMinor: 120_00, currency: 'USD', listing: { division: 'STAYS', metadata: { cleaningFeeMinor: 20_00, taxFeeMinor: 9_99 } } }
    const a = bookingFinanceSplit(noTax, noTax.amountMinor, rate)
    const b = bookingFinanceSplit(withTax, withTax.amountMinor, rate)

    expect(a.adminCommissionMinor).toBe(platformFee(100_00, 20_00, rate)) // rent 100 (=120−20 cleaning) + cleaning 20
    expect(b.adminCommissionMinor).toBe(a.adminCommissionMinor) // tax changes nothing
    expect(b.hostGrossMinor).toBe(a.hostGrossMinor)             // host payout invariant to tax
    expect(b.taxesMinor).not.toBe(a.taxesMinor)                 // the ONLY thing tax moves is disclosure

    // The payout row (host-facing) carries the same tax-invariant commission + gross.
    const payout = buildPayoutRow(withTax, new Set(), rate)
    expect(payout.adminCommissionMinor).toBe(a.adminCommissionMinor)
    expect(payout.hostGrossMinor).toBe(a.hostGrossMinor)
  })

  // ---- Guest quote surfaces the pending line BEFORE payment, separate from totalMinor ----
  it('the quote endpoint returns a PENDING_CONFIRMATION tax line for a Syria listing, outside totalMinor', async () => {
    const email = uniqueTestEmail('m8-host')
    await verifyEmailForTest(app, email, 'staff-login')
    const host = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
    trackTestUser(host.body.user.id)
    const listing = await db().listing.create({ data: { ownerId: host.body.user.id, division: 'STAYS', titleAr: 'شقة سورية', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', metadata: { country: 'SY' } } })

    function isoDay(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
    const res = await request(app).get(`/api/listings/${listing.id}/quote`).query({ checkIn: isoDay(10), checkOut: isoDay(12), currency: 'USD' })
    expect(res.status).toBe(200)
    expect(res.body.breakdown.taxLine.status).toBe('PENDING_CONFIRMATION')
    expect(res.body.breakdown.taxLine.amountMinor).toBeNull()
    // Pending tax is NOT folded into the guest's charged total.
    expect(res.body.totalMinor).toBe(res.body.breakdown.totalMinor)
    expect(res.body.breakdown.totalMinor).toBe(res.body.breakdown.nightlySubtotalMinor + res.body.breakdown.cleaningFeeMinor + res.body.breakdown.extraFeesMinor)

    await db().listing.deleteMany({ where: { id: listing.id } })
  })
})
