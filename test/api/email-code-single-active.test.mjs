import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { testApp, uniqueTestEmail } from '../support/testServer.mjs'

// Resend hardening — duplicate/repeated issuance (Q2): issuing a new verification code must leave
// exactly ONE active (unconsumed) code for a given normalized email + purpose, so an older
// unconsumed code cannot linger as a second live secret. Consumed rows (the 30-min trust window)
// must be preserved. The newest code verifies; an older one does not.
describe('single active verification code per email+purpose (Q2)', () => {
  let app
  const created = []

  beforeAll(() => { app = testApp() })
  afterAll(async () => {
    for (const email of created) {
      await db().emailVerificationCode.deleteMany({ where: { email } }).catch(() => {})
    }
  })

  const send = (email) => request(app).post('/api/auth/email-code/send').send({ email, purpose: 'guest-signup' })
  const verify = (email, code) => request(app).post('/api/auth/email-code/verify').send({ email, code, purpose: 'guest-signup' })

  it('a second send leaves exactly one unconsumed code (older is invalidated)', async () => {
    const email = uniqueTestEmail('single-active')
    created.push(email)

    const first = await send(email)
    const second = await send(email)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const devCode1 = first.body.devCode
    const devCode2 = second.body.devCode
    expect(devCode1).toBeTruthy()
    expect(devCode2).toBeTruthy()

    const unconsumed = await db().emailVerificationCode.findMany({
      where: { email, purpose: 'guest-signup', consumedAt: null },
    })
    expect(unconsumed.length).toBe(1) // only the newest remains active

    // The older code no longer verifies; the newest one does.
    if (devCode1 !== devCode2) {
      const old = await verify(email, devCode1)
      expect(old.status).toBe(400)
      expect(old.body.error.code).toBe('INVALID_OR_EXPIRED_CODE')
    }
    const fresh = await verify(email, devCode2)
    expect(fresh.status).toBe(200)
    expect(fresh.body.ok).toBe(true)
  })

  it('issuing a new code preserves an already-consumed row (30-min trust window intact)', async () => {
    const email = uniqueTestEmail('single-active-consumed')
    created.push(email)

    const s1 = await send(email)
    const v1 = await verify(email, s1.body.devCode)
    expect(v1.status).toBe(200) // creates a consumed row

    await send(email) // new issuance must NOT delete the consumed row

    const consumed = await db().emailVerificationCode.findMany({
      where: { email, purpose: 'guest-signup', consumedAt: { not: null } },
    })
    expect(consumed.length).toBe(1) // trust-window row preserved

    const unconsumed = await db().emailVerificationCode.findMany({
      where: { email, purpose: 'guest-signup', consumedAt: null },
    })
    expect(unconsumed.length).toBe(1) // exactly the newly issued code
  })
})
