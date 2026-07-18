import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'
import { DealRatingBadge } from './DealRatingBadge'

type Props = {
  lang: Lang
  listing: PlatformListing
}

const copy = {
  ar: {
    title: 'أداة التسعير',
    median: 'متوسط سعر السيارات المشابهة',
    comparableCount: 'عدد السيارات المشابهة المستخدمة',
    noData: 'لا تتوفر بيانات كافية للمقارنة بعد. أضف المزيد من التفاصيل أو انتظر ظهور سيارات مشابهة معتمدة.',
    suggestion: (amount: string) => `اخفض السعر بمقدار ${amount} تقريباً للوصول إلى تصنيف "صفقة جيدة".`,
  },
  en: {
    title: 'Pricing tool',
    median: 'Median price of comparable cars',
    comparableCount: 'Comparable cars used',
    noData: 'Not enough comparable listings yet. Add more details or wait for similar approved cars to appear.',
    suggestion: (amount: string) => `Lower the price by about ${amount} to reach a "Good Deal" rating.`,
  },
}

// GOOD_DEAL ceiling ratio mirrors GOOD_DEAL_MAX_RATIO in server/lib/car-deal-rating.mjs (1.0 --
// at or below the comparable median). Duplicated here since src/ never imports server/lib/*.mjs.
const GOOD_DEAL_MAX_RATIO = 1.0

export function CarPricingToolPanel({ lang, listing }: Props) {
  const t = copy[lang]
  const dealRating = listing.dealRating

  if (!dealRating || dealRating.tier === null || dealRating.medianPriceMinor === null) {
    return (
      <section style={styles.panel}>
        <strong>{t.title}</strong>
        <p style={styles.noData}>{t.noData}</p>
      </section>
    )
  }

  const targetPriceMinor = Math.round(dealRating.medianPriceMinor * GOOD_DEAL_MAX_RATIO)
  const suggestionMinor = listing.priceMinor > targetPriceMinor ? listing.priceMinor - targetPriceMinor : 0

  return (
    <section style={styles.panel}>
      <div style={styles.header}>
        <strong>{t.title}</strong>
        <DealRatingBadge dealRating={dealRating} lang={lang} />
      </div>
      <div style={styles.row}>
        <span style={styles.label}>{t.median}</span>
        <strong dir="ltr">{moneyText(dealRating.medianPriceMinor, listing.currency, lang)}</strong>
      </div>
      <div style={styles.row}>
        <span style={styles.label}>{t.comparableCount}</span>
        <strong>{dealRating.comparableCount}</strong>
      </div>
      {suggestionMinor > 0 && <p style={styles.suggestion}>{t.suggestion(moneyText(suggestionMinor, listing.currency, lang))}</p>}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: { border: '1px solid #242735', borderRadius: 12, background: '#0c1220', padding: 14, display: 'grid', gap: 10, color: '#fff' },
  header: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  label: { color: '#9aa6ba', fontWeight: 850, fontSize: 13 },
  noData: { color: '#9aa6ba', fontSize: 13 },
  suggestion: { color: '#e0a94a', fontSize: 13, fontWeight: 850 },
}
