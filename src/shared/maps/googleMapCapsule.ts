import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../api/platformApi'

export type GoogleMapTarget = {
  hasCoordinates: boolean
  label: string
  query: string
}

export type OfflineMapSnapshot = {
  address: string
  createdAt: string
  hasCoordinates: boolean
  label: string
  query: string
  title: string
}

export function googleMapsSearchUrl(listing: PlatformListing, title: string, lang: Lang) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listingMapTarget(listing, title, lang).query)}`
}

export function offlineMapSnapshot(listing: PlatformListing, title: string, lang: Lang): OfflineMapSnapshot {
  const target = listingMapTarget(listing, title, lang)
  return {
    address: target.label,
    createdAt: new Date().toISOString(),
    hasCoordinates: target.hasCoordinates,
    label: target.label,
    query: target.query,
    title,
  }
}

export function offlineMapStorageKey(listingId: string) {
  return `sybnb-v6-offline-map:${listingId}`
}

export function listingMapTarget(listing: PlatformListing, title: string, lang: Lang): GoogleMapTarget {
  const metadata = listing.metadata || {}
  const location = listing.location || {}
  // The seller wizard stores property coordinates nested under metadata.mapLocation.{latitude,longitude};
  // read that too, else every wizard-created listing (which never populates the `location` relation)
  // reports hasCoordinates:false and the map/directions silently never render.
  const mapLoc = (metadata.mapLocation && typeof metadata.mapLocation === 'object' ? metadata.mapLocation : {}) as Record<string, unknown>
  const lat = numberFrom(location.lat ?? location.latitude ?? location.geoLat ?? metadata.lat ?? metadata.latitude ?? metadata.geoLat ?? mapLoc.latitude ?? mapLoc.lat)
  const lng = numberFrom(location.lng ?? location.lon ?? location.longitude ?? location.geoLng ?? metadata.lng ?? metadata.lon ?? metadata.longitude ?? metadata.geoLng ?? mapLoc.longitude ?? mapLoc.lng)
  const addressParts = [
    stringFrom(location.addressAr ?? metadata.addressAr),
    stringFrom(location.address ?? metadata.address),
    stringFrom(location.neighborhoodAr ?? location.districtAr ?? location.areaAr ?? metadata.neighborhoodAr ?? metadata.districtAr ?? metadata.areaAr),
    stringFrom(location.neighborhood ?? location.district ?? location.area ?? metadata.neighborhood ?? metadata.district ?? metadata.area),
    stringFrom(location.cityAr ?? metadata.cityAr),
    stringFrom(location.city ?? metadata.city),
    stringFrom(location.governorateAr ?? metadata.governorateAr),
    stringFrom(location.governorate ?? metadata.governorate),
  ].filter(Boolean)
  const uniqueParts = Array.from(new Set(addressParts))
  const country = lang === 'ar' ? 'سوريا' : 'Syria'
  const fallbackCity = lang === 'ar' ? 'دمشق' : 'Damascus'
  const label = uniqueParts.length > 0 ? uniqueParts.join(lang === 'ar' ? '، ' : ', ') : `${title}, ${fallbackCity}, ${country}`

  if (typeof lat === 'number' && typeof lng === 'number') {
    return {
      hasCoordinates: true,
      label,
      query: `${lat},${lng}`,
    }
  }

  return {
    hasCoordinates: false,
    label,
    query: uniqueParts.length > 0 ? [title, ...uniqueParts, country].filter(Boolean).join(', ') : `${title}, ${fallbackCity}, ${country}`,
  }
}

function stringFrom(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : ''
}

function numberFrom(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}
