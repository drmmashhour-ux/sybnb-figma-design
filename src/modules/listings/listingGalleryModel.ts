// C3 — Photo gallery: pure, DOM-free helpers that read an EXISTING listing.media array and produce
// the ordered set of image URLs for the detail-page gallery. No uploads, no editing, no backend — a
// display-only concern. Mirrors C2's cover ordering (lowest sortOrder first) so the gallery's first
// image equals the cover.

type MediaItem = Record<string, unknown>

// Ordered, valid, de-duplicated image URLs from listing.media. Ordering: ascending sortOrder, with a
// stable tie-break on the original array index (so missing/equal sortOrder keeps input order). Rows
// without a usable string URL are omitted; duplicate URLs keep only their first occurrence.
export function galleryImageUrls(media: MediaItem[] | undefined): string[] {
  if (!media || media.length === 0) return []
  const withUrl = media
    .map((m, index) => ({
      url: [m.url, m.src, m.assetUrl].find((v) => typeof v === 'string' && v.length > 0) as string | undefined,
      sortOrder: typeof m.sortOrder === 'number' ? m.sortOrder : Number.MAX_SAFE_INTEGER,
      index,
    }))
    .filter((m): m is { url: string; sortOrder: number; index: number } => typeof m.url === 'string')
  withUrl.sort((a, b) => a.sortOrder - b.sortOrder || a.index - b.index)
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of withUrl) {
    if (!seen.has(m.url)) {
      seen.add(m.url)
      out.push(m.url)
    }
  }
  return out
}

// The initial main (large) image: the first valid ordered image, or the provided stock/division
// fallback when the listing has no real photos.
export function initialMainImageUrl(media: MediaItem[] | undefined, fallback: string): string {
  return galleryImageUrls(media)[0] ?? fallback
}

// Resolve which image should be active given a desired selection: the desired URL if it's still a
// valid gallery image, otherwise the first available image, otherwise the fallback. Keeps the main
// image valid when the media set changes (e.g., a photo is removed).
export function resolveActiveImageUrl(urls: string[], desired: string | undefined, fallback: string): string {
  if (desired && urls.includes(desired)) return desired
  return urls[0] ?? fallback
}
