import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { approvePaymentProof, bookingFinanceSplit, makeStrCommissionRateResolver, originalAdminShareRecipient, recordWalletEntry, resolveStrCommissionRate, strCommissionRateForBooking } from '../lib/finance-ledger.mjs'
import { adminReleaseHold, completeExpiredBookings, isPayoutEligible, payoutEligibleAt, releaseAbandonedHolds, PAYOUT_HOLD_DAYS } from '../lib/booking-lifecycle.mjs'
import { recordPayoutTransition } from '../lib/host-payout.mjs'
import { bookingTrackUrl, notify } from '../lib/notifications.mjs'
import { FREE_TIER_DIVISIONS, freeListingExpiryDate, listingExpiryDate, PAID_PLAN_DIVISIONS } from '../lib/listing-lifecycle.mjs'
import { assertVehicleEligible, computeDriverStanding } from '../lib/fleet.mjs'
import { refundGiftToSender } from '../lib/gift-ledger.mjs'
import { ID_DOCUMENT_CATEGORY, deleteIdDocument, readIdDocument, saveIdDocument } from '../lib/id-document-storage.mjs'
import { privateDocumentDownloadHeaders } from '../lib/private-document-download.mjs'
import { recordStaffDocumentAccess } from '../lib/document-access-audit.mjs'
import { readDriverDocument } from '../lib/driver-document-storage.mjs'
import { LISTING_DOCUMENT_CATEGORY, readListingDocument } from '../lib/listing-document-storage.mjs'
import { getOperationalDocumentStatuses, setListingDocumentLegalHold } from '../lib/listing-document-retention.mjs'
import { idempotencyKey } from '../lib/security.mjs'
import { assertBoundedString, assertNoUnknownFields } from '../lib/validate.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { assertJurisdictionApproved, missingJurisdictionRequirements, resolveDriverJurisdiction, resolveListingJurisdiction } from '../lib/jurisdiction-compliance.mjs'
import { compileAdminDailyReport, dailyReportTemplateNarrative } from '../lib/admin-daily-report.mjs'
import { generateDailyReportMessage, isAnthropicConfigured } from '../lib/ai-insights.mjs'

// AD1 date helpers — same date-only semantics as the guest availability endpoint (server/routes/listings.mjs)
// so the admin hosting calendar reads the single availability source identically.
function adminParseDateOnly(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}
function adminIsoDate(value) {
  return new Date(value).toISOString().slice(0, 10)
}

