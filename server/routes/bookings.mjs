import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import {
  CANCELLATION_PROTECTION_RATE,
  bookingFinanceSplit,
  originalAdminShareRecipient,
  recordWalletEntry,
} from '../lib/finance-ledger.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { computeStayTotalMinor } from '../lib/pricing.mjs'
import { sypMinorToRoundedUsdMinor } from '../lib/currency.mjs'
import { strLateCancelFeeMinor, DEFAULT_COUNTRY } from '../lib/country-config.mjs'

// Must match src/shared/booking/cancellationPolicy.ts's STANDARD_FREE_CANCELLATION_DAYS_BEFORE_CHECKIN
// -- that frontend module only computes the *displayed* cutoff date; this is what was actually
// enforced (nothing, previously -- the flat fee below applied regardless of timing, contradicting
// the "free cancellation until N days before check-in" copy guests were shown).
const FREE_CANCELLATION_DAYS_BEFORE_CHECKIN = 3

function isWithinFreeCancellationWindow(checkIn) {
  if (!checkIn) return false
  const cutoff = new Date(checkIn)
  cutoff.setUTCDate(cutoff.getUTCDate() - FREE_CANCELLATION_DAYS_BEFORE_CHECKIN)
  return Date.now() < cutoff.getTime()
}

export async function handleBookings(req, res, url, context) {
  const cancelMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/cancel$/)
  if (cancelMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    const existing = await db().booking.findFirst({
      where: {
        id: cancelMatch[1],
        guestId: context.user.id,
      },
      include: { listing: true, payments: true },
    })

    if (!existing) {
      const error = new Error('Booking not found for this guest account.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (!['REQUESTED', 'CONFIRMED'].includes(existing.status)) {
      const error = new Error('Only requested or confirmed bookings can be cancelled by the guest.')
      error.statusCode = 400
      error.code = 'BOOKING_NOT_CANCELLABLE'
      error.expose = true
      throw error
    }

    // Computed once, outside the transaction, so the fee-waiver decision reflects the moment the
    // guest actually clicked cancel, not whatever instant the transaction happens to run at.
    const freeCancellationWindow = isWithinFreeCancellationWindow(existing.checkIn)

    // The flat late-cancel fee actually withheld from the refund, in the booking currency. Captured from
    // inside the transaction so the audit log below records what was really charged (0 when waived or when
    // the refund was too small to cover the fee).
    let cancellationFeeCharged = 0

    const booking = await db().$transaction(async (tx) => {
      // SECURITY (S4): atomically claim the cancel on the expected status BEFORE doing refund work. Without
      // this, a concurrent host-confirm (which read REQUESTED outside its own transaction) could commit
      // after the refund, leaving a refunded booking marked CONFIRMED and later paying the host for a stay
      // the guest was already refunded on. A stale-status writer now matches zero rows and loses the race.
      const claim = await tx.booking.updateMany({
        where: { id: existing.id, status: { in: ['REQUESTED', 'CONFIRMED'] } },
        data: { status: 'CANCELLED' },
      })
      if (claim.count !== 1) {
        const error = new Error('This booking was already updated and can no longer be cancelled.')
        error.statusCode = 409
        error.code = 'BOOKING_CANCEL_CONFLICT'
        error.expose = true
        throw error
      }

      const approvedPayment = existing.payments.find((payment) => payment.status === 'APPROVED')
      const split = bookingFinanceSplit(existing, approvedPayment?.amountMinor || existing.amountMinor)

      if (approvedPayment) {
        const protectedByAddOn = split.cancellationProtectionPurchased
        const feeWaived = protectedByAddOn || freeCancellationWindow
        const guestRefundAmountMinor = protectedByAddOn
          ? Math.max(0, approvedPayment.amountMinor - split.cancellationProtectionFeeMinor)
          : approvedPayment.amountMinor
        // Flat late-cancel fee, denominated in the BOOKING currency (fixing the old hardcoded-USD debit
        // that drove a SYP guest's empty USD wallet negative). It is WITHHELD from the refund, never billed
        // to a separate wallet, and capped at the refund so the guest can never end up negative.
        const flatFee = feeWaived ? 0 : strLateCancelFeeMinor(existing.currency, DEFAULT_COUNTRY)
        const feeMinor = Math.min(flatFee, guestRefundAmountMinor)
        const netGuestRefundMinor = guestRefundAmountMinor - feeMinor
        cancellationFeeCharged = feeMinor
        // Reverse against whoever the wallet entries show actually received the original
        // commission share, not PaymentProof.reviewedById (which can be null or simply not the
        // credited account) — see originalAdminShareRecipient() for why.
        const adminRecipientId = await originalAdminShareRecipient(tx, existing.id)

        await tx.paymentProof.updateMany({
          where: {
            bookingId: existing.id,
            status: { in: ['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED'] },
          },
          data: {
            status: 'REFUNDED',
            adminNote: 'Auto-refunded after guest cancelled the booking.',
            reviewedById: context.user.id,
            reviewedAt: new Date(),
          },
        })

        await recordWalletEntry(tx, {
          userId: existing.guestId,
          type: 'REFUND',
          amountMinor: netGuestRefundMinor,
          currency: existing.currency,
          referenceType: 'booking_refund',
          referenceId: existing.id,
          keyParts: ['booking-guest-cancel-refund', existing.id, approvedPayment.id],
          note: 'Guest refund after guest cancelled the booking (net of any late-cancel fee).',
        })

        // adminShareMinor never included the protection fee (it's excluded from the split base and
        // recorded as its own 'booking_protection_fee' CREDIT at approval time — see
        // approvePaymentProof), so it must be reversed in full here, not reduced by the fee again.
        // The protection fee itself is a non-refundable premium and is never reversed.
        await recordWalletEntry(tx, {
          userId: adminRecipientId,
          type: 'DEBIT',
          amountMinor: split.adminShareMinor,
          currency: existing.currency,
          referenceType: 'booking_admin_share_reversal',
          referenceId: existing.id,
          keyParts: ['booking-guest-cancel-admin-share-reversal', existing.id, approvedPayment.id],
          note: 'Admin/SYBNB share reversed because the guest-cancelled booking was refunded.',
        })

        // The fee is WITHHELD from the guest's refund above (not a separate guest DEBIT), so all that
        // remains is to credit the admin the same amount in the booking currency. No guest DEBIT means no
        // wallet can be driven negative. feeMinor is 0 when waived or when the refund couldn't cover it.
        if (feeMinor > 0) {
          await recordWalletEntry(tx, {
            userId: adminRecipientId,
            type: 'CREDIT',
            amountMinor: feeMinor,
            currency: existing.currency,
            referenceType: 'booking_guest_cancel_fee',
            referenceId: existing.id,
            keyParts: ['booking-guest-cancel-fee-admin', existing.id, approvedPayment.id],
            note: 'Admin received the late-cancel fee, withheld from the guest refund (no protection).',
          })
        }
      }

      return tx.booking.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED' },
        include: {
          guest: {
            select: {
              id: true,
              displayName: true,
              email: true,
            },
          },
          payments: true,
          listing: true,
        },
      })
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'BOOKING_GUEST_CANCELLED',
        entityType: 'bookings',
        entityId: booking.id,
        before: existing,
        after: {
          ...booking,
          cancellationNote: body.note || body.reason || undefined,
          cancellationFee: {
            amountMinor: cancellationFeeCharged,
            currency: existing.currency,
            chargedTo: 'GUEST',
            withheldFromRefund: true,
            waivedByProtection: booking.metadata?.cancellationProtectionPurchased === true,
            waivedByFreeCancellationWindow: freeCancellationWindow,
          },
        },
      },
    })

    return json(res, 200, { ok: true, booking })
  }

  const disputeMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/dispute$/)
  if (disputeMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['GUEST'])
    const body = await readJson(req)
    const existing = await db().booking.findFirst({
      where: {
        id: disputeMatch[1],
        guestId: context.user.id,
      },
      include: { listing: true, payments: true },
    })

    if (!existing) {
      const error = new Error('Booking not found for this guest account.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (!['CONFIRMED', 'COMPLETED'].includes(existing.status)) {
      const error = new Error('Only confirmed or completed bookings can be disputed.')
      error.statusCode = 400
      error.code = 'BOOKING_NOT_DISPUTABLE'
      error.expose = true
      throw error
    }

    // SECURITY (S4): claim the dispute atomically on the expected status so a concurrent host-cancel /
    // admin action can't be silently clobbered back to DISPUTED, and a stale request loses the race.
    const claim = await db().booking.updateMany({
      where: { id: existing.id, status: { in: ['CONFIRMED', 'COMPLETED'] } },
      data: { status: 'DISPUTED' },
    })
    if (claim.count !== 1) {
      const error = new Error('This booking can no longer be disputed.')
      error.statusCode = 409
      error.code = 'BOOKING_DISPUTE_CONFLICT'
      error.expose = true
      throw error
    }
    const booking = await db().booking.findUnique({
      where: { id: existing.id },
      include: {
        guest: {
          select: {
            id: true,
            displayName: true,
          },
        },
        listing: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
        payments: true,
      },
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'BOOKING_DISPUTED',
        entityType: 'bookings',
        entityId: booking.id,
        before: existing,
        after: {
          ...booking,
          disputeNote: body.note || body.reason || undefined,
        },
      },
    })

    return json(res, 200, { ok: true, booking })
  }

  const bookingMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)$/)
  if (bookingMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const booking = await db().booking.findUnique({
      where: { id: bookingMatch[1] },
      include: {
        // SECURITY (S10/S18): booking detail is viewable by the listing owner (host) too, so it must NOT
        // carry the guest's email or ID-document reference. Contact stays on-platform; ID docs are admin-only.
        guest: {
          select: {
            id: true,
            displayName: true,
          },
        },
        listing: {
          include: {
            owner: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
        },
        review: true,
      },
    })

    if (!booking) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }

    if (!isBookingViewable(booking, context)) {
      const error = new Error('This booking is not available for this account.')
      error.statusCode = 403
      error.code = 'BOOKING_FORBIDDEN'
      error.expose = true
      throw error
    }

    // SECURITY (S7, mirrors payments.mjs safeProof): this endpoint is viewable by the listing owner (host),
    // so the guest's payment proofs must be projected down for a non-privileged host viewer. The host may
    // confirm a payment exists and its status/amount/currency/date, but must NOT read the guest's uploaded
    // transfer screenshot (proofAssetUrl), the provider reference, or internal admin fields.
    const isPrivileged =
      context.roles.includes('ADMIN') ||
      context.roles.includes('SUPPORT') ||
      booking.guestId === context.user.id
    const safeBooking = isPrivileged
      ? booking
      : {
          ...booking,
          payments: (booking.payments || []).map((p) => ({
            ...p,
            proofAssetUrl: undefined,
            adminNote: undefined,
            reviewedById: undefined,
            providerRef: undefined,
          })),
        }

    return json(res, 200, { ok: true, booking: safeBooking })
  }

  if (url.pathname !== '/api/bookings') return false
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  requireAuth(context, ['GUEST'])
  const body = await readJson(req)
  const checkIn = body.checkIn ? new Date(body.checkIn) : undefined
  const checkOut = body.checkOut ? new Date(body.checkOut) : undefined
  if ((checkIn && Number.isNaN(checkIn.getTime())) || (checkOut && Number.isNaN(checkOut.getTime())) || (checkIn && checkOut && checkOut <= checkIn)) {
    const error = new Error('Booking dates must be valid and check-out must be after check-in.')
    error.statusCode = 400
    error.code = 'BOOKING_DATES_INVALID'
    error.expose = true
    throw error
  }

  const listing = await db().listing.findFirst({
    where: {
      id: body.listingId,
      status: 'APPROVED',
    },
  })

  if (!listing) {
    const error = new Error('Listing is not available for booking.')
    error.statusCode = 404
    error.code = 'LISTING_NOT_BOOKABLE'
    error.expose = true
    throw error
  }

  // SELF-REVIEW guard (root): a host cannot book their own listing — which would let them drive it to
  // COMPLETED and post a 5-star self-review to inflate their own rating.
  if (listing.ownerId === context.user.id) {
    const error = new Error('You cannot book your own listing.')
    error.statusCode = 400
    error.code = 'CANNOT_BOOK_OWN_LISTING'
    error.expose = true
    throw error
  }

  const isShortStay = listing.division === 'STAYS'

  // The overlap check and the create used to be two separate, unguarded round-trips: two guests
  // requesting the same listing/dates within a race window could both pass the check before
  // either committed, double-booking the listing. A DB-level exclusion constraint would need raw
  // DDL (btree_gist), so instead we serialize concurrent requests for the same listing with a
  // transaction-scoped Postgres advisory lock — same bug class already fixed for SR rides and
  // wallet gifts, adapted here since there's no single row to re-check inside a WHERE clause.
  const booking = await db().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${listing.id}))`

    if (checkIn && checkOut) {
      const [overlappingBooking, blockedDate] = await Promise.all([
        tx.booking.findFirst({
          where: {
            listingId: listing.id,
            status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] },
            checkIn: { lt: checkOut },
            checkOut: { gt: checkIn },
          },
        }),
        tx.listingAvailability.findFirst({
          where: {
            listingId: listing.id,
            status: 'BLOCKED',
            date: { gte: checkIn, lt: checkOut },
          },
        }),
      ])

      if (overlappingBooking || blockedDate) {
        const error = new Error('These dates are no longer available for this listing.')
        error.statusCode = 409
        error.code = 'BOOKING_DATES_UNAVAILABLE'
        error.expose = true
        throw error
      }
    }

    const quote = isShortStay && checkIn && checkOut
      ? await computeStayTotalMinor(listing, checkIn, checkOut)
      : { totalMinor: listing.priceMinor, nights: 0, perNight: [] }

    // The listing itself is always priced in SYP; a guest who chose to pay in USD (matching
    // whatever they were quoted at GET /api/listings/:id/quote?currency=USD) gets the exact same
    // conversion + round-up-to-$5 applied here, so the booking is never created for a different
    // amount than what was quoted.
    const wantsUsd = body.currency === 'USD'
    const amountMinor = wantsUsd ? sypMinorToRoundedUsdMinor(quote.totalMinor) : quote.totalMinor
    const currency = wantsUsd ? 'USD' : listing.currency

    // SECURITY (S2): cancellation-protection is a SERVER-computed 3% premium on the stay. The guest only
    // chooses WHETHER to buy it (a boolean) — they can NEVER set the fee amount from the request body.
    // booking.amountMinor stays the clean stay total (fees + protection are added at charge time by
    // expectedTotalMinor and reconciled by bookingFinanceSplit). Storing the server-computed fee here
    // closes two exploits: (a) free protection via a token fee, and (b) a huge forged fee that carves out
    // the host's payout base (finance-ledger subtracts cancellationProtectionFeeMinor from the split base).
    const protectionPurchased = body.cancellationProtectionPurchased === true || body.cancellationProtection === true
    const protectionFeeMinor = protectionPurchased ? Math.round(amountMinor * CANCELLATION_PROTECTION_RATE) : 0

    return tx.booking.create({
      data: {
        listingId: listing.id,
        guestId: context.user.id,
        status: 'PAYMENT_PENDING',
        checkIn,
        checkOut,
        amountMinor,
        currency,
        metadata: protectionPurchased
          ? {
              cancellationProtectionPurchased: true,
              cancellationProtectionFeeMinor: protectionFeeMinor,
              cancellationProtectionVersion: 'SYBNB_GUEST_CANCELLATION_PROTECTION_V1',
            }
          : {},
      },
    })
  })

  return json(res, 201, { ok: true, booking })
}

export function isBookingViewable(booking, context) {
  return (
    context.roles.includes('ADMIN') ||
    context.roles.includes('SUPPORT') ||
    booking.guestId === context.user.id ||
    booking.listing.ownerId === context.user.id
  )
}

// NOTE (S2): cancellation-protection metadata is now built inline at booking creation from a SERVER-computed
// fee (never the request body). The former buildBookingMetadata() helper, which trusted
// body.cancellationProtectionFeeMinor, has been removed to eliminate the fee-forgery path.
