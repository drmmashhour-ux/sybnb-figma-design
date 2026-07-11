import request from 'supertest'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { __resetRateLimitsForTests } from '../../server/lib/rate-limit.mjs'
import { testApp } from '../support/testServer.mjs'

// End-to-end wiring check for F-08: confirms the RATE_LIMIT_RULES table in server/index.mjs is
// actually connected to a real route (unit/rate-limit.test.mjs already covers the limiter
// algorithm itself in isolation). Overrides the AUTH_LOGIN limit via env so this runs in
// milliseconds instead of needing 10 real requests against the production default.
describe('rate limiting wired to POST /api/auth/login', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  beforeEach(() => {
    __resetRateLimitsForTests()
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '3'
    process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS = '60000'
  })

  afterEach(() => {
    // Restore the generous test-wide default (see test/support/setup.mjs) rather than deleting
    // the override outright, so later test files aren't affected by this file's run order.
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '1000'
    delete process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS
    __resetRateLimitsForTests()
  })

  it('returns 429 with a retry-after header once the per-IP limit is exceeded', async () => {
    const attempt = () =>
      request(app).post('/api/auth/login').send({ email: 'nobody@sybnb.test', password: 'wrong-password' })

    const responses = []
    for (let i = 0; i < 4; i += 1) {
      responses.push(await attempt()) // eslint-disable-line no-await-in-loop
    }

    expect(responses[0].status).toBe(401) // invalid credentials, but under the limit
    expect(responses[1].status).toBe(401)
    expect(responses[2].status).toBe(401)
    expect(responses[3].status).toBe(429)
    expect(responses[3].body.error.code).toBe('RATE_LIMITED')
    expect(Number(responses[3].headers['retry-after'])).toBeGreaterThan(0)
  })

  it('still applies the standard security headers to a 429 response', async () => {
    let last
    for (let i = 0; i < 4; i += 1) {
      last = await request(app) // eslint-disable-line no-await-in-loop
        .post('/api/auth/login')
        .send({ email: 'nobody2@sybnb.test', password: 'wrong-password' })
    }
    expect(last.status).toBe(429)
    expect(last.headers['x-content-type-options']).toBe('nosniff')
  })
})
