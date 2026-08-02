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
  let sellerToken

  beforeAll(async () => {
    app = testApp()
    const email = uniqueTestEmail('re-seller')
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'SELLER', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    seller = res.body.user
    sellerToken = res.body.token
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

  it('attaches a property valuation (Below/At/Above market) from comparable price-per-m²', async () => {
    // A cluster of comparable apartments in one city + type + size band sets the market per-m².
    // Base: 100 m² at 20,000,000 SYP → 200,000/m².
    const city = 'latakia-city'
    for (const price of [20_000_000, 20_500_000, 19_500_000, 21_000_000]) {
      await createProperty('BUY', price, { propertyType: 'apartment', governorate: 'latakia', city, sizeSqm: 100 })
    }
    // A clearly under-priced comparable (100 m² at 14,000,000 → 140,000/m², ~30% under the ~200k median).
    const cheap = await createProperty('BUY', 14_000_000, { propertyType: 'apartment', governorate: 'latakia', city, sizeSqm: 100 })
    // A clearly over-priced one (100 m² at 30,000,000 → 300,000/m²).
    const pricey = await createProperty('BUY', 30_000_000, { propertyType: 'apartment', governorate: 'latakia', city, sizeSqm: 100 })

    const res = await get('division=BUY&city=' + city)
    expect(res.status).toBe(200)
    const cheapRow = res.body.listings.find((l) => l.id === cheap.id)
    const priceyRow = res.body.listings.find((l) => l.id === pricey.id)
    expect(cheapRow.valuation.tier).toBe('BELOW_MARKET')
    expect(priceyRow.valuation.tier).toBe('ABOVE_MARKET')
    expect(cheapRow.valuation.comparableCount).toBeGreaterThanOrEqual(3)
    expect(typeof cheapRow.valuation.estimatedValueMinor).toBe('number')

    // The single-listing detail carries it too.
    const detail = await request(app).get(`/api/listings/${cheap.id}`)
    expect(detail.body.listing.valuation.tier).toBe('BELOW_MARKET')
  })

  it('a BUY listing created with sizeSqm (as the wizard writes it) passes the submit gate', async () => {
    // Regression for the launch blocker: propertyRules() required metadata.areaSqm but the seller wizard
    // writes sizeSqm, so no property could ever be submitted. The gate now accepts sizeSqm.
    const draft = await request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        division: 'BUY',
        titleAr: 'شقة اختبار الإرسال',
        priceMinor: 25_000_000,
        currency: 'SYP',
        metadata: { propertyType: 'apartment', governorate: 'damascus', city: 'damascus-city', bedrooms: 2, bathrooms: 1, sizeSqm: 110 },
      })
    expect(draft.status).toBe(201)
    // Real-estate requires ≥1 photo before submit (same as the wizard uploads); a 1×1 PNG suffices.
    const onePxPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const media = await request(app)
      .post(`/api/listings/${draft.body.listing.id}/media`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ fileBase64: onePxPng, mimeType: 'image/png' })
    expect(media.status).toBe(201)
    const submit = await request(app).patch(`/api/listings/${draft.body.listing.id}/submit`).set('Authorization', `Bearer ${sellerToken}`)
    expect(submit.status).toBe(200) // sizeSqm now satisfies the attribute gate (was the launch blocker)
    expect(submit.body.listing.status).toBe('PENDING_REVIEW')
  })

  it('POST /api/listings/ai-search parses a free-text query into filters (routed before the :id guard)', async () => {
    const res = await request(app).post('/api/listings/ai-search').send({ query: '3 bedroom apartment under 25 million with elevator' })
    expect(res.status).toBe(200)
    expect(res.body.filters.propertyType).toBe('apartment')
    expect(res.body.filters.bedrooms).toBe(3)
    expect(res.body.filters.maxPrice).toBe(25_000_000)
    expect(res.body.filters.amenities).toContain('elevator')
  })

  it('GET /api/me/properties returns only the caller\'s BUY/RENTALS listings with an inquiry count', async () => {
    // A fresh seller so the portfolio + inquiry count are isolated from the shared `seller`.
    const email = uniqueTestEmail('me-props-seller')
    await verifyEmailForTest(app, email, 'staff-login')
    const reg = await request(app).post('/api/auth/register').send({ role: 'SELLER', email, password: 'correct-horse-battery' })
    trackTestUser(reg.body.user.id)
    const token = reg.body.token
    const ownerId = reg.body.user.id

    const buy = await db().listing.create({ data: { ownerId, division: 'BUY', status: 'APPROVED', titleAr: 'شقتي', priceMinor: 10_000_000, currency: 'SYP', metadata: { propertyType: 'apartment', city: 'homs-city', sizeSqm: 90 } } })
    await db().listing.create({ data: { ownerId, division: 'RENTALS', status: 'DRAFT', titleAr: 'إيجاري', priceMinor: 400_000, currency: 'SYP', metadata: { propertyType: 'apartment', city: 'homs-city' } } })
    // A STAYS listing must NOT appear in the real-estate portfolio.
    await db().listing.create({ data: { ownerId, division: 'STAYS', status: 'APPROVED', titleAr: 'إقامة', priceMinor: 5000, currency: 'USD', metadata: {} } })

    // An inquiry thread on the BUY listing from some guest → inquiryCount 1.
    const guestEmail = uniqueTestEmail('me-props-guest')
    await verifyEmailForTest(app, guestEmail)
    const guest = await request(app).post('/api/auth/register').send({ role: 'GUEST', email: guestEmail, password: 'correct-horse-battery' })
    trackTestUser(guest.body.user.id)
    await db().messageThread.create({ data: { listingId: buy.id, guestId: guest.body.user.id } })

    const res = await request(app).get('/api/me/properties').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const divisions = res.body.properties.map((p) => p.division).sort()
    expect(divisions).toEqual(['BUY', 'RENTALS']) // STAYS excluded
    const buyRow = res.body.properties.find((p) => p.id === buy.id)
    expect(buyRow.inquiryCount).toBe(1)
    // Anonymous request is rejected.
    expect((await request(app).get('/api/me/properties')).status).toBe(401)
  })

  it('PATCH /api/listings/:id lets the owner edit a REJECTED property (title/price/metadata), scoped to the owner', async () => {
    const rejected = await createProperty('BUY', 9_000_000, { propertyType: 'apartment', governorate: 'damascus', city: 'damascus-city', sizeSqm: 80 })
    await db().listing.update({ where: { id: rejected.id }, data: { status: 'REJECTED' } })

    // Owner edits title, price, and searchable metadata.
    const edit = await request(app)
      .patch(`/api/listings/${rejected.id}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ titleAr: 'شقة مُعدّلة', priceMinor: 12_500_000, metadata: { propertyType: 'villa', governorate: 'aleppo', city: 'aleppo-city', bedrooms: 4, bathrooms: 2, sizeSqm: 150 } })
    expect(edit.status).toBe(200)
    expect(edit.body.listing.titleAr).toBe('شقة مُعدّلة')
    expect(edit.body.listing.priceMinor).toBe(12_500_000)
    expect(edit.body.listing.metadata.city).toBe('aleppo-city')
    // Edit does not publish — it stays REJECTED until the seller explicitly resubmits for review.
    expect(edit.body.listing.status).toBe('REJECTED')

    // A non-owner cannot edit it (scoped to ownerId → 404, never leaks existence).
    const otherEmail = uniqueTestEmail('re-other-seller')
    await verifyEmailForTest(app, otherEmail, 'staff-login')
    const other = await request(app).post('/api/auth/register').send({ role: 'SELLER', email: otherEmail, password: 'correct-horse-battery' })
    trackTestUser(other.body.user.id)
    expect((await request(app).patch(`/api/listings/${rejected.id}`).set('Authorization', `Bearer ${other.body.token}`).send({ titleAr: 'hijack attempt' })).status).toBe(404)

    // Anonymous is rejected.
    expect((await request(app).patch(`/api/listings/${rejected.id}`).send({ titleAr: 'anon' })).status).toBe(401)
  })

  it('PATCH /api/listings/:id refuses to edit an APPROVED (live) listing', async () => {
    const live = await createProperty('BUY', 7_000_000, { propertyType: 'apartment', governorate: 'homs', city: 'homs-city' })
    const res = await request(app).patch(`/api/listings/${live.id}`).set('Authorization', `Bearer ${sellerToken}`).send({ priceMinor: 1 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('LISTING_NOT_EDITABLE')
  })

  it('never returns a non-APPROVED property in public search', async () => {
    const draft = await createProperty('BUY', 500_000, { propertyType: 'apartment', governorate: 'damascus', city: 'damascus-city' })
    await db().listing.update({ where: { id: draft.id }, data: { status: 'PENDING_REVIEW' } })
    const res = await get('division=BUY')
    expect(res.body.listings.map((l) => l.id)).not.toContain(draft.id)
  })
})
