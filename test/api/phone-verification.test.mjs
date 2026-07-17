import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestPhone, verifyPhoneForTest } from '../support/testServer.mjs'

describe('Phone/SMS verification — sign up & sign in by phone code (alternative to email)', () => {
  let app
  beforeAll(() => {
    app = testApp()
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
    await verifyPhoneForTest(app, phone, 'guest-signup')
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', phone, password: 'correct-horse-battery' })
    expect(res.status).toBe(201)
    expect(res.body.token).toBeTruthy()
    trackTestUser(res.body.user.id)
  })

  it('registers a DRIVER (staff) by verified phone only', async () => {
    const phone = uniqueTestPhone()
    await verifyPhoneForTest(app, phone, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'DRIVER', phone, password: 'correct-horse-battery' })
    expect(res.status).toBe(201)
    expect(res.body.token).toBeTruthy()
    trackTestUser(res.body.user.id)
  })

  it('refuses registration when the phone was never verified', async () => {
    const phone = uniqueTestPhone()
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', phone, password: 'correct-horse-battery' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED')
  })
})
