import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Search radius filter (025/Carcad Phase F): centerLat/centerLng/radiusKm on GET /api/listings,
// filtering by real haversine distance against metadata.mapLocation. Built on top of Phase D's
// real location capture -- a listing missing valid coordinates is excluded (not errored) when a
// radius filter is active.

const DAMASCUS_CENTER = { lat: 33.5138, lng: 36.2765 }
// ~7km from Damascus center -- inside a 10km radius, outside a 5km radius.
const NEARBY = { lat: 33.57, lng: 36.28 }
// Aleppo -- ~300km from Damascus, well outside any reasonable radius test here.
const FAR_AWAY = { lat: 36.2021, lng: 37.1343 }

const VEHICLE = { make: 'Toyota', model: 'Corolla', year: 2020, mileageKm: 30000, transmission: 'automatic', fuelType: 'gas', condition: 'USED' }

describe('Search radius filter on GET /api/listings', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerSeller(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'SELLER', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { email, token: res.body.token, user: res.body.user }
  }

  async function createApprovedCar(ownerId, mapLocation, title) {
    return db().listing.create({
      data: {
        ownerId,
        division: 'CARS',
        status: 'APPROVED',
        titleAr: title,
        priceMinor: 10_000_000,
        currency: 'USD',
        metadata: { vehicle: VEHICLE, ...(mapLocation ? { mapLocation } : {}) },
      },
    })
  }

  it('returns only listings within the radius of the center point', async () => {
    const seller = await registerSeller('radius-near-far')
    const near = await createApprovedCar(
      seller.user.id,
      { latitude: NEARBY.lat, longitude: NEARBY.lng, pinConfirmed: true },
      'قريبة',
    )
    const far = await createApprovedCar(
      seller.user.id,
      { latitude: FAR_AWAY.lat, longitude: FAR_AWAY.lng, pinConfirmed: true },
      'بعيدة',
    )

    const res = await request(app).get(
      `/api/listings?division=CARS&centerLat=${DAMASCUS_CENTER.lat}&centerLng=${DAMASCUS_CENTER.lng}&radiusKm=15`,
    )
    expect(res.status).toBe(200)
    const ids = res.body.listings.map((listing) => listing.id)
    expect(ids).toContain(near.id)
    expect(ids).not.toContain(far.id)
  })

  it('excludes a listing with no mapLocation at all when radius filter is active (not an error)', async () => {
    const seller = await registerSeller('radius-nolocation')
    const noLocation = await createApprovedCar(seller.user.id, null, 'بدون موقع')

    const res = await request(app).get(
      `/api/listings?division=CARS&centerLat=${DAMASCUS_CENTER.lat}&centerLng=${DAMASCUS_CENTER.lng}&radiusKm=15`,
    )
    expect(res.status).toBe(200)
    expect(res.body.listings.map((listing) => listing.id)).not.toContain(noLocation.id)
  })

  it('rejects partial radius params (radiusKm without center point)', async () => {
    const res = await request(app).get('/api/listings?division=CARS&radiusKm=10')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('LISTING_RADIUS_FILTER_INVALID')
  })

  it('rejects an out-of-Syria-bounds center point', async () => {
    const res = await request(app).get('/api/listings?division=CARS&centerLat=0&centerLng=0&radiusKm=10')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('LISTING_RADIUS_FILTER_INVALID')
  })

  it('is unaffected when no radius filter is given (regression)', async () => {
    const seller = await registerSeller('radius-noop')
    const listing = await createApprovedCar(
      seller.user.id,
      { latitude: FAR_AWAY.lat, longitude: FAR_AWAY.lng, pinConfirmed: true },
      'أي مكان',
    )
    const res = await request(app).get('/api/listings?division=CARS')
    expect(res.status).toBe(200)
    expect(res.body.listings.map((row) => row.id)).toContain(listing.id)
  })
})
