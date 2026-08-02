import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Buy/Sale/Rent search: GET /api/listings?division=BUY|RENTALS must return real-estate listings AND
// honour the metadata filters the RentalsPage now sends (governorate/city/area, propertyType, bedrooms,
// price range, amenities) — the wiring that turned the Centris-style filters from cosmetic into real.
// BUY/RENTALS are NOT paid-plan divisions, so listing is the same free path as STAYS.
describe('Buy/Sale/Rent listing search + metadata filters', () => {
  let app
  let seller

  beforeAll(async () => {
    app = testApp()
    const email = uniqueTestEmail('re-seller')
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'SELLER', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    seller = res.body.user
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  function createProperty(division, priceMinor, metadata) {
    return db().listing.create({
      data: { ownerId: seller.id, division, status: 'APPROVED', titleAr: 'عقار اختبار', priceMinor, currency: 'SYP', metadata },
    })
  }

  const get = (qs) => request(app).get(`/api/listings?${qs}`)

  it('lists APPROVED BUY properties and honours city + propertyType + bedrooms + price + amenity filters', async () => {
    // A 3-bed villa in Aleppo with an elevator, and a 1-bed apartment in Damascus without — same division.
    // Amenities live under metadata.visualFilters (the shape the wizard writes and the search reads).
    const villa = await createProperty('BUY', 40_000_000, {
      propertyType: 'villa', governorate: 'aleppo', city: 'aleppo-city', bedrooms: 3, bathrooms: 2, sizeSqm: 220, visualFilters: { amenities: ['elevator', 'garden'] },
    })
    const apartment = await createProperty('BUY', 120_000, {
      propertyType: 'apartment', governorate: 'damascus', city: 'damascus-city', bedrooms: 1, bathrooms: 1, sizeSqm: 70, visualFilters: { amenities: ['wifi'] },
    })

    // Unfiltered: both appear under BUY.
    const all = await get('division=BUY')
    expect(all.status).toBe(200)
    const ids = all.body.listings.map((l) => l.id)
    expect(ids).toContain(villa.id)
    expect(ids).toContain(apartment.id)

    // City filter → only Aleppo villa.
    const byCity = await get('division=BUY&city=aleppo-city')
    const cityIds = byCity.body.listings.map((l) => l.id)
    expect(cityIds).toContain(villa.id)
    expect(cityIds).not.toContain(apartment.id)

    // Property type filter → only the villa.
    const byType = await get('division=BUY&propertyType=villa')
    expect(byType.body.listings.map((l) => l.id)).toContain(villa.id)
    expect(byType.body.listings.map((l) => l.id)).not.toContain(apartment.id)

    // Bedrooms >= 3 → only the villa.
    const byBeds = await get('division=BUY&bedrooms=3')
    expect(byBeds.body.listings.map((l) => l.id)).toContain(villa.id)
    expect(byBeds.body.listings.map((l) => l.id)).not.toContain(apartment.id)

    // Amenity filter (elevator) → only the villa.
    const byAmenity = await get('division=BUY&amenities=elevator')
    expect(byAmenity.body.listings.map((l) => l.id)).toContain(villa.id)
    expect(byAmenity.body.listings.map((l) => l.id)).not.toContain(apartment.id)

    // Price ceiling below the villa → only the cheap apartment.
    const byPrice = await get('division=BUY&maxPrice=1000000')
    expect(byPrice.body.listings.map((l) => l.id)).toContain(apartment.id)
    expect(byPrice.body.listings.map((l) => l.id)).not.toContain(villa.id)
  })

  it('lists RENTALS separately from BUY (division isolation)', async () => {
    const rental = await createProperty('RENTALS', 300_000, { propertyType: 'apartment', governorate: 'homs', city: 'homs-city', bedrooms: 2 })

    const rentals = await get('division=RENTALS')
    expect(rentals.body.listings.map((l) => l.id)).toContain(rental.id)

    // A RENTALS listing must NOT leak into a BUY search.
    const buy = await get('division=BUY')
    expect(buy.body.listings.map((l) => l.id)).not.toContain(rental.id)
  })

  it('never returns a non-APPROVED property in public search', async () => {
    const draft = await createProperty('BUY', 500_000, { propertyType: 'apartment', governorate: 'damascus', city: 'damascus-city' })
    await db().listing.update({ where: { id: draft.id }, data: { status: 'PENDING_REVIEW' } })
    const res = await get('division=BUY')
    expect(res.body.listings.map((l) => l.id)).not.toContain(draft.id)
  })
})
