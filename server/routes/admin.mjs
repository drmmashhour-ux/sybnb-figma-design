import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { approvePaymentProof, bookingFinanceSplit, lockWalletForSpend, originalAdminShareRecipient, recordWalletEntry } from '../lib/finance-ledger.mjs'
import { completeExpiredBookings, isPayoutEligible, payoutEligibleAt, PAYOUT_HOLD_DAYS } from '../lib/booking-lifecycle.mjs'
import { FREE_TIER_DIVISIONS, freeListingExpiryDate, listingExpiryDate, PAID_PLAN_DIVISIONS } from '../lib/listing-lifecycle.mjs'
import { assertVehicleEligible, computeDriverStanding } from '../lib/fleet.mjs'
import { refundGiftToSender } from '../lib/gift-ledger.mjs'
import { deleteIdDocument, readIdDocument, saveIdDocument } from '../lib/id-document-storage.mjs'
import { readDriverDocument } from '../lib/driver-document-storage.mjs'
import { hashPassword, idempotencyKey } from '../lib/security.mjs'
import { assertBoundedString, assertNoUnknownFields, assertValidEmail } from '../lib/validate.mjs'
import { generateUniqueReferralCode } from '../lib/referrals.mjs'
import { randomUUID } from 'node:crypto'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'

// The internal staff roles the HR department manages/creates. Deliberately NOT HOST/DRIVER/SELLER
// (those self-register through the normal flow) — only privileged back-office roles.
const STAFF_ROLES = ['ADMIN', 'SUPPORT']
const STAFF_EMAIL_DOMAIN = '@sybnb.app'

// Surface only what admin needs to push a payout — type, holder, last4. The encrypted number
// envelope (ciphertext/iv/tag stored in User.payoutMethod) must never reach the admin client.
function safeHostPayoutMethod(payoutMethod) {
  if (!payoutMethod || typeof payoutMethod !== 'object' || payoutMethod.type !== 'sham_cash') {
    return null
  }
  return {
    type: 'sham_cash',
    accountHolder: payoutMethod.accountHolder || '',
    last4: payoutMethod.last4 || '',
  }
}

function payoutNotEligibleError() {
  const error = new Error(
    `Payout is not eligible for release yet. It must be COMPLETED and past the ${PAYOUT_HOLD_DAYS}-day hold, with no open dispute.`,
  )
  error.statusCode = 400
  error.code = 'PAYOUT_NOT_ELIGIBLE'
  error.expose = true
  return error
}

