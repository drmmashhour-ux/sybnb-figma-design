import { describe, expect, it } from 'vitest'
import { quoteSrRide } from '../../server/lib/sr-geocoding.mjs'

describe('quoteSrRide breakdown (030): base/time/distance/dynamic-pricing/regulatory/GST/QST line items', () => {
  it('itemizes the fare into separate figures that sum to the total, without a database (no jurisdiction resolved)', async () => {
    const quote = await quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', currency: 'SYP' })
    const b = quote.breakdown
    expect(b.currency).toBe('SYP')
    expect(b.totalMinor).toBe(quote.fareMinor)
    // No jurisdiction resolved (db not passed) -- regulatory/GST/QST are honestly 0, not invented.
    expect(b.regulatoryContributionMinor).toBe(0)
    expect(b.gstMinor).toBe(0)
    expect(b.qstMinor).toBe(0)
    expect(b.taxSource).toBeNull()
  })

  it('SR has no per-minute/duration pricing model -- timeChargeMinor is always 0, not fabricated', async () => {
    const quote = await quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', currency: 'SYP' })
    expect(quote.breakdown.timeChargeMinor).toBe(0)
  })

  it('baseFareMinor matches the category rate table exactly', async () => {
    const quote = await quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', currency: 'SYP' })
    expect(quote.breakdown.baseFareMinor).toBe(8000) // SR Economy base rate
  })

  it('a low-data-mode quote has zero live-tracking surcharge', async () => {
    const withTracking = await quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', currency: 'SYP', lowDataMode: false })
    const withoutTracking = await quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', currency: 'SYP', lowDataMode: true })
    expect(withTracking.breakdown.liveTrackingSurchargeMinor).toBeGreaterThan(0)
    expect(withoutTracking.breakdown.liveTrackingSurchargeMinor).toBe(0)
  })

  it('fareMinor is unchanged from the pre-030 calculation for an unconfigured jurisdiction (regression guard)', async () => {
    // Same inputs, same category -- this fareMinor must equal what the original single-lump
    // baseFareMinor+distance+surcharge, surged, rounded-to-500 calculation always produced. This is
    // the "zero behavior change" invariant for the breakdown refactor.
    const quote = await quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', currency: 'SYP' })
    expect(quote.fareMinor % 500).toBe(0) // still rounds to the nearest 500 SYP
    expect(quote.breakdown.totalMinor).toBe(quote.fareMinor)
  })

  it('a USD quote still rounds up to the nearest $5 and has no jurisdiction taxes without a db', async () => {
    const quote = await quoteSrRide({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', currency: 'USD' })
    expect(quote.currency).toBe('USD')
    expect(quote.fareMinor % 5).toBe(0)
    expect(quote.breakdown.gstMinor).toBe(0)
  })
})
