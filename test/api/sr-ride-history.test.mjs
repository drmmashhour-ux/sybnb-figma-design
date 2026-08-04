import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTestUsers, fundWallet, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// GET /api/sr/rides — a rider's own trip history (for the Trips list + receipts). Scoped strictly to the
// requesting rider; never leaks another rider's trips.
describe('GET /api/sr/rides (rider trip history)', () => {
  let app
  let riderA
  let riderB

  beforeAll(async () => {
    app = testApp()
    riderA = await registerRider('hist-a')
    riderB = await registerRider('hist-b')
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerRider(label) {
    const email = uniqueTestEmail(label)
    const legacyVerificationGrant1 = await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    await fundWallet(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  const requestRide = (token) =>
    request(app)
      .post('/api/sr/rides')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy', pickupCoords: { lat: 33.51, lng: 36.29 }, dropoffCoords: { lat: 33.52, lng: 36.28 } })
  const history = (token) => request(app).get('/api/sr/rides').set('Authorization', `Bearer ${token}`)

  it('requires authentication', async () => {
    const res = await request(app).get('/api/sr/rides')
    expect(res.status).toBe(401)
  })

  it("returns the rider's own ride in their history", async () => {
    const created = await requestRide(riderA.token)
    const res = await history(riderA.token)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.rides)).toBe(true)
    const mine = res.body.rides.find((r) => r.id === created.body.ride.id)
    expect(mine).toBeTruthy()
    expect(mine.riderId).toBe(riderA.user.id)
    expect(mine.fareMinor).toBeGreaterThan(0)
  })

  it("never shows another rider's trips", async () => {
    const a = await requestRide(riderA.token)
    const resB = await history(riderB.token)
    expect(resB.body.rides.some((r) => r.id === a.body.ride.id)).toBe(false)
    expect(resB.body.rides.every((r) => r.riderId === riderB.user.id)).toBe(true)
  })
})
