import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// CARS wizard fix: the seller wizard previously never uploaded real photo bytes (only filenames
// in memory) and never populated the structured vehicle fields carRules() requires, so no CARS
// listing could ever actually be submitted. These tests drive the real create -> upload photo(s)
// -> submit pipeline the fixed wizard now uses (createAndSubmitCarListing in platformApi.ts).

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

async function createCarDraft(app, token, vehicle = VALID_VEHICLE) {
  return request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${token}`)
    .send({
      division: 'CARS',
      titleAr: 'سيارة اختبار',
      priceMinor: 5_000_000,
      currency: 'SYP',
      metadata: { vehicle, mapLocation: { latitude: 33.5138, longitude: 36.2765, pinConfirmed: true } },
    })
}

describe('CARS listing wizard: real create -> photo upload -> submit pipeline', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('rejects creating a CARS draft without an approved seller plan', async () => {
    const seller = await registerSeller(app, 'car-wizard-noplan')
    const res = await createCarDraft(app, seller.token)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SELLER_PLAN_REQUIRED')
  })

  it('full pipeline succeeds: create draft, upload a real photo, submit lands PENDING_REVIEW', async () => {
    const seller = await registerSeller(app, 'car-wizard-happy')
    await approveSellerPlan(seller.user.id)

    const created = await createCarDraft(app, seller.token)
    expect(created.status).toBe(201)
    expect(created.body.listing.expiresAt).toBeNull()

    const listingId = created.body.listing.id
    const media = await request(app)
      .post(`/api/listings/${listingId}/media`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ fileBase64: PNG_1x1, mimeType: 'image/png' })
    expect(media.status).toBe(201)

    const submitted = await request(app).patch(`/api/listings/${listingId}/submit`).set('Authorization', `Bearer ${seller.token}`)
    expect(submitted.status).toBe(200)
    expect(submitted.body.listing.status).toBe('PENDING_REVIEW')
  })

  it('rejects submit with zero photos (LISTING_PHOTOS_REQUIRED)', async () => {
    const seller = await registerSeller(app, 'car-wizard-nophoto')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token)
    const listingId = created.body.listing.id

    const submitted = await request(app).patch(`/api/listings/${listingId}/submit`).set('Authorization', `Bearer ${seller.token}`)
    expect(submitted.status).toBe(400)
    expect(submitted.body.error.code).toBe('LISTING_PHOTOS_REQUIRED')
  })

  async function expectIncompleteFor(app, seller, vehicleOverride) {
    const created = await createCarDraft(app, seller.token, { ...VALID_VEHICLE, ...vehicleOverride })
    const listingId = created.body.listing.id
    await request(app)
      .post(`/api/listings/${listingId}/media`)
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ fileBase64: PNG_1x1, mimeType: 'image/png' })
    const submitted = await request(app).patch(`/api/listings/${listingId}/submit`).set('Authorization', `Bearer ${seller.token}`)
    expect(submitted.status).toBe(400)
    expect(submitted.body.error.code).toBe('LISTING_ATTRIBUTES_INCOMPLETE')
    return submitted.body.error.details?.missing || []
  }

  it('rejects submit when make is missing', async () => {
    const seller = await registerSeller(app, 'car-wizard-nomake')
    await approveSellerPlan(seller.user.id)
    const missing = await expectIncompleteFor(app, seller, { make: '' })
    expect(missing).toContain('make')
  })

  it('rejects submit when model is missing', async () => {
    const seller = await registerSeller(app, 'car-wizard-nomodel')
    await approveSellerPlan(seller.user.id)
    const missing = await expectIncompleteFor(app, seller, { model: '' })
    expect(missing).toContain('model')
  })

  it('rejects submit when year is out of range', async () => {
    const seller = await registerSeller(app, 'car-wizard-badyear')
    await approveSellerPlan(seller.user.id)
    const missing = await expectIncompleteFor(app, seller, { year: 1800 })
    expect(missing).toContain('year')
  })

  it('rejects submit when mileageKm is out of range', async () => {
    const seller = await registerSeller(app, 'car-wizard-badmileage')
    await approveSellerPlan(seller.user.id)
    const missing = await expectIncompleteFor(app, seller, { mileageKm: -5 })
    expect(missing).toContain('mileage (km)')
  })

  it('rejects submit when transmission is missing', async () => {
    const seller = await registerSeller(app, 'car-wizard-notrans')
    await approveSellerPlan(seller.user.id)
    const missing = await expectIncompleteFor(app, seller, { transmission: '' })
    expect(missing).toContain('transmission')
  })

  it('rejects submit when fuelType is missing', async () => {
    const seller = await registerSeller(app, 'car-wizard-nofuel')
    await approveSellerPlan(seller.user.id)
    const missing = await expectIncompleteFor(app, seller, { fuelType: '' })
    expect(missing).toContain('fuel type')
  })

  it('rejects submit when condition is not a valid enum value', async () => {
    const seller = await registerSeller(app, 'car-wizard-badcondition')
    await approveSellerPlan(seller.user.id)
    const missing = await expectIncompleteFor(app, seller, { condition: 'PRISTINE' })
    expect(missing).toContain('condition')
  })
})
