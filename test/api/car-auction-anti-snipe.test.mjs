import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Online auctions (026), anti-snipe: a bid placed inside the trailing window extends endsAt;
// outside the window it doesn't. Auction.endsAt/antiSnipeWindowSeconds are seeded directly via
// db() so timing is deterministic and the test never sleeps.

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

async function createOpenAuction(ownerId, endsAt, windowSeconds = 120, extensionSeconds = 120) {
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
  await db().auction.create({
    data: {
      listingId: listing.id,
      startingPriceMinor: 20_000_000,
      currentPriceMinor: 20_000_000,
      minIncrementMinor: 500_000,
      endsAt,
      antiSnipeWindowSeconds: windowSeconds,
      antiSnipeExtensionSeconds: extensionSeconds,
    },
  })
  return listing
}

describe('Auction anti-snipe: endsAt extension window', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a bid placed well before the window leaves endsAt unchanged', async () => {
    const seller = await registerSeller(app, 'snipe-early-seller')
    const buyer = await registerBuyer(app, 'snipe-early-buyer')
    const originalEndsAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour out, window is 120s
    const listing = await createOpenAuction(seller.user.id, originalEndsAt)

    const res = await request(app)
      .post(`/api/listings/${listing.id}/auction/bids`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ maxProxyMinor: 21_000_000 })
    expect(res.status).toBe(201)
    expect(new Date(res.body.endsAt).getTime()).toBe(originalEndsAt.getTime())
  })

  it('a bid placed inside the window extends endsAt by the configured extension', async () => {
    const seller = await registerSeller(app, 'snipe-inside-seller')
    const buyer = await registerBuyer(app, 'snipe-inside-buyer')
    const originalEndsAt = new Date(Date.now() + 30 * 1000) // 30s out, window is 120s -- inside it
    const listing = await createOpenAuction(seller.user.id, originalEndsAt, 120, 120)

    const beforeBid = Date.now()
    const res = await request(app)
      .post(`/api/listings/${listing.id}/auction/bids`)
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({ maxProxyMinor: 21_000_000 })
    expect(res.status).toBe(201)

    const newEndsAt = new Date(res.body.endsAt).getTime()
    expect(newEndsAt).toBeGreaterThan(originalEndsAt.getTime())
    expect(newEndsAt).toBeGreaterThanOrEqual(beforeBid + 120 * 1000)
  })

  it('endsAt only ever moves forward, never backward, across repeated extensions', async () => {
    const seller = await registerSeller(app, 'snipe-forward-seller')
    const buyerA = await registerBuyer(app, 'snipe-forward-a')
    const buyerB = await registerBuyer(app, 'snipe-forward-b')
    const originalEndsAt = new Date(Date.now() + 10 * 1000) // deep inside the window
    const listing = await createOpenAuction(seller.user.id, originalEndsAt, 120, 120)

    const firstRes = await request(app)
      .post(`/api/listings/${listing.id}/auction/bids`)
      .set('Authorization', `Bearer ${buyerA.token}`)
      .send({ maxProxyMinor: 21_000_000 })
    const firstEndsAt = new Date(firstRes.body.endsAt).getTime()

    const secondRes = await request(app)
      .post(`/api/listings/${listing.id}/auction/bids`)
      .set('Authorization', `Bearer ${buyerB.token}`)
      .send({ maxProxyMinor: 22_000_000 })
    const secondEndsAt = new Date(secondRes.body.endsAt).getTime()

    expect(secondEndsAt).toBeGreaterThanOrEqual(firstEndsAt)
  })
})
