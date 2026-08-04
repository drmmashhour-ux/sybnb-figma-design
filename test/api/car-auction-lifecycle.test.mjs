import { afterAll, describe, expect, it } from 'vitest'
import { expireOpenAuctions } from '../../server/lib/auction-lifecycle.mjs'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'
import request from 'supertest'

// Online auctions (026), lifecycle: reserve-met transitions and the opportunistic end-sweep
// (expireOpenAuctions) that flips OPEN -> ENDED once endsAt has passed, computing the winner only
// when reserve was actually met.

const VEHICLE = { make: 'Toyota', model: 'Camry', year: 2020, mileageKm: 30000, transmission: 'automatic', fuelType: 'gas', condition: 'USED' }

async function registerSeller(app, label) {
  const email = uniqueTestEmail(label)
  const legacyVerificationGrant1 = await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'SELLER', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function registerBuyer(app, label) {
  const email = uniqueTestEmail(label)
  const legacyVerificationGrant2 = await verifyEmailForTest(app, email, 'guest-signup')
  const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant2, role: 'GUEST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function createAuction(ownerId, overrides = {}) {
  const listing = await db().listing.create({
    data: {
      ownerId,
      division: 'CARS',
      status: 'APPROVED',
      titleAr: 'سيارة اختبار',
      priceMinor: 20_000_000,
      currency: 'USD',
      metadata: { vehicle: VEHICLE, saleType: 'AUCTION' },
    },
  })
  const auction = await db().auction.create({
    data: {
      listingId: listing.id,
      startingPriceMinor: 20_000_000,
      currentPriceMinor: 20_000_000,
      minIncrementMinor: 500_000,
      reservePriceMinor: 22_000_000,
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    },
  })
  return { listing, auction }
}

describe('Auction lifecycle: reserve-met + expireOpenAuctions sweep', () => {
  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('reserve-met flips true once real competing bids push the visible price across the reserve', async () => {
    const app = testApp()
    const seller = await registerSeller(app, 'lifecycle-reserve-seller')
    const bidderA = await registerBuyer(app, 'lifecycle-reserve-a')
    const bidderB = await registerBuyer(app, 'lifecycle-reserve-b')
    const { listing } = await createAuction(seller.user.id)

    // First bid ever: visible price is only ever min(max, startingPrice) with no opponent, so a
    // single bidder alone can never push the price above the (below-reserve) starting price --
    // reserve can only be crossed by genuine competition between two different bidders.
    const first = await request(app)
      .post(`/api/listings/${listing.id}/auction/bids`)
      .set('Authorization', `Bearer ${bidderA.token}`)
      .send({ maxProxyMinor: 25_000_000 })
    expect(first.body.reserveMet).toBe(false)

    // bidderB's max (23M) is below bidderA's hidden max (25M), so bidderA stays leader, but the
    // visible price rises to just beat bidderB (23M + 0.5M increment = 23.5M), crossing the 22M reserve.
    const second = await request(app)
      .post(`/api/listings/${listing.id}/auction/bids`)
      .set('Authorization', `Bearer ${bidderB.token}`)
      .send({ maxProxyMinor: 23_000_000 })
    expect(second.body.reserveMet).toBe(true)
    expect(second.body.youAreHighestBidder).toBe(false)
  })

  it('expireOpenAuctions only ends auctions whose endsAt has actually passed', async () => {
    const app = testApp()
    const seller = await registerSeller(app, 'lifecycle-notyet-seller')
    const { listing } = await createAuction(seller.user.id, { endsAt: new Date(Date.now() + 60 * 60 * 1000) })

    await expireOpenAuctions({ listing: { id: listing.id } })

    const row = await db().auction.findUnique({ where: { listingId: listing.id } })
    expect(row.status).toBe('OPEN')
  })

  it('expireOpenAuctions transitions OPEN -> ENDED and sets winnerBidderId only when reserveMet', async () => {
    const app = testApp()
    const seller = await registerSeller(app, 'lifecycle-ended-seller')
    const bidderA = await registerBuyer(app, 'lifecycle-ended-a')
    const bidderB = await registerBuyer(app, 'lifecycle-ended-b')
    const { listing } = await createAuction(seller.user.id, { endsAt: new Date(Date.now() + 60 * 60 * 1000) })

    // Two competing bids that push the visible price across the reserve (see the reserve-met test
    // above for why this needs two different bidders), then force endsAt into the past.
    await request(app)
      .post(`/api/listings/${listing.id}/auction/bids`)
      .set('Authorization', `Bearer ${bidderA.token}`)
      .send({ maxProxyMinor: 25_000_000 })
    await request(app)
      .post(`/api/listings/${listing.id}/auction/bids`)
      .set('Authorization', `Bearer ${bidderB.token}`)
      .send({ maxProxyMinor: 23_000_000 })
    await db().auction.update({ where: { listingId: listing.id }, data: { endsAt: new Date(Date.now() - 1000) } })

    await expireOpenAuctions({ listing: { id: listing.id } })

    const row = await db().auction.findUnique({ where: { listingId: listing.id } })
    expect(row.status).toBe('ENDED')
    expect(row.endedAt).not.toBeNull()
    expect(row.winnerBidderId).toBe(bidderA.user.id)
  })

  it('sets winnerBidderId to null when the auction ends without reserve being met', async () => {
    const app = testApp()
    const seller = await registerSeller(app, 'lifecycle-noreserve-seller')
    const buyer = await registerBuyer(app, 'lifecycle-noreserve-buyer')
    const { listing } = await createAuction(seller.user.id, { endsAt: new Date(Date.now() + 60 * 60 * 1000) })

    // Bid below reserve, then let the auction end.
    await request(app)
      .post(`/api/listings/${listing.id}/auction/bids`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ maxProxyMinor: 21_000_000 })
    await db().auction.update({ where: { listingId: listing.id }, data: { endsAt: new Date(Date.now() - 1000) } })

    await expireOpenAuctions({ listing: { id: listing.id } })

    const row = await db().auction.findUnique({ where: { listingId: listing.id } })
    expect(row.status).toBe('ENDED')
    expect(row.winnerBidderId).toBeNull()
  })

  it('running the sweep twice is idempotent (second run finds nothing left to end)', async () => {
    const app = testApp()
    const seller = await registerSeller(app, 'lifecycle-idempotent-seller')
    const { listing } = await createAuction(seller.user.id, { endsAt: new Date(Date.now() - 1000) })

    const firstCount = await expireOpenAuctions({ listing: { id: listing.id } })
    const secondCount = await expireOpenAuctions({ listing: { id: listing.id } })

    expect(firstCount).toBe(1)
    expect(secondCount).toBe(0)
  })
})
