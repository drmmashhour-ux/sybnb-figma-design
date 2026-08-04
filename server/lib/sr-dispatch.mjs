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
// How many nearest drivers a ride is offered to EXCLUSIVELY (one after another, each getting its own
// window) before it falls fully open to the whole nearest-first pool. Bounds the cascade so a ride never
// cycles forever, and so liquidity always wins in a scarce market (after the cascade every nearby driver
// sees it at once).
const MAX_OFFER_HOPS = Number(process.env.SR_OFFER_MAX_HOPS ?? 3)

const ACTIVE_RIDE_STATUSES = "('DRIVER_ASSIGNED','DRIVER_ARRIVING','IN_PROGRESS')"

// Nearest ONLINE driver with a fresh location within range of the pickup, who isn't already on a ride
// and isn't in excludeDriverIds (drivers who already declined this ride). Returns { driverId, distanceKm }
// or null. Never throws — dispatch is best-effort; if it can't find a driver the ride stays in the open
// pool for anyone to claim.
export async function findNearestOnlineDriver(pickup, { excludeDriverIds = [], client = db() } = {}) {
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
        AND dp.user_id::text <> ALL($4::text[])
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
      excludeDriverIds,
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

// The stored pickup coordinates of a ride (from its PostGIS geometry), for re-offering on decline.
export async function ridePickupCoords(rideId, client = db()) {
  try {
    const rows = await client.$queryRaw`
      SELECT ST_Y(pickup_geo) AS lat, ST_X(pickup_geo) AS lng
      FROM ride_requests WHERE id::text = ${rideId} AND pickup_geo IS NOT NULL LIMIT 1
    `
    const row = rows[0]
    return row ? { lat: Number(row.lat), lng: Number(row.lng) } : null
  } catch {
    return null
  }
}

// Offer a ride to the nearest online driver (best-effort), excluding any who've declined. Sets
// offeredDriverId + offerExpiresAt so that driver gets an exclusive window; on no driver found, leaves
// it open.
export async function offerRideToNearestDriver(rideId, pickup, { excludeDriverIds = [], client = db() } = {}) {
  const nearest = await findNearestOnlineDriver(pickup, { excludeDriverIds, client })
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

// AUTO-DISPATCH cascade: advance any ride whose exclusive offer has EXPIRED without being accepted — the
// timed-out driver is recorded (so they're skipped for the next exclusive offer, but NOT hidden from the
// open pool) and the ride is re-offered to the next nearest online driver. After MAX_OFFER_HOPS exclusive
// offers all lapse, the ride is left fully OPEN so the whole nearest-first pool can grab it.
//
// Serverless-native: driven opportunistically off the drivers' pending-ride poll (no cron needed — a
// per-minute cron is far too coarse for a ~20s offer window). Best-effort and NEVER throws — dispatch
// staleness is not a security hole and must never break the poll response.
//
// Concurrency: each advance is a single atomic CAS (updateMany guarded on the exact expired offer
// snapshot), so two drivers polling at once can't double-advance the same ride — the first wins, the
// second matches zero rows and moves on.
export async function sweepExpiredOffers({ client = db() } = {}) {
  try {
    const stale = await client.rideRequest.findMany({
      where: {
        driverId: null,
        status: { in: ['REQUESTED', 'MATCHING'] },
        offeredDriverId: { not: null },
        offerExpiresAt: { lte: new Date() },
      },
      select: { id: true, offeredDriverId: true, offerExpiresAt: true, metadata: true },
      take: 25,
    })
    if (stale.length === 0) return 0

    let advanced = 0
    for (const ride of stale) {
      const meta = ride.metadata && typeof ride.metadata === 'object' ? ride.metadata : {}
      const declinedBy = Array.isArray(meta.declinedBy) ? meta.declinedBy : []
      const priorTimedOut = Array.isArray(meta.offerTimedOut) ? meta.offerTimedOut : []
      // The driver who just let the window lapse joins the timed-out set (skipped for re-offers only).
      const timedOut = priorTimedOut.includes(ride.offeredDriverId) ? priorTimedOut : [...priorTimedOut, ride.offeredDriverId]
      const nextMeta = { ...meta, offerTimedOut: timedOut }

      // Cascade exhausted → leave the ride fully OPEN for the whole nearest-first pool (incl. the drivers
      // who timed out, who can still self-claim from the open pool).
      let data
      if (timedOut.length >= MAX_OFFER_HOPS) {
        data = { offeredDriverId: null, offerExpiresAt: null, metadata: nextMeta }
      } else {
        const pickup = await ridePickupCoords(ride.id, client)
        const next = pickup
          ? await findNearestOnlineDriver(pickup, { excludeDriverIds: [...new Set([...timedOut, ...declinedBy])], client })
          : null
        data = next
          ? { offeredDriverId: next.driverId, offerExpiresAt: new Date(Date.now() + OFFER_WINDOW_SECONDS * 1000), metadata: nextMeta }
          : { offeredDriverId: null, offerExpiresAt: null, metadata: nextMeta } // nobody nearby → open pool
      }

      // Atomic CAS: only advance if the ride is STILL this exact expired offer and unclaimed.
      const claim = await client.rideRequest.updateMany({
        where: { id: ride.id, driverId: null, offeredDriverId: ride.offeredDriverId, offerExpiresAt: ride.offerExpiresAt },
        data,
      })
      if (claim.count > 0) advanced += 1
    }
    return advanced
  } catch (error) {
    console.error('[sr-dispatch] expired-offer sweep failed (rides stay as-is):', error?.message || error)
    return 0
  }
}
