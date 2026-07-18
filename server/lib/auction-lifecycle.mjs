import { db } from './prisma.mjs'
import { isMailerConfigured, sendAuctionWonEmail } from './mailer.mjs'

// Carcad (CARS division) online auctions (026). Classic eBay-style proxy-bid resolution: a
// bidder's maxProxyMinor is their private ceiling; the auction only ever shows the minimum price
// needed to beat the next-highest bidder (auction.currentPriceMinor), never anyone's actual max.
//
// Given the auction's current state and a new bid, computes the new visible price, the new
// leader, whether reserve is now met, and whether the anti-snipe window pushes endsAt out. Pure
// function -- no DB access -- so the "place a bid" route can wrap it in the advisory-lock
// transaction that actually persists the result (see server/routes/auctions.mjs).
export function resolveProxyBid(auction, bid, now) {
  const isFirstBidEver = auction.currentBidderId == null
  let newVisiblePrice
  let newLeader
  let newLeaderMax

  if (isFirstBidEver) {
    newVisiblePrice = Math.min(bid.maxProxyMinor, auction.startingPriceMinor)
    newLeader = bid.bidderId
    newLeaderMax = bid.maxProxyMinor
  } else if (bid.bidderId === auction.currentBidderId) {
    // Leader raising their own ceiling -- visible price is unchanged since they were already
    // beating everyone else at the old price; a higher personal max only matters if someone else
    // outbids it later.
    newVisiblePrice = auction.currentPriceMinor
    newLeader = auction.currentBidderId
    newLeaderMax = bid.maxProxyMinor
  } else if (bid.maxProxyMinor < auction.currentMaxProxyMinor) {
    // Challenger still loses -- visible price rises to just beat them, capped at the leader's own max.
    newVisiblePrice = Math.min(auction.currentMaxProxyMinor, bid.maxProxyMinor + auction.minIncrementMinor)
    newLeader = auction.currentBidderId
    newLeaderMax = auction.currentMaxProxyMinor
  } else if (bid.maxProxyMinor === auction.currentMaxProxyMinor) {
    // Tie-break: the earlier bidder (the existing leader, by definition of already being leader)
    // keeps the lead.
    newVisiblePrice = auction.currentMaxProxyMinor
    newLeader = auction.currentBidderId
    newLeaderMax = auction.currentMaxProxyMinor
  } else {
    // New bidder outbids the old leader outright -- visible price = old leader's max + one
    // increment, capped at the new leader's own max (never shown paying more than necessary to win).
    newVisiblePrice = Math.min(bid.maxProxyMinor, auction.currentMaxProxyMinor + auction.minIncrementMinor)
    newLeader = bid.bidderId
    newLeaderMax = bid.maxProxyMinor
  }

  const reserveMet =
    auction.reserveMet || auction.reservePriceMinor == null || newVisiblePrice >= auction.reservePriceMinor

  const windowStartMs = auction.endsAt.getTime() - auction.antiSnipeWindowSeconds * 1000
  const nowMs = now.getTime()
  let newEndsAt = auction.endsAt
  if (nowMs >= windowStartMs && nowMs < auction.endsAt.getTime()) {
    const candidateEndsAt = new Date(nowMs + auction.antiSnipeExtensionSeconds * 1000)
    if (candidateEndsAt.getTime() > auction.endsAt.getTime()) newEndsAt = candidateEndsAt
  }

  return {
    newVisiblePrice,
    newLeader,
    newLeaderMax,
    reserveMet,
    newEndsAt,
    bidBecameLeader: newLeader === bid.bidderId,
  }
}

// Public, listing-card-safe auction summaries for a batch of listings (browse/search results) --
// only ever the fields any buyer may see: never currentBidderId/currentMaxProxyMinor/reservePriceMinor.
// Returns a Map keyed by listingId so callers can attach `listing.auction = summaries.get(listing.id)`.
export async function loadAuctionSummaries(listingIds) {
  if (!listingIds.length) return new Map()
  const auctions = await db().auction.findMany({
    where: { listingId: { in: listingIds } },
    include: { _count: { select: { bids: true } } },
  })
  return new Map(
    auctions.map((auction) => [
      auction.listingId,
      {
        status: auction.status,
        currentPriceMinor: auction.currentPriceMinor,
        reserveMet: auction.reserveMet,
        endsAt: auction.endsAt,
        bidCount: auction._count.bids,
      },
    ]),
  )
}

// Opportunistic end-sweep -- there is no cron/scheduler anywhere in this codebase (same reasoning
// as expireOldListings/completeExpiredBookings): run on read, from whichever GET route is looking
// at auctions right now, with an appropriate ownership/id filter.
export async function expireOpenAuctions(where = {}) {
  const now = new Date()
  const due = await db().auction.findMany({
    where: { ...where, status: 'OPEN', endsAt: { lt: now } },
    include: { listing: true },
  })
  let endedCount = 0
  for (const auction of due) {
    const updated = await db().auction.updateMany({
      where: { id: auction.id, status: 'OPEN', endsAt: { lt: now } },
      data: {
        status: 'ENDED',
        endedAt: now,
        winnerBidderId: auction.reserveMet ? auction.currentBidderId : null,
      },
    })
    if (updated.count === 1) {
      endedCount += 1
      await notifyAuctionEnded(auction)
    }
  }
  return endedCount
}

// Best-effort winner notification, following the exact host-insights.mjs pattern: skip entirely if
// there's no winner or no mailer configured, try/catch on send, persist success/failure on the
// Auction row, never throw, never auto-retry (a later sweep run won't see this auction again since
// its status is already ENDED).
async function notifyAuctionEnded(auction) {
  if (!auction.winnerBidderId) return
  if (!isMailerConfigured()) return
  const winner = await db().user.findUnique({
    where: { id: auction.winnerBidderId },
    select: { id: true, email: true, displayName: true },
  })
  if (!winner?.email) return
  try {
    await sendAuctionWonEmail(winner, auction, auction.listing)
    await db().auction.update({ where: { id: auction.id }, data: { winnerNotifiedAt: new Date() } })
  } catch (error) {
    await db().auction.update({
      where: { id: auction.id },
      data: { winnerEmailError: error instanceof Error ? error.message : 'Unknown email error' },
    })
  }
}
