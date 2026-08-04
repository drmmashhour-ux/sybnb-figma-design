import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { labelFor, SYRIA_GOVERNORATES } from '../../engines/search/syriaData'

// Plain min/max number inputs for year and mileage -- the chip-based VisualFilterPanel system
// (used for carBody/carBrand/carFuel/carTransmission/condition) is structurally a discrete-option
// selector and can't express a numeric range, so these two facets get their own small component
// instead of a fancier range-slider that wasn't asked for.
export type CarNumericFilters = {
  model: string
  minYear: string
  maxYear: string
  minMileageKm: string
  maxMileageKm: string
  // Search radius (025/Carcad Phase F) -- kept as a plain string like the other numeric fields;
  // '' means no radius filter. The center point itself lives in CarBrowsePage.tsx (geolocation or
  // governorate fallback), not here.
  radiusKm: string
}

export const emptyCarNumericFilters: CarNumericFilters = {
  model: '',
  minYear: '',
  maxYear: '',
  minMileageKm: '',
  maxMileageKm: '',
  radiusKm: '',
}

export const RADIUS_OPTIONS_KM = ['5', '10', '25', '50', '100']

type Props = {
  lang: Lang
  value: CarNumericFilters
  onChange: (next: CarNumericFilters) => void
  // Search radius controls (025/Carcad Phase F). Center-point resolution (geolocation vs
  // governorate fallback) lives in the parent CarBrowsePage.tsx -- this component only reports the
  // user's radius/governorate choices upward and reflects the current geolocation status.
  geoStatus: 'idle' | 'locating' | 'done' | 'denied' | 'error'
  hasCenterPoint: boolean
  onUseMyLocation: () => void
  fallbackGovernorate: string
  onFallbackGovernorateChange: (governorateKey: string) => void
}

const copy = {
  ar: {
    title: 'تصفية إضافية',
    model: 'الموديل',
    modelPlaceholder: 'Corolla',
    year: 'سنة الصنع',
    mileage: 'الممشى (كم)',
    from: 'من',
    to: 'إلى',
    radiusTitle: 'البحث حسب المسافة',
    radiusLabel: 'نطاق البحث',
    anyDistance: 'أي مسافة',
    useMyLocation: 'استخدام موقعي الحالي',
    locating: 'جارِ تحديد الموقع...',
    geoDenied: 'تعذر الوصول للموقع. اختر المحافظة بدلاً من ذلك.',
    governorateFallback: 'أو اختر المحافظة',
  },
  en: {
    title: 'More filters',
    model: 'Model',
    modelPlaceholder: 'Corolla',
    year: 'Year',
    mileage: 'Mileage (km)',
    from: 'From',
    to: 'To',
    radiusTitle: 'Search by distance',
    radiusLabel: 'Search radius',
    anyDistance: 'Any distance',
    useMyLocation: 'Use my current location',
    locating: 'Locating...',
    geoDenied: 'Could not access your location. Choose a governorate instead.',
    governorateFallback: 'Or choose a governorate',
  },
}

export function CarFilterFields({
  lang,
  value,
  onChange,
  geoStatus,
  hasCenterPoint,
  onUseMyLocation,
  fallbackGovernorate,
  onFallbackGovernorateChange,
}: Props) {
  const t = copy[lang]

  function set(patch: Partial<CarNumericFilters>) {
    onChange({ ...value, ...patch })
  }

  return (
    <section style={styles.panel}>
      <strong>{t.title}</strong>
      <label style={styles.field}>
        <span>{t.model}</span>
        <input dir="ltr" onChange={(event) => set({ model: event.target.value })} placeholder={t.modelPlaceholder} value={value.model} />
      </label>
      <div style={styles.rangeRow}>
        <span style={styles.rangeLabel}>{t.year}</span>
        <input aria-label={`${t.year} — ${t.from}`} dir="ltr" inputMode="numeric" onChange={(event) => set({ minYear: event.target.value })} placeholder={t.from} style={styles.rangeInput} value={value.minYear} />
        <input aria-label={`${t.year} — ${t.to}`} dir="ltr" inputMode="numeric" onChange={(event) => set({ maxYear: event.target.value })} placeholder={t.to} style={styles.rangeInput} value={value.maxYear} />
      </div>
      <div style={styles.rangeRow}>
        <span style={styles.rangeLabel}>{t.mileage}</span>
        <input aria-label={`${t.mileage} — ${t.from}`} dir="ltr" inputMode="numeric" onChange={(event) => set({ minMileageKm: event.target.value })} placeholder={t.from} style={styles.rangeInput} value={value.minMileageKm} />
        <input aria-label={`${t.mileage} — ${t.to}`} dir="ltr" inputMode="numeric" onChange={(event) => set({ maxMileageKm: event.target.value })} placeholder={t.to} style={styles.rangeInput} value={value.maxMileageKm} />
      </div>
      <div style={styles.radiusBlock}>
        <span style={styles.rangeLabel}>{t.radiusTitle}</span>
        <label style={styles.field}>
          <span>{t.radiusLabel}</span>
          <select onChange={(event) => set({ radiusKm: event.target.value })} value={value.radiusKm}>
            <option value="">{t.anyDistance}</option>
            {RADIUS_OPTIONS_KM.map((km) => (
              <option key={km} value={km}>
                {km} km
              </option>
            ))}
          </select>
        </label>
        <button disabled={geoStatus === 'locating'} onClick={onUseMyLocation} type="button">
          {geoStatus === 'locating' ? t.locating : t.useMyLocation}
        </button>
        {(geoStatus === 'denied' || geoStatus === 'error') && !hasCenterPoint && (
          <>
            <span style={styles.geoHint}>{t.geoDenied}</span>
            <label style={styles.field}>
              <span>{t.governorateFallback}</span>
              <select onChange={(event) => onFallbackGovernorateChange(event.target.value)} value={fallbackGovernorate}>
                <option value="">—</option>
                {SYRIA_GOVERNORATES.map((item) => (
                  <option key={item.key} value={item.key}>
                    {labelFor(lang, item)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: { border: '1px solid #242735', borderRadius: 16, background: '#111118', padding: 14, display: 'grid', gap: 10, color: '#fff' },
  field: { display: 'grid', gap: 6 },
  rangeRow: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center' },
  rangeLabel: { color: '#9aa6ba', fontWeight: 850, fontSize: 13 },
  rangeInput: { minHeight: 40, border: '1px solid #30384d', borderRadius: 10, background: '#0c1220', color: '#fff', padding: '0 10px' },
  radiusBlock: { display: 'grid', gap: 8, borderTop: '1px solid #242735', paddingTop: 10 },
  geoHint: { color: '#e0a94a', fontSize: 13 },
}
