import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { isBookingViewable } from './bookings.mjs'
import { assertNotBlockedPair } from '../lib/user-blocks.mjs'
import { assertBoundedString, assertNoUnknownFields } from '../lib/validate.mjs'
import { readThreadDocument, saveThreadDocument } from '../lib/thread-document-storage.mjs'

const THREAD_DOCUMENT_SELECT = { id: true, mimeType: true, originalFilename: true, createdAt: true, uploaderUserId: true }

const MESSAGE_BLOCK_OPTS = { code: 'MESSAGE_USER_BLOCK', message: 'You cannot message this user because of a block.', statusCode: 403 }

const MESSAGING_ELIGIBLE_BOOKING_STATUSES = ['CONFIRMED', 'COMPLETED', 'DISPUTED']

async function loadBookingForThread(bookingId, context) {
  const booking = await db().booking.findUnique({
    where: { id: bookingId },
    include: { listing: true },
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

  if (!MESSAGING_ELIGIBLE_BOOKING_STATUSES.includes(booking.status)) {
    const error = new Error('Messaging opens once the booking is confirmed.')
    error.statusCode = 400
    error.code = 'MESSAGING_NOT_ELIGIBLE'
    error.expose = true
    throw error
  }

  return booking
}

function senderRoleFor(booking, context) {
  if (context.roles.includes('ADMIN')) return 'ADMIN'
  if (context.roles.includes('SUPPORT')) return 'SUPPORT'
  if (booking.listing.ownerId === context.user.id) return 'HOST'
  return 'GUEST'
}

async function ensureThread(bookingId) {
  return db().messageThread.upsert({
    where: { bookingId },
    create: { bookingId },
    update: {},
  })
}

function listingSenderRoleFor(listing, context) {
  if (context.roles.includes('ADMIN')) return 'ADMIN'
  if (context.roles.includes('SUPPORT')) return 'SUPPORT'
  if (listing.ownerId === context.user.id) return 'HOST'
  return 'GUEST'
}

async function loadListingForThread(listingId, context) {
  const listing = await db().listing.findUnique({ where: { id: listingId } })
  if (!listing) {
    const error = new Error('Listing not found.')
    error.statusCode = 404
    error.code = 'LISTING_NOT_FOUND'
    error.expose = true
    throw error
  }

  const isOwner = listing.ownerId === context.user.id
  if (!isOwner && listing.status !== 'APPROVED') {
    const error = new Error('This listing is not available for this account.')
    error.statusCode = 403
    error.code = 'LISTING_FORBIDDEN'
    error.expose = true
    throw error
  }

  return { listing, isOwner }
}

async function ensureListingThread(listingId, guestId) {
  return db().messageThread.upsert({
    where: { listingId_guestId: { listingId, guestId } },
    create: { listingId, guestId },
    update: {},
  })
}

export async function handleMessages(req, res, url, context) {
  const listingThreadMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/thread$/)
  if (listingThreadMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)

    const { listing, isOwner } = await loadListingForThread(listingThreadMatch[1], context)
    const guestId = isOwner ? String(url.searchParams.get('guestId') || '') : context.user.id
    if (isOwner && !guestId) {
      const error = new Error('guestId is required for the listing owner.')
      error.statusCode = 400
      error.code = 'GUEST_ID_REQUIRED'
      error.expose = true
      throw error
    }
    if (isOwner && guestId === context.user.id) {
      const error = new Error('An owner cannot open a thread with themselves.')
      error.statusCode = 400
      error.code = 'INVALID_GUEST_ID'
      error.expose = true
      throw error
    }

    // Only the guest side auto-creates a thread by messaging the listing owner. An owner (isOwner)
    // can only open a thread a guest already started — otherwise an owner could fabricate an
    // inquiry thread with an arbitrary guestId they have no real relationship with and message
    // into it unsolicited.
    const thread = isOwner
      ? await db().messageThread.findUnique({ where: { listingId_guestId: { listingId: listing.id, guestId } } })
      : await ensureListingThread(listing.id, guestId)

    if (!thread) {
      const error = new Error('This inquiry thread does not exist yet.')
      error.statusCode = 404
      error.code = 'THREAD_NOT_FOUND'
      error.expose = true
      throw error
    }

    const messages = await db().message.findMany({
      where: { threadId: thread.id },
      include: { sender: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })

    const documents = await db().threadDocument.findMany({
      where: { threadId: thread.id },
      select: THREAD_DOCUMENT_SELECT,
      orderBy: { createdAt: 'asc' },
    })

    return json(res, 200, { ok: true, thread: { id: thread.id, listingId: listing.id, guestId, messages, documents } })
  }

  const listingDocumentsMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/thread\/documents$/)
  if (listingDocumentsMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)

    const { listing, isOwner } = await loadListingForThread(listingDocumentsMatch[1], context)
    const body = await readJson(req)
    assertNoUnknownFields(body, ['fileBase64', 'mimeType', 'originalFilename', 'guestId'], 'thread document body')

    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
    if (!fileBase64 || !mimeType) {
      const error = new Error('A file and its mime type are required.')
      error.statusCode = 400
      error.code = 'THREAD_DOCUMENT_REQUIRED'
      error.expose = true
      throw error
    }
    const originalFilename = assertBoundedString(body.originalFilename, { fieldName: 'originalFilename', maxLength: 200, required: false })

    const guestId = isOwner ? String(body.guestId || '') : context.user.id
    if (isOwner && !guestId) {
      const error = new Error('guestId is required for the listing owner.')
      error.statusCode = 400
      error.code = 'GUEST_ID_REQUIRED'
      error.expose = true
      throw error
    }

    const thread = isOwner
      ? await db().messageThread.findUnique({ where: { listingId_guestId: { listingId: listing.id, guestId } } })
      : await ensureListingThread(listing.id, guestId)

    if (!thread) {
      const error = new Error('This inquiry thread does not exist yet.')
      error.statusCode = 404
      error.code = 'THREAD_NOT_FOUND'
      error.expose = true
      throw error
    }

    await assertNotBlockedPair(db(), context.user.id, isOwner ? guestId : listing.ownerId, MESSAGE_BLOCK_OPTS)

    const storageKey = await saveThreadDocument(fileBase64, mimeType)
    const document = await db().threadDocument.create({
      data: {
        threadId: thread.id,
        uploaderUserId: context.user.id,
        assetUrl: storageKey,
        mimeType,
        originalFilename: originalFilename || null,
      },
      select: THREAD_DOCUMENT_SELECT,
    })

    return json(res, 201, { ok: true, document })
  }

  const listingDocumentFileMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/thread\/documents\/([^/]+)\/file$/)
  if (listingDocumentFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)

    const { listing, isOwner } = await loadListingForThread(listingDocumentFileMatch[1], context)
    const document = await db().threadDocument.findUnique({
      where: { id: listingDocumentFileMatch[2] },
      include: { thread: true },
    })

    if (!document || document.thread.listingId !== listing.id) {
      const error = new Error('Document not found.')
      error.statusCode = 404
      error.code = 'THREAD_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }

    const isStaff = context.roles.includes('ADMIN') || context.roles.includes('SUPPORT')
    const isParticipant = isOwner || context.user.id === document.thread.guestId
    if (!isStaff && !isParticipant) {
      const error = new Error('You cannot access this document.')
      error.statusCode = 403
      error.code = 'THREAD_DOCUMENT_FORBIDDEN'
      error.expose = true
      throw error
    }

    const buffer = await readThreadDocument(document.assetUrl)
    res.writeHead(200, { 'content-type': document.mimeType || 'application/octet-stream', 'cache-control': 'private, no-store' })
    res.end(buffer)
    return true
  }

  const listingSendMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/thread\/messages$/)
  if (listingSendMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)

    const { listing, isOwner } = await loadListingForThread(listingSendMatch[1], context)
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

    const guestId = isOwner ? String(body.guestId || '') : context.user.id
    if (isOwner && !guestId) {
      const error = new Error('guestId is required for the listing owner.')
      error.statusCode = 400
      error.code = 'GUEST_ID_REQUIRED'
      error.expose = true
      throw error
    }

    const thread = isOwner
      ? await db().messageThread.findUnique({ where: { listingId_guestId: { listingId: listing.id, guestId } } })
      : await ensureListingThread(listing.id, guestId)

    if (!thread) {
      const error = new Error('This inquiry thread does not exist yet.')
      error.statusCode = 404
      error.code = 'THREAD_NOT_FOUND'
      error.expose = true
      throw error
    }

    // UGC block (024): the guest and the listing owner can't message each other once either has blocked the other.
    await assertNotBlockedPair(db(), context.user.id, isOwner ? guestId : listing.ownerId, MESSAGE_BLOCK_OPTS)

    const message = await db().message.create({
      data: {
        threadId: thread.id,
        senderUserId: context.user.id,
        senderRole: listingSenderRoleFor(listing, context),
        body: text,
      },
      include: { sender: { select: { id: true, displayName: true } } },
    })

    return json(res, 201, { ok: true, message })
  }

  if (url.pathname === '/api/host/inquiries') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)

    const threads = await db().messageThread.findMany({
      where: { listing: { ownerId: context.user.id } },
      include: {
        listing: { select: { id: true, titleAr: true, titleEn: true, division: true, priceMinor: true, currency: true } },
        // SECURITY (S10): host sees only the guest's id + display name, never their email.
        guest: { select: { id: true, displayName: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        documents: { select: THREAD_DOCUMENT_SELECT, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })

    return json(res, 200, { ok: true, threads })
  }

  const threadMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/thread$/)
  if (threadMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)

    const booking = await loadBookingForThread(threadMatch[1], context)
    const thread = await ensureThread(booking.id)
    const messages = await db().message.findMany({
      where: { threadId: thread.id },
      include: { sender: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })

    return json(res, 200, { ok: true, thread: { id: thread.id, bookingId: booking.id, messages } })
  }

  const sendMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/thread\/messages$/)
  if (sendMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)

    const booking = await loadBookingForThread(sendMatch[1], context)
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

    // UGC block (024): the guest and the host can't message each other on a booking once blocked.
    const counterparty = context.user.id === booking.guestId ? booking.listing?.ownerId : booking.guestId
    await assertNotBlockedPair(db(), context.user.id, counterparty, MESSAGE_BLOCK_OPTS)

    const thread = await ensureThread(booking.id)
    const message = await db().message.create({
      data: {
        threadId: thread.id,
        senderUserId: context.user.id,
        senderRole: senderRoleFor(booking, context),
        body: text,
      },
      include: { sender: { select: { id: true, displayName: true } } },
    })

    return json(res, 201, { ok: true, message })
  }

  return false
}
