import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { galleryImageUrls, initialMainImageUrl, resolveActiveImageUrl } from './listingGalleryModel'

// C3 — thin gallery shell over the pure logic in listingGallery.ts. Displays a large main image plus a
// horizontally scrollable, keyboard-accessible thumbnail strip (when >1 photo). Display-only: reads
// existing media URLs, no upload/edit/lightbox. A failed thumbnail is dropped without breaking the
// gallery; a failed main image falls back to the stock/division image (same as before C3).
type MediaItem = Record<string, unknown>

type Props = {
  lang: Lang
  media: MediaItem[] | undefined
  fallback: string
  alt: string
  badges?: ReactNode // overlays (division / instant-book) rendered over the main image only
}

export function ListingGallery({ lang, media, fallback, alt, badges }: Props) {
  const isAr = lang === 'ar'
  const allUrls = useMemo(() => galleryImageUrls(media), [media])
  const [brokenUrls, setBrokenUrls] = useState<Set<string>>(new Set())
  const urls = useMemo(() => allUrls.filter((u) => !brokenUrls.has(u)), [allUrls, brokenUrls])

  const [activeUrl, setActiveUrl] = useState<string>(() => initialMainImageUrl(media, fallback))
  // Keep the active image valid when the media set (or broken set) changes.
  useEffect(() => {
    setActiveUrl((current) => resolveActiveImageUrl(urls, current, fallback))
  }, [urls, fallback])

  const hasStrip = urls.length > 1
  const photoWord = isAr ? 'صورة' : 'Photo'

  return (
    <div className="listing-gallery" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="lg-main-wrap">
        <img
          className="lg-main"
          src={activeUrl}
          alt={alt}
          onError={(event) => {
            if (event.currentTarget.src.endsWith(fallback)) return
            event.currentTarget.src = fallback
          }}
        />
        {badges}
      </div>

      {hasStrip && (
        <div className="lg-thumbs" role="group" aria-label={isAr ? 'صور العقار' : 'Property photos'}>
          {urls.map((url, index) => {
            const selected = url === activeUrl
            return (
              <button
                key={url}
                type="button"
                className={`lg-thumb${selected ? ' active' : ''}`}
                aria-pressed={selected}
                aria-label={`${photoWord} ${index + 1} / ${urls.length}`}
                onClick={() => setActiveUrl(url)}
              >
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  onError={() => setBrokenUrls((prev) => new Set(prev).add(url))}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
