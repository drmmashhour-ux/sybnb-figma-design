import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Online auctions (026), bidding: POST /api/listings/:listingId/auction/bids. Proxy-bid resolution
// correctness plus the concurrent-bid race safety the advisory-lock transaction exists to guarantee.

const VEHICLE = { make: 'Toyota', model: 'Camry', year: 2020, mileageKm: 30000, transmission: 'automatic', fuelType: 'gas', condition: 'USED' }

async function registerBuyer(app, label) {
  const email = uniqueTestEmail(label)
  const legacyVerificationGrant1 = await verifyEmailForTest(app, email, 'guest-signup')
  const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'GUEST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function registerSeller(app, label) {
  const email = uniqueTestEmail(label)
  const legacyVerificationGrant2 = await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant2, role: 'SELLER', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function createOpenAuction(ownerId, overrides = {}) {
  const listing = await db().listing.create({
    data: {
      ownerId,
      division: 'CARS',
      status: 'APPROVED',
      titleAr: 'سيارة اختبار',
      priceMinor: 20_000_000,
      currency: 'USD',
      metadata: { vehicle: VEHICLE, saleType: 'AUCTION', mapLocation: { latitude: 33.5138, longitude: 36.2765, pinConfirmed: true } },
    },
  })
  const auction = await db().auction.create({
    data: {
      listingId: listing.id,
      startingPriceMinor: 20_000_000,
      currentPriceMinor: 20_000_000,
      minIncrementMinor: 500_000,
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    },
  })
  return { listing, auction }
}

async function bid(app, token, listingId, maxProxyMinor) {
  return request(app)
    .post(`/api/listings/${listingId}/auction/bids`)
    .set('Authorization', `Bearer ${token}`)
    .send({ maxProxyMinor })
}

describe('Auction bidding: POST /api/listings/:listingId/auction/bids', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('first bid sets the visible price and marks the bidder as leading', async () => {
    const seller = await registerSeller(app, 'bid-first-seller')
    const buyer = await registerBuyer(app, 'bid-first-buyer')
    const { listing } = await createOpenAuction(seller.user.id)

    const res = await bid(app, buyer.token, listing.id, 21_000_000)
    expect(res.status).toBe(201)
    expect(res.body.currentPriceMinor).toBe(20_000_000) // min(maxProxy, startingPrice) -- no opponent yet
    expect(res.body.youAreHighestBidder).toBe(true)
  })

  it("a lower challenger proxy bid doesn't take the lead but raises the visible price", async () => {
    const seller = await registerSeller(app, 'bid-lower-seller')
    const leader = await registerBuyer(app, 'bid-lower-leader')
    const challenger = await registerBuyer(app, 'bid-lower-challenger')
    const { listing } = await createOpenAuction(seller.user.id)

    await bid(app, leader.token, listing.id, 25_000_000)
    const res = await bid(app, challenger.token, listing.id, 22_000_000)
    expect(res.status).toBe(201)
    expect(res.body.youAreHighestBidder).toBe(false)
    // old leader's max (25M) vs challenger's max+increment (22.5M) -> visible price = 22.5M
    expect(res.body.currentPriceMinor).toBe(22_500_000)
  })

  it('a higher challenger proxy bid takes the lead at old-leader-max + one increment', async () => {
    const seller = await registerSeller(app, 'bid-higher-seller')
    const leader = await registerBuyer(app, 'bid-higher-leader')
    const challenger = await registerBuyer(app, 'bid-higher-challenger')
    const { listing } = await createOpenAuction(seller.user.id)

    await bid(app, leader.token, listing.id, 21_000_000)
    const res = await bid(app, challenger.token, listing.id, 25_000_000)
    expect(res.status).toBe(201)
    expect(res.body.youAreHighestBidder).toBe(true)
    expect(res.body.currentPriceMinor).toBe(21_500_000) // old leader's max (21M) + one increment (0.5M)
  })

  it('equal max bids: the earlier bidder (existing leader) keeps the lead', async () => {
    const seller = await registerSeller(app, 'bid-tie-seller')
    const leader = await registerBuyer(app, 'bid-tie-leader')
    const challenger = await registerBuyer(app, 'bid-tie-challenger')
    const { listing } = await createOpenAuction(seller.user.id)

    await bid(app, leader.token, listing.id, 23_000_000)
    const res = await bid(app, challenger.token, listing.id, 23_000_000)
    expect(res.status).toBe(201)
    expect(res.body.youAreHighestBidder).toBe(false)

    const auctionRow = await db().auction.findUnique({ where: { listingId: listing.id } })
    expect(auctionRow.currentBidderId).toBe(leader.user.id)
  })

  it('rejects a bid below the current visible price', async () => {
    const seller = await registerSeller(app, 'bid-toolow-seller')
    const buyer = await registerBuyer(app, 'bid-toolow-buyer')
    const { listing } = await createOpenAuction(seller.user.id)

    const res = await bid(app, buyer.token, listing.id, 1_000_000)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BID_TOO_LOW')
  })

  it('rejects the listing owner bidding on their own auction', async () => {
    const seller = await registerSeller(app, 'bid-selfbid-seller')
    const { listing } = await createOpenAuction(seller.user.id)

    const res = await bid(app, seller.token, listing.id, 21_000_000)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CANNOT_BID_OWN_LISTING')
  })

  it('rejects a bid on an ended auction', async () => {
    const seller = await registerSeller(app, 'bid-ended-seller')
    const buyer = await registerBuyer(app, 'bid-ended-buyer')
    const { listing } = await createOpenAuction(seller.user.id, { status: 'ENDED', endsAt: new Date(Date.now() - 1000) })

    const res = await bid(app, buyer.token, listing.id, 21_000_000)
    expect(res.status).toBe(409)
    expect(['AUCTION_NOT_OPEN', 'AUCTION_ALREADY_ENDED']).toContain(res.body.error.code)
  })

  it('rejects a bid on a listing with no auction at all', async () => {
    const seller = await registerSeller(app, 'bid-noauction-seller')
    const buyer = await registerBuyer(app, 'bid-noauction-buyer')
    const listing = await db().listing.create({
      data: {
        ownerId: seller.user.id,
        division: 'CARS',
        status: 'APPROVED',
        titleAr: 'سيارة بدون مزاد',
        priceMinor: 10_000_000,
        currency: 'USD',
        metadata: { vehicle: VEHICLE },
      },
    })

    const res = await bid(app, buyer.token, listing.id, 11_000_000)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('AUCTION_NOT_FOUND')
  })

  it('concurrent-bid race safety: exactly one bid becomes the leader under simultaneous requests', async () => {
    const seller = await registerSeller(app, 'bid-race-seller')
    const bidderA = await registerBuyer(app, 'bid-race-a')
    const bidderB = await registerBuyer(app, 'bid-race-b')
    const { listing } = await createOpenAuction(seller.user.id)

    const [resA, resB] = await Promise.all([
      bid(app, bidderA.token, listing.id, 30_000_000),
      bid(app, bidderB.token, listing.id, 30_000_000),
    ])

    expect(resA.status).toBe(201)
    expect(resB.status).toBe(201)

    const bids = await db().bid.findMany({ where: { auction: { listingId: listing.id } } })
    expect(bids.length).toBe(2)
    const winningBids = bids.filter((row) => row.isWinningBid)
    expect(winningBids.length).toBe(1)

    const auctionRow = await db().auction.findUnique({ where: { listingId: listing.id } })
    expect([bidderA.user.id, bidderB.user.id]).toContain(auctionRow.currentBidderId)
    expect(auctionRow.currentBidderId).toBe(winningBids[0].bidderId)
  })
})