const REVIEW_QUEUE_DEFAULT_LIMIT = 25
const REVIEW_QUEUE_MAX_LIMIT = 100
const REVIEW_QUEUE_IN_MEMORY_PAGE_CAP = 2000
// createdAt alone isn't unique -- rows created in the same millisecond (routine under any bulk-add
// tool) sort in a DB-implementation-defined order, so two separate skip/take queries against the
// same createdAt tie can each return a different pick and either duplicate or skip a row across
// pages. `id` (a UUID) as a secondary sort key makes the order fully deterministic.
const REVIEW_QUEUE_ORDER_BY_CREATED = [{ createdAt: 'desc' }, { id: 'asc' }]
// Backs the Plus/Premium "priority admin review" plan copy (src/modules/seller/SellerListingWizard.tsx
// HOST_LISTING_PLANS) with real queue ordering. listingPlan lives in the JSONB metadata column, which
// Prisma can't portably order by in a single DB query -- sorted in memory instead, same pattern as the
// division-filtered payment-proof queue below (bounded by REVIEW_QUEUE_IN_MEMORY_PAGE_CAP).
const LISTING_PLAN_REVIEW_PRIORITY = { premium: 0, plus: 1, basic: 2 }
function listingReviewPriority(listing) {
  return LISTING_PLAN_REVIEW_PRIORITY[listing.metadata?.listingPlan] ?? 3
}
function sortListingsByReviewPriority(listings) {
  return [...listings].sort((a, b) => {
    const priorityDelta = listingReviewPriority(a) - listingReviewPriority(b)
    if (priorityDelta !== 0) return priorityDelta
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}
// Mirrors the Prisma `ListingDivision` enum (prisma/schema.prisma) -- kept as a literal set here
// rather than introspected at runtime since the admin route layer has no schema-reflection helper.
const REVIEW_QUEUE_DIVISIONS = new Set(['STAYS', 'RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION'])

function parseReviewQueueLimit(raw) {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return REVIEW_QUEUE_DEFAULT_LIMIT
  return Math.min(Math.floor(parsed), REVIEW_QUEUE_MAX_LIMIT)
}

function parseReviewQueueOffset(raw) {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

function parseReviewQueueDivision(raw) {
  if (!raw) return null
  const value = String(raw).trim().toUpperCase()
  return REVIEW_QUEUE_DIVISIONS.has(value) ? value : null
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

  // AD1 — grouped admin calendars. The "Hosting" group shows what is BOOKED across ALL hosts, read from the
  // SAME single availability source as the guest picker / host calendar / booking overlap guard (H4/H5):
  // ListingAvailability status BLOCKED + active Booking rows in the {REQUESTED, PAYMENT_PENDING, CONFIRMED}
  // set. No divergent path — a date booked/blocked here is the same date those surfaces treat as unavailable.
  if (url.pathname === '/api/admin/hosting-calendar') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const from = adminParseDateOnly(url.searchParams.get('from')) || new Date()
    const to = adminParseDateOnly(url.searchParams.get('to')) || new Date(from.getTime() + 90 * 24 * 60 * 60 * 1000)

    const listings = await db().listing.findMany({
      where: { division: 'STAYS', status: 'APPROVED' },
      select: { id: true, titleAr: true, titleEn: true, owner: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    const listingIds = listings.map((listing) => listing.id)
    const [bookings, blockedRows] = await Promise.all([
      db().booking.findMany({
        where: { listingId: { in: listingIds }, status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] }, checkIn: { not: null, lte: to }, checkOut: { gt: from } },
        select: { listingId: true, checkIn: true, checkOut: true, status: true },
      }),
      db().listingAvailability.findMany({
        where: { listingId: { in: listingIds }, status: 'BLOCKED', date: { gte: from, lte: to } },
        select: { listingId: true, date: true },
      }),
    ])
    const bookedByListing = new Map()
    for (const b of bookings) {
      if (!bookedByListing.has(b.listingId)) bookedByListing.set(b.listingId, [])
      bookedByListing.get(b.listingId).push({ checkIn: adminIsoDate(b.checkIn), checkOut: adminIsoDate(b.checkOut), status: b.status })
    }
    const blockedByListing = new Map()
    for (const row of blockedRows) {
      if (!blockedByListing.has(row.listingId)) blockedByListing.set(row.listingId, [])
      blockedByListing.get(row.listingId).push(adminIsoDate(row.date))
    }
    const rows = listings.map((listing) => ({
      listingId: listing.id,
      title: listing.titleAr,
      hostId: listing.owner?.id || null,
      hostName: listing.owner?.displayName || null,
      bookedRanges: bookedByListing.get(listing.id) || [],
      blockedDates: blockedByListing.get(listing.id) || [],
    }))
    return json(res, 200, { ok: true, hosting: { from: adminIsoDate(from), to: adminIsoDate(to), listingCount: rows.length, listings: rows } })
  }

  // AD3 — the AI daily report. Every FIGURE is a real record count/aggregate compiled in the data layer
  // (compileAdminDailyReport); the model is only allowed to PHRASE those facts and can never produce a
  // number. The authoritative `facts` are always returned from the records; the `narrative` is best-effort
  // AI phrasing when configured, otherwise a deterministic template over the same facts. Advisory + admin-
  // reviewed (this endpoint takes no action). Admin-only.
  if (url.pathname === '/api/admin/daily-report') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const report = await compileAdminDailyReport(db())
    let narrative = { messageAr: dailyReportTemplateNarrative(report.facts, 'ar'), messageEn: dailyReportTemplateNarrative(report.facts, 'en'), model: null, source: 'template' }
    if (isAnthropicConfigured()) {
      try {
        const ai = await generateDailyReportMessage(report.facts)
        narrative = { ...ai, source: 'ai' }
      } catch {
        // AI phrasing is presentation-only and best-effort — never block the report or its real numbers.
      }
    }
    // `facts` are the authoritative numbers (from records); `narrative` only restates them.
    return json(res, 200, { ok: true, report: { ...report, narrative } })
  }

  // AD4 — the per-host payments ledger + tax-slip source. The admin picks a host (+ date range) and gets that
  // host's ledger read from the FROZEN M5 Payout/Payment records (no recompute): per booking gross,
  // commission, card fee, net payout, dates, status, release date, plus period totals. It also surfaces the
  // PLATFORM revenue from this host — commission (from the Payment records) and the separately-ledgered
  // seller plan fee ($19/$49) — kept as two distinct lines. Admin-only; commission/plan-fee never appear on
  // any guest surface (R7). Reuses the same frozen records the host sees in H6, just admin-scoped by hostId.
  if (url.pathname === '/api/admin/host-ledger') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const hostId = url.searchParams.get('hostId')
    if (!hostId) {
      const error = new Error('hostId is required.')
      error.statusCode = 400
      error.code = 'HOST_LEDGER_HOST_REQUIRED'
      error.expose = true
      throw error
    }
    const from = adminParseDateOnly(url.searchParams.get('from')) || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    const to = adminParseDateOnly(url.searchParams.get('to')) || new Date()
    const host = await db().user.findUnique({ where: { id: hostId }, select: { displayName: true } })
    const [payouts, planFees] = await Promise.all([
      db().payout.findMany({
        where: { hostId, createdAt: { gte: from, lte: to } },
        include: { booking: { select: { id: true, checkIn: true, checkOut: true, listing: { select: { titleAr: true } }, payment: true } } },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      // The host's own plan-fee contributions ($19/$49) — a SEPARATE admin-revenue stream from commission.
      db().paymentProof.aggregate({ where: { userId: hostId, provider: 'seller_plan', status: 'APPROVED', createdAt: { gte: from, lte: to } }, _sum: { amountMinor: true }, _count: { _all: true } }),
    ])
    const rows = payouts.map((payout) => {
      const payment = payout.booking?.payment || null
      return {
        bookingId: payout.bookingId,
        listingTitle: payout.booking?.listing?.titleAr || null,
        checkIn: payout.booking?.checkIn || null,
        checkOut: payout.booking?.checkOut || null,
        paymentDate: payment?.settledAt || null,
        releaseDate: payout.releaseDate || null,
        grossMinor: payment?.grossMinor ?? null,
        commissionMinor: payment?.commissionAmountMinor ?? null,
        hostPayoutMinor: payment?.hostPayoutMinor ?? payout.amountMinor,
        netPayoutMinor: payout.amountMinor,
        currency: payout.currency,
        payoutStatus: payout.status,
      }
    })
    const totals = rows.reduce(
      (acc, row) => {
        acc.grossMinor += row.grossMinor || 0
        acc.commissionMinor += row.commissionMinor || 0
        acc.cardFeeMinor += Math.max(0, (row.hostPayoutMinor || 0) - row.netPayoutMinor)
        acc.netMinor += row.netPayoutMinor
        return acc
      },
      { grossMinor: 0, commissionMinor: 0, cardFeeMinor: 0, netMinor: 0 },
    )
    return json(res, 200, {
      ok: true,
      ledger: {
        hostId,
        hostName: host?.displayName || null,
        from: adminIsoDate(from),
        to: adminIsoDate(to),
        rows,
        totals: { ...totals, currency: rows[0]?.currency || 'USD' },
        // Platform revenue FROM this host, two distinct lines (never conflated).
        revenue: { commissionMinor: totals.commissionMinor, planFeeMinor: planFees._sum.amountMinor || 0, planFeeCount: planFees._count._all },
      },
    })
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

      const rateFor = makeStrCommissionRateResolver(db())
      const payouts = await Promise.all(completedBookings
        .filter((booking) => !releasedBookingIds.has(booking.id))
        .map(async (booking) => {
          const approvedPayment = booking.payments.find((payment) => payment.status === 'APPROVED')
          const split = bookingFinanceSplit(booking, approvedPayment?.amountMinor || booking.amountMinor, await rateFor(booking))
          return {
            bookingId: booking.id,
            listingTitle: booking.listing?.titleAr,
            hostId: booking.listing?.ownerId,
            hostName: booking.listing?.owner?.displayName,
            hostPayoutMethod: booking.listing?.owner?.payoutMethod || null,
            checkOut: booking.checkOut,
            eligibleAt: payoutEligibleAt(booking.checkOut),
            eligibleNow: isPayoutEligible(booking),
            hostPayoutMinor: split.hostGrossMinor,
            currency: booking.currency,
          }
        }))

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
      const split = bookingFinanceSplit(freshBooking, approvedPayment?.amountMinor || freshBooking.amountMinor, await strCommissionRateForBooking(tx, freshBooking))
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

      // M5: transition the frozen Payout record to RELEASED. updateMany is a no-op for a pre-backfill
      // booking with no Payout record yet; the wallet RELEASE entry above stays the money source of truth.
      await tx.payout.updateMany({
        where: { bookingId: freshBooking.id, status: { in: ['PENDING_HOLD', 'ELIGIBLE'] } },
        data: { status: 'RELEASED', releaseDate: new Date(), releasedById: context.user.id },
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

  // SYB-011 — record a MANUAL host-payout disbursement transition (staff moved money off-platform).
  // Does NOT move money; it records the governed lifecycle event so "released" (internal credit) is
  // never confused with "paid" (funds actually sent). Requires actor/role/timestamp/method/reference/
  // reason/reconciliation, all captured by recordPayoutTransition.
  const payoutDisburseMatch = url.pathname.match(/^\/api\/admin\/payouts\/([^/]+)\/disburse$/)
  if (payoutDisburseMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    assertNoUnknownFields(body, ['transition', 'reference', 'reason', 'reconciliationNote'], 'payout disbursement body')

    const booking = await db().booking.findUnique({
      where: { id: payoutDisburseMatch[1] },
      include: { listing: { include: { owner: { select: { id: true } } } } },
    })
    if (!booking) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }
    // D1: disburse against the payout destination FROZEN at verify (Payout.destinationSnapshot), NEVER the
    // live User.payoutMethod — so a post-verify change to the host's method cannot redirect the funds. A payout
    // with no frozen destination is refused rather than falling back to the live method.
    const payout = await db().payout.findUnique({ where: { bookingId: payoutDisburseMatch[1] } })
    const destination = payout?.destinationSnapshot
    if (!destination || typeof destination !== 'object' || !destination.type) {
      const error = new Error('This payout has no frozen destination on record — capture one before disbursing.')
      error.statusCode = 403
      error.code = 'PAYOUT_DESTINATION_MISSING'
      error.expose = true
      throw error
    }
    const hostOwner = booking.listing?.owner
    const methodType = destination.type

    const transition = String(body.transition || '').toUpperCase()
    const entry = await recordPayoutTransition(db(), {
      transition,
      actorUserId: context.user.id,
      actorRoles: context.roles,
      entityId: booking.id,
      hostUserId: hostOwner?.id || null,
      method: methodType,
      reference: body.reference,
      reason: body.reason,
      reconciliationNote: body.reconciliationNote,
    })

    // SYB-003: notify the host on the states they care about, best-effort AFTER the record commits.
    if ((transition === 'INITIATED' || transition === 'COMPLETED') && hostOwner?.id) {
      const hostUser = await db().user.findUnique({ where: { id: hostOwner.id }, select: { email: true, locale: true } })
      await notify({
        event: transition === 'INITIATED' ? 'PAYOUT_INITIATED' : 'PAYOUT_COMPLETED',
        to: hostUser?.email,
        locale: hostUser?.locale,
        data: { ref: entry.after.reference || booking.id.slice(0, 12).toUpperCase() },
        entityId: booking.id,
        recipientRef: hostOwner.id,
      })
    }
    return json(res, 201, { ok: true, transition: entry.after.transition, recordedAt: entry.createdAt })
  }

  // SYB-002 — admin manual release of an abandoned PAYMENT_PENDING hold, with a required reason.
  const holdReleaseMatch = url.pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/release-hold$/)
  if (holdReleaseMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const body = await readJson(req)
    assertNoUnknownFields(body, ['reason'], 'hold release body')

    const result = await adminReleaseHold({
      bookingId: holdReleaseMatch[1],
      adminUserId: context.user.id,
      reason: body.reason,
    })
    if (!result.released) {
      const status = result.code === 'BOOKING_NOT_FOUND' ? 404
        : result.code === 'HOLD_RELEASE_REASON_REQUIRED' ? 400
          : 409
      const error = new Error(
        result.code === 'HOLD_RELEASE_REASON_REQUIRED' ? 'A reason is required to release a hold.'
          : result.code === 'HOLD_HAS_PROOF_UNDER_REVIEW' ? 'This hold has a payment proof under review — review the proof instead of releasing it.'
            : result.code === 'BOOKING_NOT_A_HOLD' ? 'This booking is not an abandoned payment hold.'
              : result.code === 'BOOKING_NOT_FOUND' ? 'Booking not found.'
                : 'This hold was already moved and cannot be released.',
      )
      error.statusCode = status
      error.code = result.code
      error.expose = true
      throw error
    }
    return json(res, 200, { ok: true, released: true })
  }

  if (url.pathname === '/api/admin/review-queue') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    await completeExpiredBookings()
    // SYB-002: opportunistic abandoned-hold sweep on the admin queue read path (no scheduler exists).
    await releaseAbandonedHolds()

    const limit = parseReviewQueueLimit(url.searchParams.get('limit'))
    const offset = parseReviewQueueOffset(url.searchParams.get('offset'))
    const division = parseReviewQueueDivision(url.searchParams.get('division'))

    // Every division (STAYS, RENTALS, BUY, CARS, NEW_CONSTRUCTION, MARKETPLACE) funnels into this
    // one shared queue, so the division filter is applied wherever a row traces back to a listing
    // (listings themselves, bookings, and payments via their booking's listing). Gifts and ID
    // documents aren't attached to any listing/division, so they're division-agnostic: a division
    // filter narrows them to none rather than guessing, since showing them under every division
    // filter would misrepresent them as belonging to that division.
    const listingWhere = { status: 'PENDING_REVIEW', ...(division ? { division } : {}) }
    const paymentWhere = {
      status: 'PENDING_ADMIN_REVIEW',
      ...(division ? { booking: { listing: { division } } } : {}),
    }
    const giftWhere = { status: { in: ['CLAIM_PENDING', 'LOCKED'] } }
    const bookingWhere = {
      status: { in: ['REQUESTED', 'DISPUTED'] },
      ...(division ? { listing: { division } } : {}),
    }
    const idDocumentWhere = { idDocumentStatus: 'PENDING_REVIEW' }

    const [
      listings,
      listingsTotal,
      payments,
      paymentsTotal,
      gifts,
      giftsTotal,
      bookings,
      bookingsTotal,
      idDocuments,
      idDocumentsTotal,
    ] = await Promise.all([
      db().listing.findMany({
        where: listingWhere,
        orderBy: REVIEW_QUEUE_ORDER_BY_CREATED,
        take: REVIEW_QUEUE_IN_MEMORY_PAGE_CAP,
      }),
      db().listing.count({ where: listingWhere }),
      db().paymentProof.findMany({
        where: paymentWhere,
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
        orderBy: REVIEW_QUEUE_ORDER_BY_CREATED,
        // paymentProof has no direct division column, so a division filter (a nested
        // booking.listing.division match) can't be paged with skip/take at the DB level the same
        // way as the flat where-clauses below -- it's paged in memory instead (see pagedPayments),
        // bounded by REVIEW_QUEUE_IN_MEMORY_PAGE_CAP so a division with a very large pending queue
        // can't force an unbounded fetch.
        skip: division ? 0 : offset,
        take: division ? REVIEW_QUEUE_IN_MEMORY_PAGE_CAP : limit,
      }),
      db().paymentProof.count({ where: paymentWhere }),
      division ? [] : db().walletGift.findMany({ where: giftWhere, orderBy: REVIEW_QUEUE_ORDER_BY_CREATED, skip: offset, take: limit }),
      division ? 0 : db().walletGift.count({ where: giftWhere }),
      db().booking.findMany({
        where: bookingWhere,
        include: { listing: true },
        orderBy: REVIEW_QUEUE_ORDER_BY_CREATED,
        skip: offset,
        take: limit,
      }),
      db().booking.count({ where: bookingWhere }),
      division ? [] : db().user.findMany({
        where: idDocumentWhere,
        select: { id: true, displayName: true, email: true, idDocumentMimeType: true, idDocumentSubmittedAt: true },
        orderBy: [{ idDocumentSubmittedAt: 'desc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
      }),
      division ? 0 : db().user.count({ where: idDocumentWhere }),
    ])

    const pagedPayments = division ? payments.slice(offset, offset + limit) : payments
    const pagedListings = sortListingsByReviewPriority(listings).slice(offset, offset + limit)

    const totals = {
      listings: listingsTotal,
      payments: paymentsTotal,
      gifts: giftsTotal,
      bookings: bookingsTotal,
      idDocuments: idDocumentsTotal,
    }
    const counts = {
      listings: pagedListings.length,
      payments: pagedPayments.length,
      gifts: gifts.length,
      bookings: bookings.length,
      idDocuments: idDocuments.length,
    }

    // M1: expose the SAME STR commission rate the settlement math uses, for admin display (never a guest
    // response — R7). Resolved for the active jurisdiction (Syria).
    const platformFeePct = await resolveStrCommissionRate(db(), { country: 'SY' })
    return json(res, 200, {
      ok: true,
      platformFeePct,
      queue: { listings: pagedListings, payments: pagedPayments, gifts, bookings, idDocuments },
      pagination: {
        limit,
        offset,
        division,
        totals,
        hasMore: {
          listings: offset + counts.listings < totals.listings,
          payments: offset + counts.payments < totals.payments,
          gifts: offset + counts.gifts < totals.gifts,
          bookings: offset + counts.bookings < totals.bookings,
          idDocuments: offset + counts.idDocuments < totals.idDocuments,
        },
      },
    })
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

    // STG-24: staff access to identity evidence must leave a trace. Previously only admin
    // *decisions* were audited, so a support agent could open someone's passport and leave no
    // record. Metadata only — actor, role, subject record, result. Never the bytes, the storage key,
    // the bucket, or any credential.
    await recordStaffDocumentAccess({
      actorUserId: context.user.id,
      actorRoles: context.roles,
      documentCategory: ID_DOCUMENT_CATEGORY,
      entityType: 'users',
      entityId: idDocumentFileMatch[1],
      result: 'ALLOWED',
    })

    res.writeHead(200, privateDocumentDownloadHeaders({
      mimeType: targetUser.idDocumentMimeType || 'application/octet-stream',
      category: ID_DOCUMENT_CATEGORY,
      byteLength: buffer.length,
    }))
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

    // FIX 2: best-effort guest "booking confirmed" email once the booking is actually CONFIRMED (a
    // payment-proof approval or a booking-review approval). Runs AFTER the review transaction commits and
    // never throws, so it can never block or roll back the authoritative review workflow.
    if (decision === 'APPROVED') {
      try {
        let confirmedBooking = null
        if (entityType === 'booking') {
          confirmedBooking = await db().booking.findUnique({ where: { id: entityId } })
        } else if (entityType === 'paymentProof') {
          const proof = await db().paymentProof.findUnique({ where: { id: entityId }, select: { bookingId: true } })
          if (proof?.bookingId) confirmedBooking = await db().booking.findUnique({ where: { id: proof.bookingId } })
        }
        const guestEmail = confirmedBooking?.metadata?.guestContactEmail
        if (confirmedBooking?.status === 'CONFIRMED' && guestEmail) {
          const ref = confirmedBooking.id.slice(0, 12).toUpperCase()
          await notify({
            event: 'BOOKING_CONFIRMED',
            to: guestEmail,
            locale: confirmedBooking.metadata?.guestLocale,
            data: { ref, trackUrl: bookingTrackUrl(ref) },
            entityId: confirmedBooking.id,
            recipientRef: confirmedBooking.guestId,
          })
        }
      } catch {
        /* best-effort: a confirmation email must never break the admin review workflow */
      }
    }

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

  // ---- FLEET (029): full driver + vehicle + document registry export, CSV or JSON. CTQ-374
  // requires an authorized transportation-system operator to "maintain driver and vehicle
  // registries with prescribed information" and file quarterly/annual activity reports -- this is
  // that reporting capability. Not Quebec-only: works for any country/market. ----
  if (url.pathname === '/api/admin/drivers/export') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const params = url.searchParams
    const format = (params.get('format') || 'json').toLowerCase()
    const countryFilter = params.get('country') // 'SY' | 'CA'

    const drivers = await db().user.findMany({
      where: {
        roles: { some: { role: 'DRIVER' } },
        ...(countryFilter ? { driverProfile: { country: countryFilter } } : {}),
      },
      select: {
        id: true, displayName: true, email: true, status: true, idDocumentStatus: true, createdAt: true,
        driverProfile: { select: { country: true, active: true, payoutMethod: true } },
        driverVehicles: { select: { id: true, make: true, model: true, year: true, plate: true, category: true, country: true, status: true } },
        driverDocuments: { select: { type: true, status: true, reviewedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    })

    const rows = []
    for (const d of drivers) {
      const country = d.driverProfile?.country || 'SY'
      const documents = Object.fromEntries((d.driverDocuments || []).map((doc) => [doc.type, doc.status]))
      const base = {
        driverId: d.id,
        driverName: d.displayName,
        driverEmail: d.email,
        driverStatus: d.status,
        driverIdVerification: d.idDocumentStatus || 'NONE',
        country,
        driverActive: d.driverProfile?.active ?? false,
        payoutMethod: d.driverProfile?.payoutMethod || '',
        driverCreatedAt: d.createdAt,
        documents,
      }
      if (d.driverVehicles.length === 0) {
        rows.push({ ...base, vehicleId: '', vehicleMake: '', vehicleModel: '', vehicleYear: '', vehiclePlate: '', vehicleCategory: '', vehicleCountry: '', vehicleStatus: '' })
      } else {
        for (const v of d.driverVehicles) {
          rows.push({ ...base, vehicleId: v.id, vehicleMake: v.make, vehicleModel: v.model, vehicleYear: v.year, vehiclePlate: v.plate, vehicleCategory: v.category, vehicleCountry: v.country, vehicleStatus: v.status })
        }
      }
    }

    if (format === 'csv') {
      const documentTypes = Array.from(new Set(rows.flatMap((r) => Object.keys(r.documents)))).sort()
      const headers = [
        'driverId', 'driverName', 'driverEmail', 'driverStatus', 'driverIdVerification', 'country',
        'driverActive', 'payoutMethod', 'driverCreatedAt',
        'vehicleId', 'vehicleMake', 'vehicleModel', 'vehicleYear', 'vehiclePlate', 'vehicleCategory', 'vehicleCountry', 'vehicleStatus',
        ...documentTypes.map((t) => `doc_${t}`),
      ]
      const csvEscape = (value) => {
        const s = value instanceof Date ? value.toISOString() : value === null || value === undefined ? '' : String(value)
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      const lines = [headers.join(',')]
      for (const r of rows) {
        const line = [
          r.driverId, r.driverName, r.driverEmail, r.driverStatus, r.driverIdVerification, r.country,
          r.driverActive, r.payoutMethod, r.driverCreatedAt,
          r.vehicleId, r.vehicleMake, r.vehicleModel, r.vehicleYear, r.vehiclePlate, r.vehicleCategory, r.vehicleCountry, r.vehicleStatus,
          ...documentTypes.map((t) => r.documents[t] || ''),
        ]
        lines.push(line.map(csvEscape).join(','))
      }
      const csv = lines.join('\n')
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="driver-vehicle-registry-${new Date().toISOString().slice(0, 10)}.csv"`,
        'cache-control': 'no-store',
      })
      return res.end(csv)
    }

    return json(res, 200, { ok: true, generatedAt: new Date().toISOString(), count: rows.length, rows })
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

    // STG-24 / SYB-005: this route is staff-only, so every read here is staff access by definition.
    await recordStaffDocumentAccess({
      actorUserId: context.user.id,
      actorRoles: context.roles,
      documentCategory: 'driver',
      entityType: 'driver_documents',
      entityId: adminDriverDocFileMatch[1],
      result: 'ALLOWED',
    })

    // STG-12 / SYB-004: forced download. This is the admin-surface handler; the Ride module's own
    // route (driver.mjs) is frozen and intentionally unchanged. The helper's category allowlist has
    // no 'driver' entry and the helper itself is frozen, so this uses the generic category — the
    // protection is the `attachment` disposition, not the filename label.
    res.writeHead(200, privateDocumentDownloadHeaders({
      mimeType: document.mimeType || 'application/octet-stream',
      category: 'document',
      byteLength: buffer.length,
    }))
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
      // Jurisdiction gate (026): a driver document cannot go live in a market that isn't itself
      // APPROVED, regardless of how complete the document is.
      if (decision === 'APPROVED') {
        await assertJurisdictionApproved(tx, resolveDriverJurisdiction(), { subject: 'Ride-hailing in this market' })
      }
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

  // ---- Québec compliance review (item 1): admin manually verifies an uploaded listing
  // certificate (e.g. a CITQ registration) against the registration number/expiry the host
  // entered. This is the closest engineering equivalent of "validate its authenticity" available
  // without a live Québec registry API -- there is no such public API to check against. ----
  const adminListingDocFileMatch = url.pathname.match(/^\/api\/admin\/listing-documents\/([^/]+)\/file$/)
  if (adminListingDocFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const document = await db().listingDocument.findUnique({ where: { id: adminListingDocFileMatch[1] }, select: { assetUrl: true, mimeType: true } })
    if (!document) {
      const error = new Error('Listing document not found.')
      error.statusCode = 404
      error.code = 'LISTING_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (!document.assetUrl) {
      const error = new Error('This document has been deleted under the retention policy.')
      error.statusCode = 410
      error.code = 'LISTING_DOCUMENT_RETENTION_DELETED'
      error.expose = true
      throw error
    }
    const buffer = await readListingDocument(document.assetUrl)

    // STG-24 / SYB-005: staff-only review route — every read is staff access by definition.
    await recordStaffDocumentAccess({
      actorUserId: context.user.id,
      actorRoles: context.roles,
      documentCategory: LISTING_DOCUMENT_CATEGORY,
      entityType: 'listing_documents',
      entityId: adminListingDocFileMatch[1],
      result: 'ALLOWED',
    })

    // STG-12 / SYB-004: forced download for the staff review path, matching the host-facing route.
    res.writeHead(200, privateDocumentDownloadHeaders({
      mimeType: document.mimeType || 'application/octet-stream',
      category: LISTING_DOCUMENT_CATEGORY,
      byteLength: buffer.length,
    }))
    res.end(buffer)
    return true
  }

  // Second compliance-review correction pass: manual review is NOT a legal "VERIFIED" -- the
  // digital certificate has its own authenticity mechanism this platform doesn't check yet.
  // ADMIN_REVIEWED_TEST records that an admin looked at it, in test mode, nothing stronger.
  const listingDocReviewMatch = url.pathname.match(/^\/api\/admin\/listing-documents\/([^/]+)$/)
  if (listingDocReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const decision = normalizeDecision(body.decision || body.action)
    const documentId = listingDocReviewMatch[1]
    const result = await db().$transaction(async (tx) => {
      const before = await tx.listingDocument.findUnique({ where: { id: documentId }, select: { id: true, listingId: true, type: true, status: true } })
      if (!before || before.status !== 'PENDING_REVIEW') throw reviewStateError('LISTING_DOCUMENT_NOT_REVIEWABLE')
      const nextStatus = decision === 'APPROVED' ? 'ADMIN_REVIEWED_TEST' : 'REJECTED'
      const updated = await tx.listingDocument.updateMany({
        where: { id: documentId, status: 'PENDING_REVIEW' },
        data: { status: nextStatus, reviewedById: context.user.id, reviewedAt: new Date() },
      })
      if (updated.count === 0) throw reviewStateError('LISTING_DOCUMENT_NOT_REVIEWABLE')
      const after = await tx.listingDocument.findUnique({ where: { id: documentId }, select: { id: true, listingId: true, type: true, status: true, reviewedById: true, reviewedAt: true } })
      await tx.adminAuditLog.create({ data: { actorUserId: context.user.id, action: `LISTING_DOCUMENT_${nextStatus}`, entityType: 'listing_documents', entityId: documentId, before, after } })
      return after
    })
    return json(res, 200, { ok: true, document: result })
  }

  // Legal hold: blocks the retention-purge job for this specific document row until explicitly
  // cleared. Does NOT block a new upload -- a new version can always be uploaded alongside a held
  // one (see server/routes/listings.mjs's versioned upload). Requires a recorded reason and admin
  // (setListingDocumentLegalHold enforces this).
  const listingDocLegalHoldMatch = url.pathname.match(/^\/api\/admin\/listing-documents\/([^/]+)\/legal-hold$/)
  if (listingDocLegalHoldMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const documentId = listingDocLegalHoldMatch[1]
    const before = await db().listingDocument.findUnique({ where: { id: documentId }, select: { id: true, legalHold: true, legalHoldReason: true } })
    if (!before) {
      const error = new Error('Listing document not found.')
      error.statusCode = 404
      error.code = 'LISTING_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }
    const updated = await setListingDocumentLegalHold(db(), documentId, {
      hold: body.hold === true, reason: typeof body.reason === 'string' ? body.reason : '', actorId: context.user.id,
    })
    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id, action: body.hold === true ? 'LISTING_DOCUMENT_LEGAL_HOLD_SET' : 'LISTING_DOCUMENT_LEGAL_HOLD_CLEARED',
        entityType: 'listing_documents', entityId: documentId, before, after: { legalHold: updated.legalHold, legalHoldReason: updated.legalHoldReason },
      },
    })
    return json(res, 200, { ok: true, document: updated })
  }

  // ---- JURISDICTION COMPLIANCE (026): the master go-live switch per (division, country, region) ----
  if (url.pathname === '/api/admin/jurisdiction-compliance') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const profiles = await db().jurisdictionComplianceProfile.findMany({
      orderBy: [{ countryCode: 'asc' }, { regionCode: 'asc' }, { division: 'asc' }],
      include: { reviewedBy: { select: { id: true, displayName: true } } },
    })
    return json(res, 200, { ok: true, profiles })
  }

  const jurisdictionUpdateMatch = url.pathname.match(/^\/api\/admin\/jurisdiction-compliance\/([^/]+)$/)
  if (jurisdictionUpdateMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const profileId = jurisdictionUpdateMatch[1]
    const body = await readJson(req)

    const data = {}
    if (body.status !== undefined) {
      const status = String(body.status || '').toUpperCase()
      if (!['PENDING', 'APPROVED', 'BLOCKED'].includes(status)) {
        const error = new Error('status must be PENDING, APPROVED, or BLOCKED.')
        error.statusCode = 400
        error.code = 'JURISDICTION_STATUS_INVALID'
        error.expose = true
        throw error
      }
      data.status = status
    }
    for (const category of ['tourism', 'transport', 'tax', 'platform']) {
      if (body[`${category}Required`] !== undefined) data[`${category}Required`] = Boolean(body[`${category}Required`])
      if (body[`${category}Satisfied`] !== undefined) data[`${category}Satisfied`] = Boolean(body[`${category}Satisfied`])
      if (body[`${category}Notes`] !== undefined) {
        data[`${category}Notes`] = body[`${category}Notes`] ? assertBoundedString(body[`${category}Notes`], { fieldName: `${category}Notes`, maxLength: 2000 }) : null
      }
    }
    // CTQ Transportation System Operator fields (028) -- only meaningful for SR profiles, but harmless
    // to accept generically like the rest of this endpoint.
    for (const field of ['operatorRespondentName', 'operatorRespondentContact', 'operatorDispatcherName', 'operatorDispatcherContact', 'operatorInsuranceReference', 'operatorAuthorizationNumber']) {
      if (body[field] !== undefined) {
        data[field] = body[field] ? assertBoundedString(body[field], { fieldName: field, maxLength: 300 }) : null
      }
    }
    if (Object.keys(data).length === 0) {
      const error = new Error('Provide at least one field to update.')
      error.statusCode = 400
      error.code = 'JURISDICTION_UPDATE_EMPTY'
      error.expose = true
      throw error
    }
    // Any admin edit counts as a review action, not only a status flip — the reviewer/timestamp
    // should reflect who last touched this market's compliance record.
    data.reviewedById = context.user.id
    data.reviewedAt = new Date()

    const result = await db().$transaction(async (tx) => {
      const before = await tx.jurisdictionComplianceProfile.findUnique({ where: { id: profileId } })
      if (!before) {
        const error = new Error('Jurisdiction compliance profile not found.')
        error.statusCode = 404
        error.code = 'JURISDICTION_PROFILE_NOT_FOUND'
        error.expose = true
        throw error
      }
      // Mirrors the per-listing/per-driver rule (026): a market cannot be marked APPROVED while any
      // requirement it marks as required is still unsatisfied — checked against the state this same
      // request would produce, so an admin can satisfy the last requirement and approve in one call.
      if (data.status === 'APPROVED') {
        const merged = { ...before, ...data }
        const missing = missingJurisdictionRequirements(merged)
        if (missing.length) {
          const error = new Error(`This market can't be approved yet — still needed: ${missing.join(', ')}.`)
          error.statusCode = 400
          error.code = 'JURISDICTION_REQUIREMENTS_INCOMPLETE'
          error.expose = true
          error.details = { missing }
          throw error
        }
      }
      const after = await tx.jurisdictionComplianceProfile.update({ where: { id: profileId }, data })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `JURISDICTION_COMPLIANCE_${data.status || 'UPDATED'}`,
          entityType: 'jurisdiction_compliance_profiles',
          entityId: profileId,
          before,
          after,
        },
      })
      return after
    })
    return json(res, 200, { ok: true, profile: result })
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${driverId}))`
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

  // ---- SR commission (028): flag a completed ride's fare as fraudulent/chargeback so it drops out
  // of the driver's calendar-year eligible-fare total for the progressive commission engine (see
  // driverYtdEligibleFareUsd, sr-payments.mjs). Refunds already have a real mechanism (a dispute
  // resolved RESOLVED_REFUNDED) -- this only covers the two cases nothing else models yet. Never
  // retroactive: flagging a ride does not reverse the commission it was already charged, only
  // excludes it from FUTURE rides' tier math, matching the policy's "progressive, not retroactive"
  // rule. Stored in RideRequest.metadata (already a JSON column) -- no migration needed.
  const srCommissionFlagMatch = url.pathname.match(/^\/api\/admin\/sr-rides\/([^/]+)\/commission-flag$/)
  if (srCommissionFlagMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const flag = String(body.flag || '').toUpperCase()
    if (!['FRAUDULENT', 'CHARGEBACK', 'NONE'].includes(flag)) {
      const error = new Error('flag must be FRAUDULENT, CHARGEBACK, or NONE (to clear).')
      error.statusCode = 400
      error.code = 'SR_COMMISSION_FLAG_INVALID'
      error.expose = true
      throw error
    }
    const reason = body.reason ? assertBoundedString(body.reason, { fieldName: 'reason', maxLength: 500 }) : null

    const ride = await db().rideRequest.findUnique({ where: { id: srCommissionFlagMatch[1] } })
    if (!ride || ride.status !== 'COMPLETED') {
      const error = new Error('Only a completed SR ride can be commission-flagged.')
      error.statusCode = 404
      error.code = 'SR_RIDE_NOT_FOUND'
      error.expose = true
      throw error
    }

    const before = { commissionFlag: ride.metadata?.commissionFlag || null }
    const nextMetadata = { ...ride.metadata }
    if (flag === 'NONE') {
      delete nextMetadata.commissionFlag
      delete nextMetadata.commissionFlagReason
      delete nextMetadata.commissionFlagBy
      delete nextMetadata.commissionFlagAt
    } else {
      nextMetadata.commissionFlag = flag
      nextMetadata.commissionFlagReason = reason
      nextMetadata.commissionFlagBy = context.user.id
      nextMetadata.commissionFlagAt = new Date().toISOString()
    }

    const updated = await db().$transaction(async (tx) => {
      const u = await tx.rideRequest.update({ where: { id: ride.id }, data: { metadata: nextMetadata } })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `SR_RIDE_COMMISSION_FLAG_${flag}`,
          entityType: 'ride_requests',
          entityId: ride.id,
          before,
          after: { commissionFlag: flag === 'NONE' ? null : flag, reason },
        },
      })
      return u
    })
    return json(res, 200, { ok: true, ride: updated })
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

    // Jurisdiction gate (026): a STAYS listing cannot go live in a market that isn't itself
    // APPROVED, regardless of how complete the listing's own documents are. Other divisions
    // (CARS/RENTALS/BUY/MARKETPLACE/NEW_CONSTRUCTION) aren't in scope for this gate yet.
    if (decision === 'APPROVED' && existing.division === 'STAYS') {
      await assertJurisdictionApproved(tx, resolveListingJurisdiction(existing), { subject: 'Short-term rental in this market' })
    }

    // Québec compliance review (item 1): "prevent publication ... when registration is invalid" --
    // a listing cannot go APPROVED unless its CITQ certificate FILE has itself been admin-approved
    // (not just a self-entered expiry date). Uploading and reviewing the certificate can happen in
    // either order relative to this listing review; both must be done before the listing goes live.
    if (decision === 'APPROVED' && existing.division === 'STAYS' && existing.metadata?.country === 'CA') {
      const certificateDoc = await tx.listingDocument.findFirst({
        where: { listingId: existing.id, type: 'CITQ_CERTIFICATE', isCurrent: true }, select: { status: true },
      })
      if (!getOperationalDocumentStatuses().includes(certificateDoc?.status)) throw reviewStateError('CITQ_CERTIFICATE_NOT_VERIFIED')
    }

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
      const split = bookingFinanceSplit(existing, approvedPayment.amountMinor, await strCommissionRateForBooking(tx, existing))
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

      await recordWalletEntry(tx, {
        userId: adminRecipientId,
        type: 'DEBIT',
        amountMinor: split.adminShareMinor,
        currency: existing.currency,
        referenceType: 'booking_admin_share_reversal',
        referenceId: existing.id,
        keyParts: ['booking-admin-reject-admin-share-reversal', existing.id, approvedPayment.id],
        note: 'Admin/SYBNB share reversed because the admin rejected/ruled against this booking.',
      })

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
