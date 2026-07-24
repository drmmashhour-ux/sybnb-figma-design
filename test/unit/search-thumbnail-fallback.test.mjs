import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { selectCoverUrl } from '../../src/modules/seller/listingPhotos.ts'

// FIX B — search result-card thumbnails were broken: the card derived its image ad-hoc (first media
// item, ignoring sortOrder) and had no onError fallback, so a missing/failing image showed a broken-image
// icon. The detail hero already used selectCoverUrl (real cover, else division fallback). This aligns the
// results card to the same deriver and requires an onError placeholder so a missing image degrades.

const page = readFileSync(new URL('../../src/modules/search/SearchPreviewPage.tsx', import.meta.url), 'utf8')

describe('FIX B — result-card thumbnail source + fallback', () => {
  it('the shared cover deriver falls back when there is no usable media', () => {
    expect(selectCoverUrl(undefined, '/assets/divisions/daily-rental.webp')).toBe('/assets/divisions/daily-rental.webp')
    expect(selectCoverUrl([], '/fallback.webp')).toBe('/fallback.webp')
  })

  it('the shared cover deriver picks the lowest-sortOrder photo (the real cover)', () => {
    const media = [
      { url: '/second.webp', sortOrder: 2 },
      { url: '/cover.webp', sortOrder: 0 },
      { url: '/third.webp', sortOrder: 1 },
    ]
    expect(selectCoverUrl(media, '/fallback.webp')).toBe('/cover.webp')
  })

  it('SearchPreviewPage derives the card image via selectCoverUrl (same as the detail hero)', () => {
    expect(page).toMatch(/selectCoverUrl\(/)
  })

  it('the result-card <img> has an onError placeholder fallback', () => {
    // Anchor to the result media block so we assert the fix is on the thumbnail specifically.
    const mediaBlock = page.slice(page.indexOf('search-result-media'), page.indexOf('search-result-media') + 500)
    expect(mediaBlock).toMatch(/onError=/)
  })
})
