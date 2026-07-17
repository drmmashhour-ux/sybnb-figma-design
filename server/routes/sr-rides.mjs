import crypto from 'node:crypto'
import { db } from '../lib/prisma.mjs'
import { requireAuth, requireVerifiedDriver, requireRoadReadyDriver } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { quoteSrRide, assertSyriaCoords, haversineKm } from '../lib/sr-geocoding.mjs'
import { assertBoundedString, assertNoUnknownFields } from '../lib/validate.mjs'
import { rideRatingSummary } from '../lib/sr-ratings.mjs'
import { assertRiderCanAfford, chargeRiderCancellationFee, placeRideHold, tipCompletedRide } from '../lib/sr-payments.mjs'
import { riderCancelOutcome } from '../lib/sr-cancellation.mjs'
import { assertNotBlockedPair } from '../lib/user-blocks.mjs'

const DRIVER_ACTIVE_RIDE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
const SR_TRACKABLE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
const RIDE_MESSAGING_ACTIVE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']
const SR_AVG_SPEED_KMH = 30
const MAX_PIN_ATTEMPTS = 5

async function ensureDriverHasNoActiveRide(driverId, client = db()) {
  const activeRide = await client.rideRequest.findFirst({
    where: {
      driverId,
      status: { in: DRIVER_ACTIVE_RIDE_STATUSES },
    },
    select: { id: true, status: true },
  })

  if (activeRide) {
    const error = new Error('Driver already has an active ride.')
    error.statusCode = 409
    error.code = 'DRIVER_HAS_ACTIVE_RIDE'
    error.expose = true
    throw error
  }
}

function loadRideOrThrow(ride) {
  if (!ride) {
    const error = new Error('Ride request not found.')
    error.statusCode = 404
    error.code = 'RIDE_NOT_FOUND'
    error.expose = true
    throw error
  }
  return ride
}

function forbidRide() {
  const error = new Error('This ride is not available for this account.')
  error.statusCode = 403
  error.code = 'RIDE_FORBIDDEN'
  error.expose = true
  throw error
}

function coarseTripStatus(status) {
  switch (status) {
    case 'REQUESTED':
    case 'MATCHING': return 'FINDING_DRIVER'
    case 'DRIVER_ASSIGNED':
    case 'DRIVER_ARRIVING': return 'DRIVER_ON_THE_WAY'
    case 'IN_PROGRESS': return 'IN_PROGRESS'
    case 'COMPLETED': return 'COMPLETED'
    case 'CANCELLED': return 'CANCELLED'
    default: return 'UNKNOWN'
  }
}

function shareEtaMinutes(from, dropoffLat, dropoffLng) {
  if (!from || dropoffLat == null || dropoffLng == null) return null
  const km = haversineKm(from, { lat: dropoffLat, lng: dropoffLng })
  return Math.max(1, Math.ceil((km / SR_AVG_SPEED_KMH) * 60))
}

// SAFETY MATCHING EXCLUSION (015): if either party ever flagged the other for safety on a past ride, they
// must never be re-matched. Ratings only exist on COMPLETED rides, so the flag set is stable — reading it
// inside the claim/assign transaction is race-safe.
async function assertNoSafetyBlock(riderId, driverId, client = db()) {
  const block = await client.rideRating.findFirst({
    where: {
      safetyFlag: true,
      OR: [
        { raterUserId: riderId, ratedUserId: driverId },
        { raterUserId: driverId, ratedUserId: riderId },
      ],
    },
    select: { id: true },
  })
  if (block) {
    const error = new Error('This rider and driver cannot be matched again.')
    error.statusCode = 409
    error.code = 'RIDE_SAFETY_BLOCK'
    error.expose = true
    throw error
  }
}

