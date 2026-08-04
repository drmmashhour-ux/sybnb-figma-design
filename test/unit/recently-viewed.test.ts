import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearRecentlyViewed,
  detailHrefFor,
  getRecentlyViewed,
  recordViewed,
  type ViewedListing,
} from '../../src/shared/recentlyViewed/recentlyViewed'

// The recently-viewed store is a device-local localStorage capsule (no DB, no account). These tests run
// in the node env, so we install a fake localStorage on globalThis.window and exercise the module's
// hardening: corrupt/blocked storage, de-duplication, the size cap, deterministic ordering, division
// isolation (Synitres vs STR), unsafe values, versioning, and the empty state.

const STORAGE_KEY = 'sybnb.v6.recentlyViewed'

type FakeStorage = Storage & { _map: Map<string, string>; throwOnGet?: boolean; throwOnSet?: boolean }

function makeStorage(): FakeStorage {
  const map = new Map<string, string>()
  const store: FakeStorage = {
    _map: map,
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem(key: string) {
      if (store.throwOnGet) throw new Error('storage blocked')
      return map.has(key) ? (map.get(key) as string) : null
    },
    setItem(key: string, value: string) {
      if (store.throwOnSet) throw new Error('quota exceeded')
      map.set(key, String(value))
    },
    removeItem(key: string) {
      map.delete(key)
    },
  }
  return store
}

let clock = 0

beforeEach(() => {
  ;(globalThis as { window?: unknown }).window = { localStorage: makeStorage() }
  clock = 1_000
  // Strictly increasing timestamps so most-recent-first ordering is deterministic in assertions.
  vi.spyOn(Date, 'now').mockImplementation(() => ++clock)
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { window?: unknown }).window
})

function currentStorage(): FakeStorage {
  return (globalThis as unknown as { window: { localStorage: FakeStorage } }).window.localStorage
}

function view(id: string, division: string, extra: Partial<ViewedListing> = {}): Omit<ViewedListing, 'at'> {
  return { id, division, title: `Listing ${id}`, priceMinor: 1000, currency: 'USD', image: '/assets/x.webp', ...extra }
}

const idOf = (v: ViewedListing) => v.id

