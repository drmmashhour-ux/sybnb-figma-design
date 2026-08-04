import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function registerSeller(app, label) {
  const email = uniqueTestEmail(label)
  const legacyVerificationGrant1 = await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'SELLER', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { token: res.body.token, user: res.body.user }
}
async function approveSellerPlan(userId, planCode = 'plus') {
  await db().sellerProfile.upsert({
    where: { userId },
    create: { userId, legalName: 'Test Seller', sellerType: 'INDIVIDUAL', documentStatus: 'APPROVED', planCode },
    update: { documentStatus: 'APPROVED', planCode },
  })
}
async function createListing(app, token, { division, metadata = {}, priceMinor = 100 }) {
  return request(app).post('/api/listings').set('Authorization', `Bearer ${token}`)
    .send({ division, titleAr: `سلعة ${division}`, priceMinor, currency: 'SYP', metadata })
}
async function uploadPhoto(app, token, listingId) {
  return request(app).post(`/api/listings/${listingId}/media`).set('Authorization', `Bearer ${token}`).send({ fileBase64: PNG_1x1, mimeType: 'image/png' })
}
async function submit(app, token, listingId) {
  return request(app).patch(`/api/listings/${listingId}/submit`).set('Authorization', `Bearer ${token}`)
}

const GOODS_META = { category: 'ELECTRONICS', condition: 'USED', city: 'Damascus' }

describe('Marketplace Phase 1: free goods listing + paid gate on CARS/NEW_CONSTRUCTION', () => {
  let app
  beforeAll(() => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('(a) a no-plan seller can CREATE and SUBMIT a MARKETPLACE listing for free', async () => {
    const seller = await registerSeller(app, 'mkt-free')
    // No sellerProfile / no approved plan at all.
    const created = await createListing(app, seller.token, { division: 'MARKETPLACE', metadata: GOODS_META })
    expect(created.status).toBe(201)
    expect(created.body.listing.division).toBe('MARKETPLACE')

    await uploadPhoto(app, seller.token, created.body.listing.id)
    const submitted = await submit(app, seller.token, created.body.listing.id)
    expect(submitted.status).toBe(200)
    expect(submitted.body.listing.status).toBe('PENDING_REVIEW')
  })

  it('(b) a no-plan seller CANNOT create a CARS listing — paid plan still required', async () => {
    const seller = await registerSeller(app, 'mkt-cars')
    const res = await createListing(app, seller.token, { division: 'CARS', metadata: {} })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SELLER_PLAN_REQUIRED')
  })

  it('(b) a no-plan seller CANNOT create a NEW_CONSTRUCTION listing — paid plan still required', async () => {
    const seller = await registerSeller(app, 'mkt-nc')
    const res = await createListing(app, seller.token, { division: 'NEW_CONSTRUCTION', metadata: {} })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SELLER_PLAN_REQUIRED')
  })

  it('a seller WITH an approved plan can still create CARS (paid gate unbroken)', async () => {
    const seller = await registerSeller(app, 'mkt-cars-ok')
    await approveSellerPlan(seller.user.id)
    const res = await createListing(app, seller.token, { division: 'CARS', metadata: {} })
    expect(res.status).toBe(201)
  })

  it('rejects a MARKETPLACE submit with an invalid category', async () => {
    const seller = await registerSeller(app, 'mkt-badcat')
    const created = await createListing(app, seller.token, { division: 'MARKETPLACE', metadata: { category: 'NOT_A_REAL_CATEGORY', condition: 'USED' } })
    expect(created.status).toBe(201)
    await uploadPhoto(app, seller.token, created.body.listing.id)
    const submitted = await submit(app, seller.token, created.body.listing.id)
    expect(submitted.status).toBe(400) // assertListingAttributes rejects the unknown category
  })

  it('browse filters marketplace goods by category, condition, and city', async () => {
    const seller = await registerSeller(app, 'mkt-browse')
    // Two approved goods with different category/condition/city.
    const a = await db().listing.create({ data: { ownerId: seller.user.id, division: 'MARKETPLACE', titleAr: 'هاتف', priceMinor: 500, currency: 'SYP', status: 'APPROVED', metadata: { category: 'ELECTRONICS', condition: 'USED', city: 'Damascus' } } })
    const b = await db().listing.create({ data: { ownerId: seller.user.id, division: 'MARKETPLACE', titleAr: 'كرسي', priceMinor: 300, currency: 'SYP', status: 'APPROVED', metadata: { category: 'HOME_FURNITURE', condition: 'NEW', city: 'Aleppo' } } })

    const byCat = await request(app).get('/api/listings?division=MARKETPLACE&category=ELECTRONICS')
    const catIds = byCat.body.listings.map((l) => l.id)
    expect(catIds).toContain(a.id)
    expect(catIds).not.toContain(b.id)

    const byCond = await request(app).get('/api/listings?division=MARKETPLACE&condition=NEW&city=Aleppo')
    const condIds = byCond.body.listings.map((l) => l.id)
    expect(condIds).toContain(b.id)
    expect(condIds).not.toContain(a.id)
  })
})
