import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { recordWalletEntry } from '../lib/finance-ledger.mjs'
import { createStripeCardRefund, extractStripePaymentIntentId, isStripeConfigured } from './payments.mjs'
import { idempotencyKey } from '../lib/security.mjs'
import { getCountryConfig, disputeWindowHours, DEFAULT_COUNTRY } from '../lib/country-config.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(message, statusCode, code) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}

// Resolves who is owed a refund and the ceiling (never refund more than was actually paid).
async function disputeSubject(dispute) {
  if (dispute.rideId) {
    const ride = await db().rideRequest.findUnique({ where: { id: dispute.rideId } })
    return ride ? { customerId: ride.riderId, currency: ride.currency, maxRefundMinor: ride.fareMinor || 0 } : null
  }
  if (dispute.bookingId) {
    const booking = await db().booking.findUnique({ where: { id: dispute.bookingId } })
    return booking ? { customerId: booking.guestId, currency: booking.currency, maxRefundMinor: booking.amountMinor || 0 } : null
  }
  return null
}

export async function handleDisputes(req, res, url, context) {
  // ---- Public: a country's operating rules (currency, payments, age limits, dispute window, ...) ----
  const countryMatch = url.pathname.match(/^\/api\/config\/country\/([^/]+)$/)
  if (countryMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const config = getCountryConfig(countryMatch[1])
    if (!config) fail('Country is not configured.', 404, 'COUNTRY_NOT_CONFIGURED')
    return json(res, 200, { ok: true, country: config })
  }
  if (url.pathname === '/api/config/country') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    return json(res, 200, { ok: true, country: getCountryConfig(DEFAULT_COUNTRY) })
  }

  // ---- Admin dispute queue + adjudication ----
  if (url.pathname === '/api/admin/disputes') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const disputes = await db().dispute.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { openedBy: { select: { id: true, displayName: true } } },
    })
    return json(res, 200, { ok: true, disputes })
  }

  const adminResolveMatch = url.pathname.match(/^\/api\/admin\/disputes\/([^/]+)$/)
  if (adminResolveMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const decision = String(body.decision || body.action || '').toUpperCase()
    if (!['REFUND', 'REJECT'].includes(decision)) {
      fail('decision must be REFUND or REJECT.', 400, 'DISPUTE_DECISION_INVALID')
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null

    const dispute = await db().dispute.findUnique({ where: { id: adminResolveMatch[1] } })
    if (!dispute) fail('Dispute not found.', 404, 'DISPUTE_NOT_FOUND')
    if (dispute.status !== 'OPEN') fail('This dispute has already been resolved.', 409, 'DISPUTE_ALREADY_RESOLVED')

    if (decision === 'REJECT') {
      const updated = await db().dispute.update({
        where: { id: dispute.id },
        data: { status: 'RESOLVED_REJECTED', resolutionNote: note, resolvedById: context.user.id, resolvedAt: new Date() },
      })
      await db().adminAuditLog.create({
        data: { actorUserId: context.user.id, action: 'DISPUTE_REJECTED', entityType: 'disputes', entityId: dispute.id, before: { status: 'OPEN' }, after: { status: 'RESOLVED_REJECTED', note } },
      })
      return json(res, 200, { ok: true, dispute: updated })
    }

    // REFUND: credit the customer's wallet, capped at what they actually paid.
    const subject = await disputeSubject(dispute)
    if (!subject) fail('The item this dispute refers to no longer exists.', 409, 'DISPUTE_SUBJECT_MISSING')
    const requested = body.refundMinor === undefined || body.refundMinor === null ? subject.maxRefundMinor : Math.round(Number(body.refundMinor))
    if (!Number.isFinite(requested) || requested <= 0) fail('refundMinor must be a positive whole number.', 400, 'REFUND_AMOUNT_INVALID')
    const refundMinor = Math.min(requested, subject.maxRefundMinor)
    if (refundMinor <= 0) fail('There is nothing to refund for this item.', 400, 'REFUND_AMOUNT_INVALID')

    // A ride/booking can be refunded AT MOST ONCE, even across multiple disputes. The refund credit is
    // idempotency-keyed on the SUBJECT (ride/booking), not the dispute — so the ledger's unique key makes
    // a second refund on the same subject impossible, even under concurrent adjudication.
    const subjectKey = dispute.rideId || dispute.bookingId
    // For a booking paid by CARD (Stripe), the refund goes back to the CARD after commit; populated in tx.
    let deferredCardRefund = null
    const updated = await db().$transaction(async (tx) => {
      const priorRefund = await tx.walletEntry.findUnique({ where: { idempotencyKey: idempotencyKey(['dispute-refund', subjectKey]) } })
      if (priorRefund) {
        const err = new Error('This ride or booking has already been refunded.')
        err.statusCode = 409
        err.code = 'SUBJECT_ALREADY_REFUNDED'
        err.expose = true
        throw err
      }
      // CRITICAL cross-mechanism guard: a STR booking has its OWN refund paths (guest self-cancel,
      // admin proof-reject) keyed differently. Atomically move the booking to CANCELLED here so those
      // paths (which claim on CONFIRMED/COMPLETED) match zero rows and cannot refund the same booking a
      // second time. A booking that is no longer CONFIRMED/COMPLETED can't be refunded via a dispute.
      if (dispute.bookingId) {
        const claim = await tx.booking.updateMany({
          where: { id: dispute.bookingId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
          data: { status: 'CANCELLED' },
        })
        if (claim.count !== 1) {
          const err = new Error('This booking can no longer be refunded — its state changed.')
          err.statusCode = 409
          err.code = 'BOOKING_REFUND_CONFLICT'
          err.expose = true
          throw err
        }
      }
      // If this is a BOOKING paid by CARD (Stripe), refund the CARD (after commit) instead of a wallet
      // credit. Rides and Sham Cash bookings keep the internal wallet credit.
      const stripeProof = dispute.bookingId
        ? await tx.paymentProof.findFirst({
            where: { bookingId: dispute.bookingId, provider: 'stripe', status: { in: ['REFUNDED', 'APPROVED'] } },
            orderBy: { createdAt: 'desc' },
          })
        : null
      const stripeIntentId = stripeProof ? extractStripePaymentIntentId(stripeProof.proofAssetUrl) : null
      if (stripeIntentId && refundMinor > 0 && isStripeConfigured()) {
        deferredCardRefund = {
          paymentIntentId: stripeIntentId,
          amountMinor: refundMinor,
          currency: subject.currency,
          subjectKey,
          customerId: subject.customerId,
        }
      } else {
        await recordWalletEntry(tx, {
          userId: subject.customerId,
          type: 'CREDIT',
          amountMinor: refundMinor,
          currency: subject.currency,
          referenceType: 'dispute_refund',
          referenceId: subjectKey,
          keyParts: ['dispute-refund', subjectKey],
          note: 'Consumer-protection refund credited after admin adjudication.',
        })
      }
      const d = await tx.dispute.update({
        where: { id: dispute.id },
        data: { status: 'RESOLVED_REFUNDED', refundMinor, currency: subject.currency, resolutionNote: note, resolvedById: context.user.id, resolvedAt: new Date() },
      })
      await tx.adminAuditLog.create({
        data: { actorUserId: context.user.id, action: 'DISPUTE_REFUNDED', entityType: 'disputes', entityId: dispute.id, before: { status: 'OPEN' }, after: { status: 'RESOLVED_REFUNDED', refundMinor, note } },
      })
      return d
    })

    // Real card refund runs AFTER the transaction commits. On Stripe failure, fall back to a wallet
    // credit so the customer is still made whole.
    if (deferredCardRefund) {
      try {
        await createStripeCardRefund({
          paymentIntentId: deferredCardRefund.paymentIntentId,
          amountMinor: deferredCardRefund.amountMinor,
          bookingCurrency: deferredCardRefund.currency,
        })
      } catch (refundError) {
        console.error('[sybnb] Stripe card refund failed after dispute refund; crediting wallet as fallback:', refundError?.message || refundError)
        await recordWalletEntry(db(), {
          userId: deferredCardRefund.customerId,
          type: 'CREDIT',
          amountMinor: deferredCardRefund.amountMinor,
          currency: deferredCardRefund.currency,
          referenceType: 'dispute_refund',
          referenceId: deferredCardRefund.subjectKey,
          keyParts: ['dispute-refund', deferredCardRefund.subjectKey],
          note: 'Fallback wallet refund — the Stripe card refund could not be completed.',
        })
      }
    }

    return json(res, 200, { ok: true, dispute: updated })
  }

  // ---- Customer: open a dispute / list own ----
  if (url.pathname === '/api/disputes') {
    if (req.method === 'GET') {
      requireAuth(context)
      const disputes = await db().dispute.findMany({ where: { openedByUserId: context.user.id }, orderBy: { createdAt: 'desc' }, take: 100 })
      return json(res, 200, { ok: true, disputes })
    }
    if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST'])

    requireAuth(context)
    const body = await readJson(req)
    const rideId = body.rideId ? String(body.rideId) : null
    const bookingId = body.bookingId ? String(body.bookingId) : null
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : ''
    if ((rideId && bookingId) || (!rideId && !bookingId)) {
      fail('Provide exactly one of rideId or bookingId.', 400, 'DISPUTE_SUBJECT_INVALID')
    }
    if (!reason) fail('A reason is required to open a dispute.', 400, 'DISPUTE_REASON_REQUIRED')

    const windowMs = disputeWindowHours() * 60 * 60 * 1000
    let subjectType
    let completedAt

    if (rideId) {
      if (!UUID_RE.test(rideId)) fail('Ride not found.', 404, 'RIDE_NOT_FOUND')
      const ride = await db().rideRequest.findUnique({ where: { id: rideId } })
      if (!ride || ride.riderId !== context.user.id) fail('Ride not found for this account.', 404, 'RIDE_NOT_FOUND')
      if (ride.status !== 'COMPLETED') fail('Only a completed ride can be disputed.', 400, 'RIDE_NOT_DISPUTABLE')
      subjectType = 'SR_RIDE'
      completedAt = ride.updatedAt
    } else {
      if (!UUID_RE.test(bookingId)) fail('Booking not found.', 404, 'BOOKING_NOT_FOUND')
      const booking = await db().booking.findUnique({ where: { id: bookingId } })
      if (!booking || booking.guestId !== context.user.id) fail('Booking not found for this account.', 404, 'BOOKING_NOT_FOUND')
      if (!['CONFIRMED', 'COMPLETED'].includes(booking.status)) fail('Only a confirmed or completed booking can be disputed.', 400, 'BOOKING_NOT_DISPUTABLE')
      subjectType = 'STR_BOOKING'
      completedAt = booking.checkOut || booking.updatedAt
    }

    if (completedAt && Date.now() - new Date(completedAt).getTime() > windowMs) {
      fail(`The dispute window (${disputeWindowHours()}h) for this item has passed.`, 400, 'DISPUTE_WINDOW_PASSED')
    }

    // Block a duplicate: an item can't have two open disputes, and can't be disputed again once it has
    // already been refunded (a rejected dispute may be re-opened — the subject-keyed refund guard above
    // still guarantees at most one refund ever).
    const existing = await db().dispute.findFirst({
      where: { status: { in: ['OPEN', 'RESOLVED_REFUNDED'] }, ...(rideId ? { rideId } : { bookingId }) },
    })
    if (existing) {
      const refunded = existing.status === 'RESOLVED_REFUNDED'
      fail(refunded ? 'This item has already been refunded.' : 'There is already an open dispute for this item.', 409, refunded ? 'SUBJECT_ALREADY_REFUNDED' : 'DISPUTE_ALREADY_OPEN')
    }

    const dispute = await db().dispute.create({
      data: { subjectType, rideId, bookingId, openedByUserId: context.user.id, reason },
    })
    return json(res, 201, { ok: true, dispute })
  }

  return false
}
