import { db } from './prisma.mjs'

// SR auto-dispatch (Phase 2): when a ride is requested, offer it to the NEAREST online driver for a
// short exclusive window before it opens to the wider nearest-first pool. Isolated SR capsule — depends
// only on the DB. Distance is haversine-in-SQL on ST_X/ST_Y (portable; no spatial_ref_sys dependency,
// matching the nearest-first pool in driver.mjs).

// Exclusive window (seconds) the offered driver has to accept before the ride opens to everyone.
export const OFFER_WINDOW_SECONDS = Number(process.env.SR_OFFER_WINDOW_SECONDS ?? 20)
// Don't offer a ride to a driver further than this from the pickup (km).
const MAX_OFFER_RADIUS_KM = Number(process.env.SR_OFFER_MAX_KM ?? 10)
// Ignore drivers whose last GPS fix is older than this (minutes) — they may have closed the app.
const LOCATION_FRESH_MINUTES = Number(process.env.SR_LOCATION_FRESH_MIN ?? 5)

const ACTIVE_RIDE_STATUSES = "('DRIVER_ASSIGNED','DRIVER_ARRIVING','IN_PROGRESS')"

// Nearest ONLINE driver with a fresh location within range of the pickup, who isn't already on a ride.
// Returns { driverId, distanceKm } or null. Never throws — dispatch is best-effort; if it can't find a
// driver the ride simply stays in the open pool for anyone to claim.
export async function findNearestOnlineDriver(pickup, client = db()) {
  if (!pickup || typeof pickup.lat !== 'number' || typeof pickup.lng !== 'number') return null
  try {
    const rows = await client.$queryRawUnsafe(
      `
      SELECT dp.user_id AS "driverId",
             (6371 * acos(LEAST(1, GREATEST(-1,
               cos(radians(ST_Y(dp.last_location_geo))) * cos(radians($1)) *
                 cos(radians($2) - radians(ST_X(dp.last_location_geo))) +
               sin(radians(ST_Y(dp.last_location_geo))) * sin(radians($1))
             )))) AS "distanceKm"
      FROM driver_profiles dp
      WHERE dp.active = true
        AND dp.last_location_geo IS NOT NULL
        AND dp.last_location_at IS NOT NULL
        AND dp.last_location_at > now() - ($3 * interval '1 minute')
        AND NOT EXISTS (
          SELECT 1 FROM ride_requests r
          WHERE r.driver_id = dp.user_id AND r.status IN ${ACTIVE_RIDE_STATUSES}
        )
      ORDER BY "distanceKm" ASC
      LIMIT 1
      `,
      pickup.lat,
      pickup.lng,
      LOCATION_FRESH_MINUTES,
    )
    const row = rows[0]
    if (!row) return null
    const distanceKm = Number(row.distanceKm)
    if (!Number.isFinite(distanceKm) || distanceKm > MAX_OFFER_RADIUS_KM) return null
    return { driverId: row.driverId, distanceKm: Math.round(distanceKm * 10) / 10 }
  } catch (error) {
    console.error('[sr-dispatch] nearest-driver lookup failed (ride stays open pool):', error?.message || error)
    return null
  }
}

// Offer a freshly-created ride to the nearest online driver (best-effort). Sets offeredDriverId +
// offerExpiresAt so that driver gets an exclusive window; on no driver found, leaves it open.
export async function offerRideToNearestDriver(rideId, pickup, client = db()) {
  const nearest = await findNearestOnlineDriver(pickup, client)
  if (!nearest) return null
  await client.rideRequest.update({
    where: { id: rideId },
    data: {
      offeredDriverId: nearest.driverId,
      offerExpiresAt: new Date(Date.now() + OFFER_WINDOW_SECONDS * 1000),
    },
  })
  return nearest
}
