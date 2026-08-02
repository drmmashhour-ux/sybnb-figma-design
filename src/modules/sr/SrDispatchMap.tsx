import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { DEFAULT_CENTER, OSM_TILES } from '../../shared/maps/capsule'
import type { SrDispatchDriver, SrDispatchRide } from '../../shared/api/platformApi'

// SR admin live-ops map (SR-only glue on the free OSM/Leaflet capsule): every waiting/active ride pickup
// and every online driver, colour-coded. Markers refit on each poll; no per-tick re-pan fighting.

type Props = { rides: SrDispatchRide[]; drivers: SrDispatchDriver[]; height?: number }

const RIDE_WAITING: L.CircleMarkerOptions = { radius: 8, color: '#0f766e', weight: 2, fillColor: '#14b8a6', fillOpacity: 0.95 }
const RIDE_ASSIGNED: L.CircleMarkerOptions = { radius: 8, color: '#1d4ed8', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.95 }
const DRIVER_FREE: L.CircleMarkerOptions = { radius: 7, color: '#166534', weight: 2, fillColor: '#22c55e', fillOpacity: 0.95 }
const DRIVER_BUSY: L.CircleMarkerOptions = { radius: 7, color: '#b45309', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.95 }

const esc = (s: string | null) => String(s || '').replace(/[<>&"]/g, '')

export function SrDispatchMap({ rides, drivers, height = 420 }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return
    const map = L.map(boxRef.current, { center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], zoom: 7, scrollWheelZoom: false })
    L.tileLayer(OSM_TILES.url, { maxZoom: OSM_TILES.maxZoom, attribution: OSM_TILES.attribution }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const bounds: Array<[number, number]> = []

    for (const r of rides) {
      const waiting = r.status === 'REQUESTED' || r.status === 'MATCHING'
      L.circleMarker([r.pickup.lat, r.pickup.lng], waiting ? RIDE_WAITING : RIDE_ASSIGNED)
        .bindPopup(`${esc(r.riderName)} · ${esc(r.status)}${r.driverName ? ' · ' + esc(r.driverName) : ''}`)
        .addTo(layer)
      bounds.push([r.pickup.lat, r.pickup.lng])
    }
    for (const d of drivers) {
      L.circleMarker([d.location.lat, d.location.lng], d.busy ? DRIVER_BUSY : DRIVER_FREE)
        .bindPopup(`🚗 ${esc(d.driverName)} · ${d.busy ? 'busy' : 'free'}`)
        .addTo(layer)
      bounds.push([d.location.lat, d.location.lng])
    }
    if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], animate: false })
    else if (bounds.length === 1) map.setView(bounds[0], 13, { animate: false })
  }, [rides, drivers])

  return <div ref={boxRef} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden' }} aria-label="SR dispatch map" />
}

export default SrDispatchMap
