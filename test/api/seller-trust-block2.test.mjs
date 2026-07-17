import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { PLAN_DURATION_DAYS } from '../../server/lib/listing-lifecycle.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const COMPLETE_CAR = {
  vehicle: { make: 'Kia', model: 'Rio', year: 2019, mileageKm: 82000, transmission: 'AUTO', fuelType: 'PETROL', condition: 'USED' },
}

async function bootstrapAdmin() {
  const admin = await db().user.create({
    data: {
      email: uniqueTestEmail('b2-admin'),
      displayName: 'Block2 Admin',
      referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'ADMIN' } },
    },
    include: { roles: true },
  })
  trackTestUser(admin.id)
  return createSessionToken(admin)
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
    create: { userId, legalName: 'Test Seller', sellerType: 'INDIVIDUAL', documentStatus: 'APPROVED', planCode },
    update: { documentStatus: 'APPROVED', planCode },
  })
}

describe('Seller trust Block 2: seller OTP + paid-plan expiry from approval', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  describe('seller sign-up passes the same email-OTP gate as host/driver', () => {
    it('rejects a seller registration with no verified email code', async () => {
      const email = uniqueTestEmail('otp-noverify')
      const res = await request(app).post('/api/auth/register').send({ role: 'SELLER', email, password: 'correct-horse-battery' })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED')
    })

    it('accepts a seller registration once the email code is verified', async () => {
      const email = uniqueTestEmail('otp-verify')
      await verifyEmailForTest(app, email, 'staff-login')
      const res = await request(app).post('/api/auth/register').send({ role: 'SELLER', email, password: 'correct-horse-battery' })
      expect(res.status).toBe(201)
      expect(res.body.token).toBeTruthy()
      trackTestUser(res.body.user.id)
    })
  })

  describe('paid-plan expiry clock starts at admin approval, not at draft-create', () => {
    it('a car listing carries no expiry until approved, then gets the full plan window from approval time', async () => {
      const seller = await registerSeller(app, 'expiry-seller')
      await approveSellerPlan(seller.user.id, 'plus') // 30-day window
      const adminToken = await bootstrapAdmin()

      const created = await request(app)
        .post('/api/listings')
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ division: 'CARS', titleAr: 'سيارة اختبار', priceMinor: 5_000_000, currency: 'SYP', metadata: COMPLETE_CAR })
      expect(created.status).toBe(201)
      const listing = created.body.listing
      // No paid clock at create — the seller hasn't gone live yet.
      expect(listing.expiresAt).toBeNull()

      // A real photo is required before submit (Block 1).
      await request(app)
        .post(`/api/listings/${listing.id}/media`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ fileBase64: PNG_1x1, mimeType: 'image/png' })

      const submitted = await request(app).patch(`/api/listings/${listing.id}/submit`).set('Authorization', `Bearer ${seller.token}`)
      expect(submitted.status).toBe(200)
      expect(submitted.body.listing.status).toBe('PENDING_REVIEW')
      // Still no expiry while it waits in the review queue.
      const pending = await db().listing.findUnique({ where: { id: listing.id } })
      expect(pending.expiresAt).toBeNull()

      // Admin approval starts the clock.
      const approve = await request(app)
        .patch(`/api/admin/review-queue/listing/${listing.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ decision: 'APPROVED' })
      expect(approve.status).toBe(200)

      const approved = await db().listing.findUnique({ where: { id: listing.id } })
      expect(approved.status).toBe('APPROVED')
      expect(approved.expiresAt).not.toBeNull()
      const daysOut = (new Date(approved.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      expect(daysOut).toBeGreaterThan(PLAN_DURATION_DAYS.plus - 1)
      expect(daysOut).toBeLessThan(PLAN_DURATION_DAYS.plus + 1)
    })
  })
})
