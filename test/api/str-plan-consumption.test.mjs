import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

describe('STR host plan consumption is enforced atomically', () => {
  let app
  beforeAll(() => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  async function host(label) {
    const user = await db().user.create({ data: {
      email: uniqueTestEmail(label), displayName: label, referralCode: uniqueTestReferralCode(), roles: { create: { role: 'HOST' } },
    }, include: { roles: true } })
    trackTestUser(user.id)
    return { user, token: createSessionToken(user) }
  }
  const paidPlan = (userId, label) => db().paymentProof.create({ data: {
    userId, provider: 'str_host_plan', providerRef: `plan-${label}-${userId}`, status: 'APPROVED', amountMinor: 9, currency: 'USD',
  } })
  const createStay = (token, title) => request(app).post('/api/listings').set('Authorization', `Bearer ${token}`)
    .send({ division: 'STAYS', titleAr: title, priceMinor: 100, currency: 'USD', metadata: {} })

  it('rejects direct STAYS creation without an unused approved plan', async () => {
    const h = await host('str-no-plan')
    const res = await createStay(h.token, 'بدون خطة')
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('STR_HOST_PLAN_REQUIRED')
  })

  it('binds one plan to one listing and rejects reuse', async () => {
    const h = await host('str-one-plan')
    const plan = await paidPlan(h.user.id, 'one')
    const first = await createStay(h.token, 'الوحدة الأولى')
    expect(first.status).toBe(201)
    expect(first.body.listing).not.toHaveProperty('strPlanProofId')
    const second = await createStay(h.token, 'الوحدة الثانية')
    expect(second.status).toBe(403)
    expect(await db().strPlanConsumption.count({ where: { proofId: plan.id } })).toBe(1)
  })

  it('allows exactly one winner under concurrent creation with one plan', async () => {
    const h = await host('str-plan-race')
    const plan = await paidPlan(h.user.id, 'race')
    const results = await Promise.all([createStay(h.token, 'وحدة متزامنة أ'), createStay(h.token, 'وحدة متزامنة ب')])
    expect(results.map((res) => res.status).sort()).toEqual([201, 403])
    expect(await db().strPlanConsumption.count({ where: { proofId: plan.id } })).toBe(1)
  })
})
