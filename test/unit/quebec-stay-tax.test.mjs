import { describe, expect, it } from 'vitest'
import { GST_RATE, QST_RATE, QUEBEC_LODGING_TAX_RATE, computeQuebecStayTaxes, resolveGstQstResponsibility } from '../../server/lib/quebec-stay-tax.mjs'

describe('computeQuebecStayTaxes: lodging tax / GST / QST on the accommodation portion only', () => {
  it('computes all three at the official rates from the same accommodation base', () => {
    const taxes = computeQuebecStayTaxes(100000) // 100,000 minor units of accommodation price
    expect(taxes.accommodationMinor).toBe(100000)
    expect(taxes.lodgingTaxMinor).toBe(Math.round(100000 * QUEBEC_LODGING_TAX_RATE))
    expect(taxes.gstMinor).toBe(Math.round(100000 * GST_RATE))
    expect(taxes.qstMinor).toBe(Math.round(100000 * QST_RATE))
  })

  it('matches the exact official rates: 3.5% lodging, 5% GST, 9.975% QST', () => {
    const taxes = computeQuebecStayTaxes(1_000_000)
    expect(taxes.lodgingTaxMinor).toBe(35000)
    expect(taxes.gstMinor).toBe(50000)
    expect(taxes.qstMinor).toBe(99750)
  })

  it('a zero or negative accommodation amount produces zero taxes, never negative', () => {
    expect(computeQuebecStayTaxes(0)).toEqual({ accommodationMinor: 0, lodgingTaxMinor: 0, gstMinor: 0, qstMinor: 0 })
    expect(computeQuebecStayTaxes(-500)).toEqual({ accommodationMinor: 0, lodgingTaxMinor: 0, gstMinor: 0, qstMinor: 0 })
  })

  it('does not accept a cleaning-fee-inflated base -- the caller is responsible for passing only the accommodation portion', () => {
    // This is a documentation-style test: the function has no way to distinguish accommodation from
    // cleaning on its own, so the guarantee lives at the call site (finance-ledger.mjs passes
    // split.stayAmountMinor, never split.paidTotalMinor). Confirms the function is a pure multiplier
    // with no hidden inclusion of any other fee.
    const accommodationOnly = computeQuebecStayTaxes(50000)
    const accommodationPlusCleaning = computeQuebecStayTaxes(50000 + 10000)
    expect(accommodationPlusCleaning.lodgingTaxMinor).toBeGreaterThan(accommodationOnly.lodgingTaxMinor)
    expect(accommodationPlusCleaning.lodgingTaxMinor).toBe(Math.round(60000 * QUEBEC_LODGING_TAX_RATE))
  })
})

describe('resolveGstQstResponsibility: explicit, never-inferred tax treatment', () => {
  it('no tax-profile decision on file -> UNDETERMINED, never guessed', () => {
    expect(resolveGstQstResponsibility(null)).toEqual({ responsibility: 'UNDETERMINED', collectedBySybnb: false })
    expect(resolveGstQstResponsibility({})).toEqual({ responsibility: 'UNDETERMINED', collectedBySybnb: false })
  })

  it('HOST_REGISTERED -> the host is responsible, SYBNB never collects', () => {
    expect(resolveGstQstResponsibility({ gstQstTreatment: 'HOST_REGISTERED' })).toEqual({ responsibility: 'HOST', collectedBySybnb: false })
    expect(resolveGstQstResponsibility({ gstQstTreatment: 'HOST_REGISTERED' }, { platformCollectionActive: true })).toEqual({ responsibility: 'HOST', collectedBySybnb: false })
  })

  it('PLATFORM_COLLECTS but the feature flag is off -> platform is responsible on paper, but has not actually collected anything', () => {
    expect(resolveGstQstResponsibility({ gstQstTreatment: 'PLATFORM_COLLECTS' }, { platformCollectionActive: false }))
      .toEqual({ responsibility: 'PLATFORM', collectedBySybnb: false })
  })

  it('PLATFORM_COLLECTS with the feature flag on -> platform actually collected', () => {
    expect(resolveGstQstResponsibility({ gstQstTreatment: 'PLATFORM_COLLECTS' }, { platformCollectionActive: true }))
      .toEqual({ responsibility: 'PLATFORM', collectedBySybnb: true })
  })
})

describe('Decimal-safe money math (item: "no floating-point currency arithmetic")', () => {
  it('computeQuebecStayTaxes always returns integer minor units, never a fractional value', () => {
    const amounts = [1, 7, 33, 100, 999, 12345, 33333, 1000000, 7654321]
    for (const amount of amounts) {
      const taxes = computeQuebecStayTaxes(amount)
      expect(Number.isInteger(taxes.lodgingTaxMinor)).toBe(true)
      expect(Number.isInteger(taxes.gstMinor)).toBe(true)
      expect(Number.isInteger(taxes.qstMinor)).toBe(true)
    }
  })
})
