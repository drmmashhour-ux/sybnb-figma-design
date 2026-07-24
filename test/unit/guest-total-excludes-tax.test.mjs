import { describe, expect, it } from 'vitest'
import { computeGuestBookingTotalMinor } from '../../server/lib/pricing.mjs'

// H3 — one money model (R5): the guest's charged total is nightly + cleaning + extra fees. Tax is a
// PASS-THROUGH line rendered separately (M8), never folded into the charged total and never in the M2
// commission base. This pins that computeGuestBookingTotalMinor — the single source both the guest quote
// (server/routes/listings.mjs) and the host wizard's subtotal agree with — never absorbs a tax figure.

describe('H3 — guest total is rent + cleaning (tax excluded)', () => {
  it('sums nightly + cleaning + extra fees only', () => {
    const out = computeGuestBookingTotalMinor({ nightlySubtotalMinor: 100_00, listingMetadata: { cleaningFeeMinor: 20_00, extraFeesMinor: 5_00 } })
    expect(out.amountMinor).toBe(125_00)
    expect(out.cleaningFeeMinor).toBe(20_00)
    expect(out.extraFeesMinor).toBe(5_00)
  })

  it('a tax figure in metadata does NOT change the charged total (tax is pass-through, not charged)', () => {
    const noTax = computeGuestBookingTotalMinor({ nightlySubtotalMinor: 100_00, listingMetadata: { cleaningFeeMinor: 20_00 } })
    const withTax = computeGuestBookingTotalMinor({ nightlySubtotalMinor: 100_00, listingMetadata: { cleaningFeeMinor: 20_00, taxFeeMinor: 9_99, taxesMinor: 9_99 } })
    expect(withTax.amountMinor).toBe(noTax.amountMinor)
    expect(withTax.amountMinor).toBe(120_00) // nightly + cleaning, tax never added
  })

  it('matches the host wizard subtotal formula (nightly + cleaning) so the host never advertises an uncharged total', () => {
    const nightly = 80_00
    const cleaning = 15_00
    const wizardSubtotal = nightly + cleaning // SellerListingWizard: stayBookingTotal = stayNightPrice + stayCleaningFee
    const guest = computeGuestBookingTotalMinor({ nightlySubtotalMinor: nightly, listingMetadata: { cleaningFeeMinor: cleaning } })
    expect(guest.amountMinor).toBe(wizardSubtotal)
  })
})
