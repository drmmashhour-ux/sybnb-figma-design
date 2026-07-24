import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// H8 (client) — the guest listing map centers on the server-BLURRED approximate area (never an exact pin,
// which the server no longer sends pre-booking), and the detail fetch surfaces only that approximate area.

const mapCapsule = readFileSync(new URL('../../src/shared/maps/googleMapCapsule.ts', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../src/shared/api/platformApi.ts', import.meta.url), 'utf8')

describe('H8 — client consumes the approximate (blurred) location only', () => {
  it('the map target prefers the server-blurred approximateLocation', () => {
    expect(mapCapsule).toMatch(/listing\.approximateLocation/)
    expect(mapCapsule).toMatch(/approx\?\.latitude/)
    expect(mapCapsule).toMatch(/approx\?\.longitude/)
  })

  it('the detail fetch surfaces the approximate area (typed) and nothing exact', () => {
    expect(api).toMatch(/PlatformApproximateLocation/)
    expect(api).toMatch(/approximate: true/)
    expect(api).toMatch(/approximateLocation: response\.approximateLocation/)
  })
})
