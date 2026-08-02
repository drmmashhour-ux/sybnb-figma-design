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
  // Deir ez-Zor — far from the others (no cross-contamination); here `far` is within offer radius so a
  // declined offer can re-dispatch to it.
  deir: { pickup: { lat: 35.33, lng: 40.14 }, near: { lat: 35.332, lng: 40.142 }, far: { lat: 35.37, lng: 40.18 }, dropoff: { lat: 35.34, lng: 40.13 } },
  // Latakia + Qamishli — additional isolated cities for the expired-offer cascade tests.
  latakia: { pickup: { lat: 35.53, lng: 35.79 }, near: { lat: 35.532, lng: 35.792 }, far: { lat: 35.57, lng: 35.83 }, dropoff: { lat: 35.52, lng: 35.78 } },
  qamishli: { pickup: { lat: 37.05, lng: 41.23 }, near: { lat: 37.052, lng: 41.232 }, far: { lat: 37.09, lng: 41.27 }, dropoff: { lat: 37.04, lng: 41.22 } },
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

  it('a declined offer re-dispatches to the next nearest driver; the decliner cannot claim', async () => {
    const { near, far, ride } = await setupTrip('deir')

    // The offered (near) driver declines.
    const decline = await request(app).patch(`/api/sr/rides/${ride.id}/decline`).set('Authorization', `Bearer ${near.token}`)
    expect(decline.status).toBe(200)
    expect(decline.body.reoffered).toBe(true)

    // The ride is now offered to the next nearest (far).
    const row = await db().rideRequest.findUnique({ where: { id: ride.id }, select: { offeredDriverId: true } })
    expect(row.offeredDriverId).toBe(far.user.id)

    // The decliner can no longer claim it...
    const nearClaim = await claim(near.token, ride.id)
    expect(nearClaim.status).toBe(409)
    expect(nearClaim.body.error.code).toBe('DRIVER_DECLINED_RIDE')

    // ...but the re-offered driver can.
    const farClaim = await claim(far.token, ride.id)
    expect(farClaim.status).toBe(200)
    expect(farClaim.body.ride.driverId).toBe(far.user.id)
  })

  it('an EXPIRED (un-answered) offer CASCADES to the next nearest driver on the next poll', async () => {
    const { near, far, ride } = await setupTrip('latakia')
    // near got the exclusive offer but let it lapse (a timeout — NOT a decline).
    await db().rideRequest.update({ where: { id: ride.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } })

    // Any online driver's pending poll advances the cascade (no cron needed).
    await pending(far.token)

    const row = await db().rideRequest.findUnique({
      where: { id: ride.id },
      select: { offeredDriverId: true, offerExpiresAt: true, metadata: true },
    })
    expect(row.offeredDriverId).toBe(far.user.id) // re-offered to the next nearest
    expect(new Date(row.offerExpiresAt).getTime()).toBeGreaterThan(Date.now()) // a fresh window
    expect(row.metadata.offerTimedOut).toContain(near.user.id) // the lapsed driver recorded

    // far now sees it flagged offeredToMe; the timed-out near driver does NOT (it's far's window now).
    const farPool = await pending(far.token)
    expect(farPool.body.rides.find((r) => r.id === ride.id)?.offeredToMe).toBe(true)
    const nearPool = await pending(near.token)
    expect(nearPool.body.rides.some((r) => r.id === ride.id)).toBe(false)
  })

  it('when no next driver is available the ride opens to the pool — a timed-out driver can still claim it', async () => {
    const c = CITIES.qamishli
    const rider = await registerUser('GUEST', 'ad-rider-qam')
    const solo = await registerUser('DRIVER', 'ad-solo-qam')
    await goOnline(solo.token, c.near)
    const res = await request(app)
      .post('/api/sr/rides')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ pickup: 'p', dropoff: 'd', category: 'SR Economy', pickupCoords: c.pickup, dropoffCoords: c.dropoff })
    const ride = res.body.ride
    expect((await db().rideRequest.findUnique({ where: { id: ride.id }, select: { offeredDriverId: true } })).offeredDriverId).toBe(solo.user.id)

    // The only online driver lets the window lapse; the next poll finds no other driver → opens the pool.
    await db().rideRequest.update({ where: { id: ride.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } })
    const pool = await pending(solo.token)

    const row = await db().rideRequest.findUnique({ where: { id: ride.id }, select: { offeredDriverId: true, metadata: true } })
    expect(row.offeredDriverId).toBeNull() // fully open
    expect(row.metadata.offerTimedOut).toContain(solo.user.id)
    // Unlike a decliner, a timed-out driver is NOT hidden from the open pool — solo still sees + can claim it.
    expect(pool.body.rides.some((r) => r.id === ride.id)).toBe(true)
    const claimRes = await claim(solo.token, ride.id)
    expect(claimRes.status).toBe(200)
    expect(claimRes.body.ride.driverId).toBe(solo.user.id)
  })
})
