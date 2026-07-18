import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchApprovedListings, type ListingSearchFilters, type PlatformListing } from '../../shared/api/platformApi'
import { listingDescriptionText, listingTitleText, moneyText, statusText } from '../../shared/i18n/display'
import { UnifiedSearchBar } from '../search/UnifiedSearchBar'
import type { UnifiedSearchValue } from '../search/UnifiedSearchBar'
import { CarFilterFields, emptyCarNumericFilters, type CarNumericFilters } from './CarFilterFields'
import { CarComparisonModal } from './CarComparisonModal'
import { DealRatingBadge } from './DealRatingBadge'
import { GOVERNORATE_CENTERS } from './governorateCenters'
import { formatCountdown, useCountdown } from './useCountdown'

type Props = {
  lang: Lang
}

const COMPARE_LIMIT = 4
const CARS_PLACEHOLDER = '/assets/divisions/cars.webp'

const copy = {
  ar: {
    ready: 'جاهز للبحث عن سيارة',
    title: 'بحث السيارات',
    body: 'اختر الماركة والموديل والسنة والممشى والسعر، ثم قارن بين عدة سيارات قبل التواصل مع البائع.',
    liveResults: 'نتائج مباشرة من قاعدة البيانات',
    resultTitle: 'السيارات المتاحة',
    loading: 'تحميل',
    empty: 'لا توجد سيارات مطابقة',
    error: 'تعذر تحميل النتائج',
    price: 'السعر',
    details: 'عرض التفاصيل',
    compare: 'مقارنة',
    selected: 'محدد',
    compareBarPrefix: 'تم اختيار',
    compareBarSuffix: 'سيارات للمقارنة',
    compareAction: 'مقارنة الآن',
    compareLimit: `يمكن مقارنة ${COMPARE_LIMIT} سيارات كحد أقصى في المرة الواحدة.`,
    auctionBadge: 'مزاد',
    currentBid: 'السعر الحالي',
  },
  en: {
    ready: 'Ready to search for a car',
    title: 'Car search',
    body: 'Pick make, model, year, mileage, and price, then compare several cars before contacting the seller.',
    liveResults: 'Live results from the database',
    resultTitle: 'Available cars',
    loading: 'Loading',
    empty: 'No matching cars',
    error: 'Could not load results',
    price: 'Price',
    details: 'View details',
    compare: 'Compare',
    selected: 'selected',
    compareBarPrefix: '',
    compareBarSuffix: 'cars selected for comparison',
    compareAction: 'Compare now',
    compareLimit: `You can compare up to ${COMPARE_LIMIT} cars at a time.`,
    auctionBadge: 'Auction',
    currentBid: 'Current bid',
  },
}

function AuctionCountdown({ endsAt, isAr }: { endsAt: string; isAr: boolean }) {
  const countdown = useCountdown(endsAt)
  return <small>{formatCountdown(countdown, isAr)}</small>
}

function carImage(listing: PlatformListing) {
  const mediaUrl = listing.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  return typeof mediaUrl === 'string' ? mediaUrl : CARS_PLACEHOLDER
}

function toListingSearchFilters(
  value: UnifiedSearchValue | null,
  numeric: CarNumericFilters,
  centerPoint: { lat: number; lng: number } | null,
): ListingSearchFilters {
  const minYear = numeric.minYear ? Number(numeric.minYear) : undefined
  const maxYear = numeric.maxYear ? Number(numeric.maxYear) : undefined
  const minMileageKm = numeric.minMileageKm ? Number(numeric.minMileageKm) : undefined
  const maxMileageKm = numeric.maxMileageKm ? Number(numeric.maxMileageKm) : undefined
  const radiusKm = numeric.radiusKm ? Number(numeric.radiusKm) : undefined
  // The radius filter only applies once both a center point (geolocation or governorate fallback)
  // and a chosen radius are present -- a radius alone with no center point is meaningless.
  const hasRadius = centerPoint && Number.isFinite(radiusKm) && radiusKm !== undefined
  return {
    governorate: value?.governorate || undefined,
    city: value?.city || undefined,
    area: value?.area || undefined,
    minPrice: value?.minPrice ? Number(value.minPrice) : undefined,
    maxPrice: value?.maxPrice ? Number(value.maxPrice) : undefined,
    sort: value?.sort === 'priceLow' ? 'priceAsc' : value?.sort === 'priceHigh' ? 'priceDesc' : undefined,
    make: value?.carBrand && value.carBrand !== 'any' ? value.carBrand : undefined,
    transmission: value?.carTransmission && value.carTransmission !== 'any' ? value.carTransmission : undefined,
    fuelType: value?.carFuel && value.carFuel !== 'any' ? value.carFuel : undefined,
    condition: value?.condition && value.condition !== 'any' ? value.condition : undefined,
    model: numeric.model || undefined,
    minYear: Number.isFinite(minYear) ? minYear : undefined,
    maxYear: Number.isFinite(maxYear) ? maxYear : undefined,
    minMileageKm: Number.isFinite(minMileageKm) ? minMileageKm : undefined,
    maxMileageKm: Number.isFinite(maxMileageKm) ? maxMileageKm : undefined,
    centerLat: hasRadius ? centerPoint.lat : undefined,
    centerLng: hasRadius ? centerPoint.lng : undefined,
    radiusKm: hasRadius ? radiusKm : undefined,
  }
}

