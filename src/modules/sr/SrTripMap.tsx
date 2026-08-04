import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DEFAULT_CENTER, OSM_TILES } from '../../shared/maps/capsule'

// SR live trip map — the "smarter than Uber" map, built on the free OSM/Leaflet capsule (no Google).
// This is SR-only platform glue (like ResultsMap is the STR adapter): it uses the capsule's generic
// OSM tiles + Damascus default, and draws the trip — pickup + dropoff pins, the OSRM road-route
// polyline, and the driver's LIVE position (moved via setLatLng each tick, never re-panning the map so
// nearby updates don't fight Leaflet's animation, per the map-capsule notes).

type Coords = { lat: number; lng: number }

type Props = {
  pickup?: Coords | null
  dropoff?: Coords | null
  driver?: Coords | null // live driver position (updates every poll)
  route?: Array<[number, number]> | null // OSRM GeoJSON coords: [lng, lat][]
  height?: number
}

const PICKUP_STYLE: L.CircleMarkerOptions = { radius: 9, color: '#0f766e', weight: 2, fillColor: '#14b8a6', fillOpacity: 1 }
const DROPOFF_STYLE: L.CircleMarkerOptions = { radius: 9, color: '#b45309', weight: 2, fillColor: '#f59e0b', fillOpacity: 1 }
const DRIVER_STYLE: L.CircleMarkerOptions = { radius: 10, color: '#1d4ed8', weight: 3, fillColor: '#3b82f6', fillOpacity: 1 }
const ROUTE_STYLE: L.PolylineOptions = { color: '#14b8a6', weight: 5, opacity: 0.85 }

export function SrTripMap({ pickup, dropoff, driver, route, height = 320 }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const staticLayerRef = useRef<L.LayerGroup | null>(null)
  const driverMarkerRef = useRef<L.CircleMarker | null>(null)

  // Init the map exactly once.
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return
    const center = pickup || driver || DEFAULT_CENTER
    const map = L.map(boxRef.current, { center: [center.lat, center.lng], zoom: 13, scrollWheelZoom: false })
    L.tileLayer(OSM_TILES.url, { maxZoom: OSM_TILES.maxZoom, attribution: OSM_TILES.attribution }).addTo(map)
    staticLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      staticLayerRef.current = null
      driverMarkerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Redraw the static trip layer (pickup, dropoff, route) whenever any of them change, and fit the view
  // to everything. animate:false avoids the competing-pan bug the capsule documents.
  useEffect(() => {
    const map = mapRef.current
    const layer = staticLayerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const bounds: Array<[number, number]> = []

    if (route && route.length > 1) {
      const latlngs = route.map(([lng, lat]) => [lat, lng] as [number, number])
      L.polyline(latlngs, ROUTE_STYLE).addTo(layer)
      bounds.push(...latlngs)
    }
    if (pickup) {
      L.circleMarker([pickup.lat, pickup.lng], PICKUP_STYLE).addTo(layer)
      bounds.push([pickup.lat, pickup.lng])
    }
    if (dropoff) {
      L.circleMarker([dropoff.lat, dropoff.lng], DROPOFF_STYLE).addTo(layer)
      bounds.push([dropoff.lat, dropoff.lng])
    }
    if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32], animate: false })
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 14, { animate: false })
    }
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, route])

  // Move the live driver marker in place — do NOT re-pan the map on every GPS tick.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!driver) {
      driverMarkerRef.current?.remove()
      driverMarkerRef.current = null
      return
    }
    if (!driverMarkerRef.current) {
      driverMarkerRef.current = L.circleMarker([driver.lat, driver.lng], DRIVER_STYLE).addTo(map)
    } else {
      driverMarkerRef.current.setLatLng([driver.lat, driver.lng])
    }
  }, [driver?.lat, driver?.lng])

  return <div ref={boxRef} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden' }} aria-label="SR trip map" />
}

export default SrTripMap
