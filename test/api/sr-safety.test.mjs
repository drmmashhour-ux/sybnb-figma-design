import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import {
  cleanupTestUsers,
  fundWallet,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'

const DAMASCUS = { lat: 33.5169, lng: 36.287 }

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  let verificationGrant
  if (role === 'GUEST') verificationGrant = await verifyEmailForTest(app, email)
  if (role === 'DRIVER') verificationGrant = await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ verificationGrant, role, email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

// A funded rider — required now that the ride balance gate (016) rejects 0-credit riders.
async function registerRider(app, label) {
  const rider = await registerUser(app, 'GUEST', label)
  await fundWallet(rider.user.id)
  return rider
}

// A road-ready driver: ID + license + vehicle registration approved (trust layer 015).
async function registerVerifiedDriver(app, label) {
  const driver = await registerUser(app, 'DRIVER', label)
  await db().user.update({ where: { id: driver.user.id }, data: { idDocumentStatus: 'APPROVED' } })
  for (const type of ['LICENSE', 'VEHICLE_REGISTRATION']) {
    await db().driverDocument.upsert({
      where: { driverUserId_type: { driverUserId: driver.user.id, type } },
      create: { driverUserId: driver.user.id, type, assetUrl: `${type}.pdf`, status: 'APPROVED' },
      update: { status: 'APPROVED' },
    })
  }
  return driver
}

async function requestRide(app, riderToken, label) {
  const res = await request(app)
    .post('/api/sr/rides')
    .set('Authorization', `Bearer ${riderToken}`)
    .send({ pickup: `Malki ${label}`, dropoff: `Mezzeh ${label}`, category: 'SR Economy' })
  expect(res.status).toBe(201)
  return res.body.ride
}

async function claim(app, driverToken, rideId) {
  const res = await request(app).patch(`/api/sr/rides/${rideId}/claim`).set('Authorization', `Bearer ${driverToken}`)
  expect(res.status).toBe(200)
  return res.body.ride
}

// PIN gate (017): the trip can't start until the driver enters the rider's 4-digit code.
async function verifyPin(app, riderToken, driverToken, rideId) {
  const view = await request(app).get(`/api/sr/rides/${rideId}`).set('Authorization', `Bearer ${riderToken}`)
  const pin = view.body.ride.pickupPin
  const res = await request(app).post(`/api/sr/rides/${rideId}/verify-pin`).set('Authorization', `Bearer ${driverToken}`).send({ pin })
  expect(res.status).toBe(200)
}

async function setStatus(app, driverToken, rideId, status) {
  return request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driverToken}`).send({ status })
}

// Fresh funded rider + fresh road-ready driver + a requested ride — fully isolated per test, so no shared
// driver hits the one-active-ride guard and no shared rider's reserved balance accumulates.
async function setupRide(app, label) {
  const rider = await registerRider(app, `${label}-rider`)
  const driver = await registerVerifiedDriver(app, `${label}-driver`)
  const ride = await requestRide(app, rider.token, label)
  return { rider, driver, ride }
}

describe('SR SAFETY layer: SOS, live location, trip share', () => {
  let app
  let adminBearer

  beforeAll(async () => {
    app = testApp()
    const admin = await db().user.create({
      data: {
        email: uniqueTestEmail('safety-admin'),
        displayName: 'Test Admin',
        referralCode: uniqueTestReferralCode(),
        roles: { create: { role: 'ADMIN' } },
      },
      include: { roles: true },
    })
    trackTestUser(admin.id)
    adminBearer = createSessionToken(admin)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('the rider can raise SOS on their ride, and it surfaces to admins as OPEN', async () => {
    const { rider, ride } = await setupRide(app, 'sos-1')
    const res = await request(app)
      .post(`/api/sr/rides/${ride.id}/sos`)
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ lat: DAMASCUS.lat, lng: DAMASCUS.lng, note: 'Feeling unsafe' })
    expect(res.status).toBe(201)
    expect(res.body.sosEvent.status).toBe('OPEN')
    expect(res.body.sosEvent.raisedByRole).toBe('RIDER')
    const listed = await request(app).get('/api/admin/sos').set('Authorization', `Bearer ${adminBearer}`)
    expect(listed.status, JSON.stringify(listed.body)).toBe(200)
    expect(listed.body.sos.some((e) => e.id === res.body.sosEvent.id)).toBe(true)
  })

  it('the assigned driver can also raise SOS (raisedByRole DRIVER)', async () => {
    const { driver, ride } = await setupRide(app, 'sos-2')
    await claim(app, driver.token, ride.id)
    const res = await request(app).post(`/api/sr/rides/${ride.id}/sos`).set('Authorization', `Bearer ${driver.token}`).send({})
    expect(res.status).toBe(201)
    expect(res.body.sosEvent.raisedByRole).toBe('DRIVER')
  })

  it('a non-party CANNOT raise SOS (403)', async () => {
    const { ride } = await setupRide(app, 'sos-3')
    const stranger = await registerUser(app, 'GUEST', 'sos-stranger')
    const res = await request(app).post(`/api/sr/rides/${ride.id}/sos`).set('Authorization', `Bearer ${stranger.token}`).send({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('RIDE_FORBIDDEN')
  })

  it('admin can resolve an OPEN SOS (TOCTOU-safe)', async () => {
    const { rider, ride } = await setupRide(app, 'sos-4')
    const raised = await request(app).post(`/api/sr/rides/${ride.id}/sos`).set('Authorization', `Bearer ${rider.token}`).send({})
    const id = raised.body.sosEvent.id
    const resolved = await request(app).patch(`/api/admin/sos/${id}/resolve`).set('Authorization', `Bearer ${adminBearer}`).send({ note: 'Called rider, safe' })
    expect(resolved.status).toBe(200)
    expect(resolved.body.sosEvent.status).toBe('RESOLVED')
    const again = await request(app).patch(`/api/admin/sos/${id}/resolve`).set('Authorization', `Bearer ${adminBearer}`).send({})
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('SOS_NOT_OPEN')
  })

  it('SOS list requires ADMIN/SUPPORT (a rider is 403)', async () => {
    const { rider } = await setupRide(app, 'sos-5')
    const res = await request(app).get('/api/admin/sos').set('Authorization', `Bearer ${rider.token}`)
    expect(res.status).toBe(403)
  })

  it('the assigned, verified driver can post location; the rider can read it back', async () => {
    const { rider, driver, ride } = await setupRide(app, 'loc-1')
    await claim(app, driver.token, ride.id)
    const post = await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${driver.token}`).send(DAMASCUS)
    expect(post.status).toBe(200)
    const read = await request(app).get(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${rider.token}`)
    expect(read.status).toBe(200)
    expect(read.body.location.lat).toBeCloseTo(DAMASCUS.lat, 4)
    expect(read.body.location.lng).toBeCloseTo(DAMASCUS.lng, 4)
  })

  it('a non-party CANNOT read the driver location (403)', async () => {
    const { driver, ride } = await setupRide(app, 'loc-2')
    await claim(app, driver.token, ride.id)
    await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${driver.token}`).send(DAMASCUS)
    const stranger = await registerUser(app, 'GUEST', 'loc-stranger')
    const res = await request(app).get(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${stranger.token}`)
    expect(res.status).toBe(403)
  })

  it('a driver NOT assigned to the ride cannot post location (404)', async () => {
    const { driver, ride } = await setupRide(app, 'loc-3')
    await claim(app, driver.token, ride.id)
    const otherDriver = await registerVerifiedDriver(app, 'loc-other-driver')
    const res = await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${otherDriver.token}`).send(DAMASCUS)
    expect(res.status).toBe(404)
  })

  it('a rider (non-driver) cannot post location (403 role gate)', async () => {
    const { rider, driver, ride } = await setupRide(app, 'loc-4')
    await claim(app, driver.token, ride.id)
    const res = await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${rider.token}`).send(DAMASCUS)
    expect(res.status).toBe(403)
  })

  it('location is rejected once the ride is no longer active (409)', async () => {
    const { rider, driver, ride } = await setupRide(app, 'loc-5')
    await claim(app, driver.token, ride.id)
    await setStatus(app, driver.token, ride.id, 'DRIVER_ARRIVING')
    await verifyPin(app, rider.token, driver.token, ride.id) // PIN gate before IN_PROGRESS
    await setStatus(app, driver.token, ride.id, 'IN_PROGRESS')
    await setStatus(app, driver.token, ride.id, 'COMPLETED')
    const res = await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${driver.token}`).send(DAMASCUS)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('RIDE_NOT_TRACKABLE')
  })

  it('rejects a SQL-injection-shaped coordinate with 400 before touching SQL', async () => {
    const { driver, ride } = await setupRide(app, 'loc-inj')
    await claim(app, driver.token, ride.id)
    const res = await request(app)
      .post(`/api/sr/rides/${ride.id}/location`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ lat: '33.5); DROP TABLE ride_requests;--', lng: 36.3 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_INVALID_COORDS')
  })

  it('rejects out-of-Syria coordinates (400)', async () => {
    const { driver, ride } = await setupRide(app, 'loc-oob')
    await claim(app, driver.token, ride.id)
    const res = await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${driver.token}`).send({ lat: 48.8, lng: 2.3 })
    expect(res.status).toBe(400)
  })

  it('rider mints a share token; the public watcher sees coarse status + location + ETA and NO PII', async () => {
    const { rider, driver, ride } = await setupRide(app, 'share-1')
    await claim(app, driver.token, ride.id)
    await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${driver.token}`).send(DAMASCUS)
    const share = await request(app).post(`/api/sr/rides/${ride.id}/share`).set('Authorization', `Bearer ${rider.token}`)
    expect(share.status).toBe(201)
    const token = share.body.share.token
    const watch = await request(app).get(`/api/sr/rides/shared/${token}`)
    expect(watch.status).toBe(200)
    expect(watch.body.trip.status).toBe('DRIVER_ON_THE_WAY')
    const blob = JSON.stringify(watch.body)
    expect(blob).not.toContain('@')
    expect(blob).not.toMatch(/riderId|driverId|email|phone|fareMinor|displayName/)
  })

  it('a non-rider cannot mint a share token (403)', async () => {
    const { driver, ride } = await setupRide(app, 'share-2')
    await claim(app, driver.token, ride.id)
    const res = await request(app).post(`/api/sr/rides/${ride.id}/share`).set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(403)
  })

  it('an unknown share token is 404', async () => {
    const res = await request(app).get('/api/sr/rides/shared/not-a-real-token')
    expect(res.status).toBe(404)
  })

  it('the rider can revoke a share link — the token stops resolving (404)', async () => {
    const { rider, driver, ride } = await setupRide(app, 'share-revoke')
    await claim(app, driver.token, ride.id)
    const share = await request(app).post(`/api/sr/rides/${ride.id}/share`).set('Authorization', `Bearer ${rider.token}`)
    const token = share.body.share.token
    expect((await request(app).get(`/api/sr/rides/shared/${token}`)).status).toBe(200)

    const revoke = await request(app).delete(`/api/sr/rides/${ride.id}/share`).set('Authorization', `Bearer ${rider.token}`)
    expect(revoke.status).toBe(200)
    expect(revoke.body.revoked).toBe(true)
    // the old link no longer resolves
    expect((await request(app).get(`/api/sr/rides/shared/${token}`)).status).toBe(404)
  })

  it('a non-rider cannot revoke a share link (403)', async () => {
    const { rider, driver, ride } = await setupRide(app, 'share-revoke-forbidden')
    await claim(app, driver.token, ride.id)
    await request(app).post(`/api/sr/rides/${ride.id}/share`).set('Authorization', `Bearer ${rider.token}`)
    const res = await request(app).delete(`/api/sr/rides/${ride.id}/share`).set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(403)
  })

  it('the rider gets a PII-safe driver card once assigned — first name, car, rating; NO contact PII', async () => {
    const { rider, driver, ride } = await setupRide(app, 'driver-card')
    await db().user.update({ where: { id: driver.user.id }, data: { displayName: 'Kareem Al-Halabi' } })
    await db().driverVehicle.create({
      data: { driverId: driver.user.id, make: 'Toyota', model: 'Corolla', year: 2019, plate: 'DAM-4412', color: 'Silver', category: 'SR Economy', status: 'APPROVED' },
    })
    await claim(app, driver.token, ride.id)

    const res = await request(app).get(`/api/sr/rides/${ride.id}/driver`).set('Authorization', `Bearer ${rider.token}`)
    expect(res.status).toBe(200)
    expect(res.body.driver.firstName).toBe('Kareem') // first name only, never the full legal identity
    expect(res.body.driver.vehicle.plate).toBe('DAM-4412')
    expect(res.body.driver.vehicle.make).toBe('Toyota')
    expect(res.body.driver.rating).toHaveProperty('average')
    // no contact PII anywhere in the payload
    const blob = JSON.stringify(res.body)
    expect(blob).not.toContain('@')
    expect(blob).not.toMatch(/email|phone|Al-Halabi|driverId|"id"/)
  })

  it('the driver card is null before a driver is assigned, and a non-party is 403', async () => {
    const { rider, ride } = await setupRide(app, 'driver-card-unassigned')
    const unassigned = await request(app).get(`/api/sr/rides/${ride.id}/driver`).set('Authorization', `Bearer ${rider.token}`)
    expect(unassigned.status).toBe(200)
    expect(unassigned.body.driver).toBeNull()

    const stranger = await registerUser(app, 'GUEST', 'driver-card-stranger')
    const forbidden = await request(app).get(`/api/sr/rides/${ride.id}/driver`).set('Authorization', `Bearer ${stranger.token}`)
    expect(forbidden.status).toBe(403)
  })

  it('a share link past its TTL stops resolving (410 SHARE_EXPIRED)', async () => {
    const { rider, driver, ride } = await setupRide(app, 'share-ttl')
    await claim(app, driver.token, ride.id)
    const share = await request(app).post(`/api/sr/rides/${ride.id}/share`).set('Authorization', `Bearer ${rider.token}`)
    const token = share.body.share.token
    // Age the token past the 12h TTL.
    await db().rideRequest.update({ where: { id: ride.id }, data: { shareTokenCreatedAt: new Date(Date.now() - 13 * 3600_000) } })
    const watch = await request(app).get(`/api/sr/rides/shared/${token}`)
    expect(watch.status).toBe(410)
    expect(watch.body.error.code).toBe('SHARE_EXPIRED')
    // Re-sharing mints a fresh, working token.
    const reshare = await request(app).post(`/api/sr/rides/${ride.id}/share`).set('Authorization', `Bearer ${rider.token}`)
    expect(reshare.body.share.token).not.toBe(token)
    expect((await request(app).get(`/api/sr/rides/shared/${reshare.body.share.token}`)).status).toBe(200)
  })
})
