import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  verifyEmailForTest,
} from '../support/testServer.mjs'

async function registerSeller(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role: 'SELLER', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function registerHost(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function registerBuyer(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email)
  const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function makeListing(ownerId, division = 'CARS') {
  return db().listing.create({
    data: { ownerId, division, titleAr: `عرض ${division}`, priceMinor: 5_000_000, currency: 'SYP', status: 'APPROVED' },
  })
}

async function confirmSale(app, sellerToken, listingId, buyerId) {
  return request(app).post('/api/sellers/confirm-sale').set('Authorization', `Bearer ${sellerToken}`).send({ listingId, buyerId })
}

describe('Seller trust Block 3: confirmed-sale reviews + verification badge', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  describe('seller confirms a sale (the review grant)', () => {
    it('the listing owner confirms a sale to a buyer', async () => {
      const seller = await registerSeller(app, 'cs-seller')
      const buyer = await registerBuyer(app, 'cs-buyer')
      const listing = await makeListing(seller.user.id, 'CARS')
      const res = await confirmSale(app, seller.token, listing.id, buyer.user.id)
      expect(res.status).toBe(201)
      expect(res.body.sale.buyerId).toBe(buyer.user.id)
      expect(res.body.sale.sellerId).toBe(seller.user.id)
    })

    it('is idempotent — confirming the same buyer twice returns the same sale', async () => {
      const seller = await registerSeller(app, 'cs-idem-seller')
      const buyer = await registerBuyer(app, 'cs-idem-buyer')
      const listing = await makeListing(seller.user.id)
      const first = await confirmSale(app, seller.token, listing.id, buyer.user.id)
      const second = await confirmSale(app, seller.token, listing.id, buyer.user.id)
      expect(first.status).toBe(201)
      expect(second.status).toBe(201)
      expect(second.body.sale.id).toBe(first.body.sale.id)
    })

    it('a non-owner cannot confirm a sale on someone else’s listing', async () => {
      const seller = await registerSeller(app, 'cs-owner')
      const stranger = await registerSeller(app, 'cs-stranger')
      const buyer = await registerBuyer(app, 'cs-buyer2')
      const listing = await makeListing(seller.user.id)
      const res = await confirmSale(app, stranger.token, listing.id, buyer.user.id)
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('LISTING_NOT_FOUND')
    })

    it('a seller cannot confirm a sale to themselves', async () => {
      const seller = await registerSeller(app, 'cs-self')
      const listing = await makeListing(seller.user.id)
      const res = await confirmSale(app, seller.token, listing.id, seller.user.id)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('SALE_SELF_FORBIDDEN')
    })

    it('STAYS listings do not support seller sale confirmations (they use stay reviews)', async () => {
      const host = await registerHost(app, 'cs-host')
      const buyer = await registerBuyer(app, 'cs-buyer3')
      const stay = await makeListing(host.user.id, 'STAYS')
      const res = await confirmSale(app, host.token, stay.id, buyer.user.id)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('SALE_DIVISION_UNSUPPORTED')
    })
  })

  describe('only a confirmed buyer can review, once', () => {
    it('a buyer with no confirmed sale is refused', async () => {
      const seller = await registerSeller(app, 'rv-seller')
      const buyer = await registerBuyer(app, 'rv-nobuyer')
      const res = await request(app)
        .post(`/api/sellers/${seller.user.id}/reviews`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ rating: 5 })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('REVIEW_NOT_ELIGIBLE')
    })

    it('a confirmed buyer can review once; a second review is refused', async () => {
      const seller = await registerSeller(app, 'rv-seller2')
      const buyer = await registerBuyer(app, 'rv-buyer2')
      const listing = await makeListing(seller.user.id)
      await confirmSale(app, seller.token, listing.id, buyer.user.id)

      const first = await request(app)
        .post(`/api/sellers/${seller.user.id}/reviews`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ rating: 5, comment: 'smooth deal' })
      expect(first.status).toBe(201)
      expect(first.body.review.rating).toBe(5)

      const second = await request(app)
        .post(`/api/sellers/${seller.user.id}/reviews`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ rating: 3 })
      expect(second.status).toBe(409)
      expect(second.body.error.code).toBe('REVIEW_ALREADY_EXISTS')
    })

    it('rejects an out-of-range rating', async () => {
      const seller = await registerSeller(app, 'rv-seller3')
      const buyer = await registerBuyer(app, 'rv-buyer3')
      const listing = await makeListing(seller.user.id)
      await confirmSale(app, seller.token, listing.id, buyer.user.id)
      const res = await request(app)
        .post(`/api/sellers/${seller.user.id}/reviews`)
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({ rating: 9 })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('REVIEW_RATING_INVALID')
    })
  })

  describe('seller profile: reputation + verification badge', () => {
    it('aggregates rating and reflects the verification badge', async () => {
      const seller = await registerSeller(app, 'rep-seller')
      const buyerA = await registerBuyer(app, 'rep-buyerA')
      const buyerB = await registerBuyer(app, 'rep-buyerB')
      const listing = await makeListing(seller.user.id)

      // Before any review + before ID approval.
      const before = await request(app).get(`/api/sellers/${seller.user.id}`)
      expect(before.status).toBe(200)
      expect(before.body.rating).toEqual({ average: null, count: 0 })
      expect(before.body.seller.verified).toBe(false)

      // Two confirmed buyers leave 5 and 3 -> average 4.0, count 2.
      await confirmSale(app, seller.token, listing.id, buyerA.user.id)
      await confirmSale(app, seller.token, listing.id, buyerB.user.id)
      await request(app).post(`/api/sellers/${seller.user.id}/reviews`).set('Authorization', `Bearer ${buyerA.token}`).send({ rating: 5 })
      await request(app).post(`/api/sellers/${seller.user.id}/reviews`).set('Authorization', `Bearer ${buyerB.token}`).send({ rating: 3 })

      // Admin approves the seller's identity document -> verified badge flips on.
      await db().user.update({ where: { id: seller.user.id }, data: { idDocumentStatus: 'APPROVED' } })

      const after = await request(app).get(`/api/sellers/${seller.user.id}`)
      expect(after.status).toBe(200)
      expect(after.body.rating).toEqual({ average: 4, count: 2 })
      expect(after.body.seller.verified).toBe(true)
    })

    it('the public listing detail carries a sellerVerified badge', async () => {
      const seller = await registerSeller(app, 'badge-seller')
      await db().user.update({ where: { id: seller.user.id }, data: { idDocumentStatus: 'APPROVED' } })
      const listing = await makeListing(seller.user.id)

      const res = await request(app).get(`/api/listings/${listing.id}`)
      expect(res.status).toBe(200)
      expect(res.body.sellerVerified).toBe(true)
    })
  })
})
