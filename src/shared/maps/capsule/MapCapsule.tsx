import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// ─────────────────────────────────────────────────────────────────────────────
// SYBNB MAP CAPSULE — isolated, platform-agnostic map primitives.
//
// ISOLATION CONTRACT: this folder depends ONLY on `leaflet` + `react`. It must
// never import platform types (PlatformListing), i18n, currency, or engine code.
// That is what makes it portable: copy `src/shared/maps/capsule/` into any SYBNB
// platform (STR Syria, STR Canada, …) and it works unchanged. Platform-specific
// glue (turning a listing into pins/labels) lives OUTSIDE the capsule, in an
// adapter such as ResultsMap.tsx.
//
// Free forever: OpenStreetMap raster tiles — no API key, no billing, no card.
// ─────────────────────────────────────────────────────────────────────────────

export type MapCoords = { lat: number; lng: number }
export type MapPin = MapCoords & { id: string; popupHtml?: string }
export type TileConfig = { url: string; attribution: string; maxZoom: number }

// Free OpenStreetMap raster tiles. A platform can pass its own TileConfig to swap
// providers without touching the capsule.
export const OSM_TILES: TileConfig = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
}

// Default centre if a map has no pins yet — Damascus. Override via prop per platform.
export const DEFAULT_CENTER: MapCoords = { lat: 33.5138, lng: 36.2765 }

const PIN_STYLE: L.CircleMarkerOptions = { radius: 9, color: '#0f766e', weight: 2, fillColor: '#14b8a6', fillOpacity: 0.9 }

function addTiles(map: L.Map, tiles: TileConfig) {
  L.tileLayer(tiles.url, { maxZoom: tiles.maxZoom, attribution: tiles.attribution }).addTo(map)
}

/** Single-location map with one marker. */
export function LocationMap({
  lat,
  lng,
  popupHtml,
  zoom = 14,
  tiles = OSM_TILES,
  style,
}: {
  lat: number
  lng: number
  popupHtml?: string
  zoom?: number
  tiles?: TileConfig
  style?: CSSProperties
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return
    const map = L.map(boxRef.current, { center: [lat, lng], zoom, scrollWheelZoom: false })
    addTiles(map, tiles)
    const marker = L.circleMarker([lat, lng], PIN_STYLE).addTo(map)
    if (popupHtml) marker.bindPopup(popupHtml)
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 0)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [lat, lng, popupHtml, zoom, tiles])

  return <div ref={boxRef} style={style} />
}

/** Multi-pin map — one marker per point, auto-fit to bounds. */
export function PinsMap({
  pins,
  defaultCenter = DEFAULT_CENTER,
  defaultZoom = 11,
  tiles = OSM_TILES,
  style,
}: {
  pins: MapPin[]
  defaultCenter?: MapCoords
  defaultZoom?: number
  tiles?: TileConfig
  style?: CSSProperties
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  // Create the map once.
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return
    const map = L.map(boxRef.current, { center: [defaultCenter.lat, defaultCenter.lng], zoom: defaultZoom, scrollWheelZoom: false })
    addTiles(map, tiles)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 0)
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Draw/refresh markers whenever the points change.
  // NB: all view changes here use { animate: false }. These are programmatic syncs that can fire in
  // quick succession (e.g. governorate centre → geocoded place), and competing Leaflet pan/zoom
  // animations for nearby targets can cancel each other and silently leave the map put. A hard,
  // instant setView is deterministic.
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    if (!pins.length) {
      map.setView([defaultCenter.lat, defaultCenter.lng], defaultZoom, { animate: false })
      return
    }
    const latLngs: L.LatLngExpression[] = []
    for (const pin of pins) {
      latLngs.push([pin.lat, pin.lng])
      const marker = L.circleMarker([pin.lat, pin.lng], PIN_STYLE)
      if (pin.popupHtml) marker.bindPopup(pin.popupHtml)
      marker.addTo(layer)
    }
    if (pins.length === 1) map.setView(latLngs[0], 13, { animate: false })
    else map.fitBounds(L.latLngBounds(latLngs).pad(0.2), { animate: false })
  }, [pins, defaultCenter.lat, defaultCenter.lng, defaultZoom])

  return <div ref={boxRef} style={style} />
}
