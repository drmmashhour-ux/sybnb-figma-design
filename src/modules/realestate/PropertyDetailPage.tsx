import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchPrototypeListing, type PlatformListing } from '../../shared/api/platformApi'
import { listingDescriptionText, listingTitleText, moneyText, statusText } from '../../shared/i18n/display'
import { colors, withAlpha } from '../../shared/theme/tokens'
import { LocationMap, directionsUrl } from '../../shared/maps/capsule'
import { listingMapTarget } from '../../shared/maps/googleMapCapsule'
import { MortgageCalculator } from './MortgageCalculator'
import { PhotoGallery, listingPhotoUrls } from '../../shared/gallery/PhotoGallery'
import { realEstateAttrs, valuationTone } from './propertyAttrs'
import { SYNITRES_PRESELECT_LISTING_KEY } from '../../shared/nav/synitresHandoff'

type Props = { listingId: string; lang: Lang }

const copy = {
  ar: {
    back: 'كل العقارات', loading: 'جار التحميل…', error: 'تعذّر تحميل هذا العقار.',
    price: 'السعر', type: 'النوع', location: 'الموقع', bedrooms: 'غرف النوم', bathrooms: 'الحمّامات',
    size: 'المساحة', sqm: 'م²', amenities: 'المزايا', status: 'الحالة', owner: 'المالك',
    mapTitle: 'الموقع على الخريطة', getDirections: 'الاتجاهات · GPS',
    belowMarket: 'أقل من سعر السوق', atMarket: 'ضمن سعر السوق', aboveMarket: 'أعلى من سعر السوق', estValue: 'القيمة التقديرية',
    contact: 'اطلب زيارة / تواصل', copy: 'نسخ الرابط', copied: 'تم نسخ الرابط',
  },
  en: {
    back: 'All properties', loading: 'Loading…', error: 'Could not load this property.',
    price: 'Price', type: 'Type', location: 'Location', bedrooms: 'Bedrooms', bathrooms: 'Bathrooms',
    size: 'Size', sqm: 'm²', amenities: 'Amenities', status: 'Status', owner: 'Owner',
    mapTitle: 'Location on map', getDirections: 'Directions · GPS',
    belowMarket: 'Below market', atMarket: 'At market', aboveMarket: 'Above market', estValue: 'Estimated value',
    contact: 'Request a visit / contact', copy: 'Copy link', copied: 'Link copied',
  },
}

