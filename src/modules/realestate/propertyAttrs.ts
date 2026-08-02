import type { PlatformListing } from '../../shared/api/platformApi'

// Shared Synitres property helpers, used by the buy/rent browse page AND the standalone /property/:id
// page so both read a listing's metadata identically.

// Deep-link handoff: the standalone /property/:id page writes the listing id here before routing the
// buyer into the /buy or /rentals IMMOContact flow, so RentalsPage opens with that exact property
// preselected instead of a blank search. One-shot — RentalsPage clears it on arrival.
export const SYNITRES_PRESELECT_LISTING_KEY = 'sybnb.v6.synitresPreselectListing'

export type RealEstateAttrs = {
  bedrooms?: number
  bathrooms?: number
  sizeSqm?: number
  propertyType?: string
  location?: string
  amenities: string[]
}

// Pull the Centris-style property attributes out of a listing's metadata (written by the seller wizard),
// coercing loosely-typed JSON. Amenities live under metadata.visualFilters (the shape the server reads),
// with a flat fallback. Location prefers area → city → governorate.
export function realEstateAttrs(listing: PlatformListing): RealEstateAttrs {
  const m = (listing.metadata || {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
  const visual = (m.visualFilters && typeof m.visualFilters === 'object' ? m.visualFilters : {}) as Record<string, unknown>
  const rawAmenities = Array.isArray(visual.amenities) ? visual.amenities : Array.isArray(m.amenities) ? m.amenities : []
  const amenities = (rawAmenities as unknown[]).filter((a): a is string => typeof a === 'string')
  const location = [str(m.area), str(m.city), str(m.governorate)].filter(Boolean).join(' · ')
  return {
    bedrooms: num(m.bedrooms),
    bathrooms: num(m.bathrooms),
    sizeSqm: num(m.sizeSqm) ?? num(m.areaSqm),
    propertyType: str(m.propertyType),
    location: location || undefined,
    amenities,
  }
}

// Colour for a valuation tier (Below/At/Above market); null when there is no classification.
export function valuationTone(tier?: string | null): string | null {
  if (tier === 'BELOW_MARKET') return '#20d29b'
  if (tier === 'AT_MARKET') return '#38bdf8'
  if (tier === 'ABOVE_MARKET') return '#f7c05b'
  return null
}
