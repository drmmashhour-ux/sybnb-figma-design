import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  if (role === 'DRIVER' || role === 'HOST') await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role, email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function requestRide(app, riderToken, label) {
  const res = await request(app)
    .post('/api/sr/rides')
    .set('Authorization', `Bearer ${riderToken}`)
    .send({ pickup: `Malki ${label}`, dropoff: `Mezzeh ${label}`, category: 'SR Economy' })
  return res.body.ride
}

async function approveId(userId) {
  await db().user.update({ where: { id: userId }, data: { idDocumentStatus: 'APPROVED', idDocumentRef: 'test-ref' } })
}

async function makeRoadReady(userId) {
  await approveId(userId)
  for (const type of ['LICENSE', 'VEHICLE_REGISTRATION']) {
    await db().driverDocument.upsert({
      where: { driverUserId_type: { driverUserId: userId, type } },
      create: { driverUserId: userId, type, assetUrl: `${'0'.repeat(8)}-0000-4000-8000-000000000000.pdf`, status: 'APPROVED' },
      update: { status: 'APPROVED' },
    })
  }
}

async function completeRideBetween(app, rider, driver, label) {
  await makeRoadReady(driver.user.id)
  const ride = await requestRide(app, rider.token, label)
  await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
  for (const status of ['DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED']) {
    await request(app).patch(`/api/driver/rides/${ride.id}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status })
  }
  return ride
}

describe('SR TRUST layer', () => {
  let app
  let adminToken

  beforeAll(async () => {
    app = testApp()
    const admin = await db().user.create({
      data: {
        email: uniqueTestEmail('sr-trust-admin'),
        displayName: 'Trust Admin',
        referralCode: uniqueTestReferralCode(),
        roles: { create: { role: 'ADMIN' } },
      },
      include: { roles: true },
    })
    trackTestUser(admin.id)
    adminToken = createSessionToken(admin)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a driver cannot work rides until BOTH license and vehicle registration are approved', async () => {
    const rider = await registerUser(app, 'GUEST', 'gate-rider')
    const driver = await registerUser(app, 'DRIVER', 'gate-driver')
    await approveId(driver.user.id)
    const ride = await requestRide(app, rider.token, 'gate-1')
    const idOnly = await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
    expect(idOnly.status).toBe(403)
    expect(idOnly.body.error.code).toBe('DRIVER_NOT_ROAD_READY')
    await db().driverDocument.create({ data: { driverUserId: driver.user.id, type: 'LICENSE', assetUrl: 'x', status: 'APPROVED' } })
    const licenseOnly = await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
    expect(licenseOnly.status).toBe(403)
    await db().driverDocument.create({ data: { driverUserId: driver.user.id, type: 'VEHICLE_REGISTRATION', assetUrl: 'y', status: 'APPROVED' } })
    const ok = await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
    expect(ok.status).toBe(200)
    expect(ok.body.ride.status).toBe('DRIVER_ASSIGNED')
  })

  it('a rider cannot read a driver document file (only owner or ADMIN/SUPPORT)', async () => {
    const driver = await registerUser(app, 'DRIVER', 'doc-driver')
    const uploaded = await request(app)
      .post('/api/driver/documents')
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'LICENSE', fileBase64: Buffer.from('fake-license').toString('base64'), mimeType: 'application/pdf' })
    expect(uploaded.status).toBe(201)
    const documentId = uploaded.body.document.id
    expect(uploaded.body.document.assetUrl).toBeUndefined()
    const rider = await registerUser(app, 'GUEST', 'doc-rider')
    const riderView = await request(app).get(`/api/driver/documents/${documentId}/file`).set('Authorization', `Bearer ${rider.token}`)
    expect(riderView.status).toBe(403)
    const ownerView = await request(app).get(`/api/driver/documents/${documentId}/file`).set('Authorization', `Bearer ${driver.token}`)
    expect(ownerView.status).toBe(200)
    const adminView = await request(app).get(`/api/admin/driver-documents/${documentId}/file`).set('Authorization', `Bearer ${adminToken}`)
    expect(adminView.status).toBe(200)
  })

  it('ride messaging is limited to the two parties, only while active, no PII in payload', async () => {
    const rider = await registerUser(app, 'GUEST', 'msg-rider')
    const driver = await registerUser(app, 'DRIVER', 'msg-driver')
    await makeRoadReady(driver.user.id)
    const ride = await requestRide(app, rider.token, 'msg-1')
    await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
    const send = await request(app).post(`/api/sr/rides/${ride.id}/messages`).set('Authorization', `Bearer ${rider.token}`).send({ body: 'I am at the blue gate.' })
    expect(send.status).toBe(201)
    expect(send.body.message.sender.email).toBeUndefined()
    const driverRead = await request(app).get(`/api/sr/rides/${ride.id}/messages`).set('Authorization', `Bearer ${driver.token}`)
    expect(driverRead.status).toBe(200)
    expect(JSON.stringify(driverRead.body)).not.toContain(rider.email)
    const stranger = await registerUser(app, 'GUEST', 'msg-stranger')
    const strangerRead = await request(app).get(`/api/sr/rides/${ride.id}/messages`).set('Authorization', `Bearer ${stranger.token}`)
    expect(strangerRead.status).toBe(403)
    for (const status of ['DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED']) {
      await request(app).patch(`/api/driver/rides/${ride.id}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status })
    }
    const afterComplete = await request(app).post(`/api/sr/rides/${ride.id}/messages`).set('Authorization', `Bearer ${rider.token}`).send({ body: 'too late' })
    expect(afterComplete.status).toBe(400)
    expect(afterComplete.body.error.code).toBe('RIDE_MESSAGING_NOT_ACTIVE')
  })

  it('rating requires COMPLETED, rejects a stranger, allows only one per rater', async () => {
    const rider = await registerUser(app, 'GUEST', 'rate-rider')
    const driver = await registerUser(app, 'DRIVER', 'rate-driver')
    await makeRoadReady(driver.user.id)
    const activeRide = await requestRide(app, rider.token, 'rate-active')
    await request(app).patch(`/api/sr/rides/${activeRide.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
    const early = await request(app).post(`/api/sr/rides/${activeRide.id}/rate`).set('Authorization', `Bearer ${rider.token}`).send({ stars: 5 })
    expect(early.status).toBe(400)
    expect(early.body.error.code).toBe('RIDE_NOT_COMPLETED')
    const ride = await completeRideBetween(app, rider, driver, 'rate-done')
    const stranger = await registerUser(app, 'GUEST', 'rate-stranger')
    const strangerRate = await request(app).post(`/api/sr/rides/${ride.id}/rate`).set('Authorization', `Bearer ${stranger.token}`).send({ stars: 1 })
    expect(strangerRate.status).toBe(403)
    const first = await request(app).post(`/api/sr/rides/${ride.id}/rate`).set('Authorization', `Bearer ${rider.token}`).send({ stars: 5, comment: 'great' })
    expect(first.status).toBe(201)
    const second = await request(app).post(`/api/sr/rides/${ride.id}/rate`).set('Authorization', `Bearer ${rider.token}`).send({ stars: 4 })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('RIDE_ALREADY_RATED')
    const summary = await request(app).get(`/api/sr/users/${driver.user.id}/rating`).set('Authorization', `Bearer ${rider.token}`)
    expect(summary.status).toBe(200)
    expect(summary.body.rating).toEqual({ average: 5, count: 1 })
  })

  it('a safety-flagged pair is never re-matched (claim and admin-assign both refuse)', async () => {
    const rider = await registerUser(app, 'GUEST', 'safety-rider')
    const driver = await registerUser(app, 'DRIVER', 'safety-driver')
    const ride = await completeRideBetween(app, rider, driver, 'safety-1')
    const flagged = await request(app).post(`/api/sr/rides/${ride.id}/rate`).set('Authorization', `Bearer ${rider.token}`).send({ stars: 1, safetyFlag: true, comment: 'unsafe' })
    expect(flagged.status).toBe(201)
    const nextRide = await requestRide(app, rider.token, 'safety-2')
    const claim = await request(app).patch(`/api/sr/rides/${nextRide.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
    expect(claim.status).toBe(409)
    expect(claim.body.error.code).toBe('RIDE_SAFETY_BLOCK')
    const assign = await request(app).patch(`/api/sr/rides/${nextRide.id}/assign-driver`).set('Authorization', `Bearer ${adminToken}`).send({ driverId: driver.user.id })
    expect(assign.status).toBe(409)
    const cleanDriver = await registerUser(app, 'DRIVER', 'safety-clean')
    await makeRoadReady(cleanDriver.user.id)
    const cleanClaim = await request(app).patch(`/api/sr/rides/${nextRide.id}/claim`).set('Authorization', `Bearer ${cleanDriver.token}`)
    expect(cleanClaim.status).toBe(200)
  })
})
