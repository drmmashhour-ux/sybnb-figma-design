import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// H1 — pins the forgot-password flow (F-01). The session-revocation half (a token issued before the reset
// stops working, F-02) is already pinned in auth.test.mjs; this pins the two halves that were not:
//  1) a reset with NO recently-verified email code is refused (can't reset a password you didn't prove
//     control of the inbox for), and
//  2) the reset ACTUALLY rotates the password — the old one stops working and the new one logs in.

describe('H1 — forgot-password (password-reset) flow', () => {
  let app
  beforeAll(() => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  async function registerGuest(tag) {
    const email = uniqueTestEmail(tag)
    await verifyEmailForTest(app, email) // guest-signup purpose
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'original-horse-battery' })
    trackTestUser(res.body.user.id)
    return email
  }

  it('refuses a reset when the email was not recently verified (403 EMAIL_NOT_VERIFIED)', async () => {
    const email = await registerGuest('h1-reset-unverified')
    const res = await request(app).post('/api/auth/password-reset').send({ email, newPassword: 'brand-new-passphrase' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('rotates the password after a verified reset: old password fails, new password logs in', async () => {
    const email = await registerGuest('h1-reset-rotate')
    // Old password works before the reset.
    const before = await request(app).post('/api/auth/login').send({ email, password: 'original-horse-battery' })
    expect(before.status).toBe(200)

    // Verify the inbox for the reset purpose, then reset.
    await verifyEmailForTest(app, email, 'password-reset')
    const reset = await request(app).post('/api/auth/password-reset').send({ email, newPassword: 'rotated-passphrase-9' })
    expect(reset.status).toBe(200)

    // Old password no longer works; the new one does.
    const oldPw = await request(app).post('/api/auth/login').send({ email, password: 'original-horse-battery' })
    expect(oldPw.status).toBe(401)
    expect(oldPw.body.error.code).toBe('INVALID_CREDENTIALS')

    const newPw = await request(app).post('/api/auth/login').send({ email, password: 'rotated-passphrase-9' })
    expect(newPw.status).toBe(200)
    expect(newPw.body.token).toBeTruthy()
  })
})
