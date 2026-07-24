import { describe, expect, it } from 'vitest'
import { stayCardDisplayFeesMinor } from '../../src/modules/search/SearchPreviewPage'
import { sypMinorToRoundedUsdMinor } from '../../src/shared/currency'

// FIX A (tax scaling) — the search card showed "Tax 5,250 USD" because it added the raw SYP metadata
// tax/cleaning fees onto a USD-converted base and labelled the sum USD. The fee amounts must be converted
// to the display currency (USD) the same way the base price is, so a SYP-denominated fee is never dumped
// raw into a USD field.

describe('FIX A — stayCardDisplayFeesMinor converts fees to the display currency', () => {
  it('converts a SYP listing base + fees to USD minor (no raw SYP dumped into USD)', () => {
    const listing = { currency: 'SYP', priceMinor: 100_000, metadata: { cleaningFeeMinor: 50_000, taxFeeMinor: 30_000 } }
    const out = stayCardDisplayFeesMinor(listing)
    expect(out.basePriceMinor).toBe(sypMinorToRoundedUsdMinor(100_000))
    expect(out.cleaningFeeMinor).toBe(sypMinorToRoundedUsdMinor(50_000))
    expect(out.taxFeeMinor).toBe(sypMinorToRoundedUsdMinor(30_000))
    expect(out.totalMinor).toBe(out.basePriceMinor + out.cleaningFeeMinor + out.taxFeeMinor)
    // Sanity: the converted tax is a small USD amount, never the raw 30,000.
    expect(out.taxFeeMinor).toBeLessThan(30_000)
  })

  it('leaves a USD listing untouched', () => {
    const listing = { currency: 'USD', priceMinor: 1000, metadata: { cleaningFeeMinor: 500, taxFeeMinor: 0 } }
    const out = stayCardDisplayFeesMinor(listing)
    expect(out.basePriceMinor).toBe(1000)
    expect(out.cleaningFeeMinor).toBe(500)
    expect(out.taxFeeMinor).toBe(0)
    expect(out.totalMinor).toBe(1500)
  })
})
