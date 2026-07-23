import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { __resetRateLimitsForTests } from '../../server/lib/rate-limit.mjs'
import { cleanupTestUsers, testApp, trackTestUser } from '../support/testServer.mjs'

// SYB-007 (Wave 0) — the unauthenticated /api/auth/checkout-guest endpoint silently creates a real
// isolated device account on first use. Before this change it was entirely unthrottled, so a script
// could mint unlimited accounts (and, via SYB-002, pin inventory) with no cost. This adds a per-IP
// rate limit ONLY to that route — no auth redesign, no change to the account-creation logic itself.
//
// Scope guard (owner decision): rate limiting only; do not modify booking, wallet, or registration
// architecture. The device-account creation path is unchanged; a limiter sits in front of it.

const RULE_MAX_ENV = 'RATE_LIMIT_AUTH_CHECKOUT_GUEST_PER_IP_MAX'
let priorMax

function deviceId(i) {
  // Valid opaque id per the route's /^[a-zA-Z0-9-]{8,100}$/ rule; distinct per call so we exercise
  // the PER-IP bucket (every device from one IP counts), not a per-device path.
  return `syb007-device-${String(i).padStart(6, '0')}`
}

const checkout = (app, i) =>
  request(app).post('/api/auth/checkout-guest').send({ deviceId: deviceId(i), source: 'stays' })

describe('SYB-007 — checkout-guest is rate limited per IP', () => {
  let app

  beforeAll(() => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  beforeEach(() => {
    __resetRateLimitsForTests()
    priorMax = process.env[RULE_MAX_ENV]
    // Deterministic low ceiling for the test; production default is generous. Config is read at
    // call time, so this override takes effect immediately without re-importing.
    process.env[RULE_MAX_ENV] = '3'
  })
  afterEach(() => {
    if (priorMax === undefined) delete process.env[RULE_MAX_ENV]
    else process.env[RULE_MAX_ENV] = priorMax
    __resetRateLimitsForTests()
  })

  it('admits ordinary use below the limit and returns real device accounts', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await checkout(app, i)
      expect(res.status).toBe(200)
      expect(res.body.token).toBeTruthy()
      trackTestUser(res.body.user.id)
    }
  })

  it('blocks the (limit+1)th request from the same IP with a truthful 429 + retry-after', async () => {
    for (let i = 0; i < 3; i++) {
      const ok = await checkout(app, i)
      expect(ok.status).toBe(200)
      trackTestUser(ok.body.user.id)
    }
    const blocked = await checkout(app, 99)
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('RATE_LIMITED')
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    // The message carries actionable retry guidance, not a bare rejection.
    expect(blocked.body.error.message).toMatch(/\d+\s*second/i)
  })

  it('does not throttle a validation failure into a rate-limit false positive', async () => {
    // A malformed deviceId must still be a 400 (its own error), proving the limiter runs cleanly
    // alongside the existing validation rather than masking it.
    const res = await request(app).post('/api/auth/checkout-guest').send({ deviceId: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('DEVICE_ID_INVALID')
  })

  it('recovers after the buckets reset (limit is a window, not a permanent ban)', async () => {
    for (let i = 0; i < 3; i++) { const r = await checkout(app, i); trackTestUser(r.body.user.id) }
    expect((await checkout(app, 99)).status).toBe(429)
    __resetRateLimitsForTests()
    const after = await checkout(app, 100)
    expect(after.status).toBe(200)
    trackTestUser(after.body.user.id)
  })
})
