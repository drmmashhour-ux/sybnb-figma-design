import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashEmail, hashPassword, hashPhone } from '../../server/lib/security.mjs'
import { __resetRateLimitsForTests } from '../../server/lib/rate-limit.mjs'
import { AUTH_OTP_ISSUED_ACTION, AUTH_PASSWORD_RESET_COMPLETED_ACTION } from '../../server/lib/auth-audit.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// A6.2 — auth events must be audited (additive, append-only): a verification-code/OTP being ISSUED and a
// password-reset being COMPLETED. Privacy guardrail: the audit row must carry only hashed/id references
// (userId when known, hashed email/phone), NEVER the code value or the raw email/phone/new-password.

const PASSWORD = 'correct-horse-battery'
const NEW_PASSWORD = 'brand-new-passphrase-9'
const rowText = (row) => JSON.stringify(row)

describe('A6.2 — auth-event audit (OTP issued + password-reset completed), no code/PII in the row', () => {
  let app
  const usedIdHashes = []

  beforeAll(() => {
    app = testApp()
  })
  beforeEach(() => __resetRateLimitsForTests())
  afterEach(() => __resetRateLimitsForTests())
  afterAll(async () => {
    if (usedIdHashes.length) await db().adminAuditLog.deleteMany({ where: { entityId: { in: usedIdHashes } } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('email OTP issued → append-only AUTH_OTP_ISSUED row (type + timestamp; hashed id, no code/email)', async () => {
    const email = uniqueTestEmail('a62-otp')
    usedIdHashes.push(hashEmail(email))
    const send = await request(app).post('/api/auth/email-code/send').send({ email, purpose: 'password-reset' })
    expect(send.status).toBe(200)
    const devCode = send.body.devCode
    expect(devCode, 'test env returns the dev code').toBeTruthy()

    const row = await db().adminAuditLog.findFirst({ where: { action: AUTH_OTP_ISSUED_ACTION, entityId: hashEmail(email) }, orderBy: { createdAt: 'desc' } })
    expect(row, 'OTP-issued audit row exists').toBeTruthy()
    expect(row.entityType).toBe('auth_otp')
    expect(row.after?.channel).toBe('email')
    expect(row.after?.purpose).toBe('password-reset')
    expect(row.createdAt instanceof Date, 'has a timestamp').toBe(true)
    // privacy: a hashed reference, never the raw email, never the code value
    expect(row.entityId, 'entityId is the hashed email, not raw').toBe(hashEmail(email))
    expect(rowText(row), 'row must not contain the raw email').not.toContain(email)
    expect(rowText(row), 'row must not contain the code').not.toContain(devCode)
  })

  it('phone OTP issued → AUTH_OTP_ISSUED with a hashed phone id and channel=phone (no raw phone/code)', async () => {
    const phone = `+963${String(Date.now()).slice(-9)}`
    usedIdHashes.push(hashPhone(phone))
    const send = await request(app).post('/api/auth/phone-code/send').send({ phone, purpose: 'guest-signup' })
    expect(send.status).toBe(200)
    const devCode = send.body.devCode

    const row = await db().adminAuditLog.findFirst({ where: { action: AUTH_OTP_ISSUED_ACTION, entityId: hashPhone(phone) }, orderBy: { createdAt: 'desc' } })
    expect(row, 'phone OTP-issued audit row exists').toBeTruthy()
    expect(row.entityType).toBe('auth_otp')
    expect(row.after?.channel).toBe('phone')
    expect(row.entityId).toBe(hashPhone(phone))
    expect(rowText(row), 'row must not contain the raw phone').not.toContain(phone)
    if (devCode) expect(rowText(row), 'row must not contain the code').not.toContain(devCode)
  })

  it('password-reset completed → AUTH_PASSWORD_RESET_COMPLETED with the actor userId (no email/new-password)', async () => {
    const email = uniqueTestEmail('a62-reset')
    usedIdHashes.push(hashEmail(email))
    const u = await db().user.create({
      data: { email, passwordHash: hashPassword(PASSWORD), displayName: 'A62 Reset', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'GUEST' } } },
    })
    trackTestUser(u.id)

    const send = await request(app).post('/api/auth/email-code/send').send({ email, purpose: 'password-reset' })
    await request(app).post('/api/auth/email-code/verify').send({ email, code: send.body.devCode, purpose: 'password-reset' })
    const reset = await request(app).post('/api/auth/password-reset').send({ email, newPassword: NEW_PASSWORD })
    expect(reset.status).toBe(200)

    const row = await db().adminAuditLog.findFirst({ where: { action: AUTH_PASSWORD_RESET_COMPLETED_ACTION, actorUserId: u.id }, orderBy: { createdAt: 'desc' } })
    expect(row, 'reset-completed audit row exists').toBeTruthy()
    expect(row.actorUserId, 'actor is the reset user (known)').toBe(u.id)
    expect(row.createdAt instanceof Date, 'has a timestamp').toBe(true)
    expect(rowText(row), 'row must not contain the raw email').not.toContain(email)
    expect(rowText(row), 'row must not contain the new password').not.toContain(NEW_PASSWORD)
  })

  it('append-only: two code issuances for the same email append TWO rows (never an overwrite)', async () => {
    const email = uniqueTestEmail('a62-append')
    usedIdHashes.push(hashEmail(email))
    await request(app).post('/api/auth/email-code/send').send({ email, purpose: 'guest-signup' })
    await request(app).post('/api/auth/email-code/send').send({ email, purpose: 'guest-signup' })
    const rows = await db().adminAuditLog.findMany({ where: { action: AUTH_OTP_ISSUED_ACTION, entityId: hashEmail(email) } })
    expect(rows.length, 'each issuance appends its own row').toBe(2)
  })
})
