import { describe, expect, it } from 'vitest'
import { sellerPropertyFilterGroupsFromConfig, visualFilterGroupsForDivision } from '../../src/engines/filters/visualFilterDefinitions.ts'

// H2 — "honest with clients": the host's amenity/filter capsule must offer EXACTLY the guest search filters,
// so a guest never filters for something no host can declare. Both draw from the same visualFilterGroupsById
// primitives, so this pins that they stay in sync — and that the only differences are the DELIBERATE
// exclusions: 'sort'/'priceBand' (search refinement, not listing attributes) and 'trust' (platform-earned
// signals like Verified host / Rating 8+ that a host must never be able to self-claim).

const INTENTIONAL_SEARCH_ONLY = new Set(['sort', 'priceBand', 'trust'])

describe('H2 — wizard capsule == guest search filters (same source)', () => {
  const wizard = sellerPropertyFilterGroupsFromConfig()
  const search = visualFilterGroupsForDivision('stays')
  const searchById = new Map(search.map((g) => [g.id, g]))
  const wizardIds = new Set(wizard.map((g) => g.id))

  it('every wizard group exists in guest search with byte-identical options', () => {
    for (const group of wizard) {
      const match = searchById.get(group.id)
      expect(match, `wizard group "${group.id}" missing from guest search`).toBeTruthy()
      expect(group.options.map((o) => o.id)).toEqual(match.options.map((o) => o.id))
    }
  })

  it('the only guest-search groups absent from the wizard are the intentional exclusions', () => {
    const missingFromWizard = search.map((g) => g.id).filter((id) => !wizardIds.has(id))
    // No host-declarable amenity group may silently drift out of the wizard: the difference set must be
    // EXACTLY {sort, priceBand, trust}.
    expect(new Set(missingFromWizard)).toEqual(INTENTIONAL_SEARCH_ONLY)
  })

  it('the wizard exposes no group the guest cannot search (no phantom capsule)', () => {
    for (const id of wizardIds) expect(searchById.has(id), `wizard group "${id}" not searchable by guests`).toBe(true)
  })
})
