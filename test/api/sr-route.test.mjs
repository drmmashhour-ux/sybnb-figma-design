import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// POST /api/sr/route — real road route + ETA for the trip map (OSRM when configured, straight-line
// fallback otherwise). Auth-gated, Syria-bounded coords, never throws on the routing side.
describe('POST /api/sr/route', () => {
  let app
  let token
  const DAMASCUS = { lat: 33.5, lng: 36.3 }
  const MEZZEH = { lat: 33.52, lng: 36.28 }

  beforeAll(async () => {
    app = testApp()
    const email = uniqueTestEmail('sr-route')
    const legacyVerificationGrant1 = await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    token = res.body.token
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('requires authentication', async () => {
    const res = await request(app).post('/api/sr/route').send({ pickupCoords: DAMASCUS, dropoffCoords: MEZZEH })
    expect(res.status).toBe(401)
  })

  it('returns a route with distance + ETA (haversine fallback when OSRM is off)', async () => {
    const res = await request(app)
      .post('/api/sr/route')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickupCoords: DAMASCUS, dropoffCoords: MEZZEH })
    expect(res.status).toBe(200)
    expect(res.body.route.distanceKm).toBeGreaterThan(0)
    expect(res.body.route.durationMin).toBeGreaterThan(0)
    expect(['haversine', 'haversine-fallback', 'osrm']).toContain(res.body.route.source)
  })

  it('rejects coordinates outside Syria', async () => {
    const res = await request(app)
      .post('/api/sr/route')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickupCoords: { lat: 48.85, lng: 2.35 }, dropoffCoords: MEZZEH }) // Paris
    expect(res.status).toBe(400)
  })
})
