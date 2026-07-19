import { describe, expect, it } from 'vitest'
import {
  amountToRoundedUsd,
  roundUsdUpToStep,
  stayQuoteToRoundedUsd,
  sypMinorToRoundedUsdMinor,
  sypStayQuoteToRoundedUsd,
} from '../../server/lib/currency.mjs'

// Regression coverage for a real money bug found during a live walkthrough: GET
// /api/listings/:id/quote?currency=USD and the matching POST /api/bookings charge previously
// rounded the SYP total for the WHOLE multi-night stay up to the nearest $5 in one lump step
// (sypMinorToRoundedUsdMinor(quote.totalMinor)). For a cheap-enough listing, a 1-night and a
// 2-night raw SYP total can both land under the first $5 threshold, so both rounded up to the
// exact same $5 floor -- a guest could book more nights of the same listing for the identical
// total, silently under-paying the host. The fix (sypStayQuoteToRoundedUsd) rounds each night to
// the $5 step first and sums the rounded nights, so the total is guaranteed to scale with nights
// while every night individually still lands on a clean, change-free $5 multiple.
describe('sypStayQuoteToRoundedUsd (STR multi-night USD pricing)', () => {
  it('a 2-night stay costs strictly more than a 1-night stay of the same cheap listing (the actual bug found live)', () => {
    // 30,000 SYP/night at SYP_PER_USD=15000 -> $2/night raw, well under the $5 rounding step.
    const oneNight = sypStayQuoteToRoundedUsd({
      totalMinor: 30000,
      perNight: [{ date: '2026-07-19', priceMinor: 30000 }],
    })
    const twoNights = sypStayQuoteToRoundedUsd({
      totalMinor: 60000,
      perNight: [
        { date: '2026-07-19', priceMinor: 30000 },
        { date: '2026-07-20', priceMinor: 30000 },
      ],
    })

    expect(oneNight.totalMinor).toBe(5)
    // Old (buggy) behavior: sypMinorToRoundedUsdMinor(60000) also rounds up to just 5, identical
    // to the 1-night total. The fix must make 2 nights strictly more expensive than 1.
    expect(twoNights.totalMinor).toBe(10)
    expect(twoNights.totalMinor).toBeGreaterThan(oneNight.totalMinor)
  })

  it('the total always equals the sum of the rounded per-night prices', () => {
    const quote = sypStayQuoteToRoundedUsd({
      totalMinor: 275000,
      perNight: [
        { date: '2026-08-01', priceMinor: 100000 }, // $6.67 -> rounds to $10
        { date: '2026-08-02', priceMinor: 100000 }, // $6.67 -> rounds to $10
        { date: '2026-08-03', priceMinor: 75000 }, // $5.00 -> rounds to $5
      ],
    })

    const summedNights = quote.perNight.reduce((sum, night) => sum + night.priceMinor, 0)
    expect(quote.totalMinor).toBe(summedNights)
    expect(quote.totalMinor).toBe(25)
    expect(quote.perNight.map((night) => night.priceMinor)).toEqual([10, 10, 5])
  })

  it('every night in the result is itself a multiple of the $5 step (guest never owes change)', () => {
    const quote = sypStayQuoteToRoundedUsd({
      totalMinor: 133333,
      perNight: [
        { date: '2026-09-01', priceMinor: 44444 },
        { date: '2026-09-02', priceMinor: 44444 },
        { date: '2026-09-03', priceMinor: 44445 },
      ],
    })

    for (const night of quote.perNight) {
      expect(night.priceMinor % 5).toBe(0)
    }
    expect(quote.totalMinor % 5).toBe(0)
  })

  it('a zero-priced night contributes nothing (does not get bumped up to the $5 floor)', () => {
    const quote = sypStayQuoteToRoundedUsd({
      totalMinor: 30000,
      perNight: [
        { date: '2026-07-19', priceMinor: 0 },
        { date: '2026-07-20', priceMinor: 30000 },
      ],
    })

    expect(quote.perNight[0].priceMinor).toBe(0)
    expect(quote.perNight[1].priceMinor).toBe(5)
    expect(quote.totalMinor).toBe(5)
  })

  it('preserves the date on each night entry', () => {
    const quote = sypStayQuoteToRoundedUsd({
      totalMinor: 30000,
      perNight: [{ date: '2026-07-19', priceMinor: 30000 }],
    })
    expect(quote.perNight[0].date).toBe('2026-07-19')
  })
})

describe('sypMinorToRoundedUsdMinor (single-amount rounding, unchanged by the fix)', () => {
  it('still rounds a single amount (SR fares, wallet gifts, non-stay listings) up to the nearest $5', () => {
    expect(sypMinorToRoundedUsdMinor(0)).toBe(0)
    expect(sypMinorToRoundedUsdMinor(15000)).toBe(5)
    expect(sypMinorToRoundedUsdMinor(75000)).toBe(5)
    expect(sypMinorToRoundedUsdMinor(75001)).toBe(10)
    expect(roundUsdUpToStep(18.99)).toBe(20)
  })
})

// Regression coverage for a second, more severe money bug found in the same live walkthrough: a
// listing already priced natively in USD (listing.currency === 'USD') was still being run through
// the SYP->USD conversion whenever a guest paid in USD -- dividing an already-dollar amount by
// SYP_PER_USD=15000 before rounding up to $5 collapses any real price down to the $5 floor. A real
// $80/night listing was quoted (and would have actually been charged/paid out) as ~$5 total
// regardless of nights -- and since USD is the ONLY currency guests can actually pay in on the STR
// checkout page, this broke every USD-native listing, not an edge case.
describe('stayQuoteToRoundedUsd / amountToRoundedUsd (currency-aware rounding)', () => {
  it('a SYP-native listing is still converted at the fixed rate before rounding (existing behavior)', () => {
    const quote = stayQuoteToRoundedUsd(
      {
        totalMinor: 60000,
        perNight: [
          { date: '2026-07-19', priceMinor: 30000 },
          { date: '2026-07-20', priceMinor: 30000 },
        ],
      },
      'SYP',
    )
    expect(quote.totalMinor).toBe(10)
  })

  it('a USD-native listing is NOT run through the SYP conversion -- $80/night x 2 stays $80/night, not collapsed to the $5 floor', () => {
    const quote = stayQuoteToRoundedUsd(
      {
        totalMinor: 160,
        perNight: [
          { date: '2026-07-19', priceMinor: 80 },
          { date: '2026-07-20', priceMinor: 80 },
        ],
      },
      'USD',
    )
    expect(quote.perNight.map((night) => night.priceMinor)).toEqual([80, 80])
    expect(quote.totalMinor).toBe(160)
  })

  it('a USD-native listing not already on a $5 multiple still rounds up (no odd change)', () => {
    const quote = stayQuoteToRoundedUsd(
      { totalMinor: 77, perNight: [{ date: '2026-07-19', priceMinor: 77 }] },
      'USD',
    )
    expect(quote.totalMinor).toBe(80)
  })

  it('amountToRoundedUsd mirrors the same currency-awareness for flat-price (non-stay) listings', () => {
    expect(amountToRoundedUsd(80, 'USD')).toBe(80)
    expect(amountToRoundedUsd(77, 'USD')).toBe(80)
    expect(amountToRoundedUsd(60000, 'SYP')).toBe(5)
  })
})
