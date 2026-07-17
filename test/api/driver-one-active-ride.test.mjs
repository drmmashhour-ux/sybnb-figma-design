import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { approveDriverForRides, cleanupTestUsers, fundWallet, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  if (role === 'HOST' || role === 'DRIVER') await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({
    role,
    email,
    password: 'correct-horse-battery',
  })
  trackTestUser(res.body.user.id)
  // SR gates (015/016): a claiming driver must be road-ready; a rider must be funded past the balance gate.
  if (role === 'DRIVER') await approveDriverForRides(res.body.user.id)
  if (role === 'GUEST') await fundWallet(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function requestRide(app, riderToken, label) {
  const res = await request(app)
    .post('/api/sr/rides')
    .set('Authorization', `Bearer ${riderToken}`)
    .send({ pickup: `Malki ${label}`, dropoff: `Mezzeh ${label}`, category: 'SR Economy' })

  expect(res.status).toBe(201)
  return res.body.ride
}

describe('SR Rule 2: one driver can have only one active ride', () => {
  let app
  let rider
  let driver

  beforeAll(async () => {
    app = testApp()
    rider = await registerUser(app, 'GUEST', 'rule2-rider')
    driver = await registerUser(app, 'DRIVER', 'rule2-driver')
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('rejects a second self-claim while the driver already has an active ride', async () => {
    const firstRide = await requestRide(app, rider.token, 'active-1')
    const secondRide = await requestRide(app, rider.token, 'active-2')

    const firstClaim = await request(app).patch(`/api/sr/rides/${firstRide.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
    const secondClaim = await request(app).patch(`/api/sr/rides/${secondRide.id}/claim`).set('Authorization', `Bearer ${driver.token}`)

    expect(firstClaim.status).toBe(200)
    expect(secondClaim.status).toBe(409)
    expect(secondClaim.body.error.code).toBe('DRIVER_HAS_ACTIVE_RIDE')
  })
})
