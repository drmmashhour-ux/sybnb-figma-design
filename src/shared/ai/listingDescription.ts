import type { VisualFilterGroup, VisualFilterSelection } from '../../engines/filters'
import { generateListingDescription } from '../api/platformApi'

// ─────────────────────────────────────────────────────────────────────────────
// AI LISTING-DESCRIPTION CAPSULE (client side)
//
// Isolated helper that turns the host's FILTER SELECTIONS + listing details into structured
// attributes and asks the server capsule (/api/host/listing-description) to write a bilingual
// description (Claude when configured, template fallback otherwise).
//
// It depends only on the filter engine types + the platform API call, so it travels with the
// filtration system to any platform. UI (the "Write with AI" button) stays in the wizard.
// ─────────────────────────────────────────────────────────────────────────────

type Labels = { ar: string[]; en: string[] }

// Resolve the selected option labels for each filter group (skips 'any' / empty).
function selectedLabelsByGroup(groups: VisualFilterGroup[], selection: VisualFilterSelection): Record<string, Labels> {
  const out: Record<string, Labels> = {}
  for (const group of groups) {
    const raw = selection[group.id]
    const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((id) => id && id !== 'any')
    if (!ids.length) continue
    const ar: string[] = []
    const en: string[] = []
    for (const id of ids) {
      const opt = group.options.find((o) => o.id === id)
      if (opt) {
        ar.push(opt.label.ar)
        en.push(opt.label.en)
      }
    }
    if (ar.length) out[group.id] = { ar, en }
  }
  return out
}

export type ListingDescriptionInput = {
  groups: VisualFilterGroup[]
  selection: VisualFilterSelection
  cityAr?: string
  cityEn?: string
  areaAr?: string
  areaEn?: string
  guests?: number
  bedrooms?: number
  bathrooms?: number
  priceUsd?: number
}

/** Build attributes from the filter selection + details and get a bilingual description. */
export async function writeListingDescription(input: ListingDescriptionInput) {
  const g = selectedLabelsByGroup(input.groups, input.selection)
  const attributes = {
    propertyTypeAr: g.propertyType?.ar[0],
    propertyTypeEn: g.propertyType?.en[0],
    roomTypesAr: g.roomType?.ar,
    roomTypesEn: g.roomType?.en,
    bedTypesAr: g.bedType?.ar,
    bedTypesEn: g.bedType?.en,
    amenitiesAr: g.amenities?.ar,
    amenitiesEn: g.amenities?.en,
    mealsAr: g.meals?.ar,
    mealsEn: g.meals?.en,
    hotelStars: g.hotelStars?.en[0],
    cityAr: input.cityAr,
    cityEn: input.cityEn,
    areaAr: input.areaAr,
    areaEn: input.areaEn,
    guests: input.guests,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    priceUsd: input.priceUsd,
  }
  return generateListingDescription(attributes)
}
