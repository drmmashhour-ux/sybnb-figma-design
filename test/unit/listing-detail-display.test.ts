import { describe, expect, it } from 'vitest'
import {
  galleryImageUrls,
  initialMainImageUrl,
  resolveActiveImageUrl,
} from '../../src/modules/listings/listingGalleryModel'
import {
  orderedAmenityIds,
  listingAmenityLabels,
  listingAmenities,
} from '../../src/modules/listings/listingAmenities'
import { selectedFilterLabels } from '../../src/shared/filters/VisualFilterPanel'
import { sellerPropertyFilterGroups } from '../../src/engines/filters'

// C3 — Photo gallery + amenities list on the listing detail. Pure, DOM-free display logic reading
// EXISTING data (listing.media, metadata.visualFilters). No uploads, no editing, no backend.

describe('C3 gallery — ordered image urls from listing.media', () => {
  it('orders by sortOrder (ascending), lowest first', () => {
    const media = [{ url: '/b.jpg', sortOrder: 2 }, { url: '/a.jpg', sortOrder: 0 }, { url: '/c.jpg', sortOrder: 1 }]
    expect(galleryImageUrls(media)).toEqual(['/a.jpg', '/c.jpg', '/b.jpg'])
  })

  it('is stable for missing or equal sortOrder (falls back to original order)', () => {
    const media = [{ url: '/x.jpg' }, { url: '/y.jpg' }, { url: '/z.jpg', sortOrder: 5 }]
    // x and y have no sortOrder -> treated as MAX, kept in original order; z (5) comes first
    expect(galleryImageUrls(media)).toEqual(['/z.jpg', '/x.jpg', '/y.jpg'])
    const equal = [{ url: '/p.jpg', sortOrder: 1 }, { url: '/q.jpg', sortOrder: 1 }]
    expect(galleryImageUrls(equal)).toEqual(['/p.jpg', '/q.jpg']) // stable tie-break
  })

  it('omits invalid / empty / non-string urls', () => {
    const media = [{ url: '/ok.jpg', sortOrder: 0 }, { url: '' }, { kind: 'photo' }, { url: null }, { src: '/alt.jpg', sortOrder: 1 }]
    expect(galleryImageUrls(media as any)).toEqual(['/ok.jpg', '/alt.jpg'])
  })

  it('dedupes repeated urls (keeps first occurrence order)', () => {
    const media = [{ url: '/dup.jpg', sortOrder: 0 }, { url: '/dup.jpg', sortOrder: 1 }, { url: '/other.jpg', sortOrder: 2 }]
    expect(galleryImageUrls(media)).toEqual(['/dup.jpg', '/other.jpg'])
  })

  it('initial main image is the first valid ordered image; falls back when none', () => {
    const media = [{ url: '/a.jpg', sortOrder: 1 }, { url: '/cover.jpg', sortOrder: 0 }]
    expect(initialMainImageUrl(media, '/stock.webp')).toBe('/cover.jpg')
    expect(initialMainImageUrl([], '/stock.webp')).toBe('/stock.webp')
    expect(initialMainImageUrl(undefined, '/stock.webp')).toBe('/stock.webp')
  })

  it('selecting another valid image changes the active image', () => {
    const urls = ['/a.jpg', '/b.jpg', '/c.jpg']
    expect(resolveActiveImageUrl(urls, '/b.jpg', '/stock.webp')).toBe('/b.jpg')
  })

  it('active image stays valid if the media set changes (desired no longer present)', () => {
    const urls = ['/a.jpg', '/b.jpg']
    // desired was '/gone.jpg' (removed) -> fall back to first available
    expect(resolveActiveImageUrl(urls, '/gone.jpg', '/stock.webp')).toBe('/a.jpg')
    // no images at all -> stock fallback
    expect(resolveActiveImageUrl([], '/gone.jpg', '/stock.webp')).toBe('/stock.webp')
  })
})

describe('C3 amenities — resolved from metadata.visualFilters via existing definitions', () => {
  const md = (amenities: unknown) => ({ visualFilters: { amenities } })

  it('resolves selected amenity ids to approved EN labels', () => {
    const labels = listingAmenityLabels(md(['wifi', 'kitchen']), 'en')
    expect(labels).toContain('Wi-Fi')
    expect(labels).toContain('Kitchen')
  })

  it('resolves to approved AR labels', () => {
    const labels = listingAmenityLabels(md(['wifi', 'kitchen']), 'ar')
    expect(labels).toContain('Wi-Fi') // wifi AR label is 'Wi-Fi'
    expect(labels).toContain('مطبخ') // kitchen AR label
  })

  it('empty or missing metadata produces no amenities', () => {
    expect(listingAmenityLabels(undefined, 'en')).toEqual([])
    expect(listingAmenityLabels({}, 'en')).toEqual([])
    expect(listingAmenityLabels(md([]), 'en')).toEqual([])
    expect(listingAmenityLabels(md(undefined), 'en')).toEqual([])
  })

  it('duplicate amenity ids do not render twice', () => {
    expect(listingAmenityLabels(md(['wifi', 'wifi']), 'en')).toEqual(['Wi-Fi'])
  })

  it('unknown / retired amenity ids are omitted (no crash, no invented label)', () => {
    expect(listingAmenityLabels(md(['wifi', '__retired__', 'not-a-real-amenity']), 'en')).toEqual(['Wi-Fi'])
    expect(orderedAmenityIds(md(['__nope__']))).toEqual([])
  })

  it('output order follows the filter-definition order, not the selection order', () => {
    const group = sellerPropertyFilterGroups.find((g) => g.id === 'amenities')!
    const defOrderIds = group.options.map((o) => o.id)
    // pick two ids that both exist, feed them REVERSED
    const a = defOrderIds[0]
    const b = defOrderIds.find((id, i) => i > 0)!
    const resolved = orderedAmenityIds(md([b, a]))
    // resolved must be in definition order (a before b)
    expect(resolved).toEqual([a, b])
  })

  it('labels stay consistent with the existing selectedFilterLabels helper (single source)', () => {
    const ids = orderedAmenityIds(md(['kitchen', 'wifi']))
    expect(listingAmenityLabels(md(['kitchen', 'wifi']), 'en')).toEqual(
      selectedFilterLabels(sellerPropertyFilterGroups, { amenities: ids }, 'en'),
    )
  })

  it('listingAmenities returns id + label + supplemental icon; label matches the labels-only path', () => {
    const items = listingAmenities(md(['wifi', 'kitchen']), 'en')
    expect(items.map((i) => i.id)).toEqual(['wifi', 'kitchen'])
    expect(items.map((i) => i.label)).toEqual(listingAmenityLabels(md(['wifi', 'kitchen']), 'en'))
    // icon is supplemental (may be a string path from the existing art/photoSrc mapping) — text is the source of meaning
    for (const it of items) expect(typeof it.label).toBe('string')
  })
})
