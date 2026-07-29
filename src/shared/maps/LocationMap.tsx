import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Single-location Leaflet + OpenStreetMap map (free, no API key, no billing). Renders one marker
// at the given coordinates. Self-contained tiles from tile.openstreetmap.org — no embed iframe.

export function LocationMap({ lat, lng, label, style }: { lat: number; lng: number; label?: string; style?: CSSProperties }) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return
    const map = L.map(boxRef.current, {
      center: [lat, lng],
      zoom: 14,
      scrollWheelZoom: false,
      attributionControl: true,
    })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)
    const marker = L.circleMarker([lat, lng], {
      radius: 10,
      color: '#0f766e',
      weight: 2,
      fillColor: '#14b8a6',
      fillOpacity: 0.9,
    }).addTo(map)
    if (label) marker.bindPopup(`<div style="color:#111;font-weight:700;max-width:220px">${label}</div>`)
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 0)
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [lat, lng, label])

  return <div ref={boxRef} style={style} />
}