export function PropertyDetailPage({ listingId, lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [listing, setListing] = useState<PlatformListing | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setState('loading')
    fetchPrototypeListing(listingId)
      .then((l) => { setListing(l); setState('ready') })
      .catch(() => setState('error'))
  }, [listingId])

  const isBuy = listing?.division === 'BUY'
  const attrs = useMemo(() => (listing ? realEstateAttrs(listing) : null), [listing])
  const mapTarget = useMemo(() => (listing ? listingMapTarget(listing, listingTitleText(listing, lang), lang) : null), [listing, lang])

  const valuationLabel = (() => {
    const tier = listing?.valuation?.tier
    const color = valuationTone(tier)
    if (!color) return null
    const label = tier === 'BELOW_MARKET' ? t.belowMarket : tier === 'AT_MARKET' ? t.atMarket : t.aboveMarket
    return { label, color }
  })()

  function copyLink() {
    try {
      void navigator.clipboard?.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — non-fatal */ }
  }

  function contact() {
    // Route to the division's browse+contact flow (buyer account + document + IMMOContact live there),
    // carrying this exact listing so it opens preselected instead of a blank search.
    if (listing) sessionStorage.setItem(SYNITRES_PRESELECT_LISTING_KEY, listing.id)
    window.location.hash = listing?.division === 'RENTALS' ? '/rentals' : '/buy'
  }

  if (state === 'loading') return <main style={styles.page} dir={isAr ? 'rtl' : 'ltr'}><p style={styles.muted}>{t.loading}</p></main>
  if (state === 'error' || !listing) return <main style={styles.page} dir={isAr ? 'rtl' : 'ltr'}><p style={styles.err}>{t.error}</p></main>

  const [mlat, mlng] = mapTarget?.hasCoordinates ? mapTarget.query.split(',').map(Number) : [NaN, NaN]
  const est = listing.valuation?.estimatedValueMinor
  const photos = listingPhotoUrls(listing, isBuy ? '/assets/divisions/buy-property.webp' : '/assets/divisions/monthly-rental.webp')

  return (
    <main style={styles.page} dir={isAr ? 'rtl' : 'ltr'}>
      <div style={styles.topRow}>
        <button style={styles.back} onClick={() => (window.location.hash = listing.division === 'RENTALS' ? '/rentals' : '/buy')}>← {t.back}</button>
        <button style={styles.copyBtn} onClick={copyLink}>{copied ? t.copied : `🔗 ${t.copy}`}</button>
      </div>

      <PhotoGallery photos={photos} lang={lang} />

      <div style={styles.pillRow}>
        <span style={styles.statusPill}>{statusText(listing.status, lang)}</span>
        {valuationLabel ? <span style={{ ...styles.pill, color: valuationLabel.color, borderColor: withAlpha(valuationLabel.color, 0.5) }}>{valuationLabel.label}</span> : null}
      </div>
      <h1 style={styles.title}>{listingTitleText(listing, lang)}</h1>
      <div style={styles.price} dir="ltr">{moneyText(listing.priceMinor, listing.currency, lang)}</div>
      <p style={styles.desc}>{listingDescriptionText(listing, lang)}</p>

      <section style={styles.grid}>
        {attrs?.propertyType ? <Info label={t.type} value={attrs.propertyType} /> : null}
        {attrs?.location ? <Info label={t.location} value={attrs.location} /> : null}
        {attrs?.bedrooms !== undefined ? <Info label={t.bedrooms} value={String(attrs.bedrooms)} /> : null}
        {attrs?.bathrooms !== undefined ? <Info label={t.bathrooms} value={String(attrs.bathrooms)} /> : null}
        {attrs?.sizeSqm !== undefined ? <Info label={t.size} value={`${attrs.sizeSqm} ${t.sqm}`} /> : null}
        <Info label={t.status} value={statusText(listing.status, lang)} />
        {est ? <Info label={t.estValue} value={moneyText(est, listing.currency, lang)} /> : null}
      </section>

      {attrs?.amenities.length ? (
        <div style={styles.amenities}>
          {attrs.amenities.slice(0, 16).map((a) => <span key={a} style={styles.amenityChip}>{a}</span>)}
        </div>
      ) : null}

      {mapTarget?.hasCoordinates && Number.isFinite(mlat) && Number.isFinite(mlng) ? (
        <section style={styles.card}>
          <strong>{t.mapTitle}</strong>
          <LocationMap lat={mlat} lng={mlng} style={{ height: 260, borderRadius: 12, overflow: 'hidden', border: `1px solid ${colors.line}` }} popupHtml={mapTarget.label ? `<div style="color:#111;font-weight:700;max-width:220px">${mapTarget.label}</div>` : undefined} />
          <div style={styles.mapRow}>
            <span style={styles.muted}>⌖ {mapTarget.label}</span>
            <a href={directionsUrl(mlat, mlng)} target="_blank" rel="noreferrer" style={styles.directionsLink}>{t.getDirections}</a>
          </div>
        </section>
      ) : null}

      {isBuy ? <MortgageCalculator priceMinor={listing.priceMinor} currency={listing.currency} lang={lang} /> : null}

      <button style={styles.contactBtn} onClick={contact}>{t.contact}</button>
    </main>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.info}>
      <span style={styles.infoLabel}>{label}</span>
      <strong style={styles.infoValue}>{value}</strong>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 860, margin: '0 auto', padding: '18px 16px 60px', display: 'grid', gap: 12 },
  topRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  back: { background: 'transparent', border: 'none', color: colors.green, fontWeight: 800, cursor: 'pointer', fontSize: 15, padding: 0 },
  copyBtn: { border: `1px solid ${colors.line}`, background: colors.bg2, color: colors.ink, borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13 },
  pillRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  statusPill: { fontSize: 12, fontWeight: 800, color: colors.muted, border: `1px solid ${colors.line}`, borderRadius: 999, padding: '2px 10px' },
  pill: { fontSize: 12, fontWeight: 800, border: '1px solid', borderRadius: 999, padding: '2px 10px', background: 'transparent' },
  title: { fontSize: 26, margin: 0, color: colors.ink },
  price: { fontSize: 24, fontWeight: 900, color: colors.green, fontVariantNumeric: 'tabular-nums' },
  desc: { color: colors.muted, lineHeight: 1.6, margin: 0 },
  grid: { display: 'grid', gap: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', border: `1px solid ${colors.line}`, borderRadius: 12, overflow: 'hidden' },
  info: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderBottom: `1px solid ${colors.line}` },
  infoLabel: { color: colors.muted, fontSize: 13 },
  infoValue: { color: colors.ink, fontSize: 14 },
  amenities: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  amenityChip: { fontSize: 12, fontWeight: 600, color: colors.ink, background: colors.bg2, border: `1px solid ${colors.line}`, borderRadius: 999, padding: '4px 12px' },
  card: { border: `1px solid ${colors.line}`, borderRadius: 16, background: colors.bg2, padding: 14, display: 'grid', gap: 10 },
  mapRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  directionsLink: { color: colors.green, fontWeight: 800, fontSize: 13, textDecoration: 'none', border: `1px solid ${withAlpha(colors.green, 0.5)}`, borderRadius: 8, padding: '6px 12px' },
  contactBtn: { minHeight: 50, borderRadius: 12, border: 'none', background: colors.green, color: '#04211d', fontWeight: 900, fontSize: 16, cursor: 'pointer', marginTop: 4 },
  muted: { color: colors.muted, fontSize: 13 },
  err: { color: '#dc2626', fontSize: 15 },
}

export default PropertyDetailPage
