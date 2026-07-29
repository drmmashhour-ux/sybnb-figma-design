import { useEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../../shared/api/platformApi'
import { listingMapTarget } from '../../shared/maps/googleMapCapsule'
import { listingTitleText, moneyText } from '../../shared/i18n/display'
import { sypMinorToRoundedUsdMinor } from '../../shared/currency'

// Airbnb-style results map — 100% free, self-contained Leaflet + OpenStreetMap raster tiles.
// No API key, no billing, no card, no cross-origin embed page. Tiles come straight from
// tile.openstreetmap.org and Leaflet is bundled into the app, so the map always renders and
// carries a real pin per stay (with a price popup).

type Pin = { id: string; lat: number; lng: number; title: string; priceMinor: number; currency: string }

const DAMASCUS = { lat: 33.5138, lng: 36.2765 }

function pinsFromListings(listings: PlatformListing[], lang: Lang): Pin[] {
  const pins: Pin[] = []
  for (const listing of listings) {
    const target = listingMapTarget(listing, listingTitleText(listing, lang), lang)
    if (!target.hasCoordinates) continue
    const [lat, lng] = target.query.split(',').map(Number)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    pins.push({
      id: listing.id,
      lat,
      lng,
      title: listingTitleText(listing, lang),
      priceMinor: listing.currency === 'SYP' ? sypMinorToRoundedUsdMinor(listing.priceMinor) : listing.priceMinor,
      currency: listing.currency === 'SYP' ? 'USD' : listing.currency,
    })
  }
  return pins
}

export function ResultsMap({ listings, lang }: { listings: PlatformListing[]; lang: Lang }) {
  const isAr = lang === 'ar'
  const pins = useMemo(() => pinsFromListings(listings, lang), [listings, lang])
  const boxRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  // Create the map once.
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return
    const map = L.map(boxRef.current, {
      center: [DAMASCUS.lat, DAMASCUS.lng],
      zoom: 11,
      scrollWheelZoom: false,
      attributionControl: true,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // Leaflet needs a size recalculation once the container has painted.
    setTimeout(() => map.invalidateSize(), 0)
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // Draw/refresh pins whenever the results change.
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    if (!pins.length) {
      map.setView([DAMASCUS.lat, DAMASCUS.lng], 11)
      return
    }
    const latLngs: L.LatLngExpression[] = []
    for (const pin of pins) {
      latLngs.push([pin.lat, pin.lng])
      L.circleMarker([pin.lat, pin.lng], {
        radius: 9,
        color: '#0f766e',
        weight: 2,
        fillColor: '#14b8a6',
        fillOpacity: 0.9,
      })
        .bindPopup(
          `<div style="color:#111;font-weight:700;max-width:200px">${pin.title}<br/>${moneyText(pin.priceMinor, pin.currency, lang)} / ${isAr ? 'ليلة' : 'night'}</div>`,
        )
        .addTo(layer)
    }
    if (pins.length === 1) map.setView(latLngs[0], 13)
    else map.fitBounds(L.latLngBounds(latLngs).pad(0.2))
  }, [pins, lang, isAr])

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
      <div ref={boxRef} style={styles.frame} />
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { border: '1px solid #263146', borderRadius: 18, background: '#10141f', overflow: 'hidden', margin: '4px 0' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 16px', color: '#fff' },
  headNote: { color: '#9aa6ba', fontWeight: 800 },
  frame: { width: '100%', height: 340, display: 'block' },
}
