import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(message, statusCode, code) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}

// Marketplace seller reputation (Block 3). Cars/property/goods have no Booking to gate a review on,
// so the trust model is: the SELLER first confirms a real sale to a specific buyer (POST confirm-sale),
// and ONLY that confirmed buyer may then leave one review (POST /api/sellers/:id/reviews).
export async function handleSellers(req, res, url, context) {
  // ---- Seller confirms a sale to a buyer (grants that buyer the right to review) ----
  if (url.pathname === '/api/sellers/confirm-sale') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['SELLER', 'HOST'])
    const body = await readJson(req)
    const listingId = String(body.listingId || '')
    const buyerId = String(body.buyerId || '')
    if (!UUID_RE.test(listingId) || !UUID_RE.test(buyerId)) {
      fail('A valid listingId and buyerId are required.', 400, 'SALE_INPUT_INVALID')
    }
    if (buyerId === context.user.id) {
      fail('You cannot confirm a sale to yourself.', 400, 'SALE_SELF_FORBIDDEN')
    }
    const listing = await db().listing.findFirst({ where: { id: listingId, ownerId: context.user.id }, select: { id: true, division: true } })
    if (!listing) fail('Listing not found for this account.', 404, 'LISTING_NOT_FOUND')
    // STAYS uses stay reviews (off a completed Booking) — seller sale confirmations are for the
    // contact-based marketplace/property/car divisions only.
    if (listing.division === 'STAYS') {
      fail('STAYS listings use stay reviews, not seller sale confirmations.', 400, 'SALE_DIVISION_UNSUPPORTED')
    }
    const buyer = await db().user.findUnique({ where: { id: buyerId }, select: { id: true } })
    if (!buyer) fail('Buyer not found.', 404, 'BUYER_NOT_FOUND')

    // Idempotent per (listing, buyer): a repeat confirm returns the existing sale, never stacks grants.
    const sale = await db().sellerSale.upsert({
      where: { listingId_buyerId: { listingId, buyerId } },
      create: { listingId, sellerId: context.user.id, buyerId },
      update: {},
    })
    return json(res, 201, { ok: true, sale })
  }

  // ---- Seller reviews: GET lists visible reviews; POST creates one (confirmed buyer only) ----
  const reviewMatch = url.pathname.match(/^\/api\/sellers\/([^/]+)\/reviews$/)
  if (reviewMatch) {
    const sellerId = reviewMatch[1]
    if (!UUID_RE.test(sellerId)) fail('Seller not found.', 404, 'SELLER_NOT_FOUND')

    if (req.method === 'GET') {
      const reviews = await db().sellerReview.findMany({
        where: { sellerId, hiddenAt: null },
        include: { buyer: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      return json(res, 200, { ok: true, reviews })
    }
    if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST'])

    requireAuth(context)
    const body = await readJson(req)
    const rating = Number(body.rating)
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) || null : null
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      fail('rating must be an integer from 1 to 5.', 400, 'REVIEW_RATING_INVALID')
    }
    if (sellerId === context.user.id) {
      fail('You cannot review yourself.', 403, 'CANNOT_REVIEW_SELF')
    }
    // Gate: the reviewer must be a buyer the seller has confirmed a sale to.
    const sale = await db().sellerSale.findFirst({
      where: { sellerId, buyerId: context.user.id },
      include: { review: true },
      orderBy: { createdAt: 'desc' },
    })
    if (!sale) {
      fail('Only a buyer the seller has confirmed a sale to can leave a review.', 403, 'REVIEW_NOT_ELIGIBLE')
    }
    if (sale.review) {
      fail('You have already reviewed this seller for that sale.', 409, 'REVIEW_ALREADY_EXISTS')
    }
    const review = await db().sellerReview.create({
      data: { saleId: sale.id, sellerId, buyerId: context.user.id, rating, comment },
      include: { buyer: { select: { id: true, displayName: true } } },
    })
    return json(res, 201, { ok: true, review })
  }

  // ---- Public seller profile: reputation + verification badge ----
  const profileMatch = url.pathname.match(/^\/api\/sellers\/([^/]+)$/)
  if (profileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const sellerId = profileMatch[1]
    if (!UUID_RE.test(sellerId)) fail('Seller not found.', 404, 'SELLER_NOT_FOUND')
    const seller = await db().user.findUnique({
      where: { id: sellerId },
      select: { id: true, displayName: true, idDocumentStatus: true, sellerProfile: { select: { documentStatus: true } } },
    })
    if (!seller) fail('Seller not found.', 404, 'SELLER_NOT_FOUND')

    const agg = await db().sellerReview.aggregate({
      where: { sellerId, hiddenAt: null },
      _avg: { rating: true },
      _count: { _all: true },
    })
    const count = agg._count._all
    const average = count ? Math.round((agg._avg.rating || 0) * 10) / 10 : null

    return json(res, 200, {
      ok: true,
      seller: {
        id: seller.id,
        displayName: seller.displayName,
        // Verification badge: SYBNB admin approved the seller's identity document. documentsVerified
        // additionally reflects their seller-profile (business/ownership) documents being approved.
        verified: seller.idDocumentStatus === 'APPROVED',
        documentsVerified: seller.sellerProfile?.documentStatus === 'APPROVED',
      },
      rating: { average, count },
    })
  }

  return false
}
