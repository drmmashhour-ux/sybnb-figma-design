import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { lockPaymentReference, recordWalletEntry } from '../lib/finance-ledger.mjs'
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

// Retry durable Stripe refunds left PENDING by an interrupted adjudication request. Stripe's refund
// idempotency key makes repeated attempts safe; completion/fallback audit rows are the durable cursor.
export async function retryPendingStripeDisputeRefunds(limit = 50) {
  const pending = await db().adminAuditLog.findMany({
    where: { action: 'STRIPE_DISPUTE_REFUND_PENDING' }, orderBy: { createdAt: 'asc' }, take: limit,
  })
  let completed = 0
  for (const row of pending) {
    const terminal = await db().adminAuditLog.findFirst({
      where: { entityType: 'payment_proofs', entityId: row.entityId, action: { in: ['STRIPE_DISPUTE_REFUND_COMPLETED', 'STRIPE_DISPUTE_REFUND_FALLBACK_COMPLETED'] } },
    })
    if (terminal) continue
    const proof = await db().paymentProof.findUnique({ where: { id: row.entityId }, include: { booking: true } })
    const paymentIntentId = extractStripePaymentIntentId(proof?.proofAssetUrl)
    const amountMinor = Number(row.after?.amountMinor || 0)
    const currency = String(row.after?.currency || proof?.currency || '')
    if (!proof?.booking || !paymentIntentId || amountMinor <= 0 || !currency) continue
    const refund = await createStripeCardRefund({ paymentIntentId, amountMinor, bookingCurrency: currency })
    await db().$transaction(async (tx) => {
      await tx.paymentProof.update({ where: { id: proof.id }, data: { status: 'REFUNDED' } })
      await tx.adminAuditLog.create({ data: {
        actorUserId: row.actorUserId, action: 'STRIPE_DISPUTE_REFUND_COMPLETED', entityType: 'payment_proofs', entityId: proof.id,
        after: { subjectKey: row.after?.subjectKey, refundId: refund.refundId || null, amountMinor, retry: true },
      } })
    })
    completed += 1
  }
  return { scanned: pending.length, completed }
}

