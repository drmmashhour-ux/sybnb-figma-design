import { haversineKm } from './sr-geocoding.mjs'

// SR road routing (Phase 2, "smarter than Uber"): real road distance + duration + a route polyline via
// OSRM — the open-source routing engine (free, self-hostable, no Google/API-key/sanctions exposure).
// Isolated capsule: depends only on global fetch + the existing haversine helper.
//
// Resilience by design: OSRM is an EXTERNAL dependency, so this NEVER throws and NEVER blocks quoting —
// if OSRM isn't configured (no OSRM_URL) or is unreachable/slow, it falls back to straight-line haversine
// with a rough city-driving ETA. Set OSRM_URL to a self-hosted Syria OSRM (or a trusted instance) to
// upgrade every quote/route to real roads without touching any call site.

const OSRM_TIMEOUT_MS = 5000
// City-driving average when we only have straight-line distance (no OSRM). ~25 km/h is realistic for
// congested Syrian city traffic; deliberately conservative so ETAs don't read optimistically.
const FALLBACK_AVG_KMH = 25

export function isOsrmConfigured() {
  return Boolean(process.env.OSRM_URL)
}

function estimateMinutesFromKm(km) {
  return Math.max(1, Math.round((km / FALLBACK_AVG_KMH) * 60))
}

function haversineResult(pickup, dropoff, source) {
  const distanceKm = pickup && dropoff ? Math.max(0.1, Math.round(haversineKm(pickup, dropoff) * 10) / 10) : null
  return {
    distanceKm,
    durationMin: distanceKm != null ? estimateMinutesFromKm(distanceKm) : null,
    geometry: null, // no road polyline without a router
    source,
  }
}

// Returns { distanceKm, durationMin, geometry, source }. `geometry` is a GeoJSON LineString coordinate
// array ([[lng,lat], ...]) for drawing the route on the map, or null when only straight-line is known.
// `source` is 'osrm' | 'haversine' | 'haversine-fallback'. Never rejects.
export async function routeRoad(pickup, dropoff) {
  if (!pickup || !dropoff) return haversineResult(pickup, dropoff, 'haversine')
  if (!isOsrmConfigured()) return haversineResult(pickup, dropoff, 'haversine')

  try {
    const base = process.env.OSRM_URL.replace(/\/$/, '')
    // OSRM takes coordinates as lng,lat;lng,lat. Ask for the full geometry as GeoJSON.
    const url = `${base}/route/v1/driving/${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}?overview=full&geometries=geojson`
    const res = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`)
    const data = await res.json()
    const route = data?.routes?.[0]
    if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') {
      throw new Error('OSRM returned no usable route')
    }
    return {
      distanceKm: Math.max(0.1, Math.round((route.distance / 1000) * 10) / 10),
      durationMin: Math.max(1, Math.round(route.duration / 60)),
      geometry: Array.isArray(route.geometry?.coordinates) ? route.geometry.coordinates : null,
      source: 'osrm',
    }
  } catch (error) {
    console.error('[sr-routing] OSRM unavailable — falling back to straight-line:', error?.message || error)
    return haversineResult(pickup, dropoff, 'haversine-fallback')
  }
}
