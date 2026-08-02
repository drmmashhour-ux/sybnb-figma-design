import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode, SyntheticEvent } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../api/platformApi'
import { colors } from '../theme/tokens'

// One gallery photo: its URL plus an optional caption (the AI photo-tour room label, e.g. "Kitchen").
export type GalleryPhoto = { url: string; caption?: string }

type Props = {
  photos: GalleryPhoto[]
  lang: Lang
  // 'card' — rounded, aspect-ratio'd hero + thumbnail strip (Synitres real-estate MLS look).
  // 'hero' — full-bleed immersive hero with an overlay slot for badges/actions + thumbnail strip
  //          below (STR stays look). Both variants share the same photo-stepping + thumbnail logic.
  variant?: 'card' | 'hero'
  aspectRatio?: string // card variant only
  heroStyle?: CSSProperties // hero variant: match the host page's frame (border/bg/radius/minHeight)
  overlay?: ReactNode // hero variant: badges/actions rendered absolutely over the active photo
  fallback?: string // swap the main/thumbnail image to this URL if it fails to load
}

// Shared photo gallery capsule, reused across platforms (Synitres property detail + buy/rentals detail,
// STR stays detail) so there is ONE gallery implementation. It owns the active-photo state, prev/next
// (wrapping), the "N / total" counter, and the clickable thumbnail strip; the `variant` only changes the
// framing so each platform keeps its own look. A single-photo (or media-less) listing degrades to just
// the image, no controls. Build the `photos` array with listingGalleryPhotos() below.
export function PhotoGallery({ photos, lang, variant = 'card', aspectRatio = '16 / 9', heroStyle, overlay, fallback }: Props) {
  const isAr = lang === 'ar'
  const isHero = variant === 'hero'
  const [active, setActive] = useState(0)
  // Reset to the first photo whenever the set of photos changes (a different listing selected).
  useEffect(() => { setActive(0) }, [photos])

  const list = photos.length ? photos : [{ url: '' }]
  const index = Math.min(active, list.length - 1)
  const step = (delta: number) => setActive((current) => (current + delta + list.length) % list.length)
  const onError = fallback
    ? (event: SyntheticEvent<HTMLImageElement>) => {
        const target = event.currentTarget
        if (!target.src.endsWith(fallback)) target.src = fallback
      }
    : undefined

  return (
    <div style={styles.gallery}>
      <div style={{ ...(isHero ? styles.heroWrapHero : styles.heroWrapCard), ...(isHero ? heroStyle : { aspectRatio }) }}>
        <img src={list[index].url} alt={list[index].caption || ''} style={isHero ? styles.heroImgHero : styles.heroImgCard} onError={onError} />
        {list.length > 1 ? (
          <>
            <button style={{ ...(isHero ? styles.navBtnHero : styles.navBtnCard), insetInlineStart: isHero ? 12 : 10 }} onClick={() => step(-1)} aria-label="Previous photo">{isAr ? '›' : '‹'}</button>
            <button style={{ ...(isHero ? styles.navBtnHero : styles.navBtnCard), insetInlineEnd: isHero ? 12 : 10 }} onClick={() => step(1)} aria-label="Next photo">{isAr ? '‹' : '›'}</button>
            <span style={isHero ? styles.counterHero : styles.counterCard} dir="ltr">{index + 1} / {list.length}</span>
          </>
        ) : null}
        {/* AI photo-tour room label for the active photo (bottom-centre, clear of the corner badges/counter). */}
        {list[index].caption ? <span style={styles.caption}>{list[index].caption}</span> : null}
        {overlay}
      </div>
      {list.length > 1 ? (
        <div style={styles.thumbStrip}>
          {list.map((photo, i) => (
            <button
              key={photo.url}
              style={{ ...styles.thumb, ...(i === index ? styles.thumbActive : null) }}
              onClick={() => setActive(i)}
              aria-label={photo.caption ? `${photo.caption} (photo ${i + 1})` : `Photo ${i + 1}`}
            >
              <img src={photo.url} alt="" style={styles.thumbImg} onError={onError} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// Localized room/space labels for the AI photo-tour categories (keys match PHOTO_ROOM_CATEGORIES).
const ROOM_LABELS: Record<string, { ar: string; en: string }> = {
  bedroom: { ar: 'غرفة نوم', en: 'Bedroom' },
  bathroom: { ar: 'حمّام', en: 'Bathroom' },
  living_room: { ar: 'غرفة معيشة', en: 'Living room' },
  kitchen: { ar: 'مطبخ', en: 'Kitchen' },
  dining: { ar: 'غرفة طعام', en: 'Dining' },
  balcony: { ar: 'شرفة', en: 'Balcony' },
  exterior: { ar: 'الخارج', en: 'Exterior' },
  view: { ar: 'الإطلالة', en: 'View' },
  pool: { ar: 'مسبح', en: 'Pool' },
  entrance: { ar: 'المدخل', en: 'Entrance' },
}

// The listing's guest-facing photos in upload order, deduped by URL, each carrying its AI photo-tour
// room label (metadata.photoCategories, index-aligned to the upload order) as an optional caption. The
// generic "other" bucket and unlabelled photos get no caption. Falls back to the placeholder when the
// listing has no real media yet, so a gallery always has at least one photo to show.
export function listingGalleryPhotos(listing: PlatformListing, fallback: string, lang: Lang): GalleryPhoto[] {
  const isAr = lang === 'ar'
  const meta = (listing.metadata || {}) as Record<string, unknown>
  const categories = Array.isArray(meta.photoCategories) ? (meta.photoCategories as unknown[]) : []
  const seen = new Set<string>()
  const photos: GalleryPhoto[] = []
  ;(listing.media || []).forEach((m, i) => {
    const item = m as Record<string, unknown>
    const url = item.url || item.src || item.assetUrl
    if (typeof url !== 'string' || !url || seen.has(url)) return
    seen.add(url)
    const category = typeof categories[i] === 'string' ? String(categories[i]) : ''
    const label = category && category !== 'other' && ROOM_LABELS[category] ? (isAr ? ROOM_LABELS[category].ar : ROOM_LABELS[category].en) : undefined
    photos.push({ url, caption: label })
  })
  return photos.length ? photos : [{ url: fallback }]
}

const styles: Record<string, CSSProperties> = {
  gallery: { display: 'grid', gap: 8 },
  // Card variant (Synitres): rounded, aspect-ratio'd hero.
  heroWrapCard: { position: 'relative', width: '100%' },
  heroImgCard: { width: '100%', height: '100%', aspectRatio: 'inherit', objectFit: 'cover', borderRadius: 16, background: colors.bg2, display: 'block' },
  navBtnCard: { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 38, height: 38, borderRadius: '50%', border: 'none', background: 'rgba(6,12,20,.62)', color: '#fff', fontSize: 22, fontWeight: 800, lineHeight: 1, cursor: 'pointer', display: 'grid', placeItems: 'center' },
  counterCard: { position: 'absolute', insetInlineEnd: 12, bottom: 12, background: 'rgba(6,12,20,.62)', color: '#fff', fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '3px 10px' },
  // Room-label caption for the active photo — bottom-centre so it clears the corner badges/counter/arrows.
  caption: { position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 12, background: 'rgba(6,12,20,.72)', color: '#fff', fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '3px 12px', zIndex: 2, whiteSpace: 'nowrap' },
  // Hero variant (STR stays): full-bleed immersive frame supplied by the host via heroStyle.
  heroWrapHero: { position: 'relative', width: '100%', minHeight: 330, overflow: 'hidden', display: 'grid', placeItems: 'center' },
  heroImgHero: { width: '100%', height: '100%', minHeight: 330, objectFit: 'cover', display: 'block' },
  navBtnHero: { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: '50%', border: '1px solid rgba(255,255,255,.35)', background: 'rgba(8,9,15,.6)', color: '#fff', fontSize: 26, lineHeight: 1, cursor: 'pointer', display: 'grid', placeItems: 'center', backdropFilter: 'blur(8px)', zIndex: 2 },
  counterHero: { position: 'absolute', insetInlineEnd: 14, bottom: 14, borderRadius: 999, background: 'rgba(8,9,15,.78)', border: '1px solid rgba(255,255,255,.18)', color: '#fff', padding: '6px 12px', fontSize: 13, fontWeight: 700, zIndex: 2 },
  // Thumbnail strip (shared).
  thumbStrip: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 },
  thumb: { flex: '0 0 auto', width: 84, height: 60, padding: 0, border: '2px solid transparent', borderRadius: 10, background: colors.bg2, cursor: 'pointer', overflow: 'hidden' },
  thumbActive: { borderColor: colors.green },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
}

export default PhotoGallery
