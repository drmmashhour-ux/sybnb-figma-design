import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { recordWalletEntry } from '../../server/lib/finance-ledger.mjs'
import { approveDriverForRides, cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Pickup PIN: one code per ride, rider-only visible, driver enters it to confirm the correct rider;
// the trip cannot start (IN_PROGRESS) until it matches. Assumes the SR money layer's balance gate — so
// riders are funded. If the money layer is NOT integrated, remove fundRider().
async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  if (role === 'DRIVER') await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role, email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { token: res.body.token, user: res.body.user }
}

async function fundRider(userId, amountMinor = 1_000_000, currency = 'SYP') {
  await db().$transaction(async (tx) => {
    await recordWalletEntry(tx, { userId, type: 'CREDIT', amountMinor, currency, referenceType: 'wallet_topup', referenceId: `fund-${userId}`, keyParts: ['fund', userId], note: 'test' })
  }).catch(() => {})
}

async function makeDriver(app, label) {
  const driver = await registerUser(app, 'DRIVER', label)
  await approveDriverForRides(driver.user.id)
  return driver
}

async function requestAndClaim(app, rider, driver, label) {
  const created = await request(app).post('/api/sr/rides').set('Authorization', `Bearer ${rider.token}`).send({ pickup: `A ${label}`, dropoff: `B ${label}`, category: 'SR Economy' })
  const rideId = created.body.ride.id
  await request(app).patch(`/api/sr/rides/${rideId}/claim`).set('Authorization', `Bearer ${driver.token}`)
  await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'DRIVER_ARRIVING' })
  return rideId
}

describe('SR pickup PIN verification', () => {
  let app
  beforeAll(() => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('the rider sees the PIN; the driver does not; wrong code is rejected; correct code verifies and unlocks the trip', async () => {
    const rider = await registerUser(app, 'GUEST', 'pin-rider')
    const driver = await makeDriver(app, 'pin-driver')
    await fundRider(rider.user.id)
    const rideId = await requestAndClaim(app, rider, driver, 'pin-1')

    // rider sees the pin
    const riderView = await request(app).get(`/api/sr/rides/${rideId}`).set('Authorization', `Bearer ${rider.token}`)
    expect(riderView.status).toBe(200)
    const pin = riderView.body.ride.pickupPin
    expect(pin).toMatch(/^\d{4}$/)

    // driver does NOT see the pin
    const driverView = await request(app).get(`/api/sr/rides/${rideId}`).set('Authorization', `Bearer ${driver.token}`)
    expect(driverView.body.ride.pickupPin).toBeFalsy()

    // trip can't start before verification
    const early = await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'IN_PROGRESS' })
    expect(early.status).toBe(409)
    expect(early.body.error.code).toBe('PICKUP_NOT_VERIFIED')

    // wrong code
    const wrong = pin === '0000' ? '1111' : '0000'
    const bad = await request(app).post(`/api/sr/rides/${rideId}/verify-pin`).set('Authorization', `Bearer ${driver.token}`).send({ pin: wrong })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('PIN_MISMATCH')

    // correct code
    const ok = await request(app).post(`/api/sr/rides/${rideId}/verify-pin`).set('Authorization', `Bearer ${driver.token}`).send({ pin })
    expect(ok.status).toBe(200)
    expect(ok.body.verified).toBe(true)

    // now the trip can start
    const start = await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'IN_PROGRESS' })
    expect(start.status).toBe(200)
  })

  it('locks after 5 wrong attempts', async () => {
    const rider = await registerUser(app, 'GUEST', 'pin-rider2')
    const driver = await makeDriver(app, 'pin-driver2')
    await fundRider(rider.user.id)
    const rideId = await requestAndClaim(app, rider, driver, 'pin-2')
    const riderView = await request(app).get(`/api/sr/rides/${rideId}`).set('Authorization', `Bearer ${rider.token}`)
    const pin = riderView.body.ride.pickupPin
    const wrong = pin === '0000' ? '1111' : '0000'
    for (let i = 0; i < 5; i++) {
      await request(app).post(`/api/sr/rides/${rideId}/verify-pin`).set('Authorization', `Bearer ${driver.token}`).send({ pin: wrong })
    }
    const locked = await request(app).post(`/api/sr/rides/${rideId}/verify-pin`).set('Authorization', `Bearer ${driver.token}`).send({ pin: wrong })
    expect(locked.status).toBe(429)
    expect(locked.body.error.code).toBe('PIN_LOCKED')
  })
})
