import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { completeExpiredBookings, releaseAbandonedHolds } from '../lib/booking-lifecycle.mjs'
import { expireAndRefundSenderGifts } from '../lib/gift-ledger.mjs'
import { ID_DOCUMENT_CATEGORY, deleteIdDocument, readIdDocument, saveIdDocument } from '../lib/id-document-storage.mjs'
import { privateDocumentDownloadHeaders } from '../lib/private-document-download.mjs'
import { maskPayoutMethod, normalizePayoutMethod } from '../lib/host-payout.mjs'
import { approximateLocation, exactLocation, bookingRevealsExactLocation } from '../lib/listing-location.mjs'

// A booking still owing something to the counterparty, or a ride still in flight, blocks account closure.
const ACTIVE_BOOKING_STATUSES = ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED', 'DISPUTED']
const INFLIGHT_RIDE_STATUSES = ['REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']

export async function handleMe(req, res, url, context) {
  // ---- In-app account deletion (store requirement): anonymize PII + kill sessions, RETAIN ledger/audit. ----
  if (url.pathname === '/api/me' && req.method === 'DELETE') {
    requireAuth(context)
    const userId = context.user.id
    const oldEmail = context.user.email
    const oldIdRef = context.user.idDocumentRef

    // Guardrail 1: no money left in any wallet.
    const wallets = await db().wallet.findMany({ where: { userId } })
    if (wallets.some((w) => w.cachedBalanceMinor !== 0)) {
      const error = new Error('Withdraw or spend your balance before closing.')
      error.statusCode = 409
      error.code = 'WALLET_NOT_EMPTY'
      error.expose = true
      throw error
    }

    // Guardrail 2: no unfinished bookings or in-flight rides (as rider or driver).
    const [activeBookings, inflightRides] = await Promise.all([
      db().booking.count({ where: { guestId: userId, status: { in: ACTIVE_BOOKING_STATUSES } } }),
      db().rideRequest.count({ where: { OR: [{ riderId: userId }, { driverId: userId }], status: { in: INFLIGHT_RIDE_STATUSES } } }),
    ])
    if (activeBookings + inflightRides > 0) {
      const error = new Error('Resolve your active bookings and rides before closing your account.')
      error.statusCode = 409
      error.code = 'ACCOUNT_HAS_ACTIVE_OBLIGATIONS'
      error.expose = true
      throw error
    }

    // Anonymize-and-retain, atomically. PII on the row is scrubbed and sensitive documents removed, but
    // wallet ledger entries, completed bookings/rides, and admin_audit_logs are KEPT — they reference this
    // now-anonymized user id, which is exactly what the stores permit (and law/finance require).
    await db().$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          displayName: 'Deleted user',
          email: null,
          phoneHash: null,
          passwordHash: null,
          payoutMethod: null,
          idDocumentRef: null,
          idDocumentMimeType: null,
          idDocumentStatus: null,
          idDocumentSubmittedAt: null,
          idDocumentReviewedById: null,
          idDocumentReviewedAt: null,
          status: 'CLOSED',
          deletedAt: new Date(),
          // Bumping sessionVersion invalidates every outstanding token immediately (auth-context F-02).
          sessionVersion: { increment: 1 },
        },
      })
      // Remove sensitive verification/identity data (not financial, not audit).
      await tx.driverDocument.deleteMany({ where: { driverUserId: userId } })
      await tx.driverProfile.updateMany({
        where: { userId },
        data: { licenseHash: null, vehicleMake: null, vehicleModel: null, vehiclePlate: null, active: false, payoutMethod: null, payoutAccountRef: null },
      })
      if (oldEmail) await tx.emailVerificationCode.deleteMany({ where: { email: oldEmail } })
      // Personal relationship data — the user's own block list.
      await tx.userBlock.deleteMany({ where: { OR: [{ blockerUserId: userId }, { blockedUserId: userId }] } })
      // Retained-but-audited: record the closure itself (this row is intentionally NOT deleted).
      await tx.adminAuditLog.create({
        data: { actorUserId: userId, action: 'ACCOUNT_SELF_DELETED', entityType: 'users', entityId: userId, before: { status: 'ACTIVE' }, after: { status: 'CLOSED' } },
      })
    })

    // Best-effort removal of the stored ID-document file (the DB reference is already cleared above).
    if (oldIdRef) await deleteIdDocument(oldIdRef).catch(() => {})

    return json(res, 200, { ok: true, account: { status: 'CLOSED', deleted: true } })
  }

  // ---- User blocks (UGC safety): a blocked pair can't be SR-matched or message each other. ----
  if (url.pathname === '/api/me/blocks') {
    requireAuth(context)
    if (req.method === 'GET') {
      const blocks = await db().userBlock.findMany({ where: { blockerUserId: context.user.id }, orderBy: { createdAt: 'desc' } })
      return json(res, 200, { ok: true, blocks })
    }
    if (req.method === 'POST') {
      const body = await readJson(req)
      const blockedUserId = typeof body.userId === 'string' ? body.userId.trim() : ''
      if (!blockedUserId) {
        const error = new Error('userId is required.')
        error.statusCode = 400
        error.code = 'BLOCK_TARGET_REQUIRED'
        error.expose = true
        throw error
      }
      if (blockedUserId === context.user.id) {
        const error = new Error('You cannot block yourself.')
        error.statusCode = 400
        error.code = 'CANNOT_BLOCK_SELF'
        error.expose = true
        throw error
      }
      const target = await db().user.findUnique({ where: { id: blockedUserId }, select: { id: true } })
      if (!target) {
        const error = new Error('That user was not found.')
        error.statusCode = 404
        error.code = 'USER_NOT_FOUND'
        error.expose = true
        throw error
      }
      // Idempotent: re-blocking an already-blocked user is a no-op, not a duplicate-key error.
      const block = await db().userBlock.upsert({
        where: { blockerUserId_blockedUserId: { blockerUserId: context.user.id, blockedUserId } },
        create: { blockerUserId: context.user.id, blockedUserId },
        update: {},
      })
      return json(res, 201, { ok: true, block })
    }
    return methodNotAllowed(res, ['GET', 'POST'])
  }

  const blockDeleteMatch = url.pathname.match(/^\/api\/me\/blocks\/([^/]+)$/)
  if (blockDeleteMatch) {
    if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE'])
    requireAuth(context)
    await db().userBlock.deleteMany({ where: { blockerUserId: context.user.id, blockedUserId: blockDeleteMatch[1] } })
    return json(res, 200, { ok: true, unblocked: blockDeleteMatch[1] })
  }


  // SYB-011 — host payout destination registration (write path) + masked read.
  if (url.pathname === '/api/me/payout-method') {
    requireAuth(context)
    if (req.method === 'GET') {
      const me = await db().user.findUnique({ where: { id: context.user.id }, select: { payoutMethod: true } })
      return json(res, 200, { ok: true, payoutMethod: maskPayoutMethod(me?.payoutMethod) })
    }
    if (req.method === 'PATCH') {
      const body = await readJson(req)
      const normalized = normalizePayoutMethod(body)
      await db().user.update({ where: { id: context.user.id }, data: { payoutMethod: normalized } })
      // Echo the MASKED method — never the raw destination — so the host confirms without re-exposing it.
      return json(res, 200, { ok: true, payoutMethod: maskPayoutMethod(normalized) })
    }
    return methodNotAllowed(res, ['GET', 'PATCH'])
  }

  if (url.pathname === '/api/me/id-document') {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context)

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

    // Ordering: object first, metadata second, cleanup third. If the row update fails, the object we
    // just wrote is deleted — an orphan costs storage, but a user record pointing at bytes that were
    // never committed is a verification that cannot be reviewed. Success is reported only when both
    // halves completed.
    //
    // Honest limit: this is not a distributed transaction. If the process dies between the object
    // write and the row update, the object is orphaned. Automated orphan reconciliation remains
    // deferred (STG-14).
    const storageKey = await saveIdDocument(fileBase64, mimeType)
    const previous = await db().user.findUnique({ where: { id: context.user.id }, select: { idDocumentRef: true } })

    let user
    try {
      user = await db().user.update({
        where: { id: context.user.id },
        data: {
          idDocumentRef: storageKey,
          idDocumentMimeType: mimeType,
          idDocumentSubmittedAt: new Date(),
          idDocumentStatus: 'PENDING_REVIEW',
          idDocumentReviewedById: null,
          idDocumentReviewedAt: null,
        },
        select: { id: true, idDocumentRef: true, idDocumentSubmittedAt: true, idDocumentStatus: true },
      })
    } catch (error) {
      await deleteIdDocument(storageKey)
      throw error
    }

    // Replacing a previous submission (e.g. after a rejection) — remove the old file now that the
    // new one is safely written and the DB row points at the new one.
    if (previous?.idDocumentRef && previous.idDocumentRef !== storageKey) {
      await deleteIdDocument(previous.idDocumentRef)
    }

    return json(res, 200, { ok: true, user })
  }

  if (url.pathname === '/api/me/id-document/file') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)

    if (!context.user.idDocumentRef) {
      const error = new Error('No ID document has been submitted yet.')
      error.statusCode = 404
      error.code = 'ID_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }

    const buffer = await readIdDocument(context.user.idDocumentRef)
    // Forced download, never inline rendering (STG-12): a hostile PDF must not be rendered in the
    // holder's authenticated, same-origin session. Worker self-access is deliberately not audited —
    // reading your own document is ordinary self-service, not staff oversight.
    res.writeHead(200, privateDocumentDownloadHeaders({
      mimeType: context.user.idDocumentMimeType || 'application/octet-stream',
      category: ID_DOCUMENT_CATEGORY,
      byteLength: buffer.length,
    }))
    res.end(buffer)
    return true
  }

  if (url.pathname !== '/api/me/overview') return false
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

  requireAuth(context)

  await completeExpiredBookings({ guestId: context.user.id })
  // SYB-002: opportunistically release this guest's own abandoned holds on their overview read.
  await releaseAbandonedHolds({ guestId: context.user.id })
  // Same lazy-expiry pattern for wallet gifts: a gift this user sent that lapsed unclaimed is expired and
  // refunded to them before their sent-gift list is read, so their reserved money is returned on access.
  await expireAndRefundSenderGifts(db(), context.user.id)

  const [bookings, listings, payments, rides, wallet, sentGifts, claimedGifts, sellerProfile, referralsMade] = await Promise.all([
    db().booking.findMany({
      where: { guestId: context.user.id },
      include: {
        // H8: the accommodation's exact pin/address are fetched to reveal them ONLY on this guest's own
        // CONFIRMED bookings; they are stripped off any non-confirmed booking before the response is sent.
        listing: { include: { accommodation: { select: { id: true, metadata: true, address: true, governorate: true, city: true, area: true } } } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db().listing.findMany({
      where: { ownerId: context.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db().paymentProof.findMany({
      where: { userId: context.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    db().rideRequest.findMany({
      where: { OR: [{ riderId: context.user.id }, { driverId: context.user.id }] },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    }),
    db().wallet.findUnique({
      where: { userId_currency: { userId: context.user.id, currency: 'SYP' } },
      include: { entries: { orderBy: { createdAt: 'desc' }, take: 10 } },
    }),
    db().walletGift.findMany({
      where: { senderUserId: context.user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    db().walletGift.findMany({
      where: { recipientUserId: context.user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    db().sellerProfile.findUnique({ where: { userId: context.user.id } }),
    db().referral.findMany({
      where: { referrerUserId: context.user.id },
      include: { referee: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ])

  // H8 (location-R7): reveal the EXACT pin + street address only on this guest's own confirmed/completed
  // bookings; every other booking carries the blurred approximate area. Either way the raw accommodation
  // pin/address is stripped so the exact location is never leaked through a non-confirmed booking.
  const bookingsWithLocation = bookings.map((booking) => {
    const accommodation = booking.listing?.accommodation || null
    const location = bookingRevealsExactLocation(booking.status)
      ? exactLocation(accommodation)
      : approximateLocation(accommodation, booking.listing?.metadata || {})
    if (booking.listing?.accommodation) {
      booking.listing.accommodation = { id: booking.listing.accommodation.id }
    }
    return { ...booking, location }
  })

  return json(res, 200, {
    ok: true,
    overview: {
      user: {
        id: context.user.id,
        email: context.user.email,
        displayName: context.user.displayName,
        roles: context.roles,
        idDocumentRef: context.user.idDocumentRef,
        idDocumentSubmittedAt: context.user.idDocumentSubmittedAt,
        idDocumentStatus: context.user.idDocumentStatus,
        referralCode: context.user.referralCode,
        // A3.2 (Finding 3): whether the account has a contactable phone on file (the raw number is
        // stored only as a hash and never returned). The STR wizard uses this to require a phone
        // before a listing can publish, so guests can reach the host.
        hasPhone: Boolean(context.user.phoneHash),
      },
      bookings: bookingsWithLocation,
      listings,
      payments,
      rides,
      wallet,
      sellerProfile,
      gifts: {
        sent: sentGifts,
        claimed: claimedGifts,
      },
      referrals: {
        made: referralsMade,
        rewardedCount: referralsMade.filter((r) => r.status === 'REWARDED').length,
        pendingCount: referralsMade.filter((r) => r.status === 'PENDING').length,
      },
    },
  })
}
