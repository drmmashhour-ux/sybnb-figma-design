import { describe, expect, it } from 'vitest'
import {
  SR_COMMISSION_TIERS,
  computeProgressiveCommissionUsd,
  srRideFinanceSplit,
} from '../../server/lib/sr-payments.mjs'

describe('computeProgressiveCommissionUsd: progressive SR commission tiers', () => {
  it('a driver with no prior fares this year pays the first tier rate (12%)', () => {
    const { commissionUsd, tiers } = computeProgressiveCommissionUsd(0, 1000)
    expect(commissionUsd).toBeCloseTo(120, 5)
    expect(tiers).toEqual([{ ratePercent: 12, minUsd: 0, maxUsd: 20000, amountUsd: 1000, commissionUsd: 120 }])
  })

  it('a ride that crosses the $20,000 boundary is split: the portion under $20k at 12%, the rest at 11%', () => {
    const { commissionUsd, tiers } = computeProgressiveCommissionUsd(19500, 1000)
    expect(tiers).toEqual([
      { ratePercent: 12, minUsd: 0, maxUsd: 20000, amountUsd: 500, commissionUsd: 60 },
      { ratePercent: 11, minUsd: 20000, maxUsd: 40000, amountUsd: 500, commissionUsd: 55 },
    ])
    expect(commissionUsd).toBeCloseTo(115, 5)
  })

  it('a ride that crosses the $40,000 boundary splits 11% then 10%', () => {
    const { tiers } = computeProgressiveCommissionUsd(39000, 2000)
    expect(tiers).toEqual([
      { ratePercent: 11, minUsd: 20000, maxUsd: 40000, amountUsd: 1000, commissionUsd: 110 },
      { ratePercent: 10, minUsd: 40000, maxUsd: 60000, amountUsd: 1000, commissionUsd: 100 },
    ])
  })

  it('a ride that crosses the $60,000 boundary splits 10% then 9%', () => {
    const { tiers } = computeProgressiveCommissionUsd(59000, 5000)
    expect(tiers).toEqual([
      { ratePercent: 10, minUsd: 40000, maxUsd: 60000, amountUsd: 1000, commissionUsd: 100 },
      { ratePercent: 9, minUsd: 60000, maxUsd: null, amountUsd: 4000, commissionUsd: 360 },
    ])
  })

  it('a driver already well past $60,000 for the year pays 9% on the whole ride, not blended', () => {
    const { commissionUsd, tiers } = computeProgressiveCommissionUsd(250000, 1000)
    expect(tiers).toEqual([{ ratePercent: 9, minUsd: 60000, maxUsd: null, amountUsd: 1000, commissionUsd: 90 }])
    expect(commissionUsd).toBeCloseTo(90, 5)
  })

  it('a ride can span three tiers in one fare', () => {
    const { tiers, commissionUsd } = computeProgressiveCommissionUsd(19000, 22000)
    expect(tiers).toEqual([
      { ratePercent: 12, minUsd: 0, maxUsd: 20000, amountUsd: 1000, commissionUsd: 120 },
      { ratePercent: 11, minUsd: 20000, maxUsd: 40000, amountUsd: 20000, commissionUsd: 2200 },
      { ratePercent: 10, minUsd: 40000, maxUsd: 60000, amountUsd: 1000, commissionUsd: 100 },
    ])
    expect(commissionUsd).toBeCloseTo(2420, 5)
  })

  it('a zero fare produces no commission and no tiers', () => {
    expect(computeProgressiveCommissionUsd(5000, 0)).toEqual({ commissionUsd: 0, tiers: [] })
  })

  it('the tier table matches the finalized policy exactly', () => {
    expect(SR_COMMISSION_TIERS).toEqual([
      { ratePercent: 12, minUsd: 0, maxUsd: 20000 },
      { ratePercent: 11, minUsd: 20000, maxUsd: 40000 },
      { ratePercent: 10, minUsd: 40000, maxUsd: 60000 },
      { ratePercent: 9, minUsd: 60000, maxUsd: Infinity },
    ])
  })
})

describe('srRideFinanceSplit: money-safety invariant + currency handling', () => {
  it('driverEarningMinor + adminCommissionMinor always reconstructs the exact fare (no rounding drift)', () => {
    const cases = [
      { fareMinor: 15000, currency: 'SYP', priorYtdUsd: 0 },
      { fareMinor: 1, currency: 'SYP', priorYtdUsd: 0 },
      { fareMinor: 999, currency: 'USD', priorYtdUsd: 19999 },
      { fareMinor: 7777, currency: 'SYP', priorYtdUsd: 300000 },
    ]
    for (const c of cases) {
      const split = srRideFinanceSplit(c.fareMinor, c)
      expect(split.driverEarningMinor + split.adminCommissionMinor).toBe(split.fareMinor)
    }
  })

  it('a SYP fare is converted to its USD equivalent (via the fixed SYP_PER_USD rate) for the tier lookup', () => {
    // 15,000 SYP === 1 USD at the platform's fixed rate; well inside tier 1 (12%).
    const split = srRideFinanceSplit(15000, { currency: 'SYP', priorYtdUsd: 0 })
    expect(split.adminCommissionMinor).toBe(1800) // 12% of 15,000
    expect(split.breakdown.fareUsd).toBeCloseTo(1, 5)
    expect(split.breakdown.effectiveRatePercent).toBeCloseTo(12, 5)
  })

  it('a USD fare needs no conversion', () => {
    const split = srRideFinanceSplit(100, { currency: 'USD', priorYtdUsd: 0 })
    expect(split.breakdown.fareUsd).toBe(100)
    expect(split.adminCommissionMinor).toBe(12)
  })

  it('the breakdown metadata carries the applied tier(s) for auditability', () => {
    const split = srRideFinanceSplit(15000000, { currency: 'SYP', priorYtdUsd: 19500 }) // 1,000 USD fare
    expect(split.breakdown.commissionPolicy).toBe('sr_progressive_v1')
    expect(split.breakdown.priorYtdUsd).toBe(19500)
    expect(split.breakdown.tiers.length).toBe(2)
    expect(split.breakdown.tiers[0].ratePercent).toBe(12)
    expect(split.breakdown.tiers[1].ratePercent).toBe(11)
  })

  it('defaults to SYP and zero prior YTD when not given', () => {
    const split = srRideFinanceSplit(15000)
    expect(split.breakdown.currency).toBe('SYP')
    expect(split.breakdown.priorYtdUsd).toBe(0)
  })
})
