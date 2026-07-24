import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// H2 / founder decision #11 — STR publishing is FREE at the base (plans are ADDITIVE, never mandatory). The
// wizard must offer a $0 base plan for STAYS, default to it, and auto-confirm it (no payment gate); the two
// optional upgrades are $19/$49. Source-level guard (no jsdom runner) on SellerListingWizard.tsx.

const src = readFileSync(new URL('../../src/modules/seller/SellerListingWizard.tsx', import.meta.url), 'utf8')

describe('H2 — STR free base publish', () => {
  it('defines a division-scoped STR plan list with a $0 base and $19/$49 optional upgrades', () => {
    expect(src).toMatch(/STR_LISTING_PLANS/)
    expect(src).toMatch(/id: 'strBase'[\s\S]*?priceUsd: 0/)
    expect(src).toMatch(/priceUsd: 19/)
    expect(src).toMatch(/priceUsd: 49/)
  })

  it('STAYS uses the STR plan list; other divisions keep the paid HOST plans', () => {
    expect(src).toMatch(/activePlans = division === 'STAYS' \? STR_LISTING_PLANS : HOST_LISTING_PLANS/)
  })

  it('defaults to the free base and auto-confirms a $0 plan (no payment gate)', () => {
    expect(src).toMatch(/draft\.listingPlan \|\| 'strBase'/)
    expect(src).toMatch(/selectedListingPlan\.priceUsd === 0\) setListingPlanPaymentConfirmed\(true\)/)
  })

  it('never labels the free base as "paid" — shows it as free/included', () => {
    expect(src).toMatch(/priceUsd === 0 \? \(isAr \? '[^']*مضمّنة' : 'Free — included'\)/)
  })
})
