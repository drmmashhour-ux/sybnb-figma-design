import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { expireOpenAuctions, resolveProxyBid } from '../lib/auction-lifecycle.mjs'

// Carcad (CARS division) online auctions (026). A dealer's per-listing choice: fixed price OR
// auction (metadata.saleType). This file owns the auction-specific surface -- creating the config,
// reading public state, and placing bids -- kept separate from listings.mjs the same way
// accommodations.mjs is its own file: big enough surface (its own auth/ownership rules, its own
// advisory-lock bidding transaction) to deserve isolation.

const MIN_DURATION_HOURS = 1
const MAX_DURATION_HOURS = 720 // 30 days

function auctionPublicShape(auction, { isOwner, isLeader, isWinner } = {}) {
  const shape = {
    id: auction.id,
    listingId: auction.listingId,
    status: auction.status,
    startingPriceMinor: auction.startingPriceMinor,
    currentPriceMinor: auction.currentPriceMinor,
    reserveMet: auction.reserveMet,
    minIncrementMinor: auction.minIncrementMinor,
    startsAt: auction.startsAt,
    endsAt: auction.endsAt,
  }
  if (isLeader) shape.youAreHighestBidder = true
  if (isOwner) shape.reservePriceMinor = auction.reservePriceMinor
  if (auction.status === 'ENDED') {
    shape.endedAt = auction.endedAt
    // Never expose the raw winnerBidderId -- the owner learns the winner's identity the normal
    // way (the winner messages them via the existing contact-seller flow), and the winner only
    // needs to know it was THEM, not the underlying id. hasWinner lets the owner's dashboard show
    // "auction ended, reserve met" without leaking bidder identity through this endpoint.
    shape.hasWinner = Boolean(auction.winnerBidderId)
    if (isWinner) shape.youWon = true
  }
  return shape
}

