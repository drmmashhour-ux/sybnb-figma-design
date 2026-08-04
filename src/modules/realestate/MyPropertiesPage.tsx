import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchMyProperties, type MyProperty } from '../../shared/api/platformApi'
import { listingTitleText, moneyText, statusText } from '../../shared/i18n/display'
import { colors, withAlpha } from '../../shared/theme/tokens'
import { SYNITRES_INQUIRY_FOCUS_LISTING_KEY, SYNITRES_EDIT_LISTING_KEY } from '../../shared/nav/synitresHandoff'
import { realEstateAttrs } from './propertyAttrs'

type Props = { lang: Lang }

const copy = {
  ar: {
    title: 'عقاراتي', subtitle: 'أدِر إعلاناتك العقارية وتابع حالتها والاستفسارات.',
    loading: 'جار التحميل…', signIn: 'سجّل الدخول كبائع لعرض عقاراتك.', error: 'تعذر تحميل عقاراتك.', retry: 'إعادة المحاولة',
    empty: 'لا توجد عقارات بعد.', addListing: 'أضف إعلاناً',
    inquiries: 'استفسارات', viewPage: 'عرض الصفحة', edit: 'تعديل / إعادة إرسال',
    buy: 'للبيع', rent: 'إيجار', back: 'الرئيسية', openInbox: 'افتح الرسائل',
  },
  en: {
    title: 'My properties', subtitle: 'Manage your real-estate listings, their status, and inquiries.',
    loading: 'Loading…', signIn: 'Sign in as a seller to see your properties.', error: 'Could not load your properties.', retry: 'Try again',
    empty: 'No properties yet.', addListing: 'Add a listing',
    inquiries: 'inquiries', viewPage: 'View page', edit: 'Edit / resubmit',
    buy: 'For sale', rent: 'Rental', back: 'Home', openInbox: 'Open messages',
  },
}

