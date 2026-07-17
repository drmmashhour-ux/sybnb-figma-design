import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'

export async function handleReviews(req, res, url, context) {
  if (url.pathname !== '/api/reviews') return false
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  requireAuth(context, ['GUEST'])
  const body = await readJson(req)
  const bookingId = String(body.bookingId || '')
  const rating = Number(body.rating)
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) || null : null

  if (!bookingId) {
    const error = new Error('bookingId is required.')
    error.statusCode = 400
    error.code = 'REVIEW_BOOKING_REQUIRED'
    error.expose = true
    throw error
  }

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    const error = new Error('rating must be an integer from 1 to 5.')
    error.statusCode = 400
    error.code = 'REVIEW_RATING_INVALID'
    error.expose = true
    throw error
  }

  const booking = await db().booking.findFirst({
    where: { id: bookingId, guestId: context.user.id },
    include: { listing: { select: { ownerId: true } } },
  })

  if (!booking) {
    const error = new Error('Booking not found for this guest account.')
    error.statusCode = 404
    error.code = 'BOOKING_NOT_FOUND'
    error.expose = true
    throw error
  }

  // SELF-REVIEW guard (defense in depth): the reviewer must not be the listing owner.
  if (booking.listing?.ownerId === context.user.id) {
    const error = new Error('You cannot review your own listing.')
    error.statusCode = 403
    error.code = 'CANNOT_REVIEW_OWN_LISTING'
    error.expose = true
    throw error
  }

  if (booking.status !== 'COMPLETED') {
    const error = new Error('Only completed stays can be reviewed.')
    error.statusCode = 400
    error.code = 'REVIEW_BOOKING_NOT_COMPLETED'
    error.expose = true
    throw error
  }

  const existingReview = await db().listingReview.findUnique({ where: { bookingId } })
  if (existingReview) {
    const error = new Error('This booking has already been reviewed.')
    error.statusCode = 409
    error.code = 'REVIEW_ALREADY_EXISTS'
    error.expose = true
    throw error
  }

  const review = await db().listingReview.create({
    data: {
      listingId: booking.listingId,
      bookingId: booking.id,
      guestId: context.user.id,
      rating,
      comment,
    },
    include: {
      guest: { select: { id: true, displayName: true } },
    },
  })

  return json(res, 201, { ok: true, review })
}
