import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// M4 — guest currency is USD-only for launch. The listing page fixes the pay currency to USD (no SYP
// toggle / no setter), and the booking review defaults to USD so it can never fall back to a SYP display.
// The one convert()/single admin rate (currency.mjs) is retained for the underlying SYP→USD conversion.

const listing = readFileSync(new URL('../../src/modules/listings/ListingDetailPage.tsx', import.meta.url), 'utf8')
const review = readFileSync(new URL('../../src/modules/bookings/BookingReviewPage.tsx', import.meta.url), 'utf8')

describe('M4 — guest USD-only display', () => {
  it('listing page fixes pay currency to USD (no SYP selection)', () => {
    expect(listing).toMatch(/useState<'USD'>\('USD'\)/)
    // No setter that could switch it to SYP.
    expect(listing).not.toMatch(/setPayCurrency/)
  })

  it('booking review defaults to USD (never falls back to SYP)', () => {
    expect(review).toMatch(/draft\.payCurrency \?\? 'USD'/)
    expect(review).not.toMatch(/draft\.payCurrency \?\? 'SYP'/)
  })
})
