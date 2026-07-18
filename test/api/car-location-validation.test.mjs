import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Real CARS location capture (025/Carcad Phase D): the wizard's map pin used to be decorative --
// "confirm" set pinConfirmed=true unconditionally over whatever lat/lng was in the inputs (often
// still the default Damascus point), with zero server-side validation. This adds a mapLocation
// rule to carRules() requiring a real, in-bounds, explicitly confirmed coordinate before a CARS
// listing can be submitted.

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
      priceMinor: 5_000_000,
      currency: 'SYP',
      metadata: { vehicle: VALID_VEHICLE, ...metadataOverride },
    })
}

async function submitWithPhoto(app, token, listingId) {
  await request(app)
    .post(`/api/listings/${listingId}/media`)
    .set('Authorization', `Bearer ${token}`)
    .send({ fileBase64: PNG_1x1, mimeType: 'image/png' })
  return request(app).patch(`/api/listings/${listingId}/submit`).set('Authorization', `Bearer ${token}`)
}

describe('CARS real location capture: mapLocation required at submit', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('rejects submit with no mapLocation at all', async () => {
    const seller = await registerSeller(app, 'car-loc-none')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token)
    const submitted = await submitWithPhoto(app, seller.token, created.body.listing.id)
    expect(submitted.status).toBe(400)
    expect(submitted.body.error.code).toBe('LISTING_ATTRIBUTES_INCOMPLETE')
    expect(submitted.body.error.details.missing).toContain('confirmed map location')
  })

  it('rejects submit with an unconfirmed pin', async () => {
    const seller = await registerSeller(app, 'car-loc-unconfirmed')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token, {
      mapLocation: { latitude: 33.5, longitude: 36.3, pinConfirmed: false },
    })
    const submitted = await submitWithPhoto(app, seller.token, created.body.listing.id)
    expect(submitted.status).toBe(400)
    expect(submitted.body.error.details.missing).toContain('confirmed map location')
  })

  it('rejects submit with out-of-Syria-bounds coordinates even if confirmed', async () => {
    const seller = await registerSeller(app, 'car-loc-outofbounds')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token, {
      mapLocation: { latitude: 90, longitude: 36.3, pinConfirmed: true },
    })
    const submitted = await submitWithPhoto(app, seller.token, created.body.listing.id)
    expect(submitted.status).toBe(400)
    expect(submitted.body.error.details.missing).toContain('confirmed map location')
  })

  it('accepts submit with a confirmed, in-bounds coordinate', async () => {
    const seller = await registerSeller(app, 'car-loc-valid')
    await approveSellerPlan(seller.user.id)
    const created = await createCarDraft(app, seller.token, {
      mapLocation: { latitude: 33.5138, longitude: 36.2765, pinConfirmed: true },
    })
    const submitted = await submitWithPhoto(app, seller.token, created.body.listing.id)
    expect(submitted.status).toBe(200)
    expect(submitted.body.listing.status).toBe('PENDING_REVIEW')
  })

  it('does not require mapLocation for a STAYS listing (regression: rule is CARS-only)', async () => {
    const seller = await registerSeller(app, 'car-loc-stays-regression')
    const res = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({
        division: 'STAYS',
        titleAr: 'شقة اختبار',
        priceMinor: 15,
        currency: 'USD',
        metadata: { propertyType: 'apartment', governorate: 'damascus', city: 'damascus-city', bedrooms: 2, bathrooms: 1, areaSqm: 90 },
      })
    expect(res.status).toBe(201)
    const submitted = await request(app).patch(`/api/listings/${res.body.listing.id}/submit`).set('Authorization', `Bearer ${seller.token}`)
    expect(submitted.status).toBe(200)
  })
})
