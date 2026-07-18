import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Dealer inventory tools (025/Carcad Phase C): edit/delete/renew on server/routes/host.mjs.
// Edit + delete apply to every division (a universal gap, not CARS-specific), verified here
// with CARS listings first per the stated priority. Renew is CARS-specific behavior: unlike
// RENTALS/BUY's free self-renew, a paid-plan division must re-confirm plan payment.

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

async function createCarListing(ownerId, overrides = {}) {
  return db().listing.create({
    data: {
      ownerId,
      division: 'CARS',
      status: 'DRAFT',
      titleAr: 'سيارة اختبار',
      priceMinor: 5_000_000,
      currency: 'SYP',
      metadata: { vehicle: VALID_VEHICLE },
      ...overrides,
    },
  })
}

describe('Dealer inventory tools: edit / delete / renew', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  describe('PATCH /api/host/listings/:id (edit)', () => {
    it('edits a DRAFT listing title and price', async () => {
      const seller = await registerSeller(app, 'car-edit-draft')
      const listing = await createCarListing(seller.user.id)

      const res = await request(app)
        .patch(`/api/host/listings/${listing.id}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ titleAr: 'سيارة معدلة', priceMinor: 6_000_000 })

      expect(res.status).toBe(200)
      expect(res.body.listing.titleAr).toBe('سيارة معدلة')
      expect(res.body.listing.priceMinor).toBe(6_000_000)
    })

    it('edits a REJECTED listing', async () => {
      const seller = await registerSeller(app, 'car-edit-rejected')
      const listing = await createCarListing(seller.user.id, { status: 'REJECTED' })

      const res = await request(app)
        .patch(`/api/host/listings/${listing.id}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ description: 'updated description' })

      expect(res.status).toBe(200)
      expect(res.body.listing.description).toBe('updated description')
    })

    it('edits an APPROVED (live) listing', async () => {
      const seller = await registerSeller(app, 'car-edit-approved')
      const listing = await createCarListing(seller.user.id, { status: 'APPROVED' })

      const res = await request(app)
        .patch(`/api/host/listings/${listing.id}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ priceMinor: 7_000_000 })

      expect(res.status).toBe(200)
      expect(res.body.listing.priceMinor).toBe(7_000_000)
    })

    it('rejects editing while PENDING_REVIEW (HOST_LISTING_EDIT_LOCKED)', async () => {
      const seller = await registerSeller(app, 'car-edit-locked')
      const listing = await createCarListing(seller.user.id, { status: 'PENDING_REVIEW' })

      const res = await request(app)
        .patch(`/api/host/listings/${listing.id}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ titleAr: 'x' })

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('HOST_LISTING_EDIT_LOCKED')
    })

    it('rejects unknown fields in the edit body', async () => {
      const seller = await registerSeller(app, 'car-edit-unknown')
      const listing = await createCarListing(seller.user.id)

      const res = await request(app)
        .patch(`/api/host/listings/${listing.id}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ status: 'APPROVED' })

      expect(res.status).toBe(400)
    })

    it('returns 404 for a listing owned by another host', async () => {
      const owner = await registerSeller(app, 'car-edit-owner')
      const intruder = await registerSeller(app, 'car-edit-intruder')
      const listing = await createCarListing(owner.user.id)

      const res = await request(app)
        .patch(`/api/host/listings/${listing.id}`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ titleAr: 'hijacked' })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('HOST_LISTING_NOT_FOUND')
    })
  })

  describe('DELETE /api/host/listings/:id', () => {
    it('deletes a DRAFT listing', async () => {
      const seller = await registerSeller(app, 'car-delete-draft')
      const listing = await createCarListing(seller.user.id)

      const res = await request(app).delete(`/api/host/listings/${listing.id}`).set('Authorization', `Bearer ${seller.token}`)
      expect(res.status).toBe(200)
      expect(res.body.deleted).toBe(true)

      const remaining = await db().listing.findUnique({ where: { id: listing.id } })
      expect(remaining).toBeNull()
    })

    it('deletes a PAUSED listing and cleans up its media rows', async () => {
      const seller = await registerSeller(app, 'car-delete-paused')
      const listing = await createCarListing(seller.user.id, { status: 'PAUSED' })
      const media = await db().listingMedia.create({
        data: { listingId: listing.id, kind: 'photo', url: `/api/listings/${listing.id}/media/file/does-not-exist-on-disk.png` },
      })

      const res = await request(app).delete(`/api/host/listings/${listing.id}`).set('Authorization', `Bearer ${seller.token}`)
      expect(res.status).toBe(200)

      const remainingMedia = await db().listingMedia.findUnique({ where: { id: media.id } })
      expect(remainingMedia).toBeNull()
    })

    it('rejects deleting an APPROVED (live) listing (HOST_LISTING_DELETE_FORBIDDEN)', async () => {
      const seller = await registerSeller(app, 'car-delete-approved')
      const listing = await createCarListing(seller.user.id, { status: 'APPROVED' })

      const res = await request(app).delete(`/api/host/listings/${listing.id}`).set('Authorization', `Bearer ${seller.token}`)
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('HOST_LISTING_DELETE_FORBIDDEN')

      const stillThere = await db().listing.findUnique({ where: { id: listing.id } })
      expect(stillThere).not.toBeNull()
    })

    it('rejects deleting while PENDING_REVIEW', async () => {
      const seller = await registerSeller(app, 'car-delete-pending')
      const listing = await createCarListing(seller.user.id, { status: 'PENDING_REVIEW' })

      const res = await request(app).delete(`/api/host/listings/${listing.id}`).set('Authorization', `Bearer ${seller.token}`)
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('HOST_LISTING_DELETE_FORBIDDEN')
    })
  })

  describe('PATCH /api/host/listings/:id/renew', () => {
    it('rejects renewing a CARS listing without planPaymentConfirmed', async () => {
      const seller = await registerSeller(app, 'car-renew-noconfirm')
      await approveSellerPlan(seller.user.id)
      const listing = await createCarListing(seller.user.id, { status: 'APPROVED' })

      const res = await request(app).patch(`/api/host/listings/${listing.id}/renew`).set('Authorization', `Bearer ${seller.token}`)
      expect(res.status).toBe(402)
      expect(res.body.error.code).toBe('PLAN_PAYMENT_CONFIRMATION_REQUIRED')
    })

    it('rejects renewing a CARS listing without an approved seller plan even with confirmation', async () => {
      const seller = await registerSeller(app, 'car-renew-noplan')
      const listing = await createCarListing(seller.user.id, { status: 'APPROVED' })

      const res = await request(app)
        .patch(`/api/host/listings/${listing.id}/renew`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ planPaymentConfirmed: true })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('SELLER_PLAN_REQUIRED')
    })

    it('renews a CARS listing and extends expiresAt once payment is reconfirmed', async () => {
      const seller = await registerSeller(app, 'car-renew-happy')
      await approveSellerPlan(seller.user.id, 'plus')
      const originalExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)
      const listing = await createCarListing(seller.user.id, { status: 'APPROVED', expiresAt: originalExpiry })

      const res = await request(app)
        .patch(`/api/host/listings/${listing.id}/renew`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ planPaymentConfirmed: true })

      expect(res.status).toBe(200)
      const newExpiry = new Date(res.body.listing.expiresAt)
      expect(newExpiry.getTime()).toBeGreaterThan(originalExpiry.getTime())
      // plus plan = 30 days; allow generous slack for test execution time
      const expectedMs = Date.now() + 30 * 24 * 60 * 60 * 1000
      expect(Math.abs(newExpiry.getTime() - expectedMs)).toBeLessThan(60_000)
    })

    it('rejects renewing a listing that is not APPROVED (HOST_LISTING_NOT_LIVE)', async () => {
      const seller = await registerSeller(app, 'car-renew-notlive')
      await approveSellerPlan(seller.user.id)
      const listing = await createCarListing(seller.user.id, { status: 'PAUSED' })

      const res = await request(app)
        .patch(`/api/host/listings/${listing.id}/renew`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ planPaymentConfirmed: true })
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('HOST_LISTING_NOT_LIVE')
    })
  })
})
