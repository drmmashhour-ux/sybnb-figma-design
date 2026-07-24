import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import {
  CANCELLATION_PROTECTION_RATE,
  bookingFinanceSplit,
  originalAdminShareRecipient,
  recordWalletEntry,
  strCommissionRateForBooking,
} from '../lib/finance-ledger.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { computeGuestBookingTotalMinor, computeStayTotalMinor } from '../lib/pricing.mjs'
import { amountToRoundedUsd, stayQuoteToRoundedUsd } from '../lib/currency.mjs'
import { strLateCancelFeeMinor, DEFAULT_COUNTRY } from '../lib/country-config.mjs'
import { getOperationalDocumentStatuses } from '../lib/listing-document-retention.mjs'
import { assertBoundedString, assertNoUnknownFields, assertValidEmail, assertValidPhone } from '../lib/validate.mjs'
import { assertBookingWithinMontrealSeasonAndCap } from '../lib/quebec-str-rules.mjs'
import { DELIVERY_STATUS, bookingTrackUrl, notify } from '../lib/notifications.mjs'

// Matches the frictionless-guest display name set at account creation (server/routes/auth.mjs
// POST /api/auth/checkout-guest) -- only overwritten by the real name below if it's still exactly
// this placeholder, so a guest who registered normally with their own chosen name is never clobbered.
const FRICTIONLESS_GUEST_PLACEHOLDER_NAME = 'SYBNB Guest'

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
      const split = bookingFinanceSplit(existing, approvedPayment?.amountMinor || existing.amountMinor, await strCommissionRateForBooking(tx, existing))

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

  // Replaces the old ID-upload-before-payment gate: instead of requiring a photo ID, the guest
  // gives their real name + phone right before paying, so the platform still has a way to reach
  // them (host contact, dispute follow-up) without the heavier KYC-style friction. Stored on the
  // booking (not just the user) since a device-bound frictionless guest can have several bookings
  // and each one's contact details are entered independently.
  const contactMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/contact$/)
  if (contactMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context)
    const body = await readJson(req)
    assertNoUnknownFields(body, ['guestName', 'guestPhone', 'guestEmail'], 'booking contact body')
    const guestName = assertBoundedString(body.guestName, { fieldName: 'guestName', maxLength: 120, required: true })
    const guestPhone = assertValidPhone(body.guestPhone, 'guestPhone')
    if (!guestPhone) {
      const error = new Error('guestPhone is required.')
      error.statusCode = 400
      error.code = 'VALIDATION_REQUIRED'
      error.expose = true
      throw error
    }
    // FIX 2: capture the guest email so a real confirmation can be sent. assertValidEmail rejects a
    // malformed address (400 VALIDATION_INVALID_EMAIL) but treats a missing one as optional: the client
    // requires + confirm-matches it, while older callers with no email keep working (no confirmation).
    const guestEmail = assertValidEmail(body.guestEmail, 'guestEmail')

    const existing = await db().booking.findFirst({ where: { id: contactMatch[1], guestId: context.user.id } })
    if (!existing) {
      const error = new Error('Booking not found for this guest account.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }

    const contactMetadata = {
      ...(existing.metadata || {}),
      guestContactName: guestName,
      guestContactPhone: guestPhone,
      ...(guestEmail ? { guestContactEmail: guestEmail } : {}),
    }
    const [updated] = await db().$transaction([
      db().booking.update({ where: { id: existing.id }, data: { metadata: contactMetadata } }),
      ...(context.user.displayName === FRICTIONLESS_GUEST_PLACEHOLDER_NAME
        ? [db().user.update({ where: { id: context.user.id }, data: { displayName: guestName } })]
        : []),
    ])

    let booking = updated
    // FIX 2: best-effort "booking request received" confirmation AFTER the contact info commits, only when
    // we have an email. notify() never throws, so a mailer outage can't block the workflow;
    // confirmationEmailSent is set true ONLY when the provider actually sent (never faked). The body
    // carries the /#/track?ref link.
    if (guestEmail) {
      const ref = existing.id.slice(0, 12).toUpperCase()
      const delivery = await notify({
        event: 'BOOKING_SUBMITTED',
        to: guestEmail,
        locale: context.user.locale,
        data: { ref, trackUrl: bookingTrackUrl(ref) },
        entityId: existing.id,
        recipientRef: context.user.id,
      })
      const confirmationEmailSent = delivery.status === DELIVERY_STATUS.SENT
      booking = await db().booking.update({
        where: { id: existing.id },
        data: { metadata: { ...contactMetadata, confirmationEmailSent } },
      })
    }

    return json(res, 200, { ok: true, booking })
  }

  // Public, unauthenticated trip-status lookup: a guest tracks their trip from ANY device using
  // just the confirmation number shown on the payment page (bookingId.slice(0, 12), the same 12-char
  // prefix already displayed there) plus the phone they gave via PATCH .../contact above -- no
  // login, no session, no device-bound guest account required. The phone is required as a second
  // factor so a 12-char prefix alone (a small, guessable space) can't be used to browse strangers'
  // trips; a booking that never had contact info collected simply can't be looked up this way.
  // Rate-limited (server/index.mjs RATE_LIMIT_RULES) since it's unauthenticated and phone-guessable.
  if (url.pathname === '/api/bookings/lookup') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const refHex = String(url.searchParams.get('ref') || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12)
    const phone = assertValidPhone(url.searchParams.get('phone'), 'phone')
    if (!refHex || refHex.length < 8 || !phone) {
      const error = new Error('A confirmation number and phone number are required.')
      error.statusCode = 400
      error.code = 'BOOKING_LOOKUP_INPUT_INVALID'
      error.expose = true
      throw error
    }
    const idPrefix = refHex.length > 8 ? `${refHex.slice(0, 8)}-${refHex.slice(8, 12)}` : refHex
    const normalizedPhone = phone.replace(/[\s()-]/g, '')

    const candidates = await db().booking.findMany({
      where: { id: { startsWith: idPrefix, mode: 'insensitive' } },
      include: { listing: { select: { titleAr: true, titleEn: true, division: true } } },
      take: 5,
    })
    const booking = candidates.find((row) => {
      const storedPhone = String(row.metadata?.guestContactPhone || '').replace(/[\s()-]/g, '')
      return storedPhone && storedPhone === normalizedPhone
    })

    if (!booking) {
      const error = new Error('No trip found for this confirmation number and phone number.')
      error.statusCode = 404
      error.code = 'BOOKING_LOOKUP_NOT_FOUND'
      error.expose = true
      throw error
    }

    const latestPayment = await db().paymentProof.findFirst({
      where: { bookingId: booking.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    })

    return json(res, 200, {
      ok: true,
      trip: {
        confirmationNumber: booking.id.slice(0, 12).toUpperCase(),
        status: booking.status,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        listingTitleAr: booking.listing?.titleAr || null,
        listingTitleEn: booking.listing?.titleEn || null,
        division: booking.listing?.division || null,
        paymentStatus: latestPayment?.status || null,
      },
    })
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

  // FIX 3: reject a check-in in the past before any hold/"awaiting payment proof" state is created.
  // Generic booking-validity guard, division-agnostic and placed before/separate from the CITQ block
  // below (it touches no Quebec compliance logic). Date-only comparison so a booking for today is allowed.
  if (body.checkIn) {
    const todayIso = new Date().toISOString().slice(0, 10)
    const checkInIso = String(body.checkIn).slice(0, 10)
    if (checkInIso < todayIso) {
      const error = new Error('Check-in date cannot be in the past.')
      error.statusCode = 400
      error.code = 'BOOKING_DATE_IN_PAST'
      error.expose = true
      throw error
    }
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

  // Jurisdiction pricing engine (030): a Quebec STAYS listing's CITQ certificate can expire AFTER
  // approval -- this re-checks at every new booking, not just at submission time
  // (assertListingAttributes in listing-attributes.mjs only runs when the host submits for review).
  // An already-approved listing with a since-expired certificate can no longer take new bookings.
  if (listing.division === 'STAYS' && listing.metadata?.country === 'CA') {
    const expiresAt = listing.metadata?.citqCertificateExpiresAt ? new Date(listing.metadata.citqCertificateExpiresAt) : null
    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      const error = new Error('This listing’s Quebec tourist-accommodation registration (CITQ) certificate is missing or has expired. New bookings are blocked until the host renews it.')
      error.statusCode = 403
      error.code = 'CITQ_CERTIFICATE_EXPIRED'
      error.expose = true
      throw error
    }
    // Québec compliance review (item 1): an expiry date the host typed in is not proof -- the
    // actual certificate file must be uploaded and admin-approved. A missing, still-pending, or
    // rejected certificate blocks new bookings the same way an expired one does.
    const certificateDoc = await db().listingDocument.findFirst({
      where: { listingId: listing.id, type: 'CITQ_CERTIFICATE', isCurrent: true }, select: { status: true },
    })
    if (!getOperationalDocumentStatuses().includes(certificateDoc?.status)) {
      const error = new Error('This listing’s Quebec tourist-accommodation registration (CITQ) certificate has not been reviewed by SYBNB yet. New bookings are blocked until an admin reviews the uploaded certificate.')
      error.statusCode = 403
      error.code = 'CITQ_CERTIFICATE_NOT_VERIFIED'
      error.expose = true
      throw error
    }
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
      await assertBookingWithinMontrealSeasonAndCap(tx, listing, checkIn, checkOut)

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

    // A listing's own price is SYP unless the host explicitly priced it in USD (listing.currency).
    // A guest who chose to pay in USD (matching whatever they were quoted at
    // GET /api/listings/:id/quote?currency=USD) gets the exact same conversion + round-up-to-$5
    // applied here, so the booking is never created for a different amount than what was quoted --
    // and, same as the quote endpoint, a listing already priced in USD is never run through the SYP
    // conversion (that would collapse its real price to the $5 floor). For an actual per-night stay
    // quote, each night is rounded and summed (stayQuoteToRoundedUsd) so the total scales with
    // nights; a single-price listing (no perNight breakdown) rounds that one amount directly.
    const wantsUsd = body.currency === 'USD'
    const nightlySubtotalMinor = wantsUsd
      ? (quote.perNight.length ? stayQuoteToRoundedUsd(quote, listing.currency).totalMinor : amountToRoundedUsd(quote.totalMinor, listing.currency))
      : quote.totalMinor
    const currency = wantsUsd ? 'USD' : listing.currency

    // Money-model correction (2026-07-22): booking.amountMinor is now the FINAL all-inclusive guest
    // total confirmed at checkout -- nightly subtotal + cleaning fee + any other currently-supported
    // mandatory charge (computeGuestBookingTotalMinor) -- never just the "clean" nightly total. This
    // is what fixed the checkout mismatch: a guest who confirms and pays exactly booking.amountMinor
    // is never asked for more at charge time. Québec lodging tax stays disclosure-only (explicit
    // product decision) and is deliberately not part of this total. Cancellation protection remains
    // a separate, optional add-on computed below and is never folded into amountMinor itself.
    const amountMinor = isShortStay
      ? computeGuestBookingTotalMinor({ nightlySubtotalMinor, listingMetadata: listing.metadata }).amountMinor
      : nightlySubtotalMinor

    // SECURITY (S2): cancellation-protection is a SERVER-computed 3% premium on the stay. The guest only
    // chooses WHETHER to buy it (a boolean) — they can NEVER set the fee amount from the request body.
    // The premium is computed on the full all-inclusive amountMinor above (what the guest actually
    // stands to lose if they must cancel), tracked separately in booking.metadata, and added on top
    // only at charge time (server/routes/payments.mjs's expectedTotalMinor) — never folded into
    // amountMinor itself. Storing the server-computed fee here closes two exploits: (a) free
    // protection via a token fee, and (b) a huge forged fee that carves out the host's payout base
    // (finance-ledger subtracts cancellationProtectionFeeMinor from the split base).
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
