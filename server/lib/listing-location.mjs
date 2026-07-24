// H8 — location privacy (location-R7). A listing's EXACT position (the host's pinned coordinates + street
// address) is revealed ONLY to a guest with a CONFIRMED booking. Every pre-booking guest surface (search,
// listing detail, quote) shows an APPROXIMATE AREA only — the pin coarsened to a ~1km grid cell plus the
// governorate/city/area labels — so the exact home is never exposed publicly (protects host and guest).
//
// The exact pin is the host's H2-captured Accommodation.metadata.mapLocation (never surfaced raw to guests).

// Round to 2 decimal places ≈ a ~1.1 km grid cell at these latitudes: coarse enough that the exact point can
// never be recovered from the approximate one, precise enough to show the right neighbourhood on a map.
const APPROX_DECIMALS = 2
const APPROX_RADIUS_METERS = 1200

function pinCoords(mapLocation) {
  const lat = Number(mapLocation?.latitude)
  const lng = Number(mapLocation?.longitude)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

function round(value) {
  const f = 10 ** APPROX_DECIMALS
  return Math.round(value * f) / f
}

// Pre-booking: a blurred centroid + radius derived from the pin, plus area labels. Never the exact pin.
// Returns null coords when the host hasn't pinned a location (the client then falls back to area labels).
export function approximateLocation(accommodation, listingMetadata = {}) {
  const coords = pinCoords(accommodation?.metadata?.mapLocation)
  return {
    approximate: true,
    latitude: coords ? round(coords.lat) : null,
    longitude: coords ? round(coords.lng) : null,
    radiusMeters: coords ? APPROX_RADIUS_METERS : null,
    governorate: accommodation?.governorate || listingMetadata.governorate || null,
    city: accommodation?.city || listingMetadata.city || null,
    area: accommodation?.area || listingMetadata.area || null,
  }
}

// Post-confirmed-booking: the exact pin + street address the booked guest needs to actually get there.
export function exactLocation(accommodation) {
  const coords = pinCoords(accommodation?.metadata?.mapLocation)
  return {
    approximate: false,
    latitude: coords ? coords.lat : null,
    longitude: coords ? coords.lng : null,
    address: accommodation?.address || null,
    governorate: accommodation?.governorate || null,
    city: accommodation?.city || null,
    area: accommodation?.area || null,
  }
}

// A booking reveals the exact location only once it is actually confirmed (paid + accepted) or completed.
export function bookingRevealsExactLocation(status) {
  return status === 'CONFIRMED' || status === 'COMPLETED'
}
