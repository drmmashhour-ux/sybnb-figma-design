import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanupTestUsers, testApp, trackTestUser } from '../support/testServer.mjs'

// SR-as-Uber (frictionless per-device guest identity): /api/auth/checkout-guest previously
// resolved every anonymous caller to one single shared account (checkout-guest@sybnb.local).
// These tests prove the fix: each distinct deviceId gets its own isolated account, the same
// deviceId reused returns the same account, and malformed/missing deviceId is rejected rather
// than silently falling back to a shared identity.
describe('POST /api/auth/checkout-guest device-id isolation', () => {
  const app = testApp()

  afterAll(async () => {
    await cleanupTestUsers()
  })

  function checkoutGuest(deviceId) {
    return request(app).post('/api/auth/checkout-guest').send({ source: 'guest-checkout', deviceId })
  }

  it('gives two different device ids two different, isolated accounts', async () => {
    const deviceA = `device-a-${Date.now().toString(36)}`
    const deviceB = `device-b-${Date.now().toString(36)}`

    const resA = await checkoutGuest(deviceA)
    const resB = await checkoutGuest(deviceB)

    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)
    trackTestUser(resA.body.user.id)
    trackTestUser(resB.body.user.id)

    expect(resA.body.user.id).not.toBe(resB.body.user.id)
    expect(resA.body.token).not.toBe(resB.body.token)
  })

  it('returns the same account when the same device id is reused', async () => {
    const deviceId = `device-reuse-${Date.now().toString(36)}`

    const first = await checkoutGuest(deviceId)
    const second = await checkoutGuest(deviceId)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    trackTestUser(first.body.user.id)

    expect(first.body.user.id).toBe(second.body.user.id)
  })

  it('rejects a missing device id', async () => {
    const res = await checkoutGuest(undefined)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_REQUIRED')
  })

  it('rejects a malformed device id', async () => {
    const res = await checkoutGuest('not a valid id!!')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('DEVICE_ID_INVALID')
  })

  it('rejects an unknown extra field in the request body', async () => {
    const res = await request(app)
      .post('/api/auth/checkout-guest')
      .send({ source: 'guest-checkout', deviceId: `device-extra-${Date.now().toString(36)}`, extra: 'nope' })
    expect(res.status).toBe(400)
  })
})