// Resolves who is owed a refund and the ceiling (never refund more than was actually paid).
async function disputeSubject(dispute) {
  if (dispute.rideId) {
    const ride = await db().rideRequest.findUnique({ where: { id: dispute.rideId } })
    return ride ? { customerId: ride.riderId, currency: ride.currency, maxRefundMinor: ride.fareMinor || 0 } : null
  }
  if (dispute.bookingId) {
    const booking = await db().booking.findUnique({
      where: { id: dispute.bookingId },
      include: { payments: { where: { status: 'APPROVED' }, orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    // booking.amountMinor is only the stay/rent base; the approved proof is the authoritative amount
    // actually paid including cleaning, tax, add-ons and protection. Refunding only the base silently
    // short-changes a guest whose verified payment included those fees.
    return booking ? { customerId: booking.guestId, currency: booking.currency, maxRefundMinor: booking.payments[0]?.amountMinor || booking.amountMinor || 0 } : null
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
          proofId: stripeProof.id,
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
      // Reverse the original proceeds so a refund never mints wallet value while recipients retain
      // the fare/commission. Negative recipient balances are an explicit recoverable debt if funds
      // were already spent, preferable to silently losing the obligation.
      if (dispute.rideId) {
        const proceeds = await tx.walletEntry.findMany({
          where: { referenceId: dispute.rideId, type: 'CREDIT', referenceType: { in: ['sr_driver_earning', 'sr_admin_commission'] } },
          include: { wallet: true }, orderBy: { referenceType: 'asc' },
        })
        let remaining = refundMinor
        for (const entry of proceeds) {
          const amount = Math.min(remaining, entry.amountMinor)
          if (amount > 0) await recordWalletEntry(tx, {
            userId: entry.wallet.userId, type: 'DEBIT', amountMinor: amount, currency: entry.currency,
            referenceType: `${entry.referenceType}_dispute_reversal`, referenceId: dispute.rideId,
            keyParts: ['dispute-proceeds-reversal', dispute.rideId, entry.id], note: 'Ride proceeds reversed after dispute refund.',
          })
          remaining -= amount
        }
        if (remaining !== 0) fail('Ride proceeds do not reconcile to the requested refund.', 409, 'DISPUTE_PROCEEDS_MISMATCH')
      } else if (dispute.bookingId) {
        const hostHold = await tx.walletEntry.findFirst({
          where: { referenceType: 'booking_payout', referenceId: dispute.bookingId, type: 'HOLD' }, include: { wallet: true },
          orderBy: { createdAt: 'asc' },
        })
        if (!hostHold) fail('Booking payout hold is missing.', 409, 'DISPUTE_PROCEEDS_MISMATCH')
        await recordWalletEntry(tx, {
          userId: hostHold.wallet.userId, type: 'HOLD', amountMinor: hostHold.amountMinor, currency: hostHold.currency,
          referenceType: 'booking_payout_hold_reversal', referenceId: dispute.bookingId,
          keyParts: ['booking-payout-hold-reversal', dispute.bookingId], note: 'Host payout hold cancelled after booking dispute refund.',
        })
        const adminShare = await tx.walletEntry.findFirst({
          where: { referenceType: 'booking_admin_share', referenceId: dispute.bookingId, type: 'CREDIT' }, include: { wallet: true },
        })
        if (!adminShare) fail('Booking revenue does not have an accounting recipient.', 409, 'DISPUTE_PROCEEDS_MISMATCH')
        // Card refunds reverse only the platform share internally; the card settlement carries the
        // principal back. Wallet refunds are funded fully by the platform because the host amount is held.
        const reversalMinor = deferredCardRefund ? Math.min(adminShare.amountMinor, refundMinor) : refundMinor
        await recordWalletEntry(tx, {
          userId: adminShare.wallet.userId, type: 'DEBIT', amountMinor: reversalMinor, currency: subject.currency,
          referenceType: 'booking_dispute_refund_funding', referenceId: dispute.bookingId,
          keyParts: ['booking-dispute-funding', dispute.bookingId], note: 'Platform funding/revenue reversal for booking dispute refund.',
        })
      }
      const d = await tx.dispute.update({
        where: { id: dispute.id },
        data: { status: 'RESOLVED_REFUNDED', refundMinor, currency: subject.currency, resolutionNote: note, resolvedById: context.user.id, resolvedAt: new Date() },
      })
      await tx.adminAuditLog.create({
        data: { actorUserId: context.user.id, action: 'DISPUTE_REFUNDED', entityType: 'disputes', entityId: dispute.id, before: { status: 'OPEN' }, after: { status: 'RESOLVED_REFUNDED', refundMinor, note, refundChannel: deferredCardRefund ? 'STRIPE_PENDING' : 'WALLET_COMPLETED' } },
      })
      if (deferredCardRefund) await tx.adminAuditLog.create({ data: {
        actorUserId: context.user.id, action: 'STRIPE_DISPUTE_REFUND_PENDING', entityType: 'payment_proofs', entityId: deferredCardRefund.proofId,
        after: { subjectKey, amountMinor: refundMinor, currency: subject.currency },
      } })
      return d
    })

    // Real card refund runs AFTER the transaction commits. An error may be ambiguous (Stripe may have
    // committed before the connection failed), so NEVER issue a wallet fallback here. Leave the durable
    // PENDING row for the maintenance retry, which uses the same Stripe idempotency key and reconciles
    // safely without risking a double refund.
    if (deferredCardRefund) {
      let stripeRefundPending = false
      try {
        const stripeRefund = await createStripeCardRefund({
          paymentIntentId: deferredCardRefund.paymentIntentId,
          amountMinor: deferredCardRefund.amountMinor,
          bookingCurrency: deferredCardRefund.currency,
        })
        await db().$transaction(async (tx) => {
          await tx.paymentProof.update({ where: { id: deferredCardRefund.proofId }, data: { status: 'REFUNDED' } })
          await tx.adminAuditLog.create({ data: {
            actorUserId: context.user.id, action: 'STRIPE_DISPUTE_REFUND_COMPLETED', entityType: 'payment_proofs', entityId: deferredCardRefund.proofId,
            after: { subjectKey: deferredCardRefund.subjectKey, refundId: stripeRefund.refundId || null, amountMinor: deferredCardRefund.amountMinor },
          } })
        })
      } catch (refundError) {
        stripeRefundPending = true
        await db().adminAuditLog.create({ data: {
          actorUserId: context.user.id, action: 'STRIPE_DISPUTE_REFUND_RETRY_REQUIRED', entityType: 'payment_proofs', entityId: deferredCardRefund.proofId,
          after: { subjectKey: deferredCardRefund.subjectKey, amountMinor: deferredCardRefund.amountMinor, error: String(refundError?.code || 'STRIPE_REFUND_AMBIGUOUS') },
        } })
      }
      if (stripeRefundPending) return json(res, 202, { ok: true, dispute: updated, refundPending: true })
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
    const subjectKey = rideId || bookingId
    const dispute = await db().$transaction(async (tx) => {
      await lockPaymentReference(tx, 'dispute', subjectKey)
      const existing = await tx.dispute.findFirst({
        where: { status: { in: ['OPEN', 'RESOLVED_REFUNDED'] }, ...(rideId ? { rideId } : { bookingId }) },
      })
      if (existing) {
        const refunded = existing.status === 'RESOLVED_REFUNDED'
        fail(refunded ? 'This item has already been refunded.' : 'There is already an open dispute for this item.', 409, refunded ? 'SUBJECT_ALREADY_REFUNDED' : 'DISPUTE_ALREADY_OPEN')
      }
      const created = await tx.dispute.create({ data: { subjectType, rideId, bookingId, openedByUserId: context.user.id, reason } })
      await tx.adminAuditLog.create({
        data: { actorUserId: context.user.id, action: 'DISPUTE_OPENED', entityType: 'disputes', entityId: created.id, after: { subjectType, subjectKey } },
      })
      return created
    })
    return json(res, 201, { ok: true, dispute })
  }

  return false
}
