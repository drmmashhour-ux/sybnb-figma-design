import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Dealer pricing tool (025/Carcad Phase G): GET /api/host/overview rates a dealer's own CARS
// listings against the live APPROVED market -- even a DRAFT/PENDING_REVIEW/PAUSED car that isn't
// live yet, so a dealer can see the Deal Rating before ever publishing.

const VEHICLE = { make: 'Toyota', model: 'Corolla', year: 2020, mileageKm: 30000, transmission: 'automatic', fuelType: 'gas', condition: 'USED' }

async function registerSeller(app, label) {
  const email = uniqueTestEmail(label)
  const legacyVerificationGrant1 = await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'SELLER', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function createCar(ownerId, status, priceMinor, vehicleOverrides = {}) {
  return db().listing.create({
    data: {
      ownerId,
      division: 'CARS',
      status,
      titleAr: 'سيارة اختبار',
      priceMinor,
      currency: 'USD',
      metadata: { vehicle: { ...VEHICLE, ...vehicleOverrides }, mapLocation: { latitude: 33.5138, longitude: 36.2765, pinConfirmed: true } },
    },
  })
}

describe('GET /api/host/overview: dealer pricing tool (dealRating on CARS listings)', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it("rates a dealer's own DRAFT car against the market even though it isn't live", async () => {
    const seller = await registerSeller(app, 'pricing-tool-draft')
    // Market comparables must be APPROVED and owned by someone else (or the same seller -- doesn't matter).
    await createCar(seller.user.id, 'APPROVED', 20_000_000)
    await createCar(seller.user.id, 'APPROVED', 20_500_000)
    await createCar(seller.user.id, 'APPROVED', 19_500_000)
    const draft = await createCar(seller.user.id, 'DRAFT', 30_000_000)

    const res = await request(app).get('/api/host/overview').set('Authorization', `Bearer ${seller.token}`)
    expect(res.status).toBe(200)
    const found = res.body.overview.listings.find((listing) => listing.id === draft.id)
    expect(found).toBeTruthy()
    expect(found.dealRating).toBeTruthy()
    expect(found.dealRating.tier).toBe('HIGH_PRICE')
  })

  it('returns tier: null when there are too few comparables', async () => {
    const seller = await registerSeller(app, 'pricing-tool-nodata')
    // A distinct make/model so this test's pool lookup can't accidentally match comparables
    // created by other tests in this file (loadCarsComparablePool() scans the whole test DB).
    const draft = await createCar(seller.user.id, 'DRAFT', 15_000_000, { make: 'Rare Make', model: 'One Off' })

    const res = await request(app).get('/api/host/overview').set('Authorization', `Bearer ${seller.token}`)
    expect(res.status).toBe(200)
    const found = res.body.overview.listings.find((listing) => listing.id === draft.id)
    expect(found.dealRating.tier).toBeNull()
  })

  it('does not attach dealRating to a non-CARS listing on the same host', async () => {
    const seller = await registerSeller(app, 'pricing-tool-nonCars')
    const stays = await db().listing.create({
      data: {
        ownerId: seller.user.id,
        division: 'STAYS',
        status: 'DRAFT',
        titleAr: 'شقة اختبار',
        priceMinor: 15,
        currency: 'USD',
        metadata: {},
      },
    })

    const res = await request(app).get('/api/host/overview').set('Authorization', `Bearer ${seller.token}`)
    expect(res.status).toBe(200)
    const found = res.body.overview.listings.find((listing) => listing.id === stays.id)
    expect(found).toBeTruthy()
    expect(found.dealRating).toBeUndefined()
  })

  it('a host with zero CARS listings gets a normal response (regression)', async () => {
    const seller = await registerSeller(app, 'pricing-tool-zero-cars')
    const res = await request(app).get('/api/host/overview').set('Authorization', `Bearer ${seller.token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.overview.listings)).toBe(true)
  })
})
