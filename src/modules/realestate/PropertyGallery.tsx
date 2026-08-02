import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { colors } from '../../shared/theme/tokens'

type Props = {
  photos: string[]
  lang: Lang
  // Optional override for the large image's aspect ratio, so a host surface can match its own layout.
  aspectRatio?: string
}

// Reusable property photo gallery: a large active photo with prev/next + a "N / total" counter, and a
// clickable thumbnail strip. With a single photo it degrades to just that image (no controls), so it is
// a safe drop-in wherever a real-estate listing's photos are shown (standalone /property/:id, the
// buy/rentals selected-property detail). Pass the URLs via listingPhotoUrls() from propertyAttrs.
export function PropertyGallery({ photos, lang, aspectRatio = '16 / 9' }: Props) {
  const isAr = lang === 'ar'
  const [active, setActive] = useState(0)
  // Reset to the first photo whenever the set of photos changes (e.g. a different listing is selected).
  useEffect(() => { setActive(0) }, [photos])

  const list = photos.length ? photos : ['']
  const index = Math.min(active, list.length - 1)
  const step = (delta: number) => setActive((current) => (current + delta + list.length) % list.length)

  return (
    <div style={styles.gallery}>
      <div style={{ ...styles.heroWrap, aspectRatio }}>
        <img src={list[index]} alt="" style={styles.hero} />
        {list.length > 1 ? (
          <>
            <button style={{ ...styles.navBtn, insetInlineStart: 10 }} onClick={() => step(-1)} aria-label="Previous photo">{isAr ? '›' : '‹'}</button>
            <button style={{ ...styles.navBtn, insetInlineEnd: 10 }} onClick={() => step(1)} aria-label="Next photo">{isAr ? '‹' : '›'}</button>
            <span style={styles.counter} dir="ltr">{index + 1} / {list.length}</span>
          </>
        ) : null}
      </div>
      {list.length > 1 ? (
        <div style={styles.thumbStrip}>
          {list.map((url, i) => (
            <button
              key={url}
              style={{ ...styles.thumb, ...(i === index ? styles.thumbActive : null) }}
              onClick={() => setActive(i)}
              aria-label={`Photo ${i + 1}`}
            >
              <img src={url} alt="" style={styles.thumbImg} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  gallery: { display: 'grid', gap: 8 },
  heroWrap: { position: 'relative', width: '100%' },
  hero: { width: '100%', height: '100%', aspectRatio: 'inherit', objectFit: 'cover', borderRadius: 16, background: colors.bg2, display: 'block' },
  navBtn: { position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 38, height: 38, borderRadius: '50%', border: 'none', background: 'rgba(6,12,20,.62)', color: '#fff', fontSize: 22, fontWeight: 800, lineHeight: 1, cursor: 'pointer', display: 'grid', placeItems: 'center' },
  counter: { position: 'absolute', insetInlineEnd: 12, bottom: 12, background: 'rgba(6,12,20,.62)', color: '#fff', fontSize: 12, fontWeight: 800, borderRadius: 999, padding: '3px 10px' },
  thumbStrip: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 },
  thumb: { flex: '0 0 auto', width: 84, height: 60, padding: 0, border: '2px solid transparent', borderRadius: 10, background: colors.bg2, cursor: 'pointer', overflow: 'hidden' },
  thumbActive: { borderColor: colors.green },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
}

export default PropertyGallery