export async function handleAuctions(req, res, url, context) {
  const configMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/auction$/)
  if (configMatch) {
    const listingId = configMatch[1]

    if (req.method === 'POST') {
      requireAuth(context, ['SELLER', 'HOST'])
      const listing = await db().listing.findFirst({ where: { id: listingId, ownerId: context.user.id } })
      if (!listing) {
        const error = new Error('Listing not found for this account.')
        error.statusCode = 404
        error.code = 'LISTING_NOT_FOUND'
        error.expose = true
        throw error
      }
      if (listing.division !== 'CARS') {
        const error = new Error('Auctions are only available for the CARS division.')
        error.statusCode = 400
        error.code = 'AUCTION_DIVISION_UNSUPPORTED'
        error.expose = true
        throw error
      }
      if (!['DRAFT', 'REJECTED'].includes(listing.status)) {
        const error = new Error('Only a draft or rejected listing can have an auction configured.')
        error.statusCode = 400
        error.code = 'LISTING_NOT_SUBMITTABLE'
        error.expose = true
        throw error
      }
      const existingAuction = await db().auction.findUnique({ where: { listingId } })
      if (existingAuction) {
        const error = new Error('This listing already has an auction configured.')
        error.statusCode = 409
        error.code = 'AUCTION_ALREADY_CONFIGURED'
        error.expose = true
        throw error
      }

      const body = await readJson(req)
      const minIncrementMinor = Number(body.minIncrementMinor)
      const durationHours = Number(body.durationHours)
      const reservePriceMinor = body.reservePriceMinor !== undefined && body.reservePriceMinor !== null
        ? Number(body.reservePriceMinor)
        : null

      if (!Number.isInteger(minIncrementMinor) || minIncrementMinor <= 0) {
        const error = new Error('minIncrementMinor must be a positive whole number.')
        error.statusCode = 400
        error.code = 'AUCTION_INCREMENT_INVALID'
        error.expose = true
        throw error
      }
      if (!Number.isFinite(durationHours) || durationHours < MIN_DURATION_HOURS || durationHours > MAX_DURATION_HOURS) {
        const error = new Error(`durationHours must be between ${MIN_DURATION_HOURS} and ${MAX_DURATION_HOURS}.`)
        error.statusCode = 400
        error.code = 'AUCTION_DURATION_INVALID'
        error.expose = true
        throw error
      }
      if (reservePriceMinor !== null && (!Number.isInteger(reservePriceMinor) || reservePriceMinor <= 0)) {
        const error = new Error('reservePriceMinor must be a positive whole number.')
        error.statusCode = 400
        error.code = 'AUCTION_RESERVE_INVALID'
        error.expose = true
        throw error
      }

      const now = new Date()
      const endsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000)

      const auction = await db().auction.create({
        data: {
          listingId,
          startingPriceMinor: listing.priceMinor,
          currentPriceMinor: listing.priceMinor,
          reservePriceMinor,
          minIncrementMinor,
          startsAt: now,
          endsAt,
        },
      })
      await db().listing.update({
        where: { id: listingId },
        data: { metadata: { ...listing.metadata, saleType: 'AUCTION' } },
      })

      return json(res, 201, { ok: true, auction: auctionPublicShape(auction, { isOwner: true }) })
    }

    if (req.method === 'GET') {
      await expireOpenAuctions({ listing: { id: listingId } })
      const auction = await db().auction.findUnique({ where: { listingId }, include: { listing: true } })
      if (!auction) {
        const error = new Error('This listing does not have an auction.')
        error.statusCode = 404
        error.code = 'AUCTION_NOT_FOUND'
        error.expose = true
        throw error
      }
      const requesterId = context?.user?.id
      if (auction.listing.status !== 'APPROVED' && requesterId !== auction.listing.ownerId) {
        const error = new Error('This listing is not available.')
        error.statusCode = 404
        error.code = 'LISTING_NOT_FOUND'
        error.expose = true
        throw error
      }
      const isOwner = Boolean(requesterId) && requesterId === auction.listing.ownerId
      const isLeader = Boolean(requesterId) && requesterId === auction.currentBidderId
      const isWinner = Boolean(requesterId) && requesterId === auction.winnerBidderId
      const bidCount = await db().bid.count({ where: { auctionId: auction.id } })
      return json(res, 200, { ok: true, auction: { ...auctionPublicShape(auction, { isOwner, isLeader, isWinner }), bidCount } })
    }

    return methodNotAllowed(res, ['GET', 'POST'])
  }

  const bidMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/auction\/bids$/)
  if (bidMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const listingId = bidMatch[1]
    const body = await readJson(req)
    const maxProxyMinor = Number(body.maxProxyMinor)
    if (!Number.isInteger(maxProxyMinor) || maxProxyMinor <= 0) {
      const error = new Error('maxProxyMinor must be a positive whole number.')
      error.statusCode = 400
      error.code = 'BID_INVALID_AMOUNT'
      error.expose = true
      throw error
    }

    const auctionLookup = await db().auction.findUnique({ where: { listingId } })
    if (!auctionLookup) {
      const error = new Error('This listing does not have an auction.')
      error.statusCode = 404
      error.code = 'AUCTION_NOT_FOUND'
      error.expose = true
      throw error
    }
    const auctionId = auctionLookup.id
    const bidderId = context.user.id

    const result = await db().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${auctionId}))`

      const auction = await tx.auction.findUnique({ where: { id: auctionId }, include: { listing: true } })
      if (!auction) {
        const error = new Error('This listing does not have an auction.')
        error.statusCode = 404
        error.code = 'AUCTION_NOT_FOUND'
        error.expose = true
        throw error
      }
      const now = new Date()
      if (auction.status !== 'OPEN') {
        const error = new Error('This auction is not open for bidding.')
        error.statusCode = 409
        error.code = 'AUCTION_NOT_OPEN'
        error.expose = true
        throw error
      }
      if (now >= auction.endsAt) {
        const error = new Error('This auction has already ended.')
        error.statusCode = 409
        error.code = 'AUCTION_ALREADY_ENDED'
        error.expose = true
        throw error
      }
      if (auction.listing.ownerId === bidderId) {
        const error = new Error('You cannot bid on your own listing.')
        error.statusCode = 403
        error.code = 'CANNOT_BID_OWN_LISTING'
        error.expose = true
        throw error
      }
      if (maxProxyMinor < auction.currentPriceMinor) {
        const error = new Error('Your bid must be at least the current price.')
        error.statusCode = 400
        error.code = 'BID_TOO_LOW'
        error.expose = true
        error.details = { currentPriceMinor: auction.currentPriceMinor, minIncrementMinor: auction.minIncrementMinor }
        throw error
      }
      if (auction.currentBidderId === bidderId && maxProxyMinor <= auction.currentMaxProxyMinor) {
        const error = new Error('Your new maximum must be higher than your current maximum.')
        error.statusCode = 400
        error.code = 'BID_NOT_HIGHER_THAN_OWN_MAX'
        error.expose = true
        throw error
      }

      const resolution = resolveProxyBid(auction, { bidderId, maxProxyMinor }, now)

      const bid = await tx.bid.create({
        data: {
          auctionId,
          bidderId,
          maxProxyMinor,
          visiblePriceAtMinor: resolution.newVisiblePrice,
          isWinningBid: resolution.bidBecameLeader,
        },
      })
      if (resolution.bidBecameLeader && auction.currentBidderId && auction.currentBidderId !== bidderId) {
        await tx.bid.updateMany({
          where: { auctionId, bidderId: auction.currentBidderId, isWinningBid: true },
          data: { isWinningBid: false },
        })
      }

      const updated = await tx.auction.updateMany({
        where: { id: auctionId, status: 'OPEN', updatedAt: auction.updatedAt },
        data: {
          currentPriceMinor: resolution.newVisiblePrice,
          currentBidderId: resolution.newLeader,
          currentMaxProxyMinor: resolution.newLeaderMax,
          reserveMet: resolution.reserveMet,
          endsAt: resolution.newEndsAt,
        },
      })
      if (updated.count !== 1) {
        const error = new Error('This auction changed while your bid was being placed, please retry.')
        error.statusCode = 409
        error.code = 'AUCTION_STATE_CONFLICT'
        error.expose = true
        throw error
      }

      return { bid, auction: await tx.auction.findUnique({ where: { id: auctionId } }) }
    })

    return json(res, 201, {
      ok: true,
      currentPriceMinor: result.auction.currentPriceMinor,
      youAreHighestBidder: result.auction.currentBidderId === bidderId,
      reserveMet: result.auction.reserveMet,
      endsAt: result.auction.endsAt,
    })
  }

  return false
}
