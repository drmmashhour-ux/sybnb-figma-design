import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { approveDriverForRides, cleanupTestUsers, fundWallet, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// GET /api/admin/sr/dispatch — live-ops board of every in-flight ride + every online driver (with
// coordinates) for the admin dispatch map. ADMIN/SUPPORT only.
describe('GET /api/admin/sr/dispatch', () => {
  let app
  let admin

  beforeAll(async () => {
    app = testApp()
    admin = await makeStaff('disp-admin', 'ADMIN')
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function makeStaff(label, role) {
    const u = await db().user.create({
      data: { email: uniqueTestEmail(label), displayName: label, referralCode: uniqueTestReferralCode(), roles: { create: { role } } },
      include: { roles: true },
    })
    trackTestUser(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }

  async function registerUser(role, label) {
    const email = uniqueTestEmail(label)
    let verificationGrant
    if (role === 'GUEST') verificationGrant = await verifyEmailForTest(app, email)
    if (role === 'DRIVER') verificationGrant = await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ verificationGrant, role, email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    if (role === 'DRIVER') await approveDriverForRides(res.body.user.id)
    if (role === 'GUEST') await fundWallet(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  it('rejects anon (401) and a non-admin guest (403)', async () => {
    expect((await request(app).get('/api/admin/sr/dispatch')).status).toBe(401)
    const guest = await registerUser('GUEST', 'disp-guest')
    expect((await request(app).get('/api/admin/sr/dispatch').set('Authorization', `Bearer ${guest.token}`)).status).toBe(403)
  })

  it('returns active rides + online drivers with coordinates + counts', async () => {
    const rider = await registerUser('GUEST', 'disp-rider')
    const driver = await registerUser('DRIVER', 'disp-driver')
    // Online near Hama (a distinct area) + a nearby ride request.
    await request(app).patch('/api/driver/availability').set('Authorization', `Bearer ${driver.token}`).send({ online: true, lat: 35.13, lng: 36.75 })
    const ride = await request(app)
      .post('/api/sr/rides')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ pickup: 'p', dropoff: 'd', category: 'SR Economy', pickupCoords: { lat: 35.132, lng: 36.752 }, dropoffCoords: { lat: 35.14, lng: 36.74 } })

    const res = await request(app).get('/api/admin/sr/dispatch').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.counts.onlineDrivers).toBeGreaterThanOrEqual(1)
    expect(res.body.counts.activeRides).toBeGreaterThanOrEqual(1)

    const myRide = res.body.rides.find((r) => r.id === ride.body.ride.id)
    expect(myRide).toBeTruthy()
    expect(typeof myRide.pickup.lat).toBe('number')
    expect(typeof myRide.pickup.lng).toBe('number')

    const myDriver = res.body.drivers.find((d) => d.driverId === driver.user.id)
    expect(myDriver).toBeTruthy()
    expect(typeof myDriver.location.lat).toBe('number')
    expect(myDriver.driverName).toBeTruthy()
    expect(myDriver.busy).toBe(false)
  })

  it('admin can force-cancel a stuck ride; non-admins cannot; a terminal ride 409s', async () => {
    const rider = await registerUser('GUEST', 'cancel-rider')
    const ride = (
      await request(app)
        .post('/api/sr/rides')
        .set('Authorization', `Bearer ${rider.token}`)
        .send({ pickup: 'p', dropoff: 'd', category: 'SR Economy', pickupCoords: { lat: 35.13, lng: 36.75 }, dropoffCoords: { lat: 35.14, lng: 36.74 } })
    ).body.ride

    // A non-admin guest cannot force-cancel (403).
    const guest = await registerUser('GUEST', 'cancel-guest')
    const forbidden = await request(app).post(`/api/admin/sr/rides/${ride.id}/cancel`).set('Authorization', `Bearer ${guest.token}`).send({})
    expect(forbidden.status).toBe(403)

    // Admin force-cancels → CANCELLED.
    const cancel = await request(app).post(`/api/admin/sr/rides/${ride.id}/cancel`).set('Authorization', `Bearer ${admin.token}`).send({ reason: 'unresponsive driver' })
    expect(cancel.status).toBe(200)
    expect(cancel.body.ride.status).toBe('CANCELLED')

    // The rider is now free to request again (their reservation released with the terminal status).
    const reRequest = await request(app)
      .post('/api/sr/rides')
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ pickup: 'p2', dropoff: 'd2', category: 'SR Economy', pickupCoords: { lat: 35.13, lng: 36.75 }, dropoffCoords: { lat: 35.14, lng: 36.74 } })
    expect(reRequest.status).toBe(201)

    // Cancelling the already-terminal (first) ride again → 409.
    const again = await request(app).post(`/api/admin/sr/rides/${ride.id}/cancel`).set('Authorization', `Bearer ${admin.token}`).send({})
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('SR_RIDE_NOT_CANCELLABLE')
  })
})
