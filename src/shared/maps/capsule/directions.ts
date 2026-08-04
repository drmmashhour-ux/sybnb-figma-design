// Directions / GPS hand-off — part of the isolated map capsule. PURE: no platform deps.
//
// These return plain map-app links. Opening the Google/Apple/OSM maps app or website is FREE —
// it does NOT use the paid Google Maps API and cannot charge a card. On a phone the OS routes
// the link into the native maps app, which then uses the device's real GPS, live traffic, and
// voice turn-by-turn to the destination.

/** Turn-by-turn navigation to a destination. Opens the device's native maps/GPS app. */
export function directionsUrl(lat: number, lng: number): string {
  // Universal directions link — Google Maps handles it on Android/desktop and hands off to
  // Apple Maps on iOS when Google Maps isn't installed.
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}

/** Plain "show this point" link on OpenStreetMap (no navigation, just the location). */
export function mapViewUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
}

/** True when a coordinate pair is real/finite and can be mapped or navigated to. */
export function hasMapCoords(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
}
