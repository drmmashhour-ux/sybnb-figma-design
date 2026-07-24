import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// H3 — the wizard price step: base + variable per-date price, cleaning, a live subtotal that equals the
// guest charge (rent + cleaning, NOT tax), and tax shown as a separate M8 pass-through line (Syria =
// "pending confirmation", host-set only for Quebec's frozen disclosure). Commission preview stays on
// rent + cleaning (M2). Source-level guard (no jsdom runner).

const src = readFileSync(new URL('../../src/modules/seller/SellerListingWizard.tsx', import.meta.url), 'utf8')

describe('H3 — wizard pricing / subtotal', () => {
  it('the guest subtotal is nightly + cleaning only (tax NOT in the total)', () => {
    expect(src).toMatch(/const stayBookingTotal = stayNightPrice \+ stayCleaningFee\b/)
    expect(src).not.toMatch(/stayBookingTotal = stayNightPrice \+ stayCleaningFee \+ stayTaxFee/)
  })

  it('keeps a variable per-date night price input (existing priceOverride model) + a cleaning fee', () => {
    expect(src).toMatch(/variableNightPrice/)
    expect(src).toMatch(/setCleaningFee/)
  })

  it('outside Quebec, tax is read-only "pending confirmation" (M8) — the host never types a Syria tax', () => {
    expect(src).toMatch(/division === 'STAYS' && !isQuebecStr/)
    expect(src).toMatch(/Tax — pending confirmation/)
    // The only editable tax input left is the Quebec-only disclosure field.
    expect(src).toMatch(/division === 'STAYS' && isQuebecStr/)
  })

  it('the commission preview base is rent + cleaning, never tax (M2)', () => {
    expect(src).toMatch(/const grossBase = \(Number\(price\) \|\| 0\) \+ \(Number\(cleaningFee\) \|\| 0\)/)
  })

  it('labels the guest total as rent + cleaning so no uncharged tax is advertised', () => {
    expect(src).toMatch(/Guest total \(rent \+ cleaning\)/)
  })
})
