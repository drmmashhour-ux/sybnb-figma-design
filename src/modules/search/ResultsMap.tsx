import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../../shared/api/platformApi'
import { listingMapTarget } from '../../shared/maps/googleMapCapsule'
import { listingTitleText } from '../../shared/i18n/display'

// Airbnb-style results map — 100% free OpenStreetMap, no API key, no billing, no charges.
// The map is a keyless OSM embed centred on the searched area (or the average of the stays that
// carry coordinates). No Google Maps: no card, no key, nothing to bill.

type Pin = { id: string; lat: number; lng: number }

const DAMASCUS = { lat: 33.5138, lng: 36.2765 }

function pinsFromListings(listings: PlatformListing[], lang: Lang): Pin[] {
  const pins: Pin[] = []
  for (const listing of listings) {
    const target = listingMapTarget(listing, listingTitleText(listing, lang), lang)
    if (!target.hasCoordinates) continue
    const [lat, lng] = target.query.split(',').map(Number)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    pins.push({ id: listing.id, lat, lng })
  }
  return pins
}

export function ResultsMap({ listings, lang }: { listings: PlatformListing[]; lang: Lang }) {
  const isAr = lang === 'ar'
  const pins = useMemo(() => pinsFromListings(listings, lang), [listings, lang])

  const center = pins.length
    ? { lat: pins.reduce((sum, pin) => sum + pin.lat, 0) / pins.length, lng: pins.reduce((sum, pin) => sum + pin.lng, 0) / pins.length }
    : DAMASCUS

  const span = pins.length ? 0.06 : 0.09
  const bbox = `${center.lng - span},${center.lat - span},${center.lng + span},${center.lat + span}`
  const osmSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${center.lat}%2C${center.lng}`

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
      <iframe
        title={isAr ? 'خريطة' : 'Map'}
        src={osmSrc}
        style={styles.frame}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { border: '1px solid #263146', borderRadius: 18, background: '#10141f', overflow: 'hidden', margin: '4px 0' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 16px', color: '#fff' },
  headNote: { color: '#9aa6ba', fontWeight: 800 },
  frame: { border: 0, width: '100%', height: 340, display: 'block' },
}
