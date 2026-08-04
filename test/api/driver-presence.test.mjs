import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { approveDriverForRides, cleanupTestUsers, fundWallet, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// SR driver presence (Phase 1): a driver goes online, broadcasts location, and the pending pool is
// ordered nearest-first by real pickup distance. Foundation for auto-dispatch (Phase 2).

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  let verificationGrant
  if (role === 'GUEST') verificationGrant = await verifyEmailForTest(app, email)
  if (role === 'DRIVER') verificationGrant = await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ verificationGrant, role, email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  if (role === 'DRIVER') await approveDriverForRides(res.body.user.id)
  if (role === 'GUEST') await fundWallet(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function requestRideAt(app, riderToken, pickupCoords, label) {
  const res = await request(app)
    .post('/api/sr/rides')
    .set('Authorization', `Bearer ${riderToken}`)
    .send({ pickup: `pickup ${label}`, dropoff: `dropoff ${label}`, category: 'SR Economy', pickupCoords, dropoffCoords: DROPOFF })
  return res.body.ride
}

// Damascus-area coords (inside Syria bounds so assertSyriaCoords passes).
const DRIVER_AT = { lat: 33.5, lng: 36.3 }
const NEAR = { lat: 33.505, lng: 36.305 } // ~0.7 km from the driver
const FAR = { lat: 33.6, lng: 36.42 } //     ~15 km from the driver
const DROPOFF = { lat: 33.52, lng: 36.28 }

describe('SR driver presence: online toggle, location broadcast, nearest-first pool', () => {
  let app
  let riderNear
  let riderFar
  let driver

  beforeAll(async () => {
    app = testApp()
    riderNear = await registerUser(app, 'GUEST', 'presence-rider-near')
    riderFar = await registerUser(app, 'GUEST', 'presence-rider-far')
    driver = await registerUser(app, 'DRIVER', 'presence-driver')
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  const goOnline = (token, coords) =>
    request(app).patch('/api/driver/availability').set('Authorization', `Bearer ${token}`).send({ online: true, ...(coords || {}) })

  it('a driver is OFFLINE by default — the pool returns online:false and no rides', async () => {
    const res = await request(app).get('/api/driver/rides/pending').set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(200)
    expect(res.body.online).toBe(false)
    expect(res.body.rides).toEqual([])
  })

  it('an un-vetted driver cannot go online (road-ready gate → 403)', async () => {
    const email = uniqueTestEmail('presence-unvetted')
    const legacyVerificationGrant1 = await verifyEmailForTest(app, email, 'staff-login')
    const reg = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'DRIVER', email, password: 'correct-horse-battery' })
    trackTestUser(reg.body.user.id)
    const res = await goOnline(reg.body.token)
    expect(res.status).toBe(403)
  })

  it('cannot broadcast location while offline (409 DRIVER_OFFLINE)', async () => {
    const res = await request(app).post('/api/driver/location').set('Authorization', `Bearer ${driver.token}`).send(DRIVER_AT)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('DRIVER_OFFLINE')
  })

  it('driver goes ONLINE (with location); the pool flips to online:true', async () => {
    const on = await goOnline(driver.token, DRIVER_AT)
    expect(on.status).toBe(200)
    expect(on.body.online).toBe(true)
    const pool = await request(app).get('/api/driver/rides/pending').set('Authorization', `Bearer ${driver.token}`)
    expect(pool.body.online).toBe(true)
  })

  it('an online driver CAN broadcast location (200)', async () => {
    const res = await request(app).post('/api/driver/location').set('Authorization', `Bearer ${driver.token}`).send(DRIVER_AT)
    expect(res.status).toBe(200)
    expect(res.body.location.lat).toBeCloseTo(DRIVER_AT.lat, 3)
  })

  it('NEAREST-FIRST: the closer pickup ranks ahead of the farther one, with real distances', async () => {
    const far = await requestRideAt(app, riderFar.token, FAR, 'far')
    const near = await requestRideAt(app, riderNear.token, NEAR, 'near')
    await goOnline(driver.token, DRIVER_AT)

    const res = await request(app).get('/api/driver/rides/pending').set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(200)
    const ids = res.body.rides.map((r) => r.id)
    const nearIdx = ids.indexOf(near.id)
    const farIdx = ids.indexOf(far.id)
    expect(nearIdx).toBeGreaterThanOrEqual(0)
    expect(farIdx).toBeGreaterThanOrEqual(0)
    expect(nearIdx).toBeLessThan(farIdx) // closer ride listed first

    const nearRow = res.body.rides[nearIdx]
    const farRow = res.body.rides[farIdx]
    expect(typeof nearRow.pickupDistanceKm).toBe('number')
    expect(nearRow.pickupDistanceKm).toBeLessThan(farRow.pickupDistanceKm)
    // sanity on the geodesic distances (~0.7km vs ~15km)
    expect(nearRow.pickupDistanceKm).toBeLessThan(3)
    expect(farRow.pickupDistanceKm).toBeGreaterThan(8)
  })

  it('driver goes OFFLINE again; the pool returns online:false', async () => {
    const off = await request(app).patch('/api/driver/availability').set('Authorization', `Bearer ${driver.token}`).send({ online: false })
    expect(off.status).toBe(200)
    expect(off.body.online).toBe(false)
    const pool = await request(app).get('/api/driver/rides/pending').set('Authorization', `Bearer ${driver.token}`)
    expect(pool.body.online).toBe(false)
  })
})
