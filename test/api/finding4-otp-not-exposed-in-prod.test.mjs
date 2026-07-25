import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { sendEmailVerificationCode } from '../../server/lib/email-verification.mjs'
import { sendPhoneVerificationCode } from '../../server/lib/phone-verification.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestPhone, verifyEmailForTest } from '../support/testServer.mjs'

// Finding 4 — the verification/OTP code must NEVER reach production. A code that leaks through an API
// response or a log line in a production build is an account-takeover vector. These tests pin the
// backend layer: under NODE_ENV=production the send/resend path omits the dev code, the account
// endpoints never carry a code field, and the code is never written to logs. (The frontend display
// gate is pinned separately in test/unit/finding4-frontend-code-gate.test.mjs.)

const originalEnv = process.env.NODE_ENV
const CODE_KEYS = ['devCode', 'verificationCode', 'code', 'otp']

async function underProd(fn) {
  process.env.NODE_ENV = 'production'
  try {
    return await fn()
  } finally {
    process.env.NODE_ENV = originalEnv
  }
}

describe('Finding 4 — OTP code is not exposed in production (backend)', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  afterEach(() => {
    process.env.NODE_ENV = originalEnv
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('sendEmailVerificationCode() omits devCode under production, returns it otherwise', async () => {
    const prod = await underProd(() => sendEmailVerificationCode(uniqueTestEmail('f4-email-prod'), 'guest-signup'))
    expect(prod.ok).toBe(true)
    expect(prod.devCode).toBeUndefined()

    const dev = await sendEmailVerificationCode(uniqueTestEmail('f4-email-dev'), 'guest-signup')
    expect(typeof dev.devCode).toBe('string')
    expect(dev.devCode.length).toBeGreaterThanOrEqual(4)
  })

  it('sendPhoneVerificationCode() omits devCode under production, returns it otherwise', async () => {
    const prod = await underProd(() => sendPhoneVerificationCode(uniqueTestPhone(), 'guest-signup'))
    expect(prod.ok).toBe(true)
    expect(prod.devCode).toBeUndefined()

    const dev = await sendPhoneVerificationCode(uniqueTestPhone(), 'guest-signup')
    expect(typeof dev.devCode).toBe('string')
  })

  it('POST /api/auth/email-code/send returns NO code field under production', async () => {
    const res = await underProd(() =>
      request(app).post('/api/auth/email-code/send').send({ email: uniqueTestEmail('f4-http-prod'), purpose: 'guest-signup' }),
    )
    for (const key of CODE_KEYS) expect(res.body[key], `email-code/send prod leaked ${key}`).toBeUndefined()
  })

  it('POST /api/auth/phone-code/send returns NO code field under production', async () => {
    const res = await underProd(() =>
      request(app).post('/api/auth/phone-code/send').send({ phone: uniqueTestPhone(), purpose: 'guest-signup' }),
    )
    for (const key of CODE_KEYS) expect(res.body[key], `phone-code/send prod leaked ${key}`).toBeUndefined()
  })

  it('POST /api/auth/email-code/send DOES return devCode in dev/test (positive control)', async () => {
    const res = await request(app).post('/api/auth/email-code/send').send({ email: uniqueTestEmail('f4-http-dev'), purpose: 'guest-signup' })
    expect(res.status).toBe(200)
    expect(res.body.devCode).toBeTruthy()
  })

  it('register / login responses never carry a verification-code field (any env)', async () => {
    const email = uniqueTestEmail('f4-reg')
    await verifyEmailForTest(app, email)
    const reg = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    expect(reg.status).toBe(201)
    trackTestUser(reg.body.user.id)
    for (const key of CODE_KEYS) expect(reg.body[key], `register leaked ${key}`).toBeUndefined()

    const login = await request(app).post('/api/auth/login').send({ email, password: 'correct-horse-battery' })
    for (const key of CODE_KEYS) expect(login.body[key], `login leaked ${key}`).toBeUndefined()
  })

  it('the verification code is never written to logs', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug']
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    const dev = await sendEmailVerificationCode(uniqueTestEmail('f4-log'), 'guest-signup')
    const output = spies
      .flatMap((s) => s.mock.calls)
      .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
      .join('\n')
    spies.forEach((s) => s.mockRestore())
    expect(dev.devCode).toBeTruthy()
    expect(output, 'the generated code appeared in console output').not.toContain(dev.devCode)
  })
})
