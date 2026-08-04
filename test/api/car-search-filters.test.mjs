import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Car browse filters (Carcad Phase B): GET /api/listings previously silently dropped every
// car-specific query param (make/model/year/mileage/transmission/fuelType) even though the
// frontend chip UI already collected them -- these tests prove the new server-side filter
// branches actually narrow results correctly, including the documented "missing field excludes"
// strictness (unlike bedrooms/bathrooms, which treat an unset field as "unknown, keep it").

async function registerOwner(app, label) {
  const email = uniqueTestEmail(label)
  const legacyVerificationGrant1 = await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'HOST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function createApprovedCar(ownerId, vehicle, overrides = {}) {
  return db().listing.create({
    data: {
      ownerId,
      division: 'CARS',
      titleAr: `${vehicle.make} ${vehicle.model}`,
      status: 'APPROVED',
      priceMinor: 5_000_000,
      currency: 'SYP',
      metadata: { vehicle },
      ...overrides,
    },
  })
}

describe('CARS division search filters', () => {
  let app
  let owner
  let toyota2019
  let hondaNoYear

  beforeAll(async () => {
    app = testApp()
    owner = await registerOwner(app, 'car-filter-owner')

    toyota2019 = await createApprovedCar(owner.user.id, {
      make: 'Toyota', model: 'Corolla', year: 2019, mileageKm: 85000, transmission: 'automatic', fuelType: 'gas', condition: 'USED',
    })
    await createApprovedCar(owner.user.id, {
      make: 'Toyota', model: 'Camry', year: 2015, mileageKm: 150000, transmission: 'manual', fuelType: 'diesel', condition: 'FAIR',
    })
    await createApprovedCar(owner.user.id, {
      make: 'Honda', model: 'Civic', year: 2021, mileageKm: 20000, transmission: 'automatic', fuelType: 'hybrid', condition: 'EXCELLENT',
    })
    // A listing with no vehicle metadata at all -- proves filters exclude rather than "keep unknown".
    hondaNoYear = await createApprovedCar(owner.user.id, { make: 'Honda', model: 'Accord', transmission: 'automatic', fuelType: 'gas', condition: 'GOOD' })
    await db().listing.update({ where: { id: hondaNoYear.id }, data: { metadata: { vehicle: { make: 'Honda', model: 'Accord', transmission: 'automatic', fuelType: 'gas', condition: 'GOOD' } } } })
  })

  afterAll(async () => {
    await db().listing.deleteMany({ where: { ownerId: owner.user.id } })
    await cleanupTestUsers()
  })

  it('filters by make (case-insensitive)', async () => {
    const res = await request(app).get('/api/listings').query({ division: 'CARS', make: 'toyota' })
    expect(res.status).toBe(200)
    const ids = res.body.listings.map((l) => l.id)
    expect(ids).toContain(toyota2019.id)
    expect(ids).not.toContain(hondaNoYear.id)
    expect(res.body.listings.every((l) => l.metadata.vehicle.make === 'Toyota')).toBe(true)
  })

  it('filters by minYear/maxYear range', async () => {
    const res = await request(app).get('/api/listings').query({ division: 'CARS', minYear: '2018', maxYear: '2020' })
    expect(res.status).toBe(200)
    const ids = res.body.listings.map((l) => l.id)
    expect(ids).toContain(toyota2019.id)
    expect(ids.length).toBe(1)
  })

  it('filters by mileage range', async () => {
    const res = await request(app).get('/api/listings').query({ division: 'CARS', maxMileageKm: '30000' })
    expect(res.status).toBe(200)
    expect(res.body.listings.every((l) => l.metadata.vehicle.mileageKm <= 30000)).toBe(true)
    expect(res.body.listings.some((l) => l.metadata.vehicle.make === 'Honda' && l.metadata.vehicle.model === 'Civic')).toBe(true)
  })

  it('filters by transmission', async () => {
    const res = await request(app).get('/api/listings').query({ division: 'CARS', transmission: 'manual' })
    expect(res.status).toBe(200)
    expect(res.body.listings.every((l) => l.metadata.vehicle.transmission === 'manual')).toBe(true)
  })

  it('filters by fuelType', async () => {
    const res = await request(app).get('/api/listings').query({ division: 'CARS', fuelType: 'hybrid' })
    expect(res.status).toBe(200)
    expect(res.body.listings.every((l) => l.metadata.vehicle.fuelType === 'hybrid')).toBe(true)
  })

  it('a listing missing the filtered field (year) is excluded, not kept as "unknown"', async () => {
    const res = await request(app).get('/api/listings').query({ division: 'CARS', minYear: '2000' })
    expect(res.status).toBe(200)
    const ids = res.body.listings.map((l) => l.id)
    expect(ids).not.toContain(hondaNoYear.id)
  })

  it('combines multiple car filters together (AND semantics)', async () => {
    const res = await request(app).get('/api/listings').query({ division: 'CARS', make: 'toyota', transmission: 'automatic' })
    expect(res.status).toBe(200)
    const ids = res.body.listings.map((l) => l.id)
    expect(ids).toEqual([toyota2019.id])
  })
})