export function MyPropertiesPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [properties, setProperties] = useState<MyProperty[] | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'signin' | 'error'>('loading')

  function loadProperties() {
    setState('loading')
    fetchMyProperties()
      .then((p) => { setProperties(p); setState('ready') })
      .catch((error) => {
        const message = error instanceof Error ? error.message : ''
        setState(/unauth|forbidden|sign in|session|401|403/i.test(message) ? 'signin' : 'error')
      })
  }

  useEffect(() => {
    loadProperties()
  }, [])

  const go = (hash: string) => (window.location.hash = hash)

  return (
    <main style={styles.page} dir={isAr ? 'rtl' : 'ltr'}>
      <button style={styles.back} onClick={() => go('/synitres')}>← {t.back}</button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      {state === 'loading' ? <p style={styles.muted}>{t.loading}</p> : null}
      {state === 'signin' ? (
        <div style={styles.card}>
          <p style={styles.muted}>{t.signIn}</p>
          <button style={styles.primary} onClick={() => go('/sell')}>{t.addListing}</button>
        </div>
      ) : null}
      {state === 'error' ? (
        <div style={styles.card} role="alert"><p style={styles.muted}>{t.error}</p><button style={styles.primary} onClick={loadProperties}>{t.retry}</button></div>
      ) : null}

      {state === 'ready' && properties && properties.length === 0 ? (
        <div style={styles.card}>
          <p style={styles.muted}>{t.empty}</p>
          <button style={styles.primary} onClick={() => go('/sell')}>{t.addListing}</button>
        </div>
      ) : null}

      {state === 'ready' && properties && properties.length > 0 ? (
        <div style={styles.list}>
          {properties.map((p) => {
            const a = realEstateAttrs(p)
            const isDraft = p.status === 'DRAFT' || p.status === 'REJECTED'
            return (
              <article key={p.id} style={styles.row}>
                <div style={styles.rowMain}>
                  <div style={styles.rowTop}>
                    <span style={{ ...styles.divisionPill, ...(p.division === 'BUY' ? styles.buyPill : styles.rentPill) }}>{p.division === 'BUY' ? t.buy : t.rent}</span>
                    <span style={styles.statusPill}>{statusText(p.status, lang)}</span>
                    {p.inquiryCount > 0 ? (
                      <button
                        style={styles.inquiryPill}
                        title={t.openInbox}
                        onClick={() => { sessionStorage.setItem(SYNITRES_INQUIRY_FOCUS_LISTING_KEY, p.id); go('/host/seller/inquiries') }}
                      >💬 {p.inquiryCount} {t.inquiries}</button>
                    ) : null}
                  </div>
                  <strong style={styles.name}>{listingTitleText(p, lang)}</strong>
                  <span style={styles.meta} dir="ltr">
                    {moneyText(p.priceMinor, p.currency, lang)}
                    {a.bedrooms !== undefined ? ` · 🛏 ${a.bedrooms}` : ''}
                    {a.sizeSqm !== undefined ? ` · 📐 ${a.sizeSqm}` : ''}
                    {a.location ? ` · 📍 ${a.location}` : ''}
                  </span>
                </div>
                <div style={styles.rowActions}>
                  {p.status === 'APPROVED' ? <a style={styles.actionLink} href={`#/property/${p.id}`}>{t.viewPage}</a> : null}
                  {isDraft ? (
                    <button
                      style={styles.actionBtn}
                      onClick={() => { sessionStorage.setItem(SYNITRES_EDIT_LISTING_KEY, p.id); go('/sell/listing-wizard') }}
                    >{t.edit}</button>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      ) : null}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 860, margin: '0 auto', padding: '18px 16px 60px', display: 'grid', gap: 10 },
  back: { justifySelf: 'start', background: 'transparent', border: 'none', color: colors.green, fontWeight: 800, cursor: 'pointer', fontSize: 15, padding: 0 },
  title: { fontSize: 26, margin: '6px 0 0', color: colors.ink },
  subtitle: { color: colors.muted, margin: '0 0 8px', fontSize: 14 },
  muted: { color: colors.muted, fontSize: 14, margin: 0 },
  card: { border: `1px solid ${colors.line}`, borderRadius: 12, background: colors.bg2, padding: 18, display: 'grid', gap: 12, justifyItems: 'start' },
  list: { display: 'grid', gap: 10 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', border: `1px solid ${colors.line}`, borderRadius: 12, background: colors.bg2, padding: 14 },
  rowMain: { display: 'grid', gap: 6, flex: 1, minWidth: 220 },
  rowTop: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  divisionPill: { fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '2px 10px' },
  buyPill: { background: withAlpha(colors.green, 0.15), color: colors.green },
  rentPill: { background: withAlpha(colors.blue, 0.15), color: '#8fb0ff' },
  statusPill: { fontSize: 11, fontWeight: 800, color: colors.muted, border: `1px solid ${colors.line}`, borderRadius: 999, padding: '2px 10px' },
  inquiryPill: { fontSize: 11, fontWeight: 800, color: '#f7c05b', background: 'transparent', border: `1px solid ${withAlpha('#f7c05b', 0.4)}`, borderRadius: 999, padding: '3px 10px', cursor: 'pointer' },
  name: { fontSize: 16, color: colors.ink },
  meta: { color: colors.muted, fontSize: 13 },
  rowActions: { display: 'flex', gap: 8, alignItems: 'center' },
  actionLink: { color: colors.green, fontWeight: 800, fontSize: 13, textDecoration: 'none', border: `1px solid ${withAlpha(colors.green, 0.5)}`, borderRadius: 8, padding: '7px 12px' },
  actionBtn: { color: colors.ink, fontWeight: 800, fontSize: 13, background: colors.bg2, border: `1px solid ${colors.line}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer' },
  primary: { minHeight: 44, borderRadius: 10, border: 'none', background: colors.green, color: '#04211d', fontWeight: 900, padding: '0 18px', cursor: 'pointer' },
}

export default MyPropertiesPage
