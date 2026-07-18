import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../../shared/api/platformApi'

type Props = {
  lang: Lang
  dealRating: PlatformListing['dealRating']
}

const copy = {
  ar: {
    GREAT_DEAL: 'صفقة رائعة',
    GOOD_DEAL: 'صفقة جيدة',
    FAIR_PRICE: 'سعر مقبول',
    HIGH_PRICE: 'سعر مرتفع',
  },
  en: {
    GREAT_DEAL: 'Great Deal',
    GOOD_DEAL: 'Good Deal',
    FAIR_PRICE: 'Fair Price',
    HIGH_PRICE: 'High Price',
  },
}

const colors: Record<'GREAT_DEAL' | 'GOOD_DEAL' | 'FAIR_PRICE' | 'HIGH_PRICE', CSSProperties> = {
  GREAT_DEAL: { background: 'rgba(32,210,155,.18)', color: '#20d29b', borderColor: '#20d29b' },
  GOOD_DEAL: { background: 'rgba(82,108,255,.18)', color: '#8fa0ff', borderColor: '#526cff' },
  FAIR_PRICE: { background: 'rgba(154,166,186,.18)', color: '#9aa6ba', borderColor: '#30384d' },
  HIGH_PRICE: { background: 'rgba(214,120,20,.18)', color: '#e0a94a', borderColor: '#d67814' },
}

export function DealRatingBadge({ lang, dealRating }: Props) {
  if (!dealRating?.tier) return null
  return (
    <span style={{ ...styles.badge, ...colors[dealRating.tier] }}>
      {copy[lang][dealRating.tier]}
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 999,
    border: '1px solid',
    padding: '2px 10px',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
}
