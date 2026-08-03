import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { moneyText } from '../i18n/display'
import { colors } from '../theme/tokens'
import { getRecentlyViewed, detailHrefFor } from './recentlyViewed'

type Props = {
  lang: Lang
  // Limit to certain divisions (e.g. a Synitres surface passes ['BUY','RENTALS']); omit for all.
  divisions?: string[]
  excludeId?: string
  limit?: number
}

// Placeholder shown when a snapshot has no (or an unsafe) image, and as the <img> onError fallback.
const FALLBACK_IMAGE = '/assets/divisions/daily-rental.webp'

// A horizontal "recently viewed" strip built from the shared client-side store. Renders nothing when the
// visitor has no matching history, so it's a safe drop-in on any landing/search surface.
export function RecentlyViewedStrip({ lang, divisions, excludeId, limit = 8 }: Props) {
  const isAr = lang === 'ar'
  // Read once on mount — the store only changes on a detail-page view, and this surface re-mounts on
  // navigation, so a render-time snapshot is enough (no need to subscribe).
  const [rows] = useState(() => getRecentlyViewed({ divisions, excludeId, limit }))
  if (!rows.length) return null

  return (
    <section style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <strong style={styles.title}>{isAr ? 'شوهدت مؤخراً' : 'Recently viewed'}</strong>
      <div style={styles.row}>
        {rows.map((v) => (
          <a key={v.id} href={detailHrefFor(v.division, v.id)} style={styles.card}>
            <img
              src={v.image || FALLBACK_IMAGE}
              alt=""
              style={styles.img}
              onError={(event) => {
                if (event.currentTarget.src.endsWith(FALLBACK_IMAGE)) return
                event.currentTarget.src = FALLBACK_IMAGE
              }}
            />
            <div style={styles.body}>
              <strong style={styles.name}>{v.title}</strong>
              <span style={styles.price} dir="ltr">{moneyText(v.priceMinor, v.currency, lang)}</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 10 },
  title: { fontSize: 18, color: colors.ink },
  row: { display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 },
  card: { flex: '0 0 auto', width: 172, border: `1px solid ${colors.line}`, borderRadius: 12, background: colors.bg2, overflow: 'hidden', textDecoration: 'none', color: 'inherit', display: 'grid' },
  img: { width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', background: colors.bg2, display: 'block' },
  body: { display: 'grid', gap: 3, padding: '9px 11px' },
  name: { fontSize: 14, color: colors.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  price: { fontSize: 14, fontWeight: 800, color: colors.green },
}

export default RecentlyViewedStrip
