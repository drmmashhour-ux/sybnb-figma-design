import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import type { PlatformListing } from '../../shared/api/platformApi'
import { listingMapTarget } from '../../shared/maps/googleMapCapsule'
import { listingTitleText, moneyText } from '../../shared/i18n/display'
import { sypMinorToRoundedUsdMinor } from '../../shared/currency'

// Airbnb-style results map.
//  - No API key  → keyless Google embed centred on the searched area (works today).
//  - Key present → Google Maps JS with one pin per stay (fit to bounds, price info window).
// The owner adds VITE_GOOGLE_MAPS_API_KEY to the Vercel env to switch on pins; the component
// upgrades automatically with no code change.

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

// Load the Google Maps JS SDK exactly once per page.
let mapsLoader: Promise<unknown> | null = null
function loadGoogleMaps(apiKey: string): Promise<unknown> {
  const w = window as unknown as { google?: { maps?: unknown } }
  if (w.google?.maps) return Promise.resolve(w.google)
  if (mapsLoader) return mapsLoader
  mapsLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`
    script.async = true
    script.defer = true
    script.onload = () => resolve((window as unknown as { google?: unknown }).google)
    script.onerror = () => reject(new Error('google maps failed to load'))
    document.head.appendChild(script)
  })
  return mapsLoader
}

export function ResultsMap({ listings, lang }: { listings: PlatformListing[]; lang: Lang }) {
  const isAr = lang === 'ar'
  const apiKey = (import.meta.env as Record<string, string | undefined>).VITE_GOOGLE_MAPS_API_KEY || ''
  const pins = useMemo(() => pinsFromListings(listings, lang), [listings, lang])
  const mapRef = useRef<HTMLDivElement | null>(null)
  const [jsFailed, setJsFailed] = useState(false)

  const center = pins.length
    ? { lat: pins.reduce((sum, pin) => sum + pin.lat, 0) / pins.length, lng: pins.reduce((sum, pin) => sum + pin.lng, 0) / pins.length }
    : DAMASCUS

  useEffect(() => {
    if (!apiKey || !mapRef.current) return
    let cancelled = false
    loadGoogleMaps(apiKey)
      .then((googleUnknown) => {
        if (cancelled || !mapRef.current) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const google = googleUnknown as any
        const map = new google.maps.Map(mapRef.current, {
          center,
          zoom: pins.length ? 12 : 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        })
        const bounds = new google.maps.LatLngBounds()
        pins.forEach((pin) => {
          const marker = new google.maps.Marker({ position: { lat: pin.lat, lng: pin.lng }, map, title: pin.title })
          const info = new google.maps.InfoWindow({
            content: `<div style="color:#111;font-weight:700;max-width:200px">${pin.title}<br/>${moneyText(pin.priceMinor, pin.currency, lang)} / ${isAr ? 'ليلة' : 'night'}</div>`,
          })
          marker.addListener('click', () => info.open(map, marker))
          bounds.extend({ lat: pin.lat, lng: pin.lng })
        })
        if (pins.length > 1) map.fitBounds(bounds)
      })
      .catch(() => {
        if (!cancelled) setJsFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [apiKey, pins, center.lat, center.lng, lang, isAr])

  const useEmbed = !apiKey || jsFailed
  const embedSrc = `https://www.google.com/maps?q=${center.lat},${center.lng}&z=${pins.length ? 12 : 11}&output=embed`

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
      {useEmbed ? (
        <iframe
          title={isAr ? 'خريطة' : 'Map'}
          src={embedSrc}
          style={styles.frame}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <div ref={mapRef} style={styles.frame} />
      )}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { border: '1px solid #263146', borderRadius: 18, background: '#10141f', overflow: 'hidden', margin: '4px 0' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 16px', color: '#fff' },
  headNote: { color: '#9aa6ba', fontWeight: 800 },
  frame: { border: 0, width: '100%', height: 340, display: 'block' },
}
