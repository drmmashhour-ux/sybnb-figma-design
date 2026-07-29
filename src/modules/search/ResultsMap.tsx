import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../../shared/api/platformApi'
import { listingMapTarget } from '../../shared/maps/googleMapCapsule'
import { listingTitleText, moneyText } from '../../shared/i18n/display'
import { sypMinorToRoundedUsdMinor } from '../../shared/currency'
import { PinsMap, DEFAULT_CENTER, type MapPin } from '../../shared/maps/capsule'
import { governorateCenter } from '../../engines/search/governorateCenters'

// STR adapter for the isolated map capsule: turns STR listings (with prices + i18n) into plain
// MapPins and renders the capsule's <PinsMap>. All platform-specific formatting lives here so the
// capsule itself stays portable (see src/shared/maps/capsule/README.md).

function pinsFromListings(listings: PlatformListing[], lang: Lang): MapPin[] {
  const isAr = lang === 'ar'
  const pins: MapPin[] = []
  for (const listing of listings) {
    const target = listingMapTarget(listing, listingTitleText(listing, lang), lang)
    if (!target.hasCoordinates) continue
    const [lat, lng] = target.query.split(',').map(Number)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const priceMinor = listing.currency === 'SYP' ? sypMinorToRoundedUsdMinor(listing.priceMinor) : listing.priceMinor
    const currency = listing.currency === 'SYP' ? 'USD' : listing.currency
    const title = listingTitleText(listing, lang)
    pins.push({
      id: listing.id,
      lat,
      lng,
      popupHtml: `<div style="color:#111;font-weight:700;max-width:200px">${title}<br/>${moneyText(priceMinor, currency, lang)} / ${isAr ? 'ليلة' : 'night'}</div>`,
    })
  }
  return pins
}

export function ResultsMap({
  listings,
  lang,
  governorate,
}: {
  listings: PlatformListing[]
  lang: Lang
  governorate?: string
}) {
  const isAr = lang === 'ar'
  const pins = useMemo(() => pinsFromListings(listings, lang), [listings, lang])

  // When there are listing pins the capsule fits to them. When there are none, centre the map on
  // the searched governorate so the map follows the search instead of sitting on the default view.
  const searchCenter = governorateCenter(governorate)
  const center = searchCenter || DEFAULT_CENTER

  return (
    <section style={styles.wrap} aria-label={isAr ? 'خريطة النتائج' : 'Results map'}>
      <div style={styles.head}>
        <strong>{isAr ? 'الخريطة' : 'Map'}</strong>
        <small style={styles.headNote}>
          {pins.length
            ? isAr ? `${pins.length} على الخريطة` : `${pins.length} on the map`
            : isAr ? 'عرض المنطقة' : 'Area view'}
        </small>
      </div>
      <PinsMap pins={pins} defaultCenter={center} defaultZoom={searchCenter ? 12 : 11} style={styles.frame} />
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { border: '1px solid #263146', borderRadius: 18, background: '#10141f', overflow: 'hidden', margin: '4px 0' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 16px', color: '#fff' },
  headNote: { color: '#9aa6ba', fontWeight: 800 },
  frame: { width: '100%', height: 340, display: 'block' },
}
