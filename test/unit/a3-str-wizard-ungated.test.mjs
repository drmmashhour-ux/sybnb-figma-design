import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gatedDivisionForPath } from '../../src/engines/navigation/divisions'

// A3.1 — the STR stay-listing wizard must be reachable (not the closed-beta "Soon" gate) via a
// dedicated STR path, while EVERY non-STR sell division and the generic multi-vertical seller wizard
// stay gated. STR-only carve-out; the gate must not be widened.

const STR_WIZARD_PATH = '/sell/listing-wizard/stays'
const routesFile = readFileSync(new URL('../../src/modules/seller/SellerDivisionRoutes.tsx', import.meta.url), 'utf8')
const wizardFile = readFileSync(new URL('../../src/modules/seller/SellerListingWizard.tsx', import.meta.url), 'utf8')

describe('A3.1 — STR stay-listing wizard ungated (STR only)', () => {
  it('the STR stay-listing wizard path is NOT gated (reachable for a host)', () => {
    expect(gatedDivisionForPath(STR_WIZARD_PATH)).toBeUndefined()
  })

  it('the STR path resolves to the listing wizard in the seller router', () => {
    expect(routesFile).toContain(STR_WIZARD_PATH)
    // the stays-wizard branch must render SellerListingWizard
    expect(routesFile).toMatch(/listing-wizard\/stays'[\s\S]{0,120}SellerListingWizard/)
  })

  it('the STR entry locks the wizard to STAYS (no non-STR vertical is selectable)', () => {
    // The router passes lockedDivision="STAYS" for the stays path.
    expect(routesFile).toMatch(/listing-wizard\/stays'[\s\S]{0,140}lockedDivision="STAYS"/)
    // The wizard accepts the lock, defaults the division to it, and hides the division picker when locked.
    expect(wizardFile).toMatch(/lockedDivision\?:\s*ListingDivision/)
    expect(wizardFile).toMatch(/useState<ListingDivision>\(lockedDivision\s*\|\|/)
    expect(wizardFile).toMatch(/!isAdvertisingFlow\s*&&\s*!lockedDivision\s*&&/)
  })

  it('the generic seller wizard and the /sell landing REMAIN gated', () => {
    expect(gatedDivisionForPath('/sell/listing-wizard')?.id).toBe('sell')
    expect(gatedDivisionForPath('/sell')?.id).toBe('sell')
  })

  it('other sell divisions (cars / ride / rentals / buy / new-construction / marketplace) REMAIN gated', () => {
    for (const route of ['/cars', '/ride', '/rentals', '/buy', '/new-construction', '/marketplace']) {
      const gated = gatedDivisionForPath(route)
      expect(gated, `${route} should stay gated`).toBeTruthy()
      expect(gated?.status, `${route} must not be active`).not.toBe('active')
    }
  })

  it('control: the active STR browse division (/stays) is not gated', () => {
    expect(gatedDivisionForPath('/stays')).toBeUndefined()
  })
})
