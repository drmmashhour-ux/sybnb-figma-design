import request from 'supertest'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { testApp, uniqueTestEmail } from '../support/testServer.mjs'

// Resend hardening item 9: sending a new code opportunistically deletes THIS email+purpose's expired,
// unconsumed rows (narrow, index-friendly via the existing [email, purpose] index) so the table does
// not grow unbounded. It must NOT delete consumed rows (the 30-min trust window in
// hasRecentlyVerifiedEmail depends on them) nor other emails' rows.
describe('opportunistic cleanup of expired verification rows (item 9)', () => {
  let app

  beforeAll(() => { app = testApp() })

  it('deletes this email\'s expired unconsumed rows on send, preserving consumed rows', async () => {
    const email = uniqueTestEmail('cleanup')
    const past = new Date(Date.now() - 60_000)

    // Two expired, unconsumed rows (stale sends) + one consumed row (recently verified).
    await db().emailVerificationCode.create({ data: { email, codeHash: 'expired1', purpose: 'guest-signup', expiresAt: past } })
    await db().emailVerificationCode.create({ data: { email, codeHash: 'expired2', purpose: 'guest-signup', expiresAt: past } })
    await db().emailVerificationCode.create({ data: { email, codeHash: 'consumed1', purpose: 'guest-signup', expiresAt: past, consumedAt: new Date() } })

    const res = await request(app).post('/api/auth/email-code/send').send({ email, purpose: 'guest-signup' })
    expect(res.status).toBe(200)

    const rows = await db().emailVerificationCode.findMany({ where: { email, purpose: 'guest-signup' } })
    const now = new Date()
    const expiredUnconsumed = rows.filter((r) => !r.consumedAt && r.expiresAt < now)
    const consumed = rows.filter((r) => r.consumedAt)
    const freshUnconsumed = rows.filter((r) => !r.consumedAt && r.expiresAt > now)

    expect(expiredUnconsumed.length).toBe(0) // stale rows swept
    expect(consumed.length).toBe(1) // trust-window row preserved
    expect(freshUnconsumed.length).toBe(1) // the newly issued code

    // Cleanup this test's rows.
    await db().emailVerificationCode.deleteMany({ where: { email } })
  })

  it('does not delete another email\'s expired rows', async () => {
    const mine = uniqueTestEmail('mine')
    const theirs = uniqueTestEmail('theirs')
    const past = new Date(Date.now() - 60_000)
    await db().emailVerificationCode.create({ data: { email: theirs, codeHash: 'x', purpose: 'guest-signup', expiresAt: past } })

    await request(app).post('/api/auth/email-code/send').send({ email: mine, purpose: 'guest-signup' })

    const theirRows = await db().emailVerificationCode.findMany({ where: { email: theirs } })
    expect(theirRows.length).toBe(1) // untouched

    await db().emailVerificationCode.deleteMany({ where: { email: { in: [mine, theirs] } } })
  })
})
