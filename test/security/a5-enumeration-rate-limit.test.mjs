import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { __resetRateLimitsForTests } from '../../server/lib/rate-limit.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// A5 (Finding 8) — rate-limiting + account enumeration. The journey's probe was inconclusive because a
// per-email 429 (from the real email's prior sends) masked the signal. This pins it down:
//   (1) the auth endpoints (login / email-code send / password-reset) are rate-limited (→ 429);
//   (2) send-code + password-reset are EXISTENCE-AGNOSTIC — a non-existent email yields the SAME status
//       AND body shape as an existing one (no enumeration oracle);
//   (3) the clean re-test with two FRESH emails (one seeded, one not) is indistinguishable once the
//       rate limit is controlled for.

const PASSWORD = 'correct-horse-battery'

// Status + the SET of top-level body keys (not values) — an enumeration oracle would differ here.
function bodyShape(res) {
  return { status: res.status, keys: Object.keys(res.body || {}).sort() }
}
async function seedUser(email) {
  const u = await db().user.create({
    data: { email, passwordHash: hashPassword(PASSWORD), displayName: 'A5', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'GUEST' } } },
  })
  trackTestUser(u.id)
  return u
}

describe('A5 — rate-limiting + account enumeration (Finding 8)', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  beforeEach(() => {
    __resetRateLimitsForTests()
  })
  afterEach(() => {
    __resetRateLimitsForTests()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  // ---- (1) rate limiting ----
  describe('rate limiting of the auth endpoints', () => {
    beforeEach(() => {
      process.env.RATE_LIMIT_AUTH_EMAIL_CODE_SEND_MAX = '3'
      process.env.RATE_LIMIT_AUTH_EMAIL_CODE_SEND_WINDOW_MS = '60000'
      __resetRateLimitsForTests()
    })
    afterEach(() => {
      process.env.RATE_LIMIT_AUTH_EMAIL_CODE_SEND_MAX = '1000'
      delete process.env.RATE_LIMIT_AUTH_EMAIL_CODE_SEND_WINDOW_MS
      __resetRateLimitsForTests()
    })

    it('POST /api/auth/email-code/send returns 429 RATE_LIMITED once the per-IP limit is exceeded', async () => {
      const base = uniqueTestEmail('a5-rl')
      const responses = []
      // distinct emails each time so the PER-IP limiter (not the per-email one) is what trips
      for (let i = 0; i < 4; i++) {
        responses.push(await request(app).post('/api/auth/email-code/send').send({ email: `${i}.${base}`, purpose: 'password-reset' }))
      }
      expect(responses.slice(0, 3).every((r) => r.status === 200), 'first 3 allowed').toBe(true)
      expect(responses[3].status).toBe(429)
      expect(responses[3].body.error?.code).toBe('RATE_LIMITED')
      expect(responses[3].headers['retry-after']).toBeTruthy()
    })
  })

  // ---- (2) + (3) account enumeration: existence-agnostic responses ----
  describe('account enumeration is not possible (existence-agnostic responses)', () => {
    let existingEmail
    beforeAll(async () => {
      existingEmail = uniqueTestEmail('a5-exists')
      await seedUser(existingEmail)
    })

    it('(2) email-code/send: a NON-existent email returns the SAME status + shape as an EXISTING one', async () => {
      const existing = await request(app).post('/api/auth/email-code/send').send({ email: existingEmail, purpose: 'password-reset' })
      const ghost = await request(app).post('/api/auth/email-code/send').send({ email: uniqueTestEmail('a5-ghost'), purpose: 'password-reset' })
      expect(existing.status).toBe(200)
      expect(bodyShape(ghost)).toEqual(bodyShape(existing))
    })

    it('(2) password-reset: a NON-existent email returns the SAME status + shape as an EXISTING one', async () => {
      // Full forgot-password for each: send + verify a password-reset code, then reset. Both must be
      // {ok:true} — the reset uses updateMany (silent on 0 rows), so a ghost email is indistinguishable.
      async function forgotPassword(email) {
        const send = await request(app).post('/api/auth/email-code/send').send({ email, purpose: 'password-reset' })
        await request(app).post('/api/auth/email-code/verify').send({ email, code: send.body.devCode, purpose: 'password-reset' })
        return request(app).post('/api/auth/password-reset').send({ email, newPassword: 'brand-new-passphrase-9' })
      }
      const existing = await forgotPassword(existingEmail)
      const ghost = await forgotPassword(uniqueTestEmail('a5-ghost2'))
      expect(existing.status).toBe(200)
      expect(bodyShape(ghost)).toEqual(bodyShape(existing))
    })

    it('(3) clean re-test: two FRESH emails (seeded vs not), rate-limit controlled, are indistinguishable', async () => {
      const seeded = uniqueTestEmail('a5-seeded')
      await seedUser(seeded)
      const seededRes = await request(app).post('/api/auth/email-code/send').send({ email: seeded, purpose: 'password-reset' })
      const freshGhost = await request(app).post('/api/auth/email-code/send').send({ email: uniqueTestEmail('a5-fresh-ghost'), purpose: 'password-reset' })
      expect(seededRes.status).toBe(200)
      expect(bodyShape(freshGhost)).toEqual(bodyShape(seededRes))
    })
  })
})
