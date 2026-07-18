import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { computeDealRating } from '../../server/lib/car-deal-rating.mjs'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Deal Rating (025/Carcad Phase E): CarGurus-style Great/Good/Fair/High price badge computed
// against a pool of comparable APPROVED CARS listings (same make+model, year/mileage tolerance).

function vehicle(overrides = {}) {
  return { make: 'Toyota', model: 'Camry', year: 2020, mileageKm: 40000, transmission: 'automatic', fuelType: 'gas', condition: 'USED', ...overrides }
}

// loadCarsComparablePool() runs every pool row through vehicleOf(), which lowercases make/model --
// mimic that here so hand-built pool fixtures match what computeDealRating() actually compares
// the (also-lowercased) subject vehicle against.
function poolVehicle(overrides = {}) {
  const v = vehicle(overrides)
  return { ...v, make: v.make.toLowerCase(), model: v.model.toLowerCase() }
}

describe('computeDealRating (unit)', () => {
  function basePool() {
    return [
      { id: 'a', priceMinor: 20_000_000, vehicle: poolVehicle() },
      { id: 'b', priceMinor: 20_500_000, vehicle: poolVehicle() },
      { id: 'c', priceMinor: 19_500_000, vehicle: poolVehicle() },
    ]
  }

  it('classifies a listing well below the comparable median as GREAT_DEAL', () => {
    const subject = { id: 'subject', priceMinor: 18_000_000, metadata: { vehicle: vehicle() } }
    const rating = computeDealRating(subject, basePool())
    expect(rating.tier).toBe('GREAT_DEAL')
    expect(rating.comparableCount).toBe(3)
  })

  it('classifies a listing at the median as GOOD_DEAL', () => {
    const subject = { id: 'subject', priceMinor: 20_000_000, metadata: { vehicle: vehicle() } }
    const rating = computeDealRating(subject, basePool())
    expect(rating.tier).toBe('GOOD_DEAL')
  })

  it('classifies a listing ~10% above median as FAIR_PRICE', () => {
    const subject = { id: 'subject', priceMinor: 22_000_000, metadata: { vehicle: vehicle() } }
    const rating = computeDealRating(subject, basePool())
    expect(rating.tier).toBe('FAIR_PRICE')
  })

  it('classifies a listing well above median as HIGH_PRICE', () => {
    const subject = { id: 'subject', priceMinor: 30_000_000, metadata: { vehicle: vehicle() } }
    const rating = computeDealRating(subject, basePool())
    expect(rating.tier).toBe('HIGH_PRICE')
  })

  it('returns tier: null with fewer than 3 comparables', () => {
    const pool = [
      { id: 'a', priceMinor: 20_000_000, vehicle: poolVehicle() },
      { id: 'b', priceMinor: 20_500_000, vehicle: poolVehicle() },
    ]
    const subject = { id: 'subject', priceMinor: 18_000_000, metadata: { vehicle: vehicle() } }
    const rating = computeDealRating(subject, pool)
    expect(rating.tier).toBeNull()
    expect(rating.comparableCount).toBe(2)
  })

  it('excludes a comparable outside year tolerance from the median calc', () => {
    const pool = [
      ...basePool(),
      // Far outside year tolerance (2020 vs 2010) and priced very high -- must not skew the median.
      { id: 'd', priceMinor: 90_000_000, vehicle: poolVehicle({ year: 2010 }) },
    ]
    const subject = { id: 'subject', priceMinor: 20_000_000, metadata: { vehicle: vehicle() } }
    const rating = computeDealRating(subject, pool)
    expect(rating.comparableCount).toBe(3)
    expect(rating.medianPriceMinor).toBe(20_000_000)
  })

  it('excludes a comparable outside mileage tolerance from the median calc', () => {
    const pool = [
      ...basePool(),
      // 40,000km subject vs 200,000km comparable -- well outside the ±max(20k,20%) tolerance.
      { id: 'd', priceMinor: 5_000_000, vehicle: poolVehicle({ mileageKm: 200_000 }) },
    ]
    const subject = { id: 'subject', priceMinor: 20_000_000, metadata: { vehicle: vehicle() } }
    const rating = computeDealRating(subject, pool)
    expect(rating.comparableCount).toBe(3)
  })
})

describe('Deal Rating integration: GET /api/listings and /api/listings/:id', () => {
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

  async function createApprovedCar(ownerId, priceMinor, vehicleOverrides = {}) {
    return db().listing.create({
      data: {
        ownerId,
        division: 'CARS',
        status: 'APPROVED',
        titleAr: 'سيارة اختبار',
        priceMinor,
        currency: 'USD',
        metadata: { vehicle: vehicle(vehicleOverrides), mapLocation: { latitude: 33.5138, longitude: 36.2765, pinConfirmed: true } },
      },
    })
  }

  it('GET /api/listings?division=CARS includes dealRating per listing', async () => {
    const seller = await registerSeller('deal-rating-search')
    await createApprovedCar(seller.user.id, 20_000_000)
    await createApprovedCar(seller.user.id, 20_500_000)
    await createApprovedCar(seller.user.id, 19_500_000)
    const subject = await createApprovedCar(seller.user.id, 18_000_000)

    const res = await request(app).get('/api/listings?division=CARS')
    expect(res.status).toBe(200)
    const found = res.body.listings.find((listing) => listing.id === subject.id)
    expect(found).toBeTruthy()
    expect(found.dealRating).toBeTruthy()
    expect(found.dealRating.tier).toBe('GREAT_DEAL')
  })

  it('GET /api/listings/:id includes dealRating for a CARS listing', async () => {
    const seller = await registerSeller('deal-rating-detail')
    await createApprovedCar(seller.user.id, 20_000_000)
    await createApprovedCar(seller.user.id, 20_500_000)
    await createApprovedCar(seller.user.id, 19_500_000)
    const subject = await createApprovedCar(seller.user.id, 30_000_000)

    const res = await request(app).get(`/api/listings/${subject.id}`)
    expect(res.status).toBe(200)
    expect(res.body.listing.dealRating).toBeTruthy()
    expect(res.body.listing.dealRating.tier).toBe('HIGH_PRICE')
  })

  it('a non-CARS search has no dealRating on its listings (regression)', async () => {
    const seller = await registerSeller('deal-rating-regression')
    await db().listing.create({
      data: {
        ownerId: seller.user.id,
        division: 'STAYS',
        status: 'APPROVED',
        titleAr: 'شقة اختبار',
        priceMinor: 15,
        currency: 'USD',
        metadata: { propertyType: 'apartment', governorate: 'damascus', city: 'damascus-city' },
      },
    })
    const res = await request(app).get('/api/listings?division=STAYS')
    expect(res.status).toBe(200)
    expect(res.body.listings.length).toBeGreaterThan(0)
    expect(res.body.listings.every((listing) => listing.dealRating === undefined)).toBe(true)
  })
})
