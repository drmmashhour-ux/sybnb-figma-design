import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Online auctions (026), config creation: POST /api/listings/:listingId/auction. A dealer's
// per-listing choice -- fixed price OR auction -- configured before /submit.

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const VALID_VEHICLE = {
  make: 'Toyota',
  model: 'Corolla',
  year: 2019,
  mileageKm: 85000,
  transmission: 'automatic',
  fuelType: 'gas',
  condition: 'USED',
}

async function registerSeller(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role: 'SELLER', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function approveSellerPlan(userId, planCode = 'plus') {
  await db().sellerProfile.upsert({
    where: { userId },
    create: { userId, legalName: 'Test Dealer', sellerType: 'INDIVIDUAL', documentStatus: 'APPROVED', planCode },
    update: { documentStatus: 'APPROVED', planCode },
  })
}

async function createCarDraft(app, token, metadataOverride = {}) {
  return request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${token}`)
    .send({
      division: 'CARS',
      titleAr: 'سيارة اختبار',
      priceMinor: 20_000_000,
      currency: 'USD',
      metadata: { vehicle: VALID_VEHICLE, mapLocation: { latitude: 33.5138, longitude: 36.2765, pinConfirmed: true }, ...metadataOverride },
    })
}

describe('Auction config: POST /api/listings/:listingId/auction', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('creates auction config on a draft listing, starting price matches the listing price', async () => {
    const seller = await registerSeller(app, 'auction-config-happy')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token)

    const res = await request(app)
      .post(`/api/listings/${created.body.listing.id}/auction`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ minIncrementMinor: 500_000, durationHours: 72 })

    expect(res.status).toBe(201)
    expect(res.body.auction.startingPriceMinor).toBe(20_000_000)
    expect(res.body.auction.currentPriceMinor).toBe(20_000_000)
    expect(res.body.auction.status).toBe('OPEN')
  })

  it('rejects configuring an auction twice on the same listing', async () => {
    const seller = await registerSeller(app, 'auction-config-twice')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token)
    await request(app)
      .post(`/api/listings/${created.body.listing.id}/auction`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ minIncrementMinor: 500_000, durationHours: 72 })

    const res = await request(app)
      .post(`/api/listings/${created.body.listing.id}/auction`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ minIncrementMinor: 500_000, durationHours: 72 })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('AUCTION_ALREADY_CONFIGURED')
  })

  it("rejects configuring an auction on someone else's listing", async () => {
    const owner = await registerSeller(app, 'auction-config-owner')
    const intruder = await registerSeller(app, 'auction-config-intruder')
    await approveSellerPlan(owner.user.id)
    const created = await createCarDraft(app, owner.token)

    const res = await request(app)
      .post(`/api/listings/${created.body.listing.id}/auction`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .send({ minIncrementMinor: 500_000, durationHours: 72 })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('LISTING_NOT_FOUND')
  })

  it('rejects configuring an auction on a non-CARS listing', async () => {
    const seller = await registerSeller(app, 'auction-config-noncars')
    const created = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ division: 'STAYS', titleAr: 'شقة', priceMinor: 15, currency: 'USD', metadata: {} })

    const res = await request(app)
      .post(`/api/listings/${created.body.listing.id}/auction`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ minIncrementMinor: 500_000, durationHours: 72 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('AUCTION_DIVISION_UNSUPPORTED')
  })

  it('rejects an invalid minIncrementMinor', async () => {
    const seller = await registerSeller(app, 'auction-config-badincrement')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token)

    const res = await request(app)
      .post(`/api/listings/${created.body.listing.id}/auction`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ minIncrementMinor: -5, durationHours: 72 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('AUCTION_INCREMENT_INVALID')
  })

  it('rejects an out-of-range durationHours', async () => {
    const seller = await registerSeller(app, 'auction-config-badduration')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token)

    const res = await request(app)
      .post(`/api/listings/${created.body.listing.id}/auction`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ minIncrementMinor: 500_000, durationHours: 1000 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('AUCTION_DURATION_INVALID')
  })

  it('fails submit with AUCTION_CONFIG_REQUIRED when saleType is AUCTION but no auction row exists', async () => {
    const seller = await registerSeller(app, 'auction-config-submitmissing')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token, { saleType: 'AUCTION' })
    await request(app)
      .post(`/api/listings/${created.body.listing.id}/media`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ fileBase64: PNG_1x1, mimeType: 'image/png' })

    const res = await request(app).patch(`/api/listings/${created.body.listing.id}/submit`).set('Authorization', `Bearer ${seller.token}`)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('AUCTION_CONFIG_REQUIRED')
  })

  it('succeeds submit once the auction is configured', async () => {
    const seller = await registerSeller(app, 'auction-config-submitok')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token, { saleType: 'AUCTION' })
    await request(app)
      .post(`/api/listings/${created.body.listing.id}/media`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ fileBase64: PNG_1x1, mimeType: 'image/png' })
    await request(app)
      .post(`/api/listings/${created.body.listing.id}/auction`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ minIncrementMinor: 500_000, durationHours: 72 })

    const res = await request(app).patch(`/api/listings/${created.body.listing.id}/submit`).set('Authorization', `Bearer ${seller.token}`)
    expect(res.status).toBe(200)
    expect(res.body.listing.status).toBe('PENDING_REVIEW')
  })

  it('GET /api/listings/:listingId/auction works for a fully anonymous request (regression)', async () => {
    // Caught live: getAuthContext() returns `null` itself (not `{ user: null }`) for an
    // unauthenticated request, so `context.user?.id` alone still threw
    // "Cannot read properties of null (reading 'user')" -- must guard on `context` itself too.
    const seller = await registerSeller(app, 'auction-config-anon')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token)
    await request(app)
      .post(`/api/listings/${created.body.listing.id}/auction`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ minIncrementMinor: 500_000, durationHours: 72 })
    await db().listing.update({ where: { id: created.body.listing.id }, data: { status: 'APPROVED' } })

    const res = await request(app).get(`/api/listings/${created.body.listing.id}/auction`)
    expect(res.status).toBe(200)
    expect(res.body.auction.status).toBe('OPEN')
    expect(res.body.auction.youAreHighestBidder).toBeUndefined()
    expect(res.body.auction.reservePriceMinor).toBeUndefined()
  })
})
