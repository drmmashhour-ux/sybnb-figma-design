import { json, methodNotAllowed } from '../lib/responses.mjs'

// Server-side geocoding proxy (free OpenStreetMap Nominatim). The browser CANNOT call Nominatim
// directly — it 403s stock browser User-Agents to stop sites hammering it client-side — so the
// frontend calls this same-origin endpoint instead, and we call Nominatim from the server with a
// proper identifying User-Agent (which is allowed). Results are cached in-memory per instance so a
// place is geocoded at most once. Keyless, no billing, no card.

const cache = new Map() // query -> { lat, lng } | null
const CACHE_CAP = 5000
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
// Nominatim requires a User-Agent identifying the application (stock http-library UAs are rejected).
const USER_AGENT = 'SYBNB/1.0 (+https://sybnb.app)'

function remember(key, value) {
  if (cache.size >= CACHE_CAP) cache.clear()
  cache.set(key, value)
  return value
}

export async function handleGeocode(req, res, url) {
  if (url.pathname !== '/api/geocode') return false
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

  const q = (url.searchParams.get('q') || '').trim()
  if (!q) return json(res, 200, { result: null })
  if (cache.has(q)) return json(res, 200, { result: cache.get(q) })

  const target = new URL(NOMINATIM)
  target.searchParams.set('format', 'jsonv2')
  target.searchParams.set('limit', '1')
  target.searchParams.set('q', q)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ar,en' },
      signal: controller.signal,
    })
    if (!upstream.ok) return json(res, 200, { result: remember(q, null) })
    const data = await upstream.json()
    const hit = Array.isArray(data) ? data[0] : null
    const lat = hit ? Number(hit.lat) : NaN
    const lng = hit ? Number(hit.lon) : NaN
    const result = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
    return json(res, 200, { result: remember(q, result) })
  } catch {
    // Network error / timeout / abort — return null so the map falls back to the governorate view.
    return json(res, 200, { result: null })
  } finally {
    clearTimeout(timeout)
  }
}