export function CarBrowsePage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [listings, setListings] = useState<PlatformListing[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [lastSearch, setLastSearch] = useState<UnifiedSearchValue | null>(null)
  const [numericFilters, setNumericFilters] = useState<CarNumericFilters>(emptyCarNumericFilters)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [compareOpen, setCompareOpen] = useState(false)
  // Search radius (025/Carcad Phase F): center point comes from browser geolocation first, falling
  // back to a governorate-capital coordinate if geolocation is denied/unavailable.
  const [centerPoint, setCenterPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [geoStatus, setGeoStatus] = useState<'idle' | 'locating' | 'done' | 'denied' | 'error'>('idle')
  const [fallbackGovernorate, setFallbackGovernorate] = useState('')

  async function runSearch(searchValue: UnifiedSearchValue | null, numeric: CarNumericFilters, center: { lat: number; lng: number } | null) {
    setStatus('loading')
    setLastSearch(searchValue)
    try {
      const results = await fetchApprovedListings('CARS', toListingSearchFilters(searchValue, numeric, center))
      setListings(results)
      setStatus('ready')
    } catch {
      setListings([])
      setStatus('error')
    }
  }

  function updateNumericFilters(next: CarNumericFilters) {
    setNumericFilters(next)
    void runSearch(lastSearch, next, centerPoint)
  }

  function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('error')
      return
    }
    setGeoStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude }
        setCenterPoint(point)
        setGeoStatus('done')
        void runSearch(lastSearch, numericFilters, point)
      },
      () => setGeoStatus('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  function chooseFallbackGovernorate(governorateKey: string) {
    setFallbackGovernorate(governorateKey)
    const point = GOVERNORATE_CENTERS[governorateKey] || null
    setCenterPoint(point)
    void runSearch(lastSearch, numericFilters, point)
  }

  function toggleSelected(listingId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(listingId)) {
        next.delete(listingId)
      } else if (next.size < COMPARE_LIMIT) {
        next.add(listingId)
      }
      return next
    })
  }

  function openListing(listing: PlatformListing) {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('sybnb-v6-listing-return-path', '/cars')
    }
    window.location.hash = `/listing/${listing.id}`
  }

  const selectedListings = listings.filter((listing) => selectedIds.has(listing.id))

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} className="search-experience">
      <section className="search-hero">
        <div>
          <p>{t.ready}</p>
          <h1>{t.title}</h1>
          <span>{t.body}</span>
        </div>
        <div className="search-hero-metrics" aria-label={isAr ? 'حالة البحث' : 'Search status'}>
          <strong>{listings.length}</strong>
          <small>{t.liveResults}</small>
        </div>
      </section>

      <UnifiedSearchBar lang={lang} initialDivision="cars" lockedDivision onSearch={(value) => void runSearch(value, numericFilters, centerPoint)} />

      <CarFilterFields
        fallbackGovernorate={fallbackGovernorate}
        geoStatus={geoStatus}
        hasCenterPoint={centerPoint !== null}
        lang={lang}
        onChange={updateNumericFilters}
        onFallbackGovernorateChange={chooseFallbackGovernorate}
        onUseMyLocation={useMyLocation}
        value={numericFilters}
      />

      {status === 'loading' && <p style={styles.statusLine}>{t.loading}</p>}
      {status === 'error' && <p style={styles.statusLine}>{t.error}</p>}

      <section className="search-results">
        <div className="search-results-head">
          <span>{t.resultTitle}</span>
          <strong>{listings.length}</strong>
        </div>
        {listings.length ? (
          <div className="search-result-grid">
            {listings.map((listing) => {
              const vehicle = (listing.metadata as { vehicle?: Record<string, unknown> }).vehicle || {}
              return (
                <article key={listing.id} className="search-result-card">
                  <img alt="" loading="lazy" src={carImage(listing)} />
                  <div className="search-result-body">
                    <span className="search-result-status">{statusText(listing.status, lang)}</span>
                    <h2>{listingTitleText(listing, lang)}</h2>
                    <p>{listingDescriptionText(listing, lang)}</p>
                    <div style={styles.specGrid}>
                      {vehicle.year != null && <span>{String(vehicle.year)}</span>}
                      {vehicle.mileageKm != null && <span>{Number(vehicle.mileageKm).toLocaleString(isAr ? 'ar-SY' : 'en-US')} km</span>}
                      {vehicle.transmission != null && <span>{String(vehicle.transmission)}</span>}
                      {vehicle.fuelType != null && <span>{String(vehicle.fuelType)}</span>}
                    </div>
                    <div className="search-result-meta">
                      {listing.auction ? (
                        <>
                          <span style={styles.auctionBadge}>{t.auctionBadge}</span>
                          <span>{t.currentBid}</span>
                          <strong dir="ltr">{moneyText(listing.auction.currentPriceMinor, listing.currency, lang)}</strong>
                          <AuctionCountdown endsAt={listing.auction.endsAt} isAr={isAr} />
                        </>
                      ) : (
                        <>
                          <span>{t.price}</span>
                          <strong dir="ltr">{moneyText(listing.priceMinor, listing.currency, lang)}</strong>
                        </>
                      )}
                      <DealRatingBadge dealRating={listing.dealRating} lang={lang} />
                    </div>
                    <label style={styles.compareCheckbox}>
                      <input
                        checked={selectedIds.has(listing.id)}
                        onChange={() => toggleSelected(listing.id)}
                        type="checkbox"
                      />
                      {t.compare}
                    </label>
                    <div className="search-result-actions">
                      <button onClick={() => openListing(listing)} type="button">
                        {t.details}
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        ) : status !== 'loading' ? (
          <p className="search-empty-copy">{t.empty}</p>
        ) : null}
      </section>

      {selectedIds.size >= 2 && (
        <div style={styles.compareTray}>
          <span>
            {isAr
              ? `${t.compareBarPrefix} ${selectedIds.size} ${t.compareBarSuffix}`
              : `${selectedIds.size} ${t.compareBarSuffix}`}
          </span>
          <button onClick={() => setCompareOpen(true)} style={styles.compareTrayButton} type="button">
            {t.compareAction}
          </button>
        </div>
      )}
      {selectedIds.size >= COMPARE_LIMIT && <p style={styles.statusLine}>{t.compareLimit}</p>}

      {compareOpen && (
        <CarComparisonModal lang={lang} listings={selectedListings} onClose={() => setCompareOpen(false)} />
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  statusLine: { color: '#9aa6ba', textAlign: 'center' },
  specGrid: { display: 'flex', gap: 8, flexWrap: 'wrap', color: '#9aa6ba', fontSize: 13, fontWeight: 850 },
  auctionBadge: { display: 'inline-flex', borderRadius: 999, border: '1px solid #526cff', background: 'rgba(82,108,255,.18)', color: '#8fa0ff', padding: '2px 10px', fontSize: 12, fontWeight: 900 },
  compareCheckbox: { display: 'flex', gap: 8, alignItems: 'center', color: '#fff', fontWeight: 850 },
  compareTray: {
    position: 'fixed',
    bottom: 20,
    insetInline: 0,
    marginInline: 'auto',
    width: 'fit-content',
    display: 'flex',
    gap: 14,
    alignItems: 'center',
    border: '1px solid #30384d',
    borderRadius: 999,
    background: '#111118',
    color: '#fff',
    padding: '10px 18px',
    boxShadow: '0 20px 45px rgba(0,0,0,.4)',
    zIndex: 40,
  },
  compareTrayButton: { minHeight: 40, border: 0, borderRadius: 999, background: '#526cff', color: '#fff', padding: '0 18px', fontWeight: 950 },
}
