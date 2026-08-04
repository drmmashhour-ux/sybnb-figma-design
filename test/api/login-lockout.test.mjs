import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { __resetRateLimitsForTests } from '../../server/lib/rate-limit.mjs'
import { hashLoginSubject, LOGIN_LOCK_POLICY } from '../../server/lib/login-lockout.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Per-ACCOUNT login lockout: a distributed/rotating-IP attacker who slips under the per-IP rate limit
// still gets a single target account locked after too many failed attempts. Reuses otp_attempt_locks
// (purpose='login'), so no migration. We reset the IN-MEMORY IP rate limiter between attempts to prove
// the ACCOUNT lock — a distinct mechanism living in the DB — is what does the blocking.
describe('Per-account login lockout', () => {
  let app
  const GOOD = 'correct-horse-battery'
  const WRONG = 'definitely-the-wrong-password'

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function makeUser(label) {
    const email = uniqueTestEmail(label)
    const legacyVerificationGrant1 = await verifyEmailForTest(app, email)
    const res = await request(app)
      .post('/api/auth/register')
      .send({ verificationGrant: legacyVerificationGrant1, role: 'GUEST', email, password: GOOD, displayName: 'Lock Test' })
    trackTestUser(res.body.user.id)
    return { email, id: res.body.user.id }
  }

  async function failLogin(email, times) {
    for (let i = 0; i < times; i++) {
      __resetRateLimitsForTests() // isolate: never let the per-IP limiter be what blocks us
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post('/api/auth/login').send({ email, password: WRONG })
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    }
  }

  it('locks the account (429) after too many failed attempts — even the CORRECT password is then refused', async () => {
    const { email } = await makeUser('lockout')
    await failLogin(email, LOGIN_LOCK_POLICY.MAX_FAILED_ATTEMPTS)

    __resetRateLimitsForTests()
    const locked = await request(app).post('/api/auth/login').send({ email, password: GOOD })
    expect(locked.status).toBe(429)
    expect(locked.body.error.code).toBe('ACCOUNT_TEMPORARILY_LOCKED')
    expect(locked.headers['retry-after']).toBeDefined()
  })

  it('records a SECURITY_LOGIN_LOCKOUT audit event (identifier stored hashed, never in the clear)', async () => {
    const { email } = await makeUser('lockout-audit')
    await failLogin(email, LOGIN_LOCK_POLICY.MAX_FAILED_ATTEMPTS)

    const subjectHash = hashLoginSubject(email)
    const event = await db().adminAuditLog.findFirst({
      where: { action: 'SECURITY_LOGIN_LOCKOUT', entityId: subjectHash },
    })
    expect(event).toBeTruthy()
    // The event must NOT leak the raw email anywhere.
    expect(JSON.stringify(event)).not.toContain(email)
  })

  it('a correct login BELOW the threshold still succeeds and clears the failure counter', async () => {
    const { email } = await makeUser('lockout-clear')
    await failLogin(email, LOGIN_LOCK_POLICY.MAX_FAILED_ATTEMPTS - 2)

    __resetRateLimitsForTests()
    const ok = await request(app).post('/api/auth/login').send({ email, password: GOOD })
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)

    // On success the lock row is deleted, so the user starts clean next time.
    const row = await db().otpAttemptLock.findUnique({
      where: { purpose_subjectHash: { purpose: 'login', subjectHash: hashLoginSubject(email) } },
    })
    expect(row).toBeNull()
  })
})
