import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { completeExpiredBookings } from '../lib/booking-lifecycle.mjs'
import { expireAndRefundSenderGifts } from '../lib/gift-ledger.mjs'
import { deleteIdDocument, readIdDocument, saveIdDocument } from '../lib/id-document-storage.mjs'

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

    const storageKey = await saveIdDocument(fileBase64, mimeType)
    const previous = await db().user.findUnique({ where: { id: context.user.id }, select: { idDocumentRef: true } })

    const user = await db().user.update({
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
    res.writeHead(200, {
      'content-type': context.user.idDocumentMimeType || 'application/octet-stream',
      'cache-control': 'private, no-store',
    })
    res.end(buffer)
    return true
  }

  // Synitres — the seller's own property portfolio (BUY/RENTALS) with a live inquiry count per listing,
  // for the "My properties" management view. Scoped to the caller's own listings only.
  if (url.pathname === '/api/me/properties') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const properties = await db().listing.findMany({
      where: { ownerId: context.user.id, division: { in: ['BUY', 'RENTALS'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const ids = properties.map((p) => p.id)
    const inquiryRows = ids.length
      ? await db().messageThread.groupBy({ by: ['listingId'], where: { listingId: { in: ids } }, _count: { _all: true } })
      : []
    const inquiryByListing = new Map(inquiryRows.map((row) => [row.listingId, row._count._all]))
    return json(res, 200, {
      ok: true,
      properties: properties.map((p) => ({ ...p, inquiryCount: inquiryByListing.get(p.id) || 0 })),
    })
  }

  if (url.pathname !== '/api/me/overview') return false
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])

  requireAuth(context)

  await completeExpiredBookings({ guestId: context.user.id })
  // Same lazy-expiry pattern for wallet gifts: a gift this user sent that lapsed unclaimed is expired and
  // refunded to them before their sent-gift list is read, so their reserved money is returned on access.
  await expireAndRefundSenderGifts(db(), context.user.id)

  const [bookings, listings, payments, rides, wallet, sentGifts, claimedGifts, sellerProfile, referralsMade] = await Promise.all([
    db().booking.findMany({
      where: { guestId: context.user.id },
      include: { listing: true, payments: true },
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
      },
      bookings,
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
