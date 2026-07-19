import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Backs the Premium "تمييز أعلى داخل البحث" (higher search highlight) plan copy with real
// ranking (server/routes/listings.mjs applySearchBoost) instead of leaving it as marketing text
// with no functional difference from Basic/Plus.
describe('GET /api/listings ranks a Premium-plan listing ahead of an older Basic listing', () => {
  let app
  let owner

  beforeAll(async () => {
    app = testApp()
    owner = await db().user.create({
      data: {
        email: uniqueTestEmail('listing-search-boost-owner'),
        passwordHash: 'unused',
        displayName: 'Search Boost Owner',
        referralCode: uniqueTestReferralCode(),
      },
    })
    trackTestUser(owner.id)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('promotes a Premium listing above an older Basic listing under the default sort', async () => {
    const basicListing = await db().listing.create({
      data: {
        ownerId: owner.id,
        division: 'RENTALS',
        titleAr: 'Search boost test — basic',
        priceMinor: 500,
        currency: 'USD',
        status: 'APPROVED',
        metadata: { listingPlan: 'basic' },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const premiumListing = await db().listing.create({
      data: {
        ownerId: owner.id,
        division: 'RENTALS',
        titleAr: 'Search boost test — premium',
        priceMinor: 500,
        currency: 'USD',
        status: 'APPROVED',
        metadata: { listingPlan: 'premium' },
      },
    })

    const res = await request(app).get('/api/listings?division=RENTALS')

    expect(res.status).toBe(200)
    const ids = res.body.listings.map((listing) => listing.id)
    expect(ids.indexOf(premiumListing.id)).toBeLessThan(ids.indexOf(basicListing.id))
  })

  it('does not apply the boost when the guest explicitly asked for a price sort', async () => {
    const cheapBasicListing = await db().listing.create({
      data: {
        ownerId: owner.id,
        division: 'RENTALS',
        titleAr: 'Search boost test — cheap basic',
        priceMinor: 10,
        currency: 'USD',
        status: 'APPROVED',
        metadata: { listingPlan: 'basic' },
      },
    })
    const pricierPremiumListing = await db().listing.create({
      data: {
        ownerId: owner.id,
        division: 'RENTALS',
        titleAr: 'Search boost test — pricier premium',
        priceMinor: 9999,
        currency: 'USD',
        status: 'APPROVED',
        metadata: { listingPlan: 'premium' },
      },
    })

    const res = await request(app).get('/api/listings?division=RENTALS&sort=priceAsc')

    expect(res.status).toBe(200)
    const ids = res.body.listings.map((listing) => listing.id)
    expect(ids.indexOf(cheapBasicListing.id)).toBeLessThan(ids.indexOf(pricierPremiumListing.id))
  })
})
