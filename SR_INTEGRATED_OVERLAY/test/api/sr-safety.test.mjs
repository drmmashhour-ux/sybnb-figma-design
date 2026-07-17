import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import {
  cleanupTestUsers,
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
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  if (role === 'DRIVER') await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role, email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function registerVerifiedDriver(app, label) {
  const driver = await registerUser(app, 'DRIVER', label)
  await db().user.update({ where: { id: driver.user.id }, data: { idDocumentStatus: 'APPROVED' } })
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

async function setStatus(app, driverToken, rideId, status) {
  return request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driverToken}`).send({ status })
}

describe('SR SAFETY layer: SOS, live location, trip share', () => {
  let app
  let rider
  let driver
  let adminBearer

  beforeAll(async () => {
    app = testApp()
    rider = await registerUser(app, 'GUEST', 'safety-rider')
    driver = await registerVerifiedDriver(app, 'safety-driver')
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
    const ride = await requestRide(app, rider.token, 'sos-1')
    const res = await request(app)
      .post(`/api/sr/rides/${ride.id}/sos`)
      .set('Authorization', `Bearer ${rider.token}`)
      .send({ lat: DAMASCUS.lat, lng: DAMASCUS.lng, note: 'Feeling unsafe' })
    expect(res.status).toBe(201)
    expect(res.body.sosEvent.status).toBe('OPEN')
    expect(res.body.sosEvent.raisedByRole).toBe('RIDER')
    const listed = await request(app).get('/api/admin/sos').set('Authorization', `Bearer ${adminBearer}`)
    expect(listed.status).toBe(200)
    expect(listed.body.sos.some((e) => e.id === res.body.sosEvent.id)).toBe(true)
  })

  it('the assigned driver can also raise SOS (raisedByRole DRIVER)', async () => {
    const ride = await requestRide(app, rider.token, 'sos-2')
    await claim(app, driver.token, ride.id)
    const res = await request(app).post(`/api/sr/rides/${ride.id}/sos`).set('Authorization', `Bearer ${driver.token}`).send({})
    expect(res.status).toBe(201)
    expect(res.body.sosEvent.raisedByRole).toBe('DRIVER')
  })

  it('a non-party CANNOT raise SOS (403)', async () => {
    const ride = await requestRide(app, rider.token, 'sos-3')
    const stranger = await registerUser(app, 'GUEST', 'sos-stranger')
    const res = await request(app).post(`/api/sr/rides/${ride.id}/sos`).set('Authorization', `Bearer ${stranger.token}`).send({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('RIDE_FORBIDDEN')
  })

  it('admin can resolve an OPEN SOS (TOCTOU-safe)', async () => {
    const ride = await requestRide(app, rider.token, 'sos-4')
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
    const res = await request(app).get('/api/admin/sos').set('Authorization', `Bearer ${rider.token}`)
    expect(res.status).toBe(403)
  })

  it('the assigned, verified driver can post location; the rider can read it back', async () => {
    const ride = await requestRide(app, rider.token, 'loc-1')
    await claim(app, driver.token, ride.id)
    const post = await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${driver.token}`).send(DAMASCUS)
    expect(post.status).toBe(200)
    const read = await request(app).get(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${rider.token}`)
    expect(read.status).toBe(200)
    expect(read.body.location.lat).toBeCloseTo(DAMASCUS.lat, 4)
    expect(read.body.location.lng).toBeCloseTo(DAMASCUS.lng, 4)
  })

  it('a non-party CANNOT read the driver location (403)', async () => {
    const ride = await requestRide(app, rider.token, 'loc-2')
    await claim(app, driver.token, ride.id)
    await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${driver.token}`).send(DAMASCUS)
    const stranger = await registerUser(app, 'GUEST', 'loc-stranger')
    const res = await request(app).get(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${stranger.token}`)
    expect(res.status).toBe(403)
  })

  it('a driver NOT assigned to the ride cannot post location (404)', async () => {
    const ride = await requestRide(app, rider.token, 'loc-3')
    await claim(app, driver.token, ride.id)
    const otherDriver = await registerVerifiedDriver(app, 'loc-other-driver')
    const res = await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${otherDriver.token}`).send(DAMASCUS)
    expect(res.status).toBe(404)
  })

  it('a rider (non-driver) cannot post location (403 role gate)', async () => {
    const ride = await requestRide(app, rider.token, 'loc-4')
    await claim(app, driver.token, ride.id)
    const res = await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${rider.token}`).send(DAMASCUS)
    expect(res.status).toBe(403)
  })

  it('location is rejected once the ride is no longer active (409)', async () => {
    const ride = await requestRide(app, rider.token, 'loc-5')
    await claim(app, driver.token, ride.id)
    await setStatus(app, driver.token, ride.id, 'DRIVER_ARRIVING')
    await setStatus(app, driver.token, ride.id, 'IN_PROGRESS')
    await setStatus(app, driver.token, ride.id, 'COMPLETED')
    const res = await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${driver.token}`).send(DAMASCUS)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('RIDE_NOT_TRACKABLE')
  })

  it('rejects a SQL-injection-shaped coordinate with 400 before touching SQL', async () => {
    const ride = await requestRide(app, rider.token, 'loc-inj')
    await claim(app, driver.token, ride.id)
    const res = await request(app)
      .post(`/api/sr/rides/${ride.id}/location`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ lat: '33.5); DROP TABLE ride_requests;--', lng: 36.3 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_INVALID_COORDS')
  })

  it('rejects out-of-Syria coordinates (400)', async () => {
    const ride = await requestRide(app, rider.token, 'loc-oob')
    await claim(app, driver.token, ride.id)
    const res = await request(app).post(`/api/sr/rides/${ride.id}/location`).set('Authorization', `Bearer ${driver.token}`).send({ lat: 48.8, lng: 2.3 })
    expect(res.status).toBe(400)
  })

  it('rider mints a share token; the public watcher sees coarse status + location + ETA and NO PII', async () => {
    const ride = await requestRide(app, rider.token, 'share-1')
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
    const ride = await requestRide(app, rider.token, 'share-2')
    await claim(app, driver.token, ride.id)
    const res = await request(app).post(`/api/sr/rides/${ride.id}/share`).set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(403)
  })

  it('an unknown share token is 404', async () => {
    const res = await request(app).get('/api/sr/rides/shared/not-a-real-token')
    expect(res.status).toBe(404)
  })
})
