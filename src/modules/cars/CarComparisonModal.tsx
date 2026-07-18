import type { CSSProperties, ReactNode } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../../shared/api/platformApi'
import { listingTitleText, moneyText } from '../../shared/i18n/display'
import { DealRatingBadge } from './DealRatingBadge'

// Nothing like a "compare selected listings" feature exists anywhere else in this codebase for
// any division -- this is new. Purely client-side: the listings passed in are already fully
// fetched (GET /api/listings already returns complete metadata for every result), so no separate
// endpoint is needed just to render a comparison table.
type Props = {
  lang: Lang
  listings: PlatformListing[]
  onClose: () => void
}

const copy = {
  ar: {
    title: 'مقارنة السيارات',
    close: 'إغلاق',
    price: 'السعر',
    make: 'الماركة',
    model: 'الموديل',
    year: 'سنة الصنع',
    mileage: 'الممشى (كم)',
    transmission: 'ناقل الحركة',
    fuel: 'الوقود',
    condition: 'الحالة',
    dealRating: 'تقييم السعر',
  },
  en: {
    title: 'Compare cars',
    close: 'Close',
    price: 'Price',
    make: 'Make',
    model: 'Model',
    year: 'Year',
    mileage: 'Mileage (km)',
    transmission: 'Transmission',
    fuel: 'Fuel',
    condition: 'Condition',
    dealRating: 'Deal rating',
  },
}

function vehicleField(listing: PlatformListing, key: string) {
  const metadata = listing.metadata as { vehicle?: Record<string, unknown> } & Record<string, unknown>
  const vehicle = metadata.vehicle || {}
  const value = (vehicle as Record<string, unknown>)[key] ?? metadata[key]
  return value === undefined || value === null || value === '' ? '—' : String(value)
}

export function CarComparisonModal({ lang, listings, onClose }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'

  const rows: Array<{ label: string; render: (listing: PlatformListing) => ReactNode }> = [
    { label: t.price, render: (listing) => moneyText(listing.priceMinor, listing.currency, lang) },
    {
      label: t.dealRating,
      render: (listing) => (listing.dealRating?.tier ? <DealRatingBadge dealRating={listing.dealRating} lang={lang} /> : '—'),
    },
    { label: t.make, render: (listing) => vehicleField(listing, 'make') },
    { label: t.model, render: (listing) => vehicleField(listing, 'model') },
    { label: t.year, render: (listing) => vehicleField(listing, 'year') },
    { label: t.mileage, render: (listing) => vehicleField(listing, 'mileageKm') },
    { label: t.transmission, render: (listing) => vehicleField(listing, 'transmission') },
    { label: t.fuel, render: (listing) => vehicleField(listing, 'fuelType') },
    { label: t.condition, render: (listing) => vehicleField(listing, 'condition') },
  ]

  return (
    <div dir={isAr ? 'rtl' : 'ltr'} style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div style={styles.header}>
          <strong>{t.title}</strong>
          <button onClick={onClose} style={styles.closeButton} type="button">
            {t.close}
          </button>
        </div>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.headCell} />
                {listings.map((listing) => (
                  <th key={listing.id} style={styles.headCell}>
                    {listingTitleText(listing, lang)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td style={styles.labelCell}>{row.label}</td>
                  {listings.map((listing) => (
                    <td key={listing.id} style={styles.valueCell}>
                      {row.render(listing)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 },
  modal: { background: '#111118', border: '1px solid #242735', borderRadius: 16, padding: 18, maxWidth: 960, width: '100%', maxHeight: '80vh', overflow: 'hidden', display: 'grid', gap: 14 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' },
  closeButton: { minHeight: 38, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', padding: '0 14px', fontWeight: 900 },
  tableWrap: { overflow: 'auto' },
  table: { borderCollapse: 'collapse', width: '100%', color: '#fff' },
  headCell: { textAlign: 'start', padding: '10px 12px', borderBottom: '1px solid #242735', whiteSpace: 'nowrap', fontWeight: 950 },
  labelCell: { padding: '10px 12px', color: '#9aa6ba', fontWeight: 850, whiteSpace: 'nowrap' },
  valueCell: { padding: '10px 12px', borderBottom: '1px solid #1c2030' },
}
