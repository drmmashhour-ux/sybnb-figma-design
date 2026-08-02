import { db } from '../lib/prisma.mjs'
import { requireAuth, requireRoadReadyDriver } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { assertBoundedString, assertNoUnknownFields } from '../lib/validate.mjs'
import { deleteDriverDocument, readDriverDocument, saveDriverDocument } from '../lib/driver-document-storage.mjs'
import { rideRatingSummary } from '../lib/sr-ratings.mjs'
import { chargeCompletedRide, srRideFinanceSplit } from '../lib/sr-payments.mjs'
import { assertVehicleEligible } from '../lib/fleet.mjs'
import { assertSyriaCoords } from '../lib/sr-geocoding.mjs'

const DRIVER_DOCUMENT_TYPES = ['LICENSE', 'VEHICLE_REGISTRATION', 'INSURANCE']
// SECURITY (015): the private assetUrl/storage key is NEVER returned in JSON — bytes stream only via /file.
const DRIVER_DOCUMENT_SAFE_SELECT = {
  id: true, driverUserId: true, type: true, mimeType: true, status: true,
  reviewedById: true, reviewedAt: true, createdAt: true, updatedAt: true,
}

export async function handleDriver(req, res, url, context) {
  // SR DRIVER PRESENCE (Phase 1): go online/offline. Only a fully-vetted (road-ready) driver may go
  // ONLINE; going offline is always allowed. Optionally pins the driver's current location in the same
  // call so they start receiving nearby offers immediately.
  if (url.pathname === '/api/driver/availability') {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['DRIVER'])
    const body = await readJson(req)
    assertNoUnknownFields(body, ['online', 'lat', 'lng'], 'driver availability body')
    const online = Boolean(body.online)
    if (online) await requireRoadReadyDriver(context)
    const coords =
      body.lat != null && body.lng != null
        ? assertSyriaCoords(body.lat, body.lng, { fieldName: 'driver location' })
        : null

    // A road-ready driver normally already has a profile; upsert so the toggle is robust either way.
    await db().driverProfile.upsert({
      where: { userId: context.user.id },
      create: { userId: context.user.id, active: online },
      update: { active: online },
    })
    if (online && coords) {
      await db().$executeRaw`
        UPDATE driver_profiles
        SET last_location_geo = ST_SetSRID(ST_MakePoint(${coords.lng}::double precision, ${coords.lat}::double precision), 4326),
            last_location_at = now()
        WHERE user_id::text = ${context.user.id}
      `
    }
    return json(res, 200, { ok: true, online, location: coords ? { lat: coords.lat, lng: coords.lng } : null })
  }

  // Idle location broadcast while online, so dispatch/nearest-first can find the driver. Rejected when
  // the driver is offline (you only advertise your position while available — matches Uber).
  if (url.pathname === '/api/driver/location') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    await requireRoadReadyDriver(context)
    const body = await readJson(req)
    assertNoUnknownFields(body, ['lat', 'lng'], 'driver location body')
    const { lat, lng } = assertSyriaCoords(body.lat, body.lng, { fieldName: 'driver location' })
    const updated = await db().$executeRaw`
      UPDATE driver_profiles
      SET last_location_geo = ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326),
          last_location_at = now()
      WHERE user_id::text = ${context.user.id} AND active = true
    `
    if (updated === 0) {
      const error = new Error('Go online before broadcasting your location.')
      error.statusCode = 409
      error.code = 'DRIVER_OFFLINE'
      error.expose = true
      throw error
    }
    return json(res, 200, { ok: true, location: { lat, lng, at: new Date().toISOString() } })
  }

  if (url.pathname === '/api/driver/rides/pending') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    await requireRoadReadyDriver(context) // SECURITY (015): only fully-vetted drivers can see the rider pool

    // Only ONLINE drivers get offers (Uber). Offline → empty pool + a clear flag for the client.
    const profile = await db().driverProfile.findUnique({
      where: { userId: context.user.id },
      select: { active: true },
    })
    if (!profile?.active) return json(res, 200, { ok: true, online: false, rides: [] })

    // NEAREST-FIRST: order the unassigned pool by real-world distance from the driver's last known
    // location to each ride's pickup (PostGIS geography metres → km). Rides with no pickup coords, or
    // when the driver hasn't shared a location yet, fall back to oldest-first (NULLS LAST). Rider email
    // is never selected — only id + display name reach a driver.
    const rows = await db().$queryRaw`
      SELECT r.id,
             r.fare_minor    AS "fareMinor",
             r.currency,
             r.status,
             r.requested_at  AS "requestedAt",
             r.metadata,
             u.id            AS "riderId",
             u.display_name  AS "riderName",
             CASE
               WHEN dp.last_location_geo IS NOT NULL AND r.pickup_geo IS NOT NULL
               -- Great-circle (haversine) km computed straight from the lon/lat values via ST_X/ST_Y.
               -- Deliberately NOT ST_DistanceSphere / a ::geography cast: those need SRID 4326 populated
               -- in spatial_ref_sys, which isn't guaranteed on every PostGIS setup. This mirrors the
               -- codebase's existing JS haversine (sr-geocoding.mjs) and depends on nothing but the
               -- stored coordinates. LEAST/GREATEST clamp the acos argument against float rounding.
               THEN ROUND((6371 * acos(LEAST(1, GREATEST(-1,
                      cos(radians(ST_Y(dp.last_location_geo))) * cos(radians(ST_Y(r.pickup_geo))) *
                        cos(radians(ST_X(r.pickup_geo)) - radians(ST_X(dp.last_location_geo))) +
                      sin(radians(ST_Y(dp.last_location_geo))) * sin(radians(ST_Y(r.pickup_geo)))
                    ))))::numeric, 2)
               ELSE NULL
             END AS "pickupDistanceKm",
             -- Auto-dispatch: this ride is currently offered EXCLUSIVELY to me (accept-now). COALESCE to
             -- false so an OPEN ride (offered_driver_id NULL) is FALSE, not NULL — otherwise "ORDER BY
             -- offeredToMe DESC" would sort NULLs first and push open rides ahead of my own offer.
             COALESCE(r.offered_driver_id::text = ${context.user.id} AND r.offer_expires_at > now(), false) AS "offeredToMe"
      FROM ride_requests r
      JOIN users u ON u.id = r.rider_id
      LEFT JOIN driver_profiles dp ON dp.user_id::text = ${context.user.id}
      WHERE r.driver_id IS NULL AND r.status IN ('REQUESTED', 'MATCHING')
        -- Show a ride only if it's open (no live offer) OR it's offered to ME. Rides in another driver's
        -- exclusive window are hidden until that window lapses, then they open to the nearest-first pool.
        AND (
          r.offered_driver_id IS NULL
          OR r.offer_expires_at IS NULL
          OR r.offer_expires_at <= now()
          OR r.offered_driver_id::text = ${context.user.id}
        )
      ORDER BY "offeredToMe" DESC, "pickupDistanceKm" ASC NULLS LAST, r.requested_at ASC
      LIMIT 20
    `
    const rides = rows.map((row) => ({
      id: row.id,
      fareMinor: row.fareMinor,
      currency: row.currency,
      status: row.status,
      requestedAt: row.requestedAt,
      metadata: row.metadata,
      pickupDistanceKm: row.pickupDistanceKm != null ? Number(row.pickupDistanceKm) : null,
      offeredToMe: Boolean(row.offeredToMe),
      rider: { id: row.riderId, displayName: row.riderName },
    }))
    return json(res, 200, { ok: true, online: true, rides })
  }

  if (url.pathname === '/api/driver/rides') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['DRIVER'])
    const rides = await db().rideRequest.findMany({
      where: { driverId: context.user.id },
      include: {
        rider: {
          // SECURITY: never expose the rider's email to drivers (esp. the whole pending pool). Contact stays in-app.
          select: {
            id: true,
            displayName: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    })
    const completedRides = rides.filter((ride) => ride.status === 'COMPLETED')
    // updatedAt is Prisma's @updatedAt column, last written on the COMPLETED transition itself
    // (that status is terminal — see assertDriverRideTransition — so no later write can move it
    // again), which makes it a reliable stand-in for "completed at" without a dedicated column.
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)
    const completedToday = completedRides.filter((ride) => ride.updatedAt >= todayStart)

    return json(res, 200, {
      ok: true,
      overview: {
        driver: {
          id: context.user.id,
          email: context.user.email,
          displayName: context.user.displayName,
          roles: context.roles,
          idDocumentStatus: context.user.idDocumentStatus,
        },
        totals: {
          assigned: rides.length,
          active: rides.filter((ride) => ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS'].includes(ride.status)).length,
          completed: completedRides.length,
          // SR money (016): driver earnings are the 85% NET (after the 15% platform commission), not the gross fare.
          earningsMinor: completedRides.reduce((sum, ride) => sum + srRideFinanceSplit(ride.fareMinor).driverEarningMinor, 0),
          todayCompletedCount: completedToday.length,
          todayEarningsMinor: completedToday.reduce((sum, ride) => sum + srRideFinanceSplit(ride.fareMinor).driverEarningMinor, 0),
        },
        rides,
      },
    })
  }

  const rideMatch = url.pathname.match(/^\/api\/driver\/rides\/([^/]+)\/status$/)
  if (rideMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    await requireRoadReadyDriver(context) // SECURITY (015): only fully-vetted drivers can progress a ride
    const body = await readJson(req)
    const nextStatus = normalizeDriverRideStatus(body.status || body.action)
    const existing = await db().rideRequest.findFirst({
      where: { id: rideMatch[1], driverId: context.user.id },
    })

    if (!existing) {
      const error = new Error('Ride not found for this driver account.')
      error.statusCode = 404
      error.code = 'DRIVER_RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }

    assertDriverRideTransition(existing.status, nextStatus)

    // CANCELLATION (019): a DRIVER cancel never charges the rider. Instead of killing the ride, it is
    // re-dispatched to the pool (same ride id, so the rider keeps their request) and the cancellation is
    // recorded for accountability. The cancelling driver is blocked from re-claiming it (see claim guard).
    if (nextStatus === 'CANCELLED') {
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null
      const result = await db().$transaction(async (tx) => {
        const claim = await tx.rideRequest.updateMany({
          where: { id: existing.id, status: existing.status, driverId: context.user.id },
          // Back to the pool: clear the driver, the grace anchor, and the PIN verification for the next driver.
          data: { status: 'REQUESTED', driverId: null, driverMatchedAt: null, pickupVerifiedAt: null },
        })
        if (claim.count === 0) return { conflict: true }
        await tx.driverCancellation.create({ data: { rideId: existing.id, driverId: context.user.id, reason } })
        return { conflict: false }
      })
      if (result.conflict) {
        const error = new Error('Ride status changed before this update could apply. Reload and try again.')
        error.statusCode = 409
        error.code = 'DRIVER_RIDE_STATUS_CONFLICT'
        error.expose = true
        throw error
      }
      const ride = await db().rideRequest.findUnique({ where: { id: existing.id } })
      return json(res, 200, { ok: true, ride, redispatched: true })
    }

    // PICKUP PIN (017): the trip can't start until the driver has confirmed the rider's 4-digit code.
    if (nextStatus === 'IN_PROGRESS' && !existing.pickupVerifiedAt) {
      const error = new Error('Enter the rider’s 4-digit pickup code before starting the trip.')
      error.statusCode = 409
      error.code = 'PICKUP_NOT_VERIFIED'
      error.expose = true
      throw error
    }

    // SR money (016): the COMPLETED transition also CHARGES the ride, in ONE transaction — a ride is never
    // marked complete without settling, nor settled without being complete. The updateMany WHERE-guard makes
    // the transition exactly-once; chargeCompletedRide is independently idempotency-keyed on the ride id.
    const transition = await db().$transaction(async (tx) => {
      const claim = await tx.rideRequest.updateMany({
        where: { id: existing.id, status: existing.status },
        data: { status: nextStatus },
      })
      if (claim.count === 0) return { conflict: true }
      if (nextStatus === 'COMPLETED') {
        const fresh = await tx.rideRequest.findUnique({ where: { id: existing.id } })
        await chargeCompletedRide(tx, fresh)
      }
      return { conflict: false }
    })

    if (transition.conflict) {
      const error = new Error('Ride status changed before this update could apply. Reload and try again.')
      error.statusCode = 409
      error.code = 'DRIVER_RIDE_STATUS_CONFLICT'
      error.expose = true
      throw error
    }

    const ride = await db().rideRequest.findUnique({
      where: { id: existing.id },
      include: {
        rider: {
          // SECURITY: never expose the rider's email to drivers (esp. the whole pending pool). Contact stays in-app.
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: `DRIVER_${nextStatus}`,
        entityType: 'ride_requests',
        entityId: ride.id,
        before: existing,
        after: ride,
      },
    })

    return json(res, 200, { ok: true, ride })
  }

  // ---- SR TRUST (015): driver vetting documents ----
  if (url.pathname === '/api/driver/documents') {
    if (req.method === 'POST') {
      requireAuth(context, ['DRIVER']) // uploading is allowed pre-verification; working rides is not
      const body = await readJson(req)
      assertNoUnknownFields(body, ['type', 'fileBase64', 'mimeType'], 'driver document body')
      const type = String(body.type || '')
      if (!DRIVER_DOCUMENT_TYPES.includes(type)) {
        const error = new Error('type must be LICENSE, VEHICLE_REGISTRATION, or INSURANCE.')
        error.statusCode = 400
        error.code = 'DRIVER_DOCUMENT_TYPE_INVALID'
        error.expose = true
        throw error
      }
      const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
      const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
      if (!fileBase64 || !mimeType) {
        const error = new Error('A driver document file is required.')
        error.statusCode = 400
        error.code = 'DRIVER_DOCUMENT_REQUIRED'
        error.expose = true
        throw error
      }
      const storageKey = await saveDriverDocument(fileBase64, mimeType)
      const previous = await db().driverDocument.findUnique({
        where: { driverUserId_type: { driverUserId: context.user.id, type } }, select: { assetUrl: true },
      })
      const document = await db().driverDocument.upsert({
        where: { driverUserId_type: { driverUserId: context.user.id, type } },
        create: { driverUserId: context.user.id, type, assetUrl: storageKey, mimeType, status: 'PENDING_REVIEW' },
        update: { assetUrl: storageKey, mimeType, status: 'PENDING_REVIEW', reviewedById: null, reviewedAt: null },
        select: DRIVER_DOCUMENT_SAFE_SELECT,
      })
      if (previous?.assetUrl && previous.assetUrl !== storageKey) await deleteDriverDocument(previous.assetUrl)
      return json(res, 201, { ok: true, document })
    }
    if (req.method === 'GET') {
      requireAuth(context, ['DRIVER'])
      const documents = await db().driverDocument.findMany({
        where: { driverUserId: context.user.id }, select: DRIVER_DOCUMENT_SAFE_SELECT, orderBy: { createdAt: 'desc' },
      })
      return json(res, 200, { ok: true, documents })
    }
    return methodNotAllowed(res, ['POST', 'GET'])
  }

  const driverDocFileMatch = url.pathname.match(/^\/api\/driver\/documents\/([^/]+)\/file$/)
  if (driverDocFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const document = await db().driverDocument.findUnique({
      where: { id: driverDocFileMatch[1] }, select: { driverUserId: true, assetUrl: true, mimeType: true },
    })
    if (!document) {
      const error = new Error('Driver document not found.')
      error.statusCode = 404
      error.code = 'DRIVER_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }
    const isOwner = document.driverUserId === context.user.id
    const isStaff = context.roles.includes('ADMIN') || context.roles.includes('SUPPORT')
    if (!isOwner && !isStaff) {
      const error = new Error('This document is not available for this account.')
      error.statusCode = 403
      error.code = 'DRIVER_DOCUMENT_FORBIDDEN'
      error.expose = true
      throw error
    }
    const buffer = await readDriverDocument(document.assetUrl)
    res.writeHead(200, { 'content-type': document.mimeType || 'application/octet-stream', 'cache-control': 'private, no-store' })
    res.end(buffer)
    return true
  }

  // ---- SR MONEY (016): the driver's own rating summary ----
  // ---- FLEET (020): a driver registers/lists their vehicle records (age-gated by tier) ----
  if (url.pathname === '/api/driver/vehicles') {
    if (req.method === 'POST') {
      requireAuth(context, ['DRIVER'])
      const body = await readJson(req)
      assertNoUnknownFields(body, ['make', 'model', 'year', 'plate', 'color', 'category'], 'vehicle body')
      const make = assertBoundedString(body.make, { fieldName: 'make', maxLength: 60 })
      const model = assertBoundedString(body.model, { fieldName: 'model', maxLength: 60 })
      const plate = assertBoundedString(body.plate, { fieldName: 'plate', maxLength: 20 })
      const color = body.color ? assertBoundedString(body.color, { fieldName: 'color', maxLength: 30 }) : null
      const category = String(body.category || '')
      const year = Number(body.year)
      if (!make || !model || !plate) {
        const error = new Error('Vehicle make, model, and plate are required.')
        error.statusCode = 400
        error.code = 'VEHICLE_INPUT_INVALID'
        error.expose = true
        throw error
      }
      // Uber-style age gate (server-side): rejects a car too old for its tier BEFORE it can be reviewed.
      assertVehicleEligible({ category, year })
      const vehicle = await db().driverVehicle.create({
        data: { driverId: context.user.id, make, model, year, plate, color, category, status: 'PENDING_REVIEW' },
      })
      return json(res, 201, { ok: true, vehicle })
    }
    if (req.method === 'GET') {
      requireAuth(context, ['DRIVER'])
      const vehicles = await db().driverVehicle.findMany({
        where: { driverId: context.user.id },
        orderBy: { createdAt: 'desc' },
      })
      return json(res, 200, { ok: true, vehicles })
    }
    return methodNotAllowed(res, ['POST', 'GET'])
  }

  if (url.pathname === '/api/driver/rating') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['DRIVER'])
    return json(res, 200, { ok: true, rating: await rideRatingSummary(context.user.id) })
  }

  return false
}

function normalizeDriverRideStatus(value) {
  const status = String(value || '').toUpperCase()
  if (['DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(status)) return status

  const error = new Error('status must be DRIVER_ARRIVING, IN_PROGRESS, COMPLETED, or CANCELLED.')
  error.statusCode = 400
  error.code = 'INVALID_DRIVER_RIDE_STATUS'
  error.expose = true
  throw error
}

function assertDriverRideTransition(currentStatus, nextStatus) {
  const allowed = {
    DRIVER_ASSIGNED: ['DRIVER_ARRIVING', 'CANCELLED'],
    DRIVER_ARRIVING: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  }

  if (allowed[currentStatus]?.includes(nextStatus)) return

  const error = new Error(`Cannot move ride from ${currentStatus} to ${nextStatus}.`)
  error.statusCode = 400
  error.code = 'INVALID_DRIVER_RIDE_TRANSITION'
  error.expose = true
  throw error
}
