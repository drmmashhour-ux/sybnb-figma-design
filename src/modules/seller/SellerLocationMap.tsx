import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'

const pinIcon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

type Props = {
  latitude: number
  longitude: number
  onMove: (lat: number, lng: number) => void
}

export function SellerLocationMap({ latitude, longitude, onMove }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current).setView([latitude, longitude], 14)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    const marker = L.marker([latitude, longitude], { icon: pinIcon, draggable: true }).addTo(map)
    marker.on('dragend', () => {
      const position = marker.getLatLng()
      onMoveRef.current(position.lat, position.lng)
    })
    map.on('click', (event: L.LeafletMouseEvent) => {
      marker.setLatLng(event.latlng)
      onMoveRef.current(event.latlng.lat, event.latlng.lng)
    })
    mapRef.current = map
    markerRef.current = marker
    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // Map is created once; subsequent latitude/longitude updates are applied via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the marker (and view, for jumps like switching governorate/city) in sync whenever
  // latitude/longitude change from outside the map itself -- e.g. the manual lat/lng text inputs,
  // or picking a different governorate/city recentering the draft. A click/drag on the map already
  // matches this position by the time the parent's state updates, so this is a no-op in that case.
  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!map || !marker) return
    const current = marker.getLatLng()
    if (Math.abs(current.lat - latitude) > 1e-6 || Math.abs(current.lng - longitude) > 1e-6) {
      marker.setLatLng([latitude, longitude])
      map.setView([latitude, longitude], map.getZoom())
    }
  }, [latitude, longitude])

  return <div ref={containerRef} className="seller-map-leaflet" role="application" />
}
