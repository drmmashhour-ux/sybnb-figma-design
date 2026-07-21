import request from 'supertest'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { testApp, uniqueTestEmail, verifyEmailForTest, trackTestUser } from '../support/testServer.mjs'

// Resend hardening item 6: when a provider IS configured and delivery definitively fails (after
// bounded retry), the send endpoint must return a non-2xx (502) with a stable generic error code —
// NOT a misleading 200 ok:true. And the failure response must be identical for a registered and an
// unregistered email (no account-enumeration oracle). The mailer is configured + forced to fail via
// a mocked global fetch, self-contained to this file (restored in afterEach).
describe('email-code/send — definitive delivery failure (item 6)', () => {
  let app
  const realFetch = globalThis.fetch
  let registeredEmail

  beforeAll(async () => {
    app = testApp()
    // Register a real GUEST while the mailer is OFF (default) — uses the dev devCode path, so this
    // setup does not depend on the failure mock configured per-test below.
    registeredEmail = uniqueTestEmail('registered')
    await verifyEmailForTest(app, registeredEmail, 'guest-signup')
    const reg = await request(app).post('/api/auth/register').send({ role: 'GUEST', email: registeredEmail, password: 'correct-horse-battery' })
    trackTestUser(reg.body.user?.id)
  })

  beforeEach(() => {
    // Configure Resend and force every send to fail with a definitive provider error.
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.EMAIL_MAX_ATTEMPTS = '1'
    process.env.EMAIL_RETRY_BASE_MS = '0'
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: 'PROVIDER_SECRET_DETAIL' }) })
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.EMAIL_PROVIDER
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_MAX_ATTEMPTS
    delete process.env.EMAIL_RETRY_BASE_MS
  })

  it('returns 502 EMAIL_SEND_FAILED (not a false 200) and never returns a devCode', async () => {
    const res = await request(app).post('/api/auth/email-code/send').send({ email: registeredEmail, purpose: 'guest-signup' })
    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
    expect(res.body.error.code).toBe('EMAIL_SEND_FAILED')
    expect(res.body.devCode).toBeUndefined()
  })

  it('is identical for a registered vs an unregistered email (no enumeration oracle)', async () => {
    const unregistered = uniqueTestEmail('never-seen')
    const a = await request(app).post('/api/auth/email-code/send').send({ email: registeredEmail, purpose: 'guest-signup' })
    const b = await request(app).post('/api/auth/email-code/send').send({ email: unregistered, purpose: 'guest-signup' })
    expect(a.status).toBe(502)
    expect(b.status).toBe(a.status)
    expect(b.body).toEqual(a.body)
  })
})
