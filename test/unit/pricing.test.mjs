import { describe, expect, it } from 'vitest'
import { computeGuestBookingTotalMinor } from '../../server/lib/pricing.mjs'

// Canonical, single source of truth for the STAYS guest-facing booking total (money-model
// correction, 2026-07-22): nightlySubtotalMinor + cleaningFeeMinor + extraFeesMinor. Québec lodging
// tax stays disclosure-only (explicit product decision) and is deliberately NOT part of amountMinor
// -- computeGuestBookingTotalMinor never adds it, matching test/api/jurisdiction-pricing-compliance
// .test.mjs's "never added on top of the guest's total" tests.
describe('computeGuestBookingTotalMinor: canonical STAYS booking total', () => {
  const CASES = [
    {
      name: 'nightly price only, no fees',
      input: { nightlySubtotalMinor: 100, nights: 1, listingMetadata: {} },
      expected: { cleaningFeeMinor: 0, extraFeesMinor: 0, amountMinor: 100 },
    },
    {
      name: 'nightly price plus a cleaning fee',
      input: { nightlySubtotalMinor: 100, nights: 1, listingMetadata: { cleaningFeeMinor: 20 } },
      expected: { cleaningFeeMinor: 20, extraFeesMinor: 0, amountMinor: 120 },
    },
    {
      name: 'Québec listing, tax metadata present but never added (disclosure-only)',
      input: { nightlySubtotalMinor: 100, nights: 1, listingMetadata: { country: 'CA', taxFeeMinor: 350 } },
      expected: { cleaningFeeMinor: 0, extraFeesMinor: 0, amountMinor: 100 },
    },
    {
      name: 'Québec listing, tax AND cleaning fee both present -- only cleaning fee is added',
      input: { nightlySubtotalMinor: 100, nights: 1, listingMetadata: { country: 'CA', taxFeeMinor: 350, cleaningFeeMinor: 25 } },
      expected: { cleaningFeeMinor: 25, extraFeesMinor: 0, amountMinor: 125 },
    },
    {
      name: 'multiple nights -- cleaning fee is flat, added exactly once, not scaled by nights',
      input: { nightlySubtotalMinor: 400, nights: 4, listingMetadata: { cleaningFeeMinor: 20 } },
      expected: { cleaningFeeMinor: 20, extraFeesMinor: 0, amountMinor: 420 },
    },
    {
      name: 'non-Québec listing with a free-text tax field -- also disclosure-only, never added',
      input: { nightlySubtotalMinor: 250000, nights: 1, listingMetadata: { taxFeeMinor: 5000 } },
      expected: { cleaningFeeMinor: 0, extraFeesMinor: 0, amountMinor: 250000 },
    },
    {
      name: 'extraFeesMinor present (currently no product writer, but the formula supports it)',
      input: { nightlySubtotalMinor: 100, nights: 1, listingMetadata: { extraFeesMinor: 15 } },
      expected: { cleaningFeeMinor: 0, extraFeesMinor: 15, amountMinor: 115 },
    },
    {
      name: 'cleaning fee, tax, and extra fees all present together',
      input: { nightlySubtotalMinor: 300, nights: 3, listingMetadata: { country: 'CA', cleaningFeeMinor: 30, taxFeeMinor: 1050, extraFeesMinor: 5 } },
      expected: { cleaningFeeMinor: 30, extraFeesMinor: 5, amountMinor: 335 },
    },
    {
      name: 'zero-value optional fields (explicit 0, not absent) behave the same as absent',
      input: { nightlySubtotalMinor: 100, nights: 1, listingMetadata: { cleaningFeeMinor: 0, taxFeeMinor: 0, extraFeesMinor: 0 } },
      expected: { cleaningFeeMinor: 0, extraFeesMinor: 0, amountMinor: 100 },
    },
    {
      name: 'legacy taxesMinor-only metadata (no writer sets this today, but must not crash or be added)',
      input: { nightlySubtotalMinor: 100, nights: 1, listingMetadata: { taxesMinor: 3500 } },
      expected: { cleaningFeeMinor: 0, extraFeesMinor: 0, amountMinor: 100 },
    },
    {
      name: 'negative/garbage metadata values are clamped to zero, never subtracted',
      input: { nightlySubtotalMinor: 100, nights: 1, listingMetadata: { cleaningFeeMinor: -50 } },
      expected: { cleaningFeeMinor: 0, extraFeesMinor: 0, amountMinor: 100 },
    },
  ]

  for (const { name, input, expected } of CASES) {
    it(name, () => {
      const result = computeGuestBookingTotalMinor(input)
      expect(result.nightlySubtotalMinor).toBe(input.nightlySubtotalMinor)
      expect(result.cleaningFeeMinor).toBe(expected.cleaningFeeMinor)
      expect(result.extraFeesMinor).toBe(expected.extraFeesMinor)
      expect(result.amountMinor).toBe(expected.amountMinor)
    })
  }

  it('the sum of the returned components always reconstructs amountMinor exactly', () => {
    for (const { input } of CASES) {
      const result = computeGuestBookingTotalMinor(input)
      expect(result.nightlySubtotalMinor + result.cleaningFeeMinor + result.extraFeesMinor).toBe(result.amountMinor)
    }
  })
})
