import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { testApp } from '../support/testServer.mjs'

// Coverage for the DB-backed rate-limit store (RATE_LIMIT_STORE=db) used on serverless/multi-instance.
// The in-memory path is covered by test/unit/rate-limit.test.mjs + test/security/rate-limit-http.test.mjs;
// this proves the shared Postgres counter enforces the same limit and persists across (would-be
// separate) instances, keyed in a real table rather than a per-process Map.
describe('DB-backed rate-limit store enforces limits via a shared counter', () => {
  let app

  beforeAll(() => {
    app = testApp()
    process.env.RATE_LIMIT_STORE = 'db'
  })

  beforeEach(async () => {
    await db().rateLimitHit.deleteMany({})
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '3'
    process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS = '60000'
  })

  afterAll(async () => {
    // Restore shared test defaults so file run-order can't leak the DB store / low limit into others.
    delete process.env.RATE_LIMIT_STORE
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '1000'
    delete process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS
    await db().rateLimitHit.deleteMany({})
  })

  it('returns 429 once the shared per-IP limit is exceeded, and records the counter row', async () => {
    const attempt = () =>
      request(app).post('/api/auth/login').send({ email: 'nobody@sybnb.test', password: 'wrong-password' })

    const responses = []
    for (let i = 0; i < 4; i += 1) {
      responses.push(await attempt()) // eslint-disable-line no-await-in-loop
    }

    expect(responses[0].status).toBe(401) // wrong creds, but under the limit
    expect(responses[1].status).toBe(401)
    expect(responses[2].status).toBe(401)
    expect(responses[3].status).toBe(429)
    expect(responses[3].body.error.code).toBe('RATE_LIMITED')
    expect(Number(responses[3].headers['retry-after'])).toBeGreaterThan(0)

    // The counter lives in the shared table (not process memory) and counted every hit.
    const row = await db().rateLimitHit.findFirst({ where: { key: { startsWith: 'AUTH_LOGIN:' } } })
    expect(row).not.toBeNull()
    expect(row.count).toBeGreaterThanOrEqual(4)
  })

  it('opens a fresh allowance after the window resets', async () => {
    const attempt = () =>
      request(app).post('/api/auth/login').send({ email: 'nobody@sybnb.test', password: 'wrong-password' })

    for (let i = 0; i < 3; i += 1) await attempt() // eslint-disable-line no-await-in-loop
    expect((await attempt()).status).toBe(429)

    // Deterministically age the window past its reset instead of racing a real sleep against the
    // HTTP round-trip time. Use Postgres now() (not a JS Date) so the aged value is tz-consistent
    // with the limiter's own now()-based comparison. The next hit must start a fresh window.
    await db().$executeRaw`UPDATE rate_limit_hits SET reset_at = now() - interval '1 hour'`

    expect((await attempt()).status).toBe(401) // window elapsed -> allowed again
  })
})
