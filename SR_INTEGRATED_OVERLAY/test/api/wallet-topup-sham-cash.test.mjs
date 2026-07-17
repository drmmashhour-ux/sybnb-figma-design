import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

async function registerRider(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email)
  const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { token: res.body.token, user: res.body.user }
}

async function createAdmin(label) {
  const user = await db().user.create({
    data: {
      email: uniqueTestEmail(label),
      passwordHash: hashPassword('correct-horse-battery'),
      displayName: 'Test ADMIN',
      referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'ADMIN' } },
    },
    include: { roles: true },
  })
  trackTestUser(user.id)
  return { token: createSessionToken(user), user }
}

describe('Sham Cash wallet top-up: credits 1:1 only after admin approval', () => {
  let app
  let admin

  beforeAll(async () => {
    app = testApp()
    admin = await createAdmin('topup-sham-admin')
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('submitting does NOT credit until approved, then credits 1:1', async () => {
    const rider = await registerRider(app, 'topup-sham-rider')
    const providerRef = `SHAM-${Date.now()}-1`
    const submit = await request(app).post('/api/wallet/topup/sham-cash').set('Authorization', `Bearer ${rider.token}`).send({ amountMinor: 5000, currency: 'SYP', providerRef })
    expect(submit.status).toBe(201)
    expect(submit.body.proof.status).toBe('PENDING_ADMIN_REVIEW')
    const before = await db().wallet.findUnique({ where: { userId_currency: { userId: rider.user.id, currency: 'SYP' } } })
    expect(before?.cachedBalanceMinor || 0).toBe(0)
    const approve = await request(app)
      .patch(`/api/admin/review-queue/payment/${submit.body.proof.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVE', shamCashReconciliation: { accountMinor: 5000 } })
    expect(approve.status).toBe(200)
    const after = await db().wallet.findUnique({ where: { userId_currency: { userId: rider.user.id, currency: 'SYP' } } })
    expect(after.cachedBalanceMinor).toBe(5000)
    const entries = await db().walletEntry.findMany({ where: { walletId: after.id, referenceType: 'wallet_topup' } })
    expect(entries).toHaveLength(1)
    expect(entries[0].amountMinor).toBe(5000)
  })

  it('rejects a duplicate providerRef', async () => {
    const rider = await registerRider(app, 'topup-sham-dup')
    const providerRef = `SHAM-${Date.now()}-DUP`
    const first = await request(app).post('/api/wallet/topup/sham-cash').set('Authorization', `Bearer ${rider.token}`).send({ amountMinor: 3000, providerRef })
    expect(first.status).toBe(201)
    const second = await request(app).post('/api/wallet/topup/sham-cash').set('Authorization', `Bearer ${rider.token}`).send({ amountMinor: 3000, providerRef })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('PAYMENT_REFERENCE_DUPLICATE')
  })

  it('rejects a non-positive amount', async () => {
    const rider = await registerRider(app, 'topup-sham-bad')
    const res = await request(app).post('/api/wallet/topup/sham-cash').set('Authorization', `Bearer ${rider.token}`).send({ amountMinor: 0, providerRef: `SHAM-${Date.now()}-Z` })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('TOPUP_AMOUNT_INVALID')
  })
})
