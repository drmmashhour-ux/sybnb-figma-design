import request from 'supertest'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { __resetRateLimitsForTests } from '../../server/lib/rate-limit.mjs'
import { testApp, uniqueTestEmail } from '../support/testServer.mjs'

// Resend hardening item 8: a SECOND limit keyed on the (hashed) recipient email, IN ADDITION to the
// existing per-IP limit, so a rotating-IP attacker cannot email-bomb one address. Uses the same
// distributed limiter (Upstash in prod; in-memory in tests). The per-IP limit is raised out of the
// way here so the test isolates the new per-email dimension.
describe('per-email rate limiting on POST /api/auth/email-code/send (item 8)', () => {
  let app

  beforeAll(() => { app = testApp() })

  beforeEach(() => {
    __resetRateLimitsForTests()
    process.env.RATE_LIMIT_AUTH_EMAIL_CODE_SEND_MAX = '1000' // keep the per-IP limit out of the way
    process.env.RATE_LIMIT_AUTH_EMAIL_CODE_SEND_PER_EMAIL_MAX = '2'
    process.env.RATE_LIMIT_AUTH_EMAIL_CODE_SEND_PER_EMAIL_WINDOW_MS = '900000'
  })

  afterEach(() => {
    process.env.RATE_LIMIT_AUTH_EMAIL_CODE_SEND_MAX = '1000'
    process.env.RATE_LIMIT_AUTH_EMAIL_CODE_SEND_PER_EMAIL_MAX = '1000'
    delete process.env.RATE_LIMIT_AUTH_EMAIL_CODE_SEND_PER_EMAIL_WINDOW_MS
    __resetRateLimitsForTests()
  })

  const send = (email) => request(app).post('/api/auth/email-code/send').send({ email, purpose: 'guest-signup' })

  it('blocks the 3rd send to one address (limit=2) while other addresses are unaffected', async () => {
    const email = uniqueTestEmail('bombed')
    const other = uniqueTestEmail('other')

    const first = await send(email)
    const second = await send(email)
    const third = await send(email)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(third.status).toBe(429)
    expect(third.body.error.code).toBe('RATE_LIMITED')
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0)

    const differentAddress = await send(other)
    expect(differentAddress.status).toBe(200) // own bucket
  })

  it('shares one bucket across case variants of the same address (normalized lowercase)', async () => {
    const lower = uniqueTestEmail('casetest') // already lowercase
    const upper = lower.toUpperCase()

    const a = await send(lower)
    const b = await send(upper)
    const c = await send(lower)

    expect(a.status).toBe(200)
    expect(b.status).toBe(200) // 2nd hit on the SAME normalized address
    expect(c.status).toBe(429) // limit=2 reached via the two equivalent forms
  })
})
