import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOsrmConfigured, routeRoad } from '../../server/lib/sr-routing.mjs'

// SR road routing: real road distance/ETA/polyline via OSRM, with a straight-line haversine fallback so
// quoting/mapping never breaks when OSRM is unset or unreachable.

const PICKUP = { lat: 33.5, lng: 36.3 } // Damascus
const DROPOFF = { lat: 33.52, lng: 36.28 }

describe('SR routing (OSRM with haversine fallback)', () => {
  const origOsrm = process.env.OSRM_URL
  const origFetch = global.fetch

  afterEach(() => {
    if (origOsrm === undefined) delete process.env.OSRM_URL
    else process.env.OSRM_URL = origOsrm
    global.fetch = origFetch
    vi.restoreAllMocks()
  })

  it('falls back to straight-line haversine when OSRM is not configured', async () => {
    delete process.env.OSRM_URL
    expect(isOsrmConfigured()).toBe(false)
    const r = await routeRoad(PICKUP, DROPOFF)
    expect(r.source).toBe('haversine')
    expect(r.distanceKm).toBeGreaterThan(0)
    expect(r.durationMin).toBeGreaterThan(0)
    expect(r.geometry).toBeNull()
  })

  it('returns null distance for missing coords and never throws', async () => {
    delete process.env.OSRM_URL
    const r = await routeRoad(null, DROPOFF)
    expect(r.distanceKm).toBeNull()
    expect(r.durationMin).toBeNull()
  })

  it('uses OSRM road distance / duration / geometry when configured', async () => {
    process.env.OSRM_URL = 'https://osrm.example'
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        routes: [{ distance: 5200, duration: 780, geometry: { coordinates: [[36.3, 33.5], [36.28, 33.52]] } }],
      }),
    }))
    const r = await routeRoad(PICKUP, DROPOFF)
    expect(global.fetch).toHaveBeenCalledOnce()
    expect(r.source).toBe('osrm')
    expect(r.distanceKm).toBe(5.2) // 5200 m → 5.2 km
    expect(r.durationMin).toBe(13) // 780 s → 13 min
    expect(r.geometry).toEqual([[36.3, 33.5], [36.28, 33.52]])
    // OSRM expects coordinates as lng,lat;lng,lat
    expect(String(global.fetch.mock.calls[0][0])).toContain('/route/v1/driving/36.3,33.5;36.28,33.52')
  })

  it('falls back gracefully when the OSRM request errors', async () => {
    process.env.OSRM_URL = 'https://osrm.example'
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    })
    const r = await routeRoad(PICKUP, DROPOFF)
    expect(r.source).toBe('haversine-fallback')
    expect(r.distanceKm).toBeGreaterThan(0)
    expect(r.durationMin).toBeGreaterThan(0)
  })

  it('falls back when OSRM returns no usable route', async () => {
    process.env.OSRM_URL = 'https://osrm.example'
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ routes: [] }) }))
    const r = await routeRoad(PICKUP, DROPOFF)
    expect(r.source).toBe('haversine-fallback')
  })
})
