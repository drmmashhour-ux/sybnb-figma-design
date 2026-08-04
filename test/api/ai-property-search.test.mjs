import { describe, expect, it } from 'vitest'
import { fallbackParse } from '../../server/lib/ai-property-search.mjs'

// AI property search — the deterministic keyword+number fallback (used whenever ANTHROPIC_API_KEY is
// unset) must map plain-language queries to the exact filter values GET /api/listings compares against.
describe('AI property search fallback parser', () => {
  it('parses an English query into property type + bedrooms + max price + amenity', () => {
    const f = fallbackParse('3 bedroom apartment under 25 million with an elevator')
    expect(f.propertyType).toBe('apartment')
    expect(f.bedrooms).toBe(3)
    expect(f.maxPrice).toBe(25_000_000)
    expect(f.amenities).toContain('elevator')
  })

  it('parses an Arabic query', () => {
    const f = fallbackParse('شقة 2 غرف مع مصعد وموقف')
    expect(f.propertyType).toBe('apartment')
    expect(f.bedrooms).toBe(2)
    expect(f.amenities).toEqual(expect.arrayContaining(['elevator', 'parking']))
  })

  it('reads "over/at least" as a minimum price and expands k/million', () => {
    expect(fallbackParse('villa over 50 million').minPrice).toBe(50_000_000)
    expect(fallbackParse('apartment above 800k').minPrice).toBe(800_000)
    expect(fallbackParse('villa over 50 million').propertyType).toBe('villa')
  })

  it('treats a lone price as a ceiling and ignores a bare bedroom count as price', () => {
    const f = fallbackParse('house 30 million')
    expect(f.maxPrice).toBe(30_000_000)
    expect(f.propertyType).toBe('family house')
    // "3 bedroom" must not leak into price (bare number < 1000 with no unit is skipped)
    const g = fallbackParse('3 bedroom apartment')
    expect(g.bedrooms).toBe(3)
    expect(g.maxPrice).toBeUndefined()
    expect(g.minPrice).toBeUndefined()
  })

  it('returns an empty object for an empty or meaningless query', () => {
    expect(fallbackParse('')).toEqual({})
    expect(fallbackParse('hello there')).toEqual({})
  })
})
