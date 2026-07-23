import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import {
  cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest,
} from '../support/testServer.mjs'

// SYB-009 (Wave 0) — SUPPORT must be subject to the same staff sign-in step-up (email/phone OTP) as
// the other privileged roles. Before this change `STAFF_ROLES_REQUIRING_OTP` held ADMIN/HOST/DRIVER/
// SELLER but not SUPPORT, so a support-only account — which can read any user's identity document,
// export the driver registry, and read the audit log — signed in with a password alone.
//
// Scope is intentionally narrow (owner decision): add SUPPORT to the existing set. No authentication
// redesign. These tests lock the behaviour in both directions and prove ADMIN is unaffected.

const PASSWORD = 'correct-horse-battery'

async function createStaff(role, label) {
  const email = uniqueTestEmail(label)
  const user = await db().user.create({
    data: {
      email, passwordHash: hashPassword(PASSWORD),
      displayName: `Test ${role}`, referralCode: uniqueTestReferralCode(),
      status: 'ACTIVE', roles: { create: { role } },
    },
  })
  trackTestUser(user.id)
  return { email, user }
}

const login = (app, body) => request(app).post('/api/auth/login').send(body)

describe('SYB-009 — SUPPORT staff sign-in requires OTP step-up', () => {
  let app

  beforeAll(() => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('refuses a SUPPORT sign-in with a correct password but no verified access code', async () => {
    const support = await createStaff('SUPPORT', 'syb009-support-nootp')
    const res = await login(app, { email: support.email, password: PASSWORD })
    // Credentials are valid, so this is the step-up gate, not an auth failure.
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('STAFF_OTP_REQUIRED')
    expect(res.body.token).toBeUndefined()
  })

  it('admits a SUPPORT sign-in once the email access code is verified', async () => {
    const support = await createStaff('SUPPORT', 'syb009-support-otp')
    await verifyEmailForTest(app, support.email, 'staff-login')
    const res = await login(app, { email: support.email, password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
  })

  it('still refuses SUPPORT when the password is wrong (gate does not weaken auth)', async () => {
    const support = await createStaff('SUPPORT', 'syb009-support-badpw')
    await verifyEmailForTest(app, support.email, 'staff-login')
    const res = await login(app, { email: support.email, password: 'wrong-password' })
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('leaves ADMIN behaviour unchanged — still gated by the same step-up', async () => {
    const admin = await createStaff('ADMIN', 'syb009-admin')
    const noOtp = await login(app, { email: admin.email, password: PASSWORD })
    expect(noOtp.status).toBe(403)
    expect(noOtp.body.error.code).toBe('STAFF_OTP_REQUIRED')

    await verifyEmailForTest(app, admin.email, 'staff-login')
    const withOtp = await login(app, { email: admin.email, password: PASSWORD })
    expect(withOtp.status).toBe(200)
    expect(withOtp.body.token).toBeTruthy()
  })

  it('does not step-up an ordinary GUEST — password alone still signs in', async () => {
    const email = uniqueTestEmail('syb009-guest')
    await verifyEmailForTest(app, email, 'guest-signup')
    const reg = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: PASSWORD })
    trackTestUser(reg.body.user.id)

    const res = await login(app, { email, password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
  })
})