export async function handleAdmin(req, res, url, context) {
  const hideReviewMatch = url.pathname.match(/^\/api\/admin\/reviews\/([^/]+)\/hide$/)
  if (hideReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const existing = await db().listingReview.findUnique({ where: { id: hideReviewMatch[1] } })
    if (!existing) {
      const error = new Error('Review not found.')
      error.statusCode = 404
      error.code = 'REVIEW_NOT_FOUND'
      error.expose = true
      throw error
    }

    const review = await db().listingReview.update({
      where: { id: existing.id },
      data: { hiddenAt: new Date(), hiddenByAdminId: context.user.id },
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_REVIEW_HIDDEN',
        entityType: 'listing_reviews',
        entityId: review.id,
        before: existing,
        after: review,
      },
    })

    return json(res, 200, { ok: true, review })
  }

  if (url.pathname === '/api/admin/host-insights') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN'])
    const insights = await db().hostInsight.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        host: { select: { id: true, displayName: true, email: true } },
        listing: { select: { id: true, titleAr: true, titleEn: true } },
      },
    })
    const totals = {
      generated: insights.length,
      emailed: insights.filter((insight) => insight.emailSentAt).length,
      read: insights.filter((insight) => insight.readAt).length,
    }
    return json(res, 200, { ok: true, insights, totals })
  }

  // ---- HR DEPARTMENT — staff/admin directory + creation (owner/super-admin gated) ----
  if (url.pathname === '/api/admin/staff') {
    if (req.method === 'GET') {
      // Reading the staff directory is fine for any back-office role.
      requireAuth(context, ['ADMIN', 'SUPPORT'])
      const staff = await db().user.findMany({
        where: { roles: { some: { role: { in: STAFF_ROLES } } } },
        select: {
          id: true,
          displayName: true,
          email: true,
          createdAt: true,
          roles: { select: { role: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      })
      return json(res, 200, {
        ok: true,
        staff: staff.map((user) => ({
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          createdAt: user.createdAt,
          roles: user.roles.map((entry) => entry.role),
        })),
      })
    }

    if (req.method === 'POST') {
      // SENSITIVE: creating a privileged account. Restricted to ADMIN — the most-privileged guard
      // this platform has (ADMIN cannot self-register, so an ADMIN is the effective owner/super-admin).
      // Deliberately NOT ['ADMIN','SUPPORT'] — SUPPORT must not be able to mint new admins.
      requireAuth(context, ['ADMIN'])
      const body = await readJson(req)
      assertNoUnknownFields(body, ['displayName', 'email', 'role'], 'staff body')

      const displayName = assertBoundedString(body.displayName, {
        fieldName: 'displayName',
        maxLength: 120,
        required: true,
      })
      const email = assertValidEmail(body.email)
      if (!email) {
        const error = new Error('A staff email address is required.')
        error.statusCode = 400
        error.code = 'STAFF_EMAIL_REQUIRED'
        error.expose = true
        throw error
      }
      if (!email.endsWith(STAFF_EMAIL_DOMAIN)) {
        const error = new Error(`Staff email must be on the ${STAFF_EMAIL_DOMAIN} domain.`)
        error.statusCode = 400
        error.code = 'STAFF_EMAIL_DOMAIN_INVALID'
        error.expose = true
        throw error
      }
      const role = String(body.role || '').toUpperCase()
      if (!STAFF_ROLES.includes(role)) {
        const error = new Error(`Staff role must be one of: ${STAFF_ROLES.join(', ')}.`)
        error.statusCode = 400
        error.code = 'STAFF_ROLE_INVALID'
        error.expose = true
        throw error
      }

      // The account is created with a random, unusable password. The staff member activates it via
      // the existing password-reset OTP to their real @sybnb.app mailbox (created separately in
      // Google Workspace — this endpoint never provisions a mailbox).
      const passwordHash = hashPassword(`${randomUUID()}${randomUUID()}`)

      try {
        const created = await db().$transaction(async (tx) => {
          const referralCode = await generateUniqueReferralCode(tx)
          return tx.user.create({
            data: {
              email,
              passwordHash,
              displayName,
              referralCode,
              roles: { create: { role } },
              wallets: { create: { currency: 'SYP' } },
            },
            include: { roles: true },
          })
        })

        await db().adminAuditLog.create({
          data: {
            actorUserId: context.user.id,
            action: 'ADMIN_STAFF_CREATED',
            entityType: 'users',
            entityId: created.id,
            before: null,
            after: { email, role, displayName },
          },
        })

        return json(res, 201, {
          ok: true,
          staff: {
            id: created.id,
            displayName: created.displayName,
            email: created.email,
            createdAt: created.createdAt,
            roles: created.roles.map((entry) => entry.role),
          },
        })
      } catch (error) {
        if (error?.code === 'P2002') {
          const conflict = new Error('An account with this email already exists.')
          conflict.statusCode = 409
          conflict.code = 'ACCOUNT_ALREADY_EXISTS'
          conflict.expose = true
          throw conflict
        }
        throw error
      }
    }

    return methodNotAllowed(res, ['GET', 'POST'])
  }

  if (url.pathname === '/api/admin/payouts') {
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    await completeExpiredBookings()

    if (req.method === 'GET') {
      const completedBookings = await db().booking.findMany({
        where: { status: 'COMPLETED' },
        include: {
          listing: { include: { owner: { select: { id: true, displayName: true, payoutMethod: true } } } },
          payments: true,
        },
        orderBy: { checkOut: 'asc' },
        take: 100,
      })

      const releasedBookingIds = new Set(
        (
          await db().walletEntry.findMany({
            where: {
              referenceType: 'booking_payout',
              type: 'RELEASE',
              referenceId: { in: completedBookings.map((b) => b.id) },
            },
            select: { referenceId: true },
          })
        ).map((entry) => entry.referenceId),
      )

      const payouts = completedBookings
        .filter((booking) => !releasedBookingIds.has(booking.id))
        .map((booking) => {
          const approvedPayment = booking.payments.find((payment) => payment.status === 'APPROVED')
          const split = bookingFinanceSplit(booking, approvedPayment?.amountMinor || booking.amountMinor)
          return {
            bookingId: booking.id,
            listingTitle: booking.listing?.titleAr,
            hostId: booking.listing?.ownerId,
            hostName: booking.listing?.owner?.displayName,
            hostPayoutMethod: safeHostPayoutMethod(booking.listing?.owner?.payoutMethod),
            checkOut: booking.checkOut,
            eligibleAt: payoutEligibleAt(booking.checkOut),
            eligibleNow: isPayoutEligible(booking),
            hostPayoutMinor: split.hostGrossMinor,
            currency: booking.currency,
          }
        })

      return json(res, 200, { ok: true, payouts, holdDays: PAYOUT_HOLD_DAYS })
    }

    return methodNotAllowed(res, ['GET'])
  }

  const payoutReleaseMatch = url.pathname.match(/^\/api\/admin\/payouts\/([^/]+)\/release$/)
  if (payoutReleaseMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    const booking = await db().booking.findUnique({
      where: { id: payoutReleaseMatch[1] },
      include: { listing: true, payments: true },
    })

    if (!booking) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }

    const entry = await db().$transaction(async (tx) => {
      // TOCTOU-safe: claim the row on the exact status we require, then re-load and re-check payout
      // eligibility INSIDE the transaction — so a concurrent state change (dispute, re-open) between the
      // outer read and here can never let a payout be released against a no-longer-eligible booking.
      const guarded = await tx.booking.updateMany({
        where: { id: booking.id, status: 'COMPLETED' },
        data: { updatedAt: new Date() },
      })
      if (guarded.count !== 1) throw payoutNotEligibleError()

      const freshBooking = await tx.booking.findUnique({
        where: { id: booking.id },
        include: { listing: true, payments: true },
      })
      if (!freshBooking || !isPayoutEligible(freshBooking)) throw payoutNotEligibleError()

      const approvedPayment = freshBooking.payments.find((payment) => payment.status === 'APPROVED')
      const split = bookingFinanceSplit(freshBooking, approvedPayment?.amountMinor || freshBooking.amountMinor)
      const released = await recordWalletEntry(tx, {
        userId: freshBooking.listing.ownerId,
        type: 'RELEASE',
        amountMinor: split.hostGrossMinor,
        currency: freshBooking.currency,
        referenceType: 'booking_payout',
        referenceId: freshBooking.id,
        keyParts: ['booking-host-release', freshBooking.id, approvedPayment?.id],
        note: `Host payout released by admin after the ${PAYOUT_HOLD_DAYS}-day hold following stay completion.`,
      })

      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'ADMIN_PAYOUT_RELEASED',
          entityType: 'bookings',
          entityId: freshBooking.id,
          before: freshBooking,
          after: { walletEntry: released },
        },
      })

      return released
    })

    return json(res, 200, { ok: true, walletEntry: entry })
  }

  if (url.pathname === '/api/admin/review-queue') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    await completeExpiredBookings()
    const [listings, payments, gifts, bookings, idDocuments] = await Promise.all([
      db().listing.findMany({ where: { status: 'PENDING_REVIEW' }, take: 25 }),
      db().paymentProof.findMany({
        where: { status: 'PENDING_ADMIN_REVIEW' },
        include: {
          booking: {
            include: {
              listing: {
                include: {
                  owner: { select: { id: true, displayName: true, email: true, idDocumentStatus: true } },
                },
              },
            },
          },
          payer: { select: { id: true, displayName: true, email: true } },
        },
        take: 25,
      }),
      db().walletGift.findMany({ where: { status: { in: ['CLAIM_PENDING', 'LOCKED'] } }, take: 25 }),
      db().booking.findMany({
        where: { status: { in: ['REQUESTED', 'DISPUTED'] } },
        include: { listing: true },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      db().user.findMany({
        where: { idDocumentStatus: 'PENDING_REVIEW' },
        select: { id: true, displayName: true, email: true, idDocumentMimeType: true, idDocumentSubmittedAt: true },
        take: 25,
      }),
    ])
    return json(res, 200, { ok: true, queue: { listings, payments, gifts, bookings, idDocuments } })
  }

  const idDocumentFileMatch = url.pathname.match(/^\/api\/admin\/id-document\/([^/]+)\/file$/)
  if (idDocumentFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const targetUser = await db().user.findUnique({
      where: { id: idDocumentFileMatch[1] },
      select: { idDocumentRef: true, idDocumentMimeType: true },
    })
    if (!targetUser?.idDocumentRef) {
      const error = new Error('No ID document has been submitted by this user.')
      error.statusCode = 404
      error.code = 'ID_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }

    const buffer = await readIdDocument(targetUser.idDocumentRef)
    res.writeHead(200, {
      'content-type': targetUser.idDocumentMimeType || 'application/octet-stream',
      'cache-control': 'private, no-store',
    })
    res.end(buffer)
    return true
  }

  // Supports the WhatsApp/email ID-submission channel: a guest who doesn't want to upload
  // through the website sends their ID to SYBNB's WhatsApp/email directly, and an admin attaches
  // it to the right account here after finding it by the email the guest signed up with.
  if (url.pathname === '/api/admin/users/lookup') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const email = String(url.searchParams.get('email') || '').trim().toLowerCase()
    if (!email) {
      const error = new Error('An email is required to look up a customer.')
      error.statusCode = 400
      error.code = 'USER_LOOKUP_EMAIL_REQUIRED'
      error.expose = true
      throw error
    }

    const foundUser = await db().user.findUnique({
      where: { email },
      select: ID_DOCUMENT_SAFE_SELECT,
    })
    if (!foundUser) {
      const error = new Error('No account found with this email.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    return json(res, 200, { ok: true, user: foundUser })
  }

  const idDocumentAdminUploadMatch = url.pathname.match(/^\/api\/admin\/id-document\/([^/]+)\/upload$/)
  if (idDocumentAdminUploadMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const body = await readJson(req)
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
    if (!fileBase64 || !mimeType) {
      const error = new Error('An ID document file is required.')
      error.statusCode = 400
      error.code = 'ID_DOCUMENT_REQUIRED'
      error.expose = true
      throw error
    }

    const targetUserId = idDocumentAdminUploadMatch[1]
    const previous = await db().user.findUnique({ where: { id: targetUserId }, select: { idDocumentRef: true } })
    if (!previous) {
      const error = new Error('Customer not found.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    const storageKey = await saveIdDocument(fileBase64, mimeType)
    const updated = await db().user.update({
      where: { id: targetUserId },
      data: {
        idDocumentRef: storageKey,
        idDocumentMimeType: mimeType,
        idDocumentSubmittedAt: new Date(),
        idDocumentStatus: 'PENDING_REVIEW',
        idDocumentReviewedById: null,
        idDocumentReviewedAt: null,
      },
      select: ID_DOCUMENT_SAFE_SELECT,
    })

    if (previous.idDocumentRef && previous.idDocumentRef !== storageKey) {
      await deleteIdDocument(previous.idDocumentRef)
    }

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ID_DOCUMENT_UPLOADED_BY_ADMIN',
        entityType: 'iddocuments',
        entityId: targetUserId,
        before: {},
        after: updated,
      },
    })

    return json(res, 200, { ok: true, user: updated })
  }

  if (url.pathname === '/api/admin/audit-log') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100)
    const auditLog = await db().adminAuditLog.findMany({
      include: {
        actor: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return json(res, 200, { ok: true, auditLog })
  }

  if (url.pathname === '/api/admin/platform-metrics') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const [
      usersByRole,
      listingsByDivision,
      listingsByStatus,
      bookingsByStatus,
      ridesByStatus,
      paymentsByStatus,
      giftsByStatus,
      wallets,
      approvedPaymentVolume,
    ] = await Promise.all([
      db().userRole.groupBy({ by: ['role'], _count: { _all: true } }),
      db().listing.groupBy({ by: ['division'], _count: { _all: true }, orderBy: { division: 'asc' } }),
      db().listing.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().booking.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().rideRequest.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().paymentProof.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().walletGift.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().wallet.aggregate({ _count: { _all: true }, _sum: { cachedBalanceMinor: true } }),
      db().paymentProof.aggregate({
        where: { status: 'APPROVED' },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
    ])

    return json(res, 200, {
      ok: true,
      metrics: {
        usersByRole: toCountMap(usersByRole, 'role'),
        listingsByDivision: toCountMap(listingsByDivision, 'division'),
        listingsByStatus: toCountMap(listingsByStatus, 'status'),
        bookingsByStatus: toCountMap(bookingsByStatus, 'status'),
        ridesByStatus: toCountMap(ridesByStatus, 'status'),
        paymentsByStatus: toCountMap(paymentsByStatus, 'status'),
        giftsByStatus: toCountMap(giftsByStatus, 'status'),
        walletCount: wallets._count._all,
        walletBalanceMinor: wallets._sum.cachedBalanceMinor || 0,
        approvedPaymentCount: approvedPaymentVolume._count._all,
        approvedPaymentVolumeMinor: approvedPaymentVolume._sum.amountMinor || 0,
      },
    })
  }

  if (url.pathname === '/api/admin/revenue-summary') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    // Platform revenue today is exactly three real wallet-entry kinds: the STR admin commission
    // share, the (non-refundable) cancellation-protection fee, and the seller/dealer/developer
    // plan fee — all recorded as CREDIT entries by approvePaymentProof() in finance-ledger.mjs.
    // SR rides currently record zero platform commission (the full fare is a driver-side figure
    // only, never credited to an admin wallet) — that's surfaced explicitly below rather than
    // silently folded into "revenue".
    const [commissionEntries, completedSrRides] = await Promise.all([
      db().walletEntry.findMany({
        where: { type: 'CREDIT', referenceType: { in: ['booking_admin_share', 'booking_protection_fee', 'seller_plan_fee'] } },
        select: { amountMinor: true, currency: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      db().rideRequest.aggregate({
        where: { status: 'COMPLETED' },
        _count: { _all: true },
        _sum: { fareMinor: true },
      }),
    ])

    // Seller-plan fees default to USD while booking commission is SYP (see payments.mjs /
    // bookingFinanceSplit) — summing different currencies' minor units together as one number
    // would silently misreport the total, so each currency gets its own totals/history/projection
    // instead of being flattened into a single (wrongly-labeled) figure.
    const entriesByCurrency = new Map()
    for (const entry of commissionEntries) {
      if (!entriesByCurrency.has(entry.currency)) entriesByCurrency.set(entry.currency, [])
      entriesByCurrency.get(entry.currency).push(entry)
    }

    const byCurrency = Array.from(entriesByCurrency.entries())
      .map(([currency, entries]) => {
        const totalRevenueMinor = entries.reduce((sum, entry) => sum + entry.amountMinor, 0)

        const dailyTotals = new Map()
        for (const entry of entries) {
          const day = entry.createdAt.toISOString().slice(0, 10)
          dailyTotals.set(day, (dailyTotals.get(day) || 0) + entry.amountMinor)
        }
        const history = Array.from(dailyTotals.entries())
          .map(([day, amountMinor]) => ({ day, amountMinor }))
          .sort((a, b) => a.day.localeCompare(b.day))

        const firstDay = new Date(entries[0].createdAt)
        const lastDay = new Date(entries[entries.length - 1].createdAt)
        // +1 so a single day of data still divides by 1, not 0.
        const elapsedDays = Math.max(1, Math.ceil((lastDay.getTime() - firstDay.getTime()) / 86400000) + 1)
        const dailyAverageMinor = totalRevenueMinor / elapsedDays

        return {
          currency,
          totalRevenueMinor,
          sampleSize: entries.length,
          history,
          projection: {
            elapsedDays,
            dailyAverageMinor: Math.round(dailyAverageMinor),
            next30DaysMinor: Math.round(dailyAverageMinor * 30),
            next90DaysMinor: Math.round(dailyAverageMinor * 90),
          },
        }
      })
      .sort((a, b) => b.sampleSize - a.sampleSize)

    return json(res, 200, {
      ok: true,
      revenue: {
        byCurrency,
        srRidesCompletedCount: completedSrRides._count._all,
        srRidesFareVolumeMinor: completedSrRides._sum.fareMinor || 0,
      },
    })
  }

  const approveAllMatch = url.pathname.match(/^\/api\/admin\/accommodations\/([^/]+)\/approve-all$/)
  if (approveAllMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const accommodationId = approveAllMatch[1]

    const result = await db().$transaction(async (tx) => {
      const accommodation = await tx.accommodation.findUnique({ where: { id: accommodationId } })
      if (!accommodation) {
        const error = new Error('Accommodation not found.')
        error.statusCode = 404
        error.code = 'ACCOMMODATION_NOT_FOUND'
        error.expose = true
        throw error
      }

      const pendingListings = await tx.listing.findMany({
        where: { accommodationId, status: 'PENDING_REVIEW' },
        select: { id: true },
      })
      // Same TOCTOU-safe re-check-in-WHERE pattern as the single-listing review-queue approval
      // below — each room type is updated individually so a concurrent decision on one room type
      // can't silently double-apply.
      for (const pending of pendingListings) {
        await tx.listing.updateMany({ where: { id: pending.id, status: 'PENDING_REVIEW' }, data: { status: 'APPROVED' } })
      }

      const accommodationUpdate =
        accommodation.status === 'PENDING_REVIEW' ? { status: 'APPROVED' } : {}
      const updatedAccommodation = await tx.accommodation.update({
        where: { id: accommodationId },
        data: accommodationUpdate,
      })

      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'REVIEW_APPROVED',
          entityType: 'accommodation',
          entityId: accommodationId,
          before: { pendingListingIds: pendingListings.map((listing) => listing.id) },
          after: { approvedListingIds: pendingListings.map((listing) => listing.id) },
        },
      })

      return { accommodation: updatedAccommodation, approvedListingIds: pendingListings.map((listing) => listing.id) }
    })

    return json(res, 200, { ok: true, ...result })
  }

  const reviewMatch = url.pathname.match(/^\/api\/admin\/review-queue\/([^/]+)\/([^/]+)$/)
  if (reviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const [entityType, entityId] = reviewMatch.slice(1)
    const decision = normalizeDecision(body.decision || body.action)
    const result = await db().$transaction(async (tx) => {
      const before = await findReviewEntity(tx, entityType, entityId)
      const after = await updateReviewEntity(tx, entityType, entityId, decision, context.user.id, body)
      const auditLog = await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `REVIEW_${decision}`,
          entityType,
          entityId,
          before: before || {},
          after: after || {},
        },
      })
      return { entity: after, auditLog }
    })
    return json(res, 200, { ok: true, ...result })
  }

  // ---- SR SAFETY (014): SOS triage ----
  if (url.pathname === '/api/admin/sos') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const sos = await db().sosEvent.findMany({
      where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, take: 100,
      include: {
        raisedBy: { select: { id: true, displayName: true } },
        ride: {
          select: {
            id: true, status: true, riderId: true, driverId: true,
            rider: { select: { id: true, displayName: true, email: true } },
            driver: { select: { id: true, displayName: true, email: true } },
          },
        },
      },
    })
    return json(res, 200, { ok: true, sos })
  }

  // ---- FLEET (020): driver directory — paginated, filterable, for operating a large fleet ----
  if (url.pathname === '/api/admin/drivers') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const params = url.searchParams
    const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get('pageSize') || '25', 10) || 25))
    const statusFilter = params.get('status') // ACTIVE | SUSPENDED | DELETED
    const verifiedFilter = params.get('verified') // 'true' | 'false'
    const search = (params.get('search') || '').trim()

    const where = {
      roles: { some: { role: 'DRIVER' } },
      ...(['ACTIVE', 'SUSPENDED', 'DELETED'].includes(statusFilter) ? { status: statusFilter } : {}),
      ...(verifiedFilter === 'true' ? { idDocumentStatus: 'APPROVED' } : {}),
      ...(verifiedFilter === 'false' ? { NOT: { idDocumentStatus: 'APPROVED' } } : {}),
      ...(search ? { OR: [{ displayName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}),
    }

    const [total, drivers] = await Promise.all([
      db().user.count({ where }),
      db().user.findMany({
        where,
        select: { id: true, displayName: true, email: true, status: true, idDocumentStatus: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return json(res, 200, { ok: true, drivers, page, pageSize, total, pages: Math.ceil(total / pageSize) })
  }

  // ---- FLEET (020): suspend / reinstate / remove a driver account (the fleet kill switch) ----
  const driverStatusMatch = url.pathname.match(/^\/api\/admin\/drivers\/([^/]+)\/status$/)
  if (driverStatusMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const nextStatus = String(body.status || '').toUpperCase()
    if (!['ACTIVE', 'SUSPENDED', 'DELETED'].includes(nextStatus)) {
      const error = new Error('status must be ACTIVE, SUSPENDED, or DELETED.')
      error.statusCode = 400
      error.code = 'ACCOUNT_STATUS_INVALID'
      error.expose = true
      throw error
    }
    const reason = body.reason ? assertBoundedString(body.reason, { fieldName: 'reason', maxLength: 500 }) : null
    const driver = await db().user.findFirst({ where: { id: driverStatusMatch[1], roles: { some: { role: 'DRIVER' } } } })
    if (!driver) {
      const error = new Error('Driver not found.')
      error.statusCode = 404
      error.code = 'DRIVER_NOT_FOUND'
      error.expose = true
      throw error
    }
    const updated = await db().$transaction(async (tx) => {
      // Bumping sessionVersion on suspend/remove instantly invalidates the driver's existing tokens, so a
      // suspended driver is logged out on their next request — not just blocked at next login.
      const bumpSession = nextStatus !== 'ACTIVE'
      const u = await tx.user.update({
        where: { id: driver.id },
        data: { status: nextStatus, ...(bumpSession ? { sessionVersion: { increment: 1 } } : {}) },
        select: { id: true, status: true },
      })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `DRIVER_STATUS_${nextStatus}`,
          entityType: 'users',
          entityId: driver.id,
          before: { status: driver.status },
          after: { status: nextStatus, reason },
        },
      })
      return u
    })
    return json(res, 200, { ok: true, driver: updated })
  }

  // ---- FLEET (020): full driver record — profile, vehicles, verification, and computed standing ----
  const driverRecordMatch = url.pathname.match(/^\/api\/admin\/drivers\/([^/]+)$/)
  if (driverRecordMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const driverId = driverRecordMatch[1]
    const driver = await db().user.findFirst({
      where: { id: driverId, roles: { some: { role: 'DRIVER' } } },
      select: {
        id: true, displayName: true, email: true, status: true, idDocumentStatus: true, createdAt: true,
        driverProfile: { select: { payoutMethod: true, payoutAccountRef: true } },
        driverVehicles: { orderBy: { createdAt: 'desc' } },
        driverDocuments: { select: { id: true, type: true, status: true, reviewedAt: true } },
      },
    })
    if (!driver) {
      const error = new Error('Driver not found.')
      error.statusCode = 404
      error.code = 'DRIVER_NOT_FOUND'
      error.expose = true
      throw error
    }
    const [ratingAgg, completedRides, driverCancellations] = await Promise.all([
      db().rideRating.aggregate({ where: { ratedUserId: driverId, raterRole: 'RIDER' }, _avg: { stars: true }, _count: { _all: true } }),
      db().rideRequest.count({ where: { driverId, status: 'COMPLETED' } }),
      db().driverCancellation.count({ where: { driverId } }),
    ])
    const standing = computeDriverStanding({
      ratingAvg: ratingAgg._avg.stars,
      ratingCount: ratingAgg._count._all,
      completedRides,
      driverCancellations,
    })
    return json(res, 200, { ok: true, driver, standing })
  }

  // ---- FLEET (020): admin approves / rejects a vehicle (age gate re-checked on approval) ----
  const vehicleReviewMatch = url.pathname.match(/^\/api\/admin\/vehicles\/([^/]+)$/)
  if (vehicleReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const body = await readJson(req)
    const decision = String(body.decision || body.action || '').toUpperCase()
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      const error = new Error('decision must be APPROVED or REJECTED.')
      error.statusCode = 400
      error.code = 'VEHICLE_DECISION_INVALID'
      error.expose = true
      throw error
    }
    const note = body.note ? assertBoundedString(body.note, { fieldName: 'note', maxLength: 500 }) : null
    const vehicle = await db().driverVehicle.findUnique({ where: { id: vehicleReviewMatch[1] } })
    if (!vehicle) {
      const error = new Error('Vehicle not found.')
      error.statusCode = 404
      error.code = 'VEHICLE_NOT_FOUND'
      error.expose = true
      throw error
    }
    // Re-run the age gate at approval time — a car that has aged past its tier's limit since submission
    // (or a tier changed underneath it) can never be approved into the fleet.
    if (decision === 'APPROVED') assertVehicleEligible(vehicle)
    const updated = await db().driverVehicle.update({
      where: { id: vehicle.id },
      data: { status: decision, reviewedById: context.user.id, reviewedAt: new Date(), reviewNote: note },
    })
    return json(res, 200, { ok: true, vehicle: updated })
  }

  // ---- SR CANCELLATION (019): a driver's cancellation record, for accountability review ----
  const driverCancellationsMatch = url.pathname.match(/^\/api\/admin\/drivers\/([^/]+)\/cancellations$/)
  if (driverCancellationsMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const driverId = driverCancellationsMatch[1]
    const [count, recent] = await Promise.all([
      db().driverCancellation.count({ where: { driverId } }),
      db().driverCancellation.findMany({
        where: { driverId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, rideId: true, reason: true, createdAt: true },
      }),
    ])
    return json(res, 200, { ok: true, driverId, count, recent })
  }

  const sosResolveMatch = url.pathname.match(/^\/api\/admin\/sos\/([^/]+)\/resolve$/)
  if (sosResolveMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const note = assertBoundedString(body.note, { fieldName: 'note', maxLength: 500 })
    const existing = await db().sosEvent.findUnique({ where: { id: sosResolveMatch[1] } })
    if (!existing) {
      const error = new Error('SOS event not found.')
      error.statusCode = 404
      error.code = 'SOS_NOT_FOUND'
      error.expose = true
      throw error
    }
    const updated = await db().sosEvent.updateMany({
      where: { id: existing.id, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedById: context.user.id, resolvedAt: new Date() },
    })
    if (updated.count === 0) {
      const error = new Error('This SOS event is no longer open.')
      error.statusCode = 409
      error.code = 'SOS_NOT_OPEN'
      error.expose = true
      throw error
    }
    const sosEvent = await db().sosEvent.findUnique({ where: { id: existing.id } })
    await db().adminAuditLog.create({
      data: { actorUserId: context.user.id, action: 'SR_SOS_RESOLVED', entityType: 'sos_events', entityId: sosEvent.id, before: existing, after: note ? { ...sosEvent, resolutionNote: note } : sosEvent },
    })
    return json(res, 200, { ok: true, sosEvent })
  }

  // ---- SR TRUST (015): driver document review ----
  const adminDriverDocFileMatch = url.pathname.match(/^\/api\/admin\/driver-documents\/([^/]+)\/file$/)
  if (adminDriverDocFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const document = await db().driverDocument.findUnique({ where: { id: adminDriverDocFileMatch[1] }, select: { assetUrl: true, mimeType: true } })
    if (!document) {
      const error = new Error('Driver document not found.')
      error.statusCode = 404
      error.code = 'DRIVER_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }
    const buffer = await readDriverDocument(document.assetUrl)
    res.writeHead(200, { 'content-type': document.mimeType || 'application/octet-stream', 'cache-control': 'private, no-store' })
    res.end(buffer)
    return true
  }

  const driverDocReviewMatch = url.pathname.match(/^\/api\/admin\/driver-documents\/([^/]+)$/)
  if (driverDocReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const decision = normalizeDecision(body.decision || body.action)
    const documentId = driverDocReviewMatch[1]
    const result = await db().$transaction(async (tx) => {
      const before = await tx.driverDocument.findUnique({ where: { id: documentId }, select: { id: true, driverUserId: true, type: true, status: true } })
      if (!before || before.status !== 'PENDING_REVIEW') throw reviewStateError('DRIVER_DOCUMENT_NOT_REVIEWABLE')
      const updated = await tx.driverDocument.updateMany({
        where: { id: documentId, status: 'PENDING_REVIEW' },
        data: { status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED', reviewedById: context.user.id, reviewedAt: new Date() },
      })
      if (updated.count === 0) throw reviewStateError('DRIVER_DOCUMENT_NOT_REVIEWABLE')
      const after = await tx.driverDocument.findUnique({ where: { id: documentId }, select: { id: true, driverUserId: true, type: true, status: true, reviewedById: true, reviewedAt: true } })
      await tx.adminAuditLog.create({ data: { actorUserId: context.user.id, action: `DRIVER_DOCUMENT_${decision}`, entityType: 'driver_documents', entityId: documentId, before, after } })
      return after
    })
    return json(res, 200, { ok: true, document: result })
  }

  // ---- SR MONEY (016): driver Sham-Cash payout ----
  const srPayoutReleaseMatch = url.pathname.match(/^\/api\/admin\/sr-payouts\/([^/]+)\/release$/)
  if (srPayoutReleaseMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const driverId = srPayoutReleaseMatch[1]
    const body = await readJson(req)
    const currency = body.currency === 'USD' ? 'USD' : 'SYP'
    const payoutRef = String(body.payoutRef || body.shamCashRef || '').trim()
    if (!payoutRef) {
      const error = new Error('A payoutRef (e.g. the Sham Cash transaction reference) is required so payouts are idempotent.')
      error.statusCode = 400
      error.code = 'SR_PAYOUT_REF_REQUIRED'
      error.expose = true
      throw error
    }
    const driver = await db().user.findFirst({ where: { id: driverId, roles: { some: { role: 'DRIVER' } } }, include: { driverProfile: true } })
    if (!driver) {
      const error = new Error('Driver not found.')
      error.statusCode = 404
      error.code = 'DRIVER_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (!driver.driverProfile?.payoutMethod || !driver.driverProfile?.payoutAccountRef) {
      const error = new Error('This driver has no payout method on file. Add a Sham Cash payout method before releasing a payout.')
      error.statusCode = 400
      error.code = 'PAYOUT_METHOD_REQUIRED'
      error.expose = true
      throw error
    }
    const entry = await db().$transaction(async (tx) => {
      const key = idempotencyKey(['sr-driver-payout', driverId, payoutRef])
      const existingPayout = await tx.walletEntry.findUnique({ where: { idempotencyKey: key } })
      if (existingPayout) return existingPayout
      // Serialize on the SAME per-(user,currency) wallet lock as lockWalletForSpend, so an admin SR
      // payout and a concurrent rider-side spend by the same user (one person can be rider + driver)
      // mutually exclude on their shared wallet and can't both pass a balance check on the same balance.
      await lockWalletForSpend(tx, driverId, currency)
      const wallet = await tx.wallet.findUnique({ where: { userId_currency: { userId: driverId, currency } } })
      const accruedMinor = wallet?.cachedBalanceMinor || 0
      const requestedMinor = body.amountMinor != null ? Math.max(0, Math.round(Number(body.amountMinor) || 0)) : accruedMinor
      if (requestedMinor <= 0) {
        const error = new Error('This driver has no accrued SR earnings to pay out.')
        error.statusCode = 400
        error.code = 'SR_PAYOUT_NOTHING_TO_PAY'
        error.expose = true
        throw error
      }
      if (requestedMinor > accruedMinor) {
        const error = new Error('Payout exceeds the driver’s accrued SR earnings.')
        error.statusCode = 400
        error.code = 'SR_PAYOUT_EXCEEDS_ACCRUED'
        error.expose = true
        throw error
      }
      const released = await recordWalletEntry(tx, {
        userId: driverId, type: 'DEBIT', amountMinor: requestedMinor, currency,
        referenceType: 'sr_driver_payout', referenceId: driverId,
        keyParts: ['sr-driver-payout', driverId, payoutRef],
        note: `SR driver earnings paid out via Sham Cash (${driver.driverProfile.payoutMethod}:${driver.driverProfile.payoutAccountRef}); ref ${payoutRef}.`,
      })
      await tx.adminAuditLog.create({
        data: { actorUserId: context.user.id, action: 'ADMIN_SR_PAYOUT_RELEASED', entityType: 'users', entityId: driverId, before: { accruedMinor, currency, payoutRef }, after: { walletEntry: released } },
      })
      return released
    })
    return json(res, 200, { ok: true, walletEntry: entry })
  }

  return false
}

function toCountMap(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = row._count._all
    return acc
  }, {})
}

function normalizeDecision(value) {
  const decision = String(value || 'APPROVE').toUpperCase()
  if (decision === 'APPROVE' || decision === 'APPROVED') return 'APPROVED'
  if (decision === 'REJECT' || decision === 'REJECTED') return 'REJECTED'

  const error = new Error('decision must be APPROVE or REJECT.')
  error.statusCode = 400
  error.code = 'INVALID_REVIEW_DECISION'
  error.expose = true
  throw error
}

const ID_DOCUMENT_SAFE_SELECT = {
  id: true,
  displayName: true,
  email: true,
  idDocumentRef: true,
  idDocumentMimeType: true,
  idDocumentSubmittedAt: true,
  idDocumentStatus: true,
  idDocumentReviewedById: true,
  idDocumentReviewedAt: true,
}

function reviewModel(entityType) {
  const normalized = String(entityType || '').toLowerCase()
  if (normalized === 'listing' || normalized === 'listings') return 'listing'
  if (normalized === 'payment' || normalized === 'payments') return 'paymentProof'
  if (normalized === 'gift' || normalized === 'gifts') return 'walletGift'
  if (normalized === 'booking' || normalized === 'bookings') return 'booking'
  if (normalized === 'iddocument' || normalized === 'iddocuments') return 'user'

  const error = new Error('Unsupported review entity type.')
  error.statusCode = 400
  error.code = 'UNSUPPORTED_REVIEW_ENTITY'
  error.expose = true
  throw error
}

async function findReviewEntity(tx, entityType, entityId) {
  const model = reviewModel(entityType)
  // The 'user' model backs ID-document review — never return the full row (password hash, phone
  // hash) into an audit log or API response; only the fields relevant to document review.
  if (model === 'user') {
    return tx.user.findUnique({ where: { id: entityId }, select: ID_DOCUMENT_SAFE_SELECT })
  }
  return tx[model].findUnique({ where: { id: entityId } })
}

async function updateReviewEntity(tx, entityType, entityId, decision, actorUserId, body) {
  const model = reviewModel(entityType)
  const note = body.adminNote || body.note || undefined

  if (model === 'listing') {
    const existing = await tx.listing.findUnique({ where: { id: entityId } })
    if (!existing || existing.status !== 'PENDING_REVIEW') throw reviewStateError('LISTING_NOT_REVIEWABLE')

    // The paid-plan expiry clock starts HERE, at approval — not at draft-create — so a seller never
    // loses paid days waiting in the review queue. Computed from the owner's current plan at the moment
    // the listing actually goes live.
    const listingUpdate = { status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED' }
    if (decision === 'APPROVED' && PAID_PLAN_DIVISIONS.has(existing.division)) {
      const sellerProfile = await tx.sellerProfile.findUnique({ where: { userId: existing.ownerId } })
      listingUpdate.expiresAt = listingExpiryDate(sellerProfile?.planCode)
    }
    // Rentals/Buy (025): commission-based, no paid plan, but still needs a real freshness signal
    // instead of living forever with no "still available?" nudge -- see FREE_TIER_DIVISIONS.
    if (decision === 'APPROVED' && FREE_TIER_DIVISIONS.has(existing.division)) {
      listingUpdate.expiresAt = freeListingExpiryDate()
    }
    // Re-check status in the WHERE clause so two concurrent decisions on the same listing can't
    // both apply (same TOCTOU class as the payment-proof and SR-ride races fixed earlier).
    const updated = await tx.listing.updateMany({
      where: { id: entityId, status: 'PENDING_REVIEW' },
      data: listingUpdate,
    })
    if (updated.count === 0) throw reviewStateError('LISTING_NOT_REVIEWABLE')
    return tx.listing.findUnique({ where: { id: entityId } })
  }

  if (model === 'paymentProof') {
    const existing = await tx.paymentProof.findUnique({
      where: { id: entityId },
      include: {
        booking: {
          include: {
            listing: true,
          },
        },
      },
    })
    if (!existing || existing.status !== 'PENDING_ADMIN_REVIEW') throw reviewStateError('PAYMENT_NOT_REVIEWABLE')
    const shamCashReconciliation = decision === 'APPROVED' && isShamCashProvider(existing.provider)
      ? requireShamCashReconciliation(existing, body)
      : null
    const adminNote = [
      note,
      shamCashReconciliation
        ? `Sham Cash reconciled server-side: expected=${shamCashReconciliation.expectedMinor}, account=${shamCashReconciliation.accountMinor}, difference=${shamCashReconciliation.differenceMinor}, source=${shamCashReconciliation.source}.`
        : '',
    ].filter(Boolean).join('\n') || undefined

    if (decision === 'APPROVED') {
      return approvePaymentProof(tx, { proofId: entityId, actorUserId, note: adminNote })
    }

    const rejectResult = await tx.paymentProof.updateMany({
      where: { id: entityId, status: 'PENDING_ADMIN_REVIEW' },
      data: {
        status: 'REJECTED',
        reviewedById: actorUserId,
        reviewedAt: new Date(),
        adminNote,
      },
    })
    if (rejectResult.count === 0) throw reviewStateError('PAYMENT_REVIEW_CONFLICT')
    const rejected = await tx.paymentProof.findUnique({ where: { id: entityId } })

    if (!existing.bookingId && existing.provider === 'seller_plan') {
      await tx.sellerProfile.update({
        where: { userId: existing.userId },
        data: { documentStatus: 'REJECTED' },
      })
    }

    return rejected
  }

  if (model === 'walletGift') {
    const existing = await tx.walletGift.findUnique({ where: { id: entityId } })
    if (!existing || !['CLAIM_PENDING', 'LOCKED'].includes(existing.status)) throw reviewStateError('GIFT_NOT_REVIEWABLE')
    const updated = await tx.walletGift.updateMany({
      where: { id: entityId, status: existing.status },
      data: { status: decision === 'APPROVED' ? 'SENT' : 'ADMIN_BLOCKED' },
    })
    if (updated.count === 0) throw reviewStateError('GIFT_NOT_REVIEWABLE')
    // A rejected gift (ADMIN_BLOCKED) is a non-claimed terminal state: refund the sender the amount that
    // was reserved from their wallet at send time. Idempotent on the gift id. Approve needs no ledger
    // action — the money was already debited at send and stays reserved until the recipient claims it.
    if (decision !== 'APPROVED') {
      await refundGiftToSender(tx, existing)
    }
    return tx.walletGift.findUnique({ where: { id: entityId } })
  }

  if (model === 'user') {
    const existing = await tx.user.findUnique({ where: { id: entityId }, select: { idDocumentStatus: true } })
    if (!existing || existing.idDocumentStatus !== 'PENDING_REVIEW') throw reviewStateError('ID_DOCUMENT_NOT_REVIEWABLE')
    const updated = await tx.user.updateMany({
      where: { id: entityId, idDocumentStatus: 'PENDING_REVIEW' },
      data: {
        idDocumentStatus: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        idDocumentReviewedById: actorUserId,
        idDocumentReviewedAt: new Date(),
      },
    })
    if (updated.count === 0) throw reviewStateError('ID_DOCUMENT_NOT_REVIEWABLE')
    return tx.user.findUnique({ where: { id: entityId }, select: ID_DOCUMENT_SAFE_SELECT })
  }

  const existing = await tx.booking.findUnique({
    where: { id: entityId },
    include: { payments: true, listing: true },
  })
  if (!existing || !['REQUESTED', 'DISPUTED'].includes(existing.status)) throw reviewStateError('BOOKING_NOT_REVIEWABLE')
  const updatedBooking = await tx.booking.updateMany({
    where: { id: entityId, status: existing.status },
    data: { status: decision === 'APPROVED' ? 'CONFIRMED' : 'CANCELLED' },
  })
  if (updatedBooking.count === 0) throw reviewStateError('BOOKING_NOT_REVIEWABLE')

  // Rejecting a REQUESTED booking or ruling against the host in a DISPUTED one both cancel a
  // booking that already has an approved payment (the HOLD/admin-share CREDIT were created back
  // when the payment proof was approved, well before this decision). Without reversing them here,
  // the guest's money and the admin's commission are stranded forever with no other code path that
  // ever cleans them up — this mirrors the guest/host-initiated cancellation reversal in
  // bookings.mjs and host.mjs, but with a full refund (no cancellation fee) since the guest didn't
  // choose to cancel.
  if (decision !== 'APPROVED') {
    const approvedPayment = existing.payments.find((payment) => payment.status === 'APPROVED')
    if (approvedPayment) {
      const split = bookingFinanceSplit(existing, approvedPayment.amountMinor)
      const adminRecipientId = await originalAdminShareRecipient(tx, existing.id)

      await tx.paymentProof.updateMany({
        where: {
          bookingId: existing.id,
          status: { in: ['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED'] },
        },
        data: {
          status: 'REFUNDED',
          adminNote: 'Auto-refunded after admin rejected/ruled against this booking.',
          reviewedById: actorUserId,
          reviewedAt: new Date(),
        },
      })

      await recordWalletEntry(tx, {
        userId: existing.guestId,
        type: 'REFUND',
        amountMinor: approvedPayment.amountMinor,
        currency: existing.currency,
        referenceType: 'booking_refund',
        referenceId: existing.id,
        keyParts: ['booking-admin-reject-refund', existing.id, approvedPayment.id],
        note: 'Guest refund after admin rejected/ruled against this booking.',
      })

      // Floor the platform-share reversal at the admin wallet's balance so it can't go negative; lock
      // the wallet first so the floor's read-then-write is serialized against concurrent debits.
      await lockWalletForSpend(tx, adminRecipientId, existing.currency)
      const adminShareRevMinor = await debitableMinor(tx, adminRecipientId, existing.currency, split.adminShareMinor)
      if (adminShareRevMinor > 0) {
        await recordWalletEntry(tx, {
          userId: adminRecipientId,
          type: 'DEBIT',
          amountMinor: adminShareRevMinor,
          currency: existing.currency,
          referenceType: 'booking_admin_share_reversal',
          referenceId: existing.id,
          keyParts: ['booking-admin-reject-admin-share-reversal', existing.id, approvedPayment.id],
          note: 'Admin/SYBNB share reversed because the admin rejected/ruled against this booking.',
        })
      }

      // SECURITY (S5): if the host payout was already RELEASED (money moved to the host, only possible on a
      // COMPLETED booking that was later disputed), an adverse ruling must claw it back. Otherwise the guest
      // is refunded in full while the host keeps the released payout and the platform absorbs the loss.
      // Only debit when a RELEASE actually exists; the DEBIT is idempotency-keyed so it can't double-apply.
      const releasedPayout = await tx.walletEntry.findFirst({
        where: { referenceType: 'booking_payout', referenceId: existing.id, type: 'RELEASE' },
      })
      if (releasedPayout) {
        await recordWalletEntry(tx, {
          userId: existing.listing.ownerId,
          type: 'DEBIT',
          amountMinor: split.hostGrossMinor,
          currency: existing.currency,
          referenceType: 'booking_payout_clawback',
          referenceId: existing.id,
          keyParts: ['booking-host-payout-clawback', existing.id, approvedPayment.id],
          note: 'Host payout clawed back after the admin ruled against the host in a dispute.',
        })
      }
    }
  }

  return tx.booking.findUnique({ where: { id: entityId } })
}

function reviewStateError(code) {
  const error = new Error('Entity is not in a reviewable state.')
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

function isShamCashProvider(provider) {
  const value = String(provider || '').toUpperCase()
  return value.includes('SHAM') || value.includes('LOCAL_WALLET') || value.includes('SYRIAN_LOCAL_WALLET')
}

function minorValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : null
}

function requireShamCashReconciliation(paymentProof, body) {
  const packet = body.shamCashReconciliation || body.shamCash || {}
  const accountMinor = minorValue(packet.accountMinor ?? body.shamCashAccountMinor)
  const source = String(packet.source || body.shamCashSource || 'admin-ui')
  // expectedMinor is recomputed from this payment's own row rather than trusted from the client.
  // The admin UI used to send one aggregate figure summed across every pending Sham Cash payment,
  // so reconciling the total let a single balance entry silently "cover" unrelated bookings too —
  // approving one payment could flip another, unreconciled payment's mismatch banner to matched.
  const expectedMinor = Math.round(paymentProof.amountMinor || 0)

  if (accountMinor == null) {
    throwShamCashError(
      'SHAM_CASH_RECONCILIATION_REQUIRED',
      'Sham Cash reconciliation is required before approving this payment.',
      409,
    )
  }

  const differenceMinor = accountMinor - expectedMinor
  if (differenceMinor !== 0) {
    throwShamCashError(
      'SHAM_CASH_RECONCILIATION_MISMATCH',
      'Sham Cash account balance does not match the expected SYBNB payment amount.',
      409,
    )
  }

  return { accountMinor, expectedMinor, differenceMinor, source }
}

function throwShamCashError(code, message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}