describe('recentlyViewed capsule — hardening', () => {
  it('records a first view and reads it back', () => {
    recordViewed(view('a1', 'BUY'))
    const rows = getRecentlyViewed()
    expect(rows.map(idOf)).toEqual(['a1'])
    expect(rows[0]).toMatchObject({ id: 'a1', division: 'BUY', priceMinor: 1000, currency: 'USD' })
  })

  it('de-duplicates a repeated view of the same listing and refreshes it to the front', () => {
    recordViewed(view('a1', 'BUY'))
    recordViewed(view('b2', 'RENTALS'))
    recordViewed(view('a1', 'BUY', { priceMinor: 2000 })) // same id again, newer + updated price
    const rows = getRecentlyViewed()
    expect(rows.map(idOf)).toEqual(['a1', 'b2']) // one 'a1', now most-recent
    expect(rows[0].priceMinor).toBe(2000) // refreshed to the latest snapshot
  })

  it('keeps multiple listing types', () => {
    recordViewed(view('a1', 'BUY'))
    recordViewed(view('b2', 'RENTALS'))
    recordViewed(view('c3', 'STAYS'))
    expect(getRecentlyViewed().map((v) => v.division).sort()).toEqual(['BUY', 'RENTALS', 'STAYS'])
  })

  it('orders most-recent-first and updates ordering as views arrive', () => {
    recordViewed(view('a1', 'BUY'))
    recordViewed(view('b2', 'BUY'))
    recordViewed(view('c3', 'BUY'))
    expect(getRecentlyViewed().map(idOf)).toEqual(['c3', 'b2', 'a1'])
    recordViewed(view('a1', 'BUY')) // re-view the oldest → jumps to front
    expect(getRecentlyViewed().map(idOf)).toEqual(['a1', 'c3', 'b2'])
  })

  it('treats malformed / wrong-version storage as empty (fail safe)', () => {
    const store = currentStorage()
    // not JSON
    store._map.set(STORAGE_KEY, '{not json')
    expect(getRecentlyViewed()).toEqual([])
    // valid JSON but the old bare-array (v0) shape → discarded
    store._map.set(STORAGE_KEY, JSON.stringify([{ id: 'x', division: 'BUY', priceMinor: 1, currency: 'USD', image: '/a', at: 1 }]))
    expect(getRecentlyViewed()).toEqual([])
    // future/unknown version → discarded
    store._map.set(STORAGE_KEY, JSON.stringify({ v: 999, items: [{ id: 'x', division: 'BUY', priceMinor: 1, currency: 'USD', image: '/a', at: 1 }] }))
    expect(getRecentlyViewed()).toEqual([])
    // right version, but individual bad items are dropped and good ones kept
    store._map.set(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        items: [
          { id: 'good', division: 'BUY', priceMinor: 5, currency: 'USD', image: '/a', at: 5 },
          { id: 'bad space', division: 'BUY', priceMinor: 5, currency: 'USD', image: '/a', at: 6 }, // invalid id
          { id: 'ok2', division: 'MADE_UP', priceMinor: 5, currency: 'USD', image: '/a', at: 7 }, // unknown division
          { id: 'ok3', division: 'BUY', priceMinor: -1, currency: 'USD', image: '/a', at: 8 }, // bad price
        ],
      }),
    )
    expect(getRecentlyViewed().map(idOf)).toEqual(['good'])
  })

  it('never throws when storage read or write is blocked', () => {
    const store = currentStorage()
    store.throwOnSet = true
    expect(() => recordViewed(view('a1', 'BUY'))).not.toThrow()
    expect(getRecentlyViewed()).toEqual([]) // nothing persisted, but no crash
    store.throwOnSet = false
    recordViewed(view('a1', 'BUY'))
    store.throwOnGet = true
    expect(getRecentlyViewed()).toEqual([]) // read blocked → empty, no crash
  })

  it('degrades to a no-op when storage is entirely unavailable (no window)', () => {
    delete (globalThis as { window?: unknown }).window
    expect(() => recordViewed(view('a1', 'BUY'))).not.toThrow()
    expect(getRecentlyViewed()).toEqual([])
    expect(() => clearRecentlyViewed()).not.toThrow()
  })

  it('caps history at the retention limit (15)', () => {
    for (let i = 0; i < 25; i += 1) recordViewed(view(`id${i}`, 'BUY'))
    const rows = getRecentlyViewed()
    expect(rows.length).toBe(15)
    // The 15 most recent (id24 … id10), newest first.
    expect(rows[0].id).toBe('id24')
    expect(rows.at(-1)?.id).toBe('id10')
    expect(rows.some((v) => v.id === 'id9')).toBe(false)
  })

  it('isolates Synitres (BUY/RENTALS) from STR (STAYS) history via the divisions filter', () => {
    recordViewed(view('buy1', 'BUY'))
    recordViewed(view('rent1', 'RENTALS'))
    recordViewed(view('stay1', 'STAYS'))
    expect(getRecentlyViewed({ divisions: ['BUY', 'RENTALS'] }).map(idOf).sort()).toEqual(['buy1', 'rent1'])
    expect(getRecentlyViewed({ divisions: ['STAYS'] }).map(idOf)).toEqual(['stay1'])
    expect(getRecentlyViewed({ excludeId: 'stay1' }).some((v) => v.id === 'stay1')).toBe(false)
    expect(getRecentlyViewed({ limit: 1 }).length).toBe(1)
  })

  it('builds valid detail links per division and preserves price fields for rendering', () => {
    expect(detailHrefFor('BUY', 'abc-123')).toBe('#/property/abc-123')
    expect(detailHrefFor('RENTALS', 'abc-123')).toBe('#/property/abc-123')
    expect(detailHrefFor('STAYS', 'abc-123')).toBe('#/listing/abc-123')
    expect(detailHrefFor('CARS', 'abc-123')).toBe('#/listing/abc-123')
    recordViewed(view('p1', 'BUY', { priceMinor: 12_500_000, currency: 'USD' }))
    const [row] = getRecentlyViewed()
    expect({ priceMinor: row.priceMinor, currency: row.currency }).toEqual({ priceMinor: 12_500_000, currency: 'USD' })
  })

  it('returns an empty list (and clears) gracefully when there is no history', () => {
    expect(getRecentlyViewed()).toEqual([])
    recordViewed(view('a1', 'BUY'))
    expect(getRecentlyViewed().length).toBe(1)
    clearRecentlyViewed()
    expect(getRecentlyViewed()).toEqual([])
  })

  it('drops records with an unsafe id and never stores garbage from callers', () => {
    recordViewed(view('bad/id', 'BUY')) // slash is not id-safe
    recordViewed(view('<script>', 'BUY'))
    recordViewed(view('', 'BUY'))
    expect(getRecentlyViewed()).toEqual([])
  })

  it('strips an unsafe image URL to empty (the strip then shows its placeholder)', () => {
    recordViewed(view('a1', 'BUY', { image: 'javascript:alert(1)' as string }))
    recordViewed(view('a2', 'BUY', { image: '/media/real.png' }))
    const byId = Object.fromEntries(getRecentlyViewed().map((v) => [v.id, v.image]))
    expect(byId.a1).toBe('') // unsafe → cleared
    expect(byId.a2).toBe('/media/real.png') // safe path kept
  })

  it('round-trips Arabic, English and French (accented) titles intact', () => {
    recordViewed(view('ar1', 'BUY', { title: 'شقة فاخرة في دمشق' }))
    recordViewed(view('en1', 'RENTALS', { title: 'Cozy apartment downtown' }))
    recordViewed(view('fr1', 'STAYS', { title: 'Appartement élégant à Montréal — vue dégagée' }))
    const byId = Object.fromEntries(getRecentlyViewed().map((v) => [v.id, v.title]))
    expect(byId.ar1).toBe('شقة فاخرة في دمشق')
    expect(byId.en1).toBe('Cozy apartment downtown')
    expect(byId.fr1).toBe('Appartement élégant à Montréal — vue dégagée')
  })
})
