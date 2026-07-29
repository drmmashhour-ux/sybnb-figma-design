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

export function googleMapsEmbedUrl(listing: PlatformListing, title: string, lang: Lang) {
  const key = (import.meta.env as Record<string, string | undefined>).VITE_GOOGLE_MAPS_API_KEY
  const query = listingMapTarget(listing, title, lang).query
  // Google 404s / SAMEORIGIN-blocks the old keyless `?output=embed` URL, so a working embed needs
  // the key (Maps Embed API). Without a key return '' → callers show a blank frame, never a broken one.
  return key ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}` : ''
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
  const lat = numberFrom(location.lat ?? location.latitude ?? location.geoLat ?? metadata.lat ?? metadata.latitude ?? metadata.geoLat)
  const lng = numberFrom(location.lng ?? location.lon ?? location.longitude ?? location.geoLng ?? metadata.lng ?? metadata.lon ?? metadata.longitude ?? metadata.geoLng)
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
