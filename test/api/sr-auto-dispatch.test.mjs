import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { approveDriverForRides, cleanupTestUsers, fundWallet, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// SR auto-dispatch: a new ride is OFFERED to the nearest online driver for a short exclusive window; it
// opens to the wider pool once the window lapses. Each test runs in a DIFFERENT Syrian city (drivers are
// a global online pool), so "nearest" is unambiguous and tests don't cross-contaminate.

const CITIES = {
  damascus: { pickup: { lat: 33.51, lng: 36.29 }, near: { lat: 33.512, lng: 36.292 }, far: { lat: 33.6, lng: 36.42 }, dropoff: { lat: 33.52, lng: 36.28 } },
  aleppo: { pickup: { lat: 36.2, lng: 37.16 }, near: { lat: 36.202, lng: 37.162 }, far: { lat: 36.28, lng: 37.29 }, dropoff: { lat: 36.19, lng: 37.14 } },
  homs: { pickup: { lat: 34.73, lng: 36.72 }, near: { lat: 34.732, lng: 36.722 }, far: { lat: 34.81, lng: 36.86 }, dropoff: { lat: 34.72, lng: 36.7 } },
}

describe('SR auto-dispatch: nearest driver gets an exclusive offer window', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerUser(role, label) {
    const email = uniqueTestEmail(label)
    if (role === 'GUEST') await verifyEmailForTest(app, email)
    if (role === 'DRIVER') await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role, email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    if (role === 'DRIVER') await approveDriverForRides(res.body.user.id)
    if (role === 'GUEST') await fundWallet(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  const goOnline = (token, coords) =>
    request(app).patch('/api/driver/availability').set('Authorization', `Bearer ${token}`).send({ online: true, ...coords })
  const pending = (token) => request(app).get('/api/driver/rides/pending').set('Authorization', `Bearer ${token}`)
  const claim = (token, rideId) => request(app).patch(`/api/sr/rides/${rideId}/claim`).set('Authorization', `Bearer ${token}`)

  // Fresh rider + two fresh online drivers (near/far) in `city`, then request a ride at the city pickup.
  async function setupTrip(city) {
    const c = CITIES[city]
    const rider = await registerUser('GUEST', `ad-rider-${city}`)
    const near = await registerUser('DRIVER', `ad-near-${city}`)
    const far = await registerUser('DRIVER', `ad-far-${city}`)
    await goOnline(near.token, c.near)
    await goOnline(far.token, c.far)
    const res = await request(app)
      .post('/api/sr/rides')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ pickup: 'p', dropoff: 'd', category: 'SR Economy', pickupCoords: c.pickup, dropoffCoords: c.dropoff })
    return { rider, near, far, ride: res.body.ride }
  }

  it('offers a new ride EXCLUSIVELY to the nearest online driver', async () => {
    const { near, far, ride } = await setupTrip('damascus')

    const row = await db().rideRequest.findUnique({ where: { id: ride.id }, select: { offeredDriverId: true, offerExpiresAt: true } })
    expect(row.offeredDriverId).toBe(near.user.id)
    expect(row.offerExpiresAt).toBeTruthy()

    // The offered (near) driver sees it flagged offeredToMe...
    const nearPool = await pending(near.token)
    const mine = nearPool.body.rides.find((r) => r.id === ride.id)
    expect(mine).toBeTruthy()
    expect(mine.offeredToMe).toBe(true)

    // ...and the far driver does NOT see it while the window is live.
    const farPool = await pending(far.token)
    expect(farPool.body.rides.some((r) => r.id === ride.id)).toBe(false)
  })

  it('blocks a non-offered driver from claiming during the window; the offered driver can claim', async () => {
    const { near, far, ride } = await setupTrip('aleppo')

    const farClaim = await claim(far.token, ride.id)
    expect(farClaim.status).toBe(409)
    expect(farClaim.body.error.code).toBe('RIDE_OFFERED_TO_OTHER')

    const nearClaim = await claim(near.token, ride.id)
    expect(nearClaim.status).toBe(200)
    expect(nearClaim.body.ride.status).toBe('DRIVER_ASSIGNED')
    expect(nearClaim.body.ride.driverId).toBe(near.user.id)
  })

  it('opens the ride to other drivers once the exclusive window lapses', async () => {
    const { far, ride } = await setupTrip('homs')

    // Fast-forward the offer expiry into the past (instead of waiting the real window).
    await db().rideRequest.update({ where: { id: ride.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } })

    const farPool = await pending(far.token)
    expect(farPool.body.rides.some((r) => r.id === ride.id)).toBe(true)

    const farClaim = await claim(far.token, ride.id)
    expect(farClaim.status).toBe(200)
    expect(farClaim.body.ride.driverId).toBe(far.user.id)
  })
})