async function loadRideForMessaging(rideId, context, client = db()) {
  const ride = await client.rideRequest.findUnique({ where: { id: rideId } })
  loadRideOrThrow(ride)
  let role
  if (ride.riderId === context.user.id) role = 'RIDER'
  else if (ride.driverId && ride.driverId === context.user.id) role = 'DRIVER'
  else {
    const error = new Error('This ride conversation is not available for this account.')
    error.statusCode = 403
    error.code = 'RIDE_MESSAGE_FORBIDDEN'
    error.expose = true
    throw error
  }
  if (!RIDE_MESSAGING_ACTIVE_STATUSES.includes(ride.status)) {
    const error = new Error('Messaging is only available while the ride is active.')
    error.statusCode = 400
    error.code = 'RIDE_MESSAGING_NOT_ACTIVE'
    error.expose = true
    throw error
  }
  // UGC block (024): a blocked rider/driver pair can't message on the ride either.
  await assertNotBlockedPair(client, ride.riderId, ride.driverId, { code: 'MESSAGE_USER_BLOCK', message: 'You cannot message this user because of a block.', statusCode: 403 })
  return { ride, role }
}

export async function handleSrRides(req, res, url, context) {
  if (url.pathname === '/api/sr/quote') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    const quote = quoteSrRide({
      pickup: body.pickup,
      dropoff: body.dropoff,
      category: body.category,
      lowDataMode: Boolean(body.lowDataMode),
      pickupCoordsOverride: body.pickupCoords,
      dropoffCoordsOverride: body.dropoffCoords,
      currency: body.currency,
    })
    return json(res, 200, { ok: true, quote })
  }

  if (url.pathname === '/api/sr/rides') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    // SR-INPUT: reject unknown fields and bound the free-text so a rider can't persist arbitrary/oversized data.
    assertNoUnknownFields(
      body,
      ['category', 'pickup', 'dropoff', 'lowDataMode', 'pickupCoords', 'dropoffCoords', 'currency', 'pickupLocationId', 'dropoffLocationId'],
      'ride request body',
    )
    const category = String(body.category || 'SR Economy')
    const pickup = assertBoundedString(body.pickup, { fieldName: 'pickup', maxLength: 300 }) || ''
    const dropoff = assertBoundedString(body.dropoff, { fieldName: 'dropoff', maxLength: 300 }) || ''
    const quote = quoteSrRide({
      pickup,
      dropoff,
      category,
      lowDataMode: Boolean(body.lowDataMode),
      pickupCoordsOverride: body.pickupCoords,
      dropoffCoordsOverride: body.dropoffCoords,
      currency: body.currency,
    })

    // BALANCE GATE (016, cashless/Uber): a rider can't request a ride they can't pay for.
    await assertRiderCanAfford(db(), { riderId: context.user.id, currency: quote.currency, fareMinor: quote.fareMinor })

    // PICKUP PIN (017): 4-digit code the rider shares with the driver at pickup to confirm the right rider.
    const pickupPin = String(crypto.randomInt(0, 10000)).padStart(4, '0')

    const ride = await db().rideRequest.create({
      data: {
        riderId: context.user.id,
        pickupLocationId: body.pickupLocationId || undefined,
        dropoffLocationId: body.dropoffLocationId || undefined,
        status: 'REQUESTED',
        fareMinor: quote.fareMinor,
        currency: quote.currency,
        pickupPin,
        metadata: {
          // SR-INPUT: metadata is server-built only — no client-supplied blob is merged in.
          pickup,
          dropoff,
          category,
          distanceKm: quote.distanceKm,
          distanceEstimated: quote.estimated,
        },
      },
    })

    if (quote.pickupCoords || quote.dropoffCoords) {
      await db().$executeRaw`
        UPDATE ride_requests
        SET
          pickup_geo = ${quote.pickupCoords ? `SRID=4326;POINT(${quote.pickupCoords.lng} ${quote.pickupCoords.lat})` : null}::geometry,
          dropoff_geo = ${quote.dropoffCoords ? `SRID=4326;POINT(${quote.dropoffCoords.lng} ${quote.dropoffCoords.lat})` : null}::geometry
        WHERE id::text = ${ride.id}
      `
    }

    return json(res, 201, { ok: true, ride })
  }

  const rideMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)$/)
  if (rideMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const ride = await db().rideRequest.findUnique({ where: { id: rideMatch[1] } })
    if (!ride) {
      const error = new Error('Ride request not found.')
      error.statusCode = 404
      error.code = 'RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (!context.roles.includes('ADMIN') && !context.roles.includes('SUPPORT') && ride.riderId !== context.user.id && ride.driverId !== context.user.id) {
      const error = new Error('This ride is not available for this account.')
      error.statusCode = 403
      error.code = 'RIDE_FORBIDDEN'
      error.expose = true
      throw error
    }
    // PICKUP PIN (017): only the rider ever sees the code — the driver must obtain it from the rider.
    const isRider = ride.riderId === context.user.id
    const safeRide = isRider ? ride : { ...ride, pickupPin: undefined }
    return json(res, 200, { ok: true, ride: safeRide })
  }

  const assignMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/assign-driver$/)
  if (assignMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const body = await readJson(req)
    const driver = await db().user.findFirst({
      where: {
        id: body.driverId,
        roles: { some: { role: 'DRIVER' } },
        status: 'ACTIVE',
        idDocumentStatus: 'APPROVED', // SECURITY: admin may only assign an ID-verified driver
      },
    })

    if (!driver) {
      const error = new Error('Assigned user must be an active, verified SR driver.')
      error.statusCode = 400
      error.code = 'INVALID_DRIVER_ASSIGNMENT'
      error.expose = true
      throw error
    }

    const existing = await db().rideRequest.findUnique({ where: { id: assignMatch[1] } })
    if (!existing || !['REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED'].includes(existing.status)) {
      const error = new Error('Ride is not available for driver assignment.')
      error.statusCode = 400
      error.code = 'RIDE_NOT_ASSIGNABLE'
      error.expose = true
      throw error
    }

    // SECURITY (one-driver-one-ride, race-safe): atomic active-ride check + assign under an advisory lock
    // on the target driver, so an admin-assign can't race the driver's own self-claim into a double booking.
    const assignResult = await db().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${driver.id}))`
      await ensureDriverHasNoActiveRide(driver.id, tx)
      await assertNoSafetyBlock(existing.riderId, driver.id, tx) // SAFETY (015): no re-match of a flagged pair
      await assertNotBlockedPair(tx, existing.riderId, driver.id, { code: 'RIDE_USER_BLOCK', message: 'This rider and driver cannot be matched because of a block.' }) // UGC block (024)
      // BALANCE GATE + HOLD (016): a driver may only be assigned to a ride the rider can still pay for.
      await assertRiderCanAfford(tx, {
        riderId: existing.riderId, currency: existing.currency, fareMinor: existing.fareMinor,
        excludeRideId: existing.id, message: 'Cannot assign a driver: the rider wallet no longer covers the fare.',
      })
      // Re-check status in the WHERE clause (optimistic concurrency): if another admin/support agent
      // assigned a driver to this ride between our read and this write, this matches zero rows instead
      // of silently overwriting their assignment.
      const updated = await tx.rideRequest.updateMany({
        where: { id: assignMatch[1], status: existing.status },
        data: { driverId: driver.id, status: 'DRIVER_ASSIGNED', driverMatchedAt: new Date() },
      })
      if (updated.count > 0) {
        await placeRideHold(tx, { id: existing.id, riderId: existing.riderId, fareMinor: existing.fareMinor, currency: existing.currency })
      }
      return updated
    })

    if (assignResult.count === 0) {
      const error = new Error('Ride was updated by another admin action. Reload and try again.')
      error.statusCode = 409
      error.code = 'RIDE_ASSIGNMENT_CONFLICT'
      error.expose = true
      throw error
    }

    const ride = await db().rideRequest.findUnique({ where: { id: assignMatch[1] } })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'SR_DRIVER_ASSIGNED',
        entityType: 'ride_requests',
        entityId: ride.id,
        before: existing,
        after: ride,
      },
    })

    return json(res, 200, { ok: true, ride })
  }

  const claimMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/claim$/)
  if (claimMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    await requireRoadReadyDriver(context) // SECURITY (015): ID + license + vehicle registration all APPROVED

    const existing = await db().rideRequest.findUnique({ where: { id: claimMatch[1] } })
    if (!existing || existing.driverId || !['REQUESTED', 'MATCHING'].includes(existing.status)) {
      const error = new Error('This ride has already been claimed by another driver.')
      error.statusCode = 409
      error.code = 'RIDE_ALREADY_CLAIMED'
      error.expose = true
      throw error
    }

    // SECURITY (one-driver-one-ride, race-safe): the active-ride check and the claim must be atomic, or a
    // driver firing two claims concurrently passes both checks and ends up holding two active rides. Wrap
    // them in one transaction and serialize this driver's concurrent claims with an advisory lock on their
    // id (same pattern as the STR double-booking guard). The updateMany WHERE still blocks two drivers on
    // the same ride.
    const claimResult = await db().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${context.user.id}))`
      await ensureDriverHasNoActiveRide(context.user.id, tx)
      await assertNoSafetyBlock(existing.riderId, context.user.id, tx) // SAFETY (015): no re-match of a flagged pair
      await assertNotBlockedPair(tx, existing.riderId, context.user.id, { code: 'RIDE_USER_BLOCK', message: 'This rider and driver cannot be matched because of a block.' }) // UGC block (024)
      // CANCELLATION (019): a driver who already cancelled THIS ride cannot re-claim it after re-dispatch.
      const priorCancel = await tx.driverCancellation.findFirst({ where: { rideId: existing.id, driverId: context.user.id } })
      if (priorCancel) {
        const error = new Error('You cancelled this ride and cannot pick it up again.')
        error.statusCode = 409
        error.code = 'DRIVER_CANNOT_RECLAIM'
        error.expose = true
        throw error
      }
      // BALANCE GATE + HOLD (016): re-verify the rider can pay, and reserve the fare, atomically with the claim.
      await assertRiderCanAfford(tx, {
        riderId: existing.riderId, currency: existing.currency, fareMinor: existing.fareMinor,
        excludeRideId: existing.id, message: 'This ride cannot start: the rider wallet no longer covers the fare.',
      })
      const updated = await tx.rideRequest.updateMany({
        where: { id: claimMatch[1], driverId: null, status: { in: ['REQUESTED', 'MATCHING'] } },
        // driverMatchedAt anchors the rider's free-cancel grace window (019).
        data: { driverId: context.user.id, status: 'DRIVER_ASSIGNED', driverMatchedAt: new Date() },
      })
      if (updated.count > 0) {
        await placeRideHold(tx, { id: existing.id, riderId: existing.riderId, fareMinor: existing.fareMinor, currency: existing.currency })
      }
      return updated
    })

    if (claimResult.count === 0) {
      const error = new Error('This ride has already been claimed by another driver.')
      error.statusCode = 409
      error.code = 'RIDE_ALREADY_CLAIMED'
      error.expose = true
      throw error
    }

    const ride = await db().rideRequest.findUnique({
      where: { id: claimMatch[1] },
      include: { rider: { select: { id: true, displayName: true } } }, // SECURITY: no rider email to driver
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'SR_DRIVER_SELF_CLAIMED',
        entityType: 'ride_requests',
        entityId: ride.id,
        before: existing,
        after: ride,
      },
    })

    return json(res, 200, { ok: true, ride })
  }

  // ---- SR SAFETY (014): SOS ----
  // ---- CANCELLATION (019): rider cancels their own ride (Uber-style grace window + late fee) ----
  const cancelMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/cancel$/)
  if (cancelMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    const existing = await db().rideRequest.findUnique({ where: { id: cancelMatch[1] } })
    if (!existing || existing.riderId !== context.user.id) {
      const error = new Error('Ride not found for this account.')
      error.statusCode = 404
      error.code = 'RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }
    const body = await readJson(req).catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null

    const outcome = riderCancelOutcome(existing, new Date())
    if (!outcome.allowed) {
      const error = new Error(outcome.message)
      error.statusCode = outcome.statusCode
      error.code = outcome.code
      error.expose = true
      throw error
    }

    const result = await db().$transaction(async (tx) => {
      // Claim the cancel on the current status so a concurrent driver transition can't race it.
      const claim = await tx.rideRequest.updateMany({
        where: { id: existing.id, status: existing.status },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByRole: 'RIDER',
          cancelReason: reason,
          cancellationFeeMinor: outcome.free ? 0 : outcome.feeMinor,
        },
      })
      if (claim.count === 0) return { conflict: true }
      if (!outcome.free && outcome.feeMinor > 0) {
        await chargeRiderCancellationFee(tx, existing, outcome.feeMinor)
      }
      return { conflict: false }
    })
    if (result.conflict) {
      const error = new Error('This ride changed before the cancel could apply. Reload and try again.')
      error.statusCode = 409
      error.code = 'RIDE_CANCEL_CONFLICT'
      error.expose = true
      throw error
    }

    const ride = await db().rideRequest.findUnique({ where: { id: existing.id } })
    return json(res, 200, { ok: true, ride, cancellationFeeMinor: outcome.free ? 0 : outcome.feeMinor })
  }

  const sosMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/sos$/)
  if (sosMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const rideId = sosMatch[1]
    const ride = loadRideOrThrow(await db().rideRequest.findUnique({ where: { id: rideId } }))
    const isRider = ride.riderId === context.user.id
    const isDriver = Boolean(ride.driverId) && ride.driverId === context.user.id
    if (!isRider && !isDriver) forbidRide() // only the two people in the car raise SOS
    const body = await readJson(req)
    assertNoUnknownFields(body, ['lat', 'lng', 'note'], 'SOS body')
    const note = assertBoundedString(body.note, { fieldName: 'note', maxLength: 500 })
    let lat = null
    let lng = null
    if (body.lat != null || body.lng != null) {
      const coords = assertSyriaCoords(body.lat, body.lng, { fieldName: 'SOS location' })
      lat = coords.lat
      lng = coords.lng
    }
    const sosEvent = await db().sosEvent.create({
      data: { rideId, raisedByUserId: context.user.id, raisedByRole: isRider ? 'RIDER' : 'DRIVER', lat, lng, note, status: 'OPEN' },
    })
    await db().adminAuditLog.create({
      data: { actorUserId: context.user.id, action: 'SR_SOS_RAISED', entityType: 'sos_events', entityId: sosEvent.id, before: {}, after: sosEvent },
    })
    return json(res, 201, { ok: true, sosEvent })
  }

  // ---- SR SAFETY (014): live location ----
  const locationMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/location$/)
  if (locationMatch) {
    const rideId = locationMatch[1]
    if (req.method === 'POST') {
      requireVerifiedDriver(context)
      const body = await readJson(req)
      assertNoUnknownFields(body, ['lat', 'lng'], 'location body')
      const { lat, lng } = assertSyriaCoords(body.lat, body.lng, { fieldName: 'driver location' })
      const ride = await db().rideRequest.findFirst({ where: { id: rideId, driverId: context.user.id } })
      if (!ride) {
        const error = new Error('Ride not found for this driver account.')
        error.statusCode = 404
        error.code = 'DRIVER_RIDE_NOT_FOUND'
        error.expose = true
        throw error
      }
      if (!SR_TRACKABLE_STATUSES.includes(ride.status)) {
        const error = new Error('Live location can only be posted for an assigned, in-progress ride.')
        error.statusCode = 409
        error.code = 'RIDE_NOT_TRACKABLE'
        error.expose = true
        throw error
      }
      await db().$executeRaw`
        UPDATE ride_requests
        SET last_location_geo = ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326),
            last_location_at = now()
        WHERE id::text = ${rideId} AND driver_id::text = ${context.user.id}
      `
      return json(res, 200, { ok: true, location: { lat, lng, at: new Date().toISOString() } })
    }
    if (req.method === 'GET') {
      requireAuth(context)
      const ride = loadRideOrThrow(await db().rideRequest.findUnique({ where: { id: rideId } }))
      const isStaff = context.roles.includes('ADMIN') || context.roles.includes('SUPPORT')
      if (!isStaff && ride.riderId !== context.user.id && ride.driverId !== context.user.id) forbidRide()
      const rows = await db().$queryRaw`
        SELECT ST_Y(last_location_geo::geometry) AS lat, ST_X(last_location_geo::geometry) AS lng, last_location_at AS at
        FROM ride_requests WHERE id::text = ${rideId} AND last_location_geo IS NOT NULL LIMIT 1
      `
      const row = rows[0]
      return json(res, 200, { ok: true, status: ride.status, location: row ? { lat: row.lat, lng: row.lng, at: row.at } : null })
    }
    return methodNotAllowed(res, ['POST', 'GET'])
  }

  // ---- SR SAFETY (014): trip share ----
  const shareMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/share$/)
  if (shareMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const rideId = shareMatch[1]
    const ride = loadRideOrThrow(await db().rideRequest.findUnique({ where: { id: rideId } }))
    if (ride.riderId !== context.user.id) forbidRide()
    let token = ride.shareToken
    if (!token) {
      token = crypto.randomBytes(24).toString('base64url')
      await db().rideRequest.update({ where: { id: rideId }, data: { shareToken: token, shareTokenCreatedAt: new Date() } })
    }
    return json(res, 201, { ok: true, share: { token, path: `/sr/track/${token}`, apiPath: `/api/sr/rides/shared/${token}` } })
  }

  const sharedMatch = url.pathname.match(/^\/api\/sr\/rides\/shared\/([^/]+)$/)
  if (sharedMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const token = sharedMatch[1]
    const rows = await db().$queryRaw`
      SELECT status, ST_Y(last_location_geo::geometry) AS lat, ST_X(last_location_geo::geometry) AS lng, last_location_at AS at,
             ST_Y(dropoff_geo::geometry) AS dropoff_lat, ST_X(dropoff_geo::geometry) AS dropoff_lng
      FROM ride_requests WHERE share_token = ${token} LIMIT 1
    `
    const row = rows[0]
    if (!row) {
      const error = new Error('This trip-share link is not valid.')
      error.statusCode = 404
      error.code = 'SHARE_NOT_FOUND'
      error.expose = true
      throw error
    }
    const trackable = SR_TRACKABLE_STATUSES.includes(row.status)
    const location = trackable && row.lat != null ? { lat: row.lat, lng: row.lng, at: row.at } : null
    const etaMinutes = trackable ? shareEtaMinutes(location, row.dropoff_lat, row.dropoff_lng) : null
    return json(res, 200, { ok: true, trip: { status: coarseTripStatus(row.status), location, etaMinutes } })
  }

  // ---- SR TRUST (015): masked ride messaging ----
  const rideMessagesMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/messages$/)
  if (rideMessagesMatch) {
    requireAuth(context)
    if (req.method === 'GET') {
      const { ride } = await loadRideForMessaging(rideMessagesMatch[1], context)
      const messages = await db().rideMessage.findMany({
        where: { rideId: ride.id }, include: { sender: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: 'asc' }, take: 200,
      })
      return json(res, 200, { ok: true, thread: { rideId: ride.id, messages } })
    }
    if (req.method === 'POST') {
      const { ride, role } = await loadRideForMessaging(rideMessagesMatch[1], context)
      const body = await readJson(req)
      const text = typeof body.body === 'string' ? body.body.trim() : ''
      if (!text) {
        const error = new Error('Message body is required.')
        error.statusCode = 400
        error.code = 'MESSAGE_BODY_REQUIRED'
        error.expose = true
        throw error
      }
      if (text.length > 4000) {
        const error = new Error('Message body is too long.')
        error.statusCode = 400
        error.code = 'MESSAGE_BODY_TOO_LONG'
        error.expose = true
        throw error
      }
      const message = await db().rideMessage.create({
        data: { rideId: ride.id, senderUserId: context.user.id, senderRole: role, body: text },
        include: { sender: { select: { id: true, displayName: true } } },
      })
      return json(res, 201, { ok: true, message })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  // ---- SR TRUST (015): two-way rating ----
  const rateMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/rate$/)
  if (rateMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const ride = loadRideOrThrow(await db().rideRequest.findUnique({ where: { id: rateMatch[1] } }))
    let raterRole
    let ratedUserId
    if (ride.riderId === context.user.id) { raterRole = 'RIDER'; ratedUserId = ride.driverId }
    else if (ride.driverId && ride.driverId === context.user.id) { raterRole = 'DRIVER'; ratedUserId = ride.riderId }
    else {
      const error = new Error('Only the rider or assigned driver can rate this ride.')
      error.statusCode = 403
      error.code = 'RIDE_RATE_FORBIDDEN'
      error.expose = true
      throw error
    }
    if (ride.status !== 'COMPLETED') {
      const error = new Error('You can only rate a ride once it is completed.')
      error.statusCode = 400
      error.code = 'RIDE_NOT_COMPLETED'
      error.expose = true
      throw error
    }
    if (!ratedUserId || ratedUserId === context.user.id) {
      const error = new Error('This ride has no counterparty to rate.')
      error.statusCode = 400
      error.code = 'RIDE_RATE_NO_COUNTERPARTY'
      error.expose = true
      throw error
    }
    const body = await readJson(req)
    assertNoUnknownFields(body, ['stars', 'safetyFlag', 'comment'], 'ride rating body')
    const stars = Number(body.stars)
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      const error = new Error('stars must be an integer from 1 to 5.')
      error.statusCode = 400
      error.code = 'RIDE_RATING_STARS_INVALID'
      error.expose = true
      throw error
    }
    const safetyFlag = Boolean(body.safetyFlag)
    const comment = assertBoundedString(body.comment, { fieldName: 'comment', maxLength: 2000 }) || null
    let rating
    try {
      rating = await db().rideRating.create({
        data: { rideId: ride.id, raterUserId: context.user.id, ratedUserId, raterRole, stars, safetyFlag, comment },
      })
    } catch (error) {
      if (error?.code === 'P2002') {
        const conflict = new Error('You have already rated this ride.')
        conflict.statusCode = 409
        conflict.code = 'RIDE_ALREADY_RATED'
        conflict.expose = true
        throw conflict
      }
      throw error
    }
    return json(res, 201, { ok: true, rating })
  }

  const userRatingMatch = url.pathname.match(/^\/api\/sr\/users\/([^/]+)\/rating$/)
  if (userRatingMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    return json(res, 200, { ok: true, userId: userRatingMatch[1], rating: await rideRatingSummary(userRatingMatch[1]) })
  }

  // ---- SR MONEY (016): tip (100% to driver, no commission) ----
  const tipMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/tip$/)
  if (tipMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const ride = loadRideOrThrow(await db().rideRequest.findUnique({ where: { id: tipMatch[1] } }))
    if (ride.riderId !== context.user.id) {
      const error = new Error('Only the rider can tip this ride.')
      error.statusCode = 403
      error.code = 'RIDE_FORBIDDEN'
      error.expose = true
      throw error
    }
    const body = await readJson(req)
    const tipMinor = Number(body.amountMinor)
    const result = await db().$transaction(async (tx) => {
      const fresh = await tx.rideRequest.findUnique({ where: { id: ride.id } })
      return tipCompletedRide(tx, fresh, tipMinor)
    })
    return json(res, 201, { ok: true, tip: result })
  }

  // ---- SR PICKUP PIN (017): driver verifies the rider's code ----
  const verifyPinMatch = url.pathname.match(/^\/api\/sr\/rides\/([^/]+)\/verify-pin$/)
  if (verifyPinMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireVerifiedDriver(context)
    const rideId = verifyPinMatch[1]
    const body = await readJson(req)
    const submitted = String(body.pin || '').trim()
    const ride = await db().rideRequest.findFirst({ where: { id: rideId, driverId: context.user.id } })
    if (!ride) {
      const error = new Error('Ride not found for this driver account.')
      error.statusCode = 404
      error.code = 'DRIVER_RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (ride.pickupVerifiedAt) return json(res, 200, { ok: true, verified: true })
    if (!['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(ride.status)) {
      const error = new Error('The pickup code can only be entered at pickup.')
      error.statusCode = 409
      error.code = 'RIDE_NOT_AT_PICKUP'
      error.expose = true
      throw error
    }
    if (ride.pinAttempts >= MAX_PIN_ATTEMPTS) {
      const error = new Error('Too many incorrect codes. Please contact support to verify this pickup.')
      error.statusCode = 429
      error.code = 'PIN_LOCKED'
      error.expose = true
      throw error
    }
    if (submitted !== ride.pickupPin) {
      await db().rideRequest.update({ where: { id: ride.id }, data: { pinAttempts: { increment: 1 } } })
      const error = new Error('The pickup code does not match. Ask the rider to read you the 4-digit code shown in their app.')
      error.statusCode = 400
      error.code = 'PIN_MISMATCH'
      error.expose = true
      throw error
    }
    const verified = await db().rideRequest.updateMany({
      where: { id: ride.id, pickupVerifiedAt: null, driverId: context.user.id, pinAttempts: { lt: MAX_PIN_ATTEMPTS } },
      data: { pickupVerifiedAt: new Date() },
    })
    if (verified.count !== 1) {
      const error = new Error('This pickup could not be verified. Please retry.')
      error.statusCode = 409
      error.code = 'PIN_VERIFY_CONFLICT'
      error.expose = true
      throw error
    }
    return json(res, 200, { ok: true, verified: true })
  }

  return false
}
