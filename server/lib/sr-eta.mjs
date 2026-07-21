// SIR ETA (027): a real per-tier "in N min" estimate, computed only from drivers who are actually
// online (recently pinged, server/routes/driver.mjs's PATCH /api/driver/location) and road-ready
// (ID + LICENSE + VEHICLE_REGISTRATION all APPROVED, mirroring requireRoadReadyDriver) with an
// APPROVED vehicle in that category. If no qualifying driver is nearby, the category simply gets no
// ETA -- never a fabricated number. Distance uses the same haversine + flat-speed model already
// established for in-trip ETA (shareEtaMinutes, server/routes/sr-rides.mjs), not routed/live-traffic
// time, since this platform has no routing engine.
import { db } from './prisma.mjs'
import { haversineKm } from './sr-geocoding.mjs'

// A ping older than this is treated as the driver having gone offline (app closed/backgrounded)
// even if they never explicitly toggled off.
export const DRIVER_ONLINE_STALE_MS = 2 * 60 * 1000
const SR_AVG_SPEED_KMH = 30
// Consider only drivers within a plausible dispatch radius -- a driver 80km away isn't a real match.
const MAX_MATCH_RADIUS_KM = 25

export async function computeCategoryEtas(pickupCoords) {
  if (!pickupCoords || typeof pickupCoords.lat !== 'number' || typeof pickupCoords.lng !== 'number') return null

  const staleCutoff = new Date(Date.now() - DRIVER_ONLINE_STALE_MS)
  const rows = await db().$queryRaw`
    SELECT dv.category AS category,
           ST_Y(dp.last_location_geo::geometry) AS lat,
           ST_X(dp.last_location_geo::geometry) AS lng
    FROM driver_profiles dp
    JOIN users u ON u.id::text = dp.user_id::text
    JOIN driver_vehicles dv ON dv.driver_id::text = dp.user_id::text AND dv.status = 'APPROVED'
    WHERE dp.active = true
      AND dp.last_location_geo IS NOT NULL
      AND dp.updated_at >= ${staleCutoff}
      AND u.status = 'ACTIVE'
      AND u.id_document_status = 'APPROVED'
      AND EXISTS (
        SELECT 1 FROM driver_documents dd
        WHERE dd.driver_user_id::text = dp.user_id::text AND dd.status = 'APPROVED' AND dd.type = 'LICENSE'
      )
      AND EXISTS (
        SELECT 1 FROM driver_documents dd2
        WHERE dd2.driver_user_id::text = dp.user_id::text AND dd2.status = 'APPROVED' AND dd2.type = 'VEHICLE_REGISTRATION'
      )
  `

  const bestKmByCategory = {}
  for (const row of rows) {
    if (row.lat == null || row.lng == null) continue
    const km = haversineKm(pickupCoords, { lat: row.lat, lng: row.lng })
    if (km > MAX_MATCH_RADIUS_KM) continue
    if (bestKmByCategory[row.category] === undefined || km < bestKmByCategory[row.category]) {
      bestKmByCategory[row.category] = km
    }
  }

  const etaByCategory = {}
  for (const [category, km] of Object.entries(bestKmByCategory)) {
    etaByCategory[category] = Math.max(1, Math.ceil((km / SR_AVG_SPEED_KMH) * 60))
  }
  return etaByCategory
}
