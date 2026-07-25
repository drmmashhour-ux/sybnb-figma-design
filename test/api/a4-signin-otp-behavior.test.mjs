import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// A4 (Finding 2) — the actual sign-in behavior, which the gate copy must match: a STAFF role
// (HOST/SELLER/ADMIN/DRIVER/SUPPORT) must pass a real 'staff-login' email/phone OTP on EVERY sign-in,
// while a GUEST signs in with just identifier + password. This pins the behavior half of the
// copy↔behavior consistency (the copy half is in test/unit/a4-signin-copy-consistency.test.mjs).

const PASSWORD = 'correct-horse-battery'

describe('A4 — sign-in OTP behavior (staff requires an email code every time; guest does not)', () => {
  let app
  let host
  let guest

  async function mkUser(role) {
    const u = await db().user.create({
      data: {
        email: uniqueTestEmail(`a4-${role.toLowerCase()}`),
        passwordHash: hashPassword(PASSWORD),
        displayName: `A4 ${role}`,
        referralCode: uniqueTestReferralCode(),
        status: 'ACTIVE',
        roles: { create: { role } },
      },
    })
    trackTestUser(u.id)
    return u
  }

  beforeAll(async () => {
    app = testApp()
    host = await mkUser('HOST')
    guest = await mkUser('GUEST')
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a HOST (staff) sign-in WITHOUT a recent staff-login OTP is rejected (403 STAFF_OTP_REQUIRED)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: host.email, password: PASSWORD })
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('STAFF_OTP_REQUIRED')
  })

  it('a GUEST sign-in needs no verification code (succeeds with just email + password)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: guest.email, password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
  })
})
