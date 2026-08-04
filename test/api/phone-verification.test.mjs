import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { __resetRateLimitsForTests } from '../../server/lib/rate-limit.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestPhone, verifyPhoneForTest } from '../support/testServer.mjs'

describe('Phone/SMS verification — sign up & sign in by phone code (alternative to email)', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  beforeEach(() => {
    // Each scenario drives the real OTP endpoints. Isolate the production per-IP send/verify caps so
    // earlier scenarios cannot turn a later valid code into an unrelated 429 response.
    __resetRateLimitsForTests()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('sends a phone code and verifies it', async () => {
    const phone = uniqueTestPhone()
    const send = await request(app).post('/api/auth/phone-code/send').send({ phone, purpose: 'guest-signup' })
    expect(send.status).toBe(200)
    expect(send.body.devCode).toBeTruthy() // dev/test only — never returned in production
    const verify = await request(app).post('/api/auth/phone-code/verify').send({ phone, code: send.body.devCode, purpose: 'guest-signup' })
    expect(verify.status).toBe(200)
    expect(verify.body.ok).toBe(true)
    expect(verify.body.verificationGrant).toBeTruthy()
  })

  it('rejects an invalid code', async () => {
    const phone = uniqueTestPhone()
    await request(app).post('/api/auth/phone-code/send').send({ phone, purpose: 'guest-signup' })
    const verify = await request(app).post('/api/auth/phone-code/verify').send({ phone, code: '000000', purpose: 'guest-signup' })
    expect(verify.status).toBe(400)
    expect(verify.body.error.code).toBe('INVALID_OR_EXPIRED_CODE')
  })

  it('registers a GUEST by verified phone only — no email', async () => {
    const phone = uniqueTestPhone()
    const verificationGrant = await verifyPhoneForTest(app, phone, 'guest-signup')
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', phone, password: 'correct-horse-battery', verificationGrant })
    expect(res.status).toBe(201)
    expect(res.body.token).toBeTruthy()
    trackTestUser(res.body.user.id)
  })

  it('registers a DRIVER (staff) by verified phone only', async () => {
    const phone = uniqueTestPhone()
    const verificationGrant = await verifyPhoneForTest(app, phone, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'DRIVER', phone, password: 'correct-horse-battery', verificationGrant })
    expect(res.status).toBe(201)
    expect(res.body.token).toBeTruthy()
    expect(res.body.user.roles).toEqual(expect.arrayContaining(['DRIVER', 'GUEST']))
    trackTestUser(res.body.user.id)
  })

  it('resets a phone-only account password and consumes the reset proof once', async () => {
    const phone = uniqueTestPhone()
    const signupGrant = await verifyPhoneForTest(app, phone, 'guest-signup')
    const registered = await request(app).post('/api/auth/register').send({ role: 'GUEST', phone, password: 'original-password-1', verificationGrant: signupGrant })
    trackTestUser(registered.body.user.id)

    const resetGrant = await verifyPhoneForTest(app, phone, 'password-reset')
    const reset = await request(app).post('/api/auth/password-reset').send({ phone, newPassword: 'new-password-2', verificationGrant: resetGrant })
    expect(reset.status).toBe(200)
    const replay = await request(app).post('/api/auth/password-reset').send({ phone, newPassword: 'attacker-password-3', verificationGrant: resetGrant })
    expect(replay.status).toBe(403)

    const login = await request(app).post('/api/auth/login').send({ phone, password: 'new-password-2' })
    expect(login.status).toBe(200)
  })

  it('allows only one concurrent verification of the same OTP', async () => {
    const phone = uniqueTestPhone()
    const sent = await request(app).post('/api/auth/phone-code/send').send({ phone, purpose: 'guest-signup' })
    const verify = () => request(app).post('/api/auth/phone-code/verify').send({ phone, code: sent.body.devCode, purpose: 'guest-signup' })
    const results = await Promise.all([verify(), verify()])
    expect(results.map((result) => result.status).sort()).toEqual([200, 400])
  })

  it('refuses registration when the phone was never verified', async () => {
    const phone = uniqueTestPhone()
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', phone, password: 'correct-horse-battery' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED')
  })
})
