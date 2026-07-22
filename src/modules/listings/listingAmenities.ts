// C3 — Amenities: pure, DOM-free resolution of a listing's amenities from its EXISTING
// metadata.visualFilters, using the EXISTING STAYS filter definitions as the single source of truth.
// No second amenity mapping is created: labels come from the same definitions the search/wizard use
// (via selectedFilterLabels), and supplemental icons come from each option's existing photoSrc/art.
// Unknown/retired ids are omitted (never invented, never a crash); output is de-duplicated and ordered
// by the filter-definition order.

import type { Lang } from '../../engines/language/languageEngine'
import { sellerPropertyFilterGroups } from '../../engines/filters'
import { selectedFilterLabels } from '../../shared/filters/VisualFilterPanel'

const AMENITIES_GROUP_ID = 'amenities'

function amenitiesGroup() {
  return sellerPropertyFilterGroups.find((group) => group.id === AMENITIES_GROUP_ID)
}

function selectedAmenityIds(metadata: Record<string, unknown> | undefined): Set<string> {
  const vf = metadata?.visualFilters as { amenities?: string[] | string } | undefined
  const raw = vf?.amenities
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return new Set(list.filter((id): id is string => typeof id === 'string' && id.length > 0))
}

// The listing's amenity ids, de-duplicated, ordered by the filter-definition order, with unknown/
// retired ids omitted (they aren't in the definition).
export function orderedAmenityIds(metadata: Record<string, unknown> | undefined): string[] {
  const group = amenitiesGroup()
  if (!group) return []
  const selected = selectedAmenityIds(metadata)
  if (selected.size === 0) return []
  return group.options.map((option) => option.id).filter((id) => selected.has(id))
}

// Labels-only, resolved through the existing selectedFilterLabels helper (single source), for the
// definition-ordered, de-duplicated ids.
export function listingAmenityLabels(metadata: Record<string, unknown> | undefined, lang: Lang): string[] {
  const ids = orderedAmenityIds(metadata)
  if (ids.length === 0) return []
  return selectedFilterLabels(sellerPropertyFilterGroups, { amenities: ids }, lang)
}

export type ResolvedAmenity = { id: string; label: string; iconSrc?: string }

// Full amenity items (id + label + supplemental icon) from the same definitions. Text (label) is the
// source of meaning; iconSrc is supplemental and reuses the existing photoSrc/art asset — no new asset
// system or remote image dependency is introduced.
export function listingAmenities(metadata: Record<string, unknown> | undefined, lang: Lang): ResolvedAmenity[] {
  const group = amenitiesGroup()
  if (!group) return []
  const ids = orderedAmenityIds(metadata)
  const langKey = lang === 'ar' ? 'ar' : lang === 'fr' ? 'fr' : 'en'
  return ids.map((id) => {
    const option = group.options.find((o) => o.id === id)!
    const label = (option.label[langKey] ?? option.label.en) as string
    return { id, label, iconSrc: option.photoSrc }
  })
}
