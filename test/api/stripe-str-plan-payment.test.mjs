import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { finalizeStripeStrPlanSession } from '../../server/routes/payments.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// STR host listing-plan CARD payment, tested locally WITHOUT live Stripe (no keys required).
// finalizeStripeStrPlanSession(session) runs only when payment_status==='paid' and metadata.purpose
// is 'str_host_plan'; it creates a `str_host_plan` proof, auto-approves it (recording 100% platform
// revenue as a str_host_plan_fee CREDIT), and is idempotent on the Stripe session id. Same fabricated
// -session pattern as stripe-booking-payment.test.mjs. Crucially, unlike the marketplace `seller_plan`
// flow, it must NOT create/flip a sellerProfile (which would wrongly unlock cars/marketplace selling).

function paidStrPlanSession(id, userId, planCode, priceMinor) {
  return {
    id,
    payment_status: 'paid',
    payment_intent: `pi_test_${id}`,
    metadata: { purpose: 'str_host_plan', userId, planCode, planPriceUsdMinor: String(priceMinor) },
  }
}

describe('STR host-plan Stripe card payment — correctness + idempotency + isolation from seller_plan', () => {
  let host

  beforeAll(async () => {
    // An admin must exist so approvePaymentProof can credit the platform (str_host_plan_fee).
    const admin = await db().user.create({
      data: { email: uniqueTestEmail('strplan-admin'), displayName: 'STR Plan Admin', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'ADMIN' } } },
    })
    trackTestUser(admin.id)
    host = await db().user.create({
      data: { email: uniqueTestEmail('strplan-host'), displayName: 'STR Plan Host', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'HOST' } } },
    })
    trackTestUser(host.id)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('paid session: creates an auto-approved str_host_plan proof and records a str_host_plan_fee CREDIT', async () => {
    const session = paidStrPlanSession(`cs_test_${Date.now()}_PLAN_OK`, host.id, 'premium', 49)

    const approved = await finalizeStripeStrPlanSession(session)
    expect(approved).not.toBeNull()
    expect(approved.status).toBe('APPROVED')

    const proof = await db().paymentProof.findFirst({ where: { provider: 'str_host_plan', providerRef: session.id } })
    expect(proof).not.toBeNull()
    expect(proof.amountMinor).toBe(49)
    expect(proof.currency).toBe('USD')

    const credit = await db().walletEntry.findFirst({
      where: { type: 'CREDIT', referenceType: 'str_host_plan_fee', referenceId: proof.id },
    })
    expect(credit).not.toBeNull()
    expect(credit.amountMinor).toBe(49)
  })

  it('isolation: an STR host-plan payment does NOT create or approve a sellerProfile (no marketplace unlock)', async () => {
    const session = paidStrPlanSession(`cs_test_${Date.now()}_PLAN_ISO`, host.id, 'plus', 19)
    await finalizeStripeStrPlanSession(session)
    const profile = await db().sellerProfile.findUnique({ where: { userId: host.id } })
    expect(profile).toBeNull()
  })

  it('duplicate / out-of-order webhook: replaying the same session records the plan fee exactly once', async () => {
    const session = paidStrPlanSession(`cs_test_${Date.now()}_PLAN_DUP`, host.id, 'basic', 9)

    await finalizeStripeStrPlanSession(session)
    await finalizeStripeStrPlanSession(session) // duplicate/delayed webhook delivery
    await finalizeStripeStrPlanSession(session) // out-of-order re-delivery

    const proofs = await db().paymentProof.count({ where: { provider: 'str_host_plan', providerRef: session.id } })
    expect(proofs).toBe(1)
    const proof = await db().paymentProof.findFirst({ where: { provider: 'str_host_plan', providerRef: session.id } })
    const credits = await db().walletEntry.count({ where: { type: 'CREDIT', referenceType: 'str_host_plan_fee', referenceId: proof.id } })
    expect(credits).toBe(1)
  })

  it('concurrent webhook + browser confirmation records one proof and one fee', async () => {
    const session = paidStrPlanSession(`cs_test_${Date.now()}_PLAN_RACE`, host.id, 'plus', 19)
    const results = await Promise.all([
      finalizeStripeStrPlanSession(session),
      finalizeStripeStrPlanSession(session),
      finalizeStripeStrPlanSession(session),
    ])
    expect(results.every((proof) => proof?.id === results[0]?.id)).toBe(true)
    const proofs = await db().paymentProof.findMany({ where: { provider: 'str_host_plan', providerRef: session.id } })
    expect(proofs).toHaveLength(1)
    expect(await db().walletEntry.count({ where: { referenceType: 'str_host_plan_fee', referenceId: proofs[0].id } })).toBe(1)
  })

  it('unpaid session: no proof, no revenue', async () => {
    const session = paidStrPlanSession(`cs_test_${Date.now()}_PLAN_UNPAID`, host.id, 'hotel', 100)
    session.payment_status = 'unpaid'

    const result = await finalizeStripeStrPlanSession(session)
    expect(result).toBeNull()
    const proofs = await db().paymentProof.count({ where: { provider: 'str_host_plan', providerRef: session.id } })
    expect(proofs).toBe(0)
  })

  it('wrong purpose: a non-str_host_plan session is ignored by the plan finalizer', async () => {
    const session = paidStrPlanSession(`cs_test_${Date.now()}_PLAN_WRONG`, host.id, 'plus', 19)
    session.metadata.purpose = 'wallet_topup'
    const result = await finalizeStripeStrPlanSession(session)
    expect(result).toBeNull()
  })

  it('fails closed and rolls back when no platform ADMIN account exists', async () => {
    await db().userRole.deleteMany({ where: { role: 'ADMIN' } })
    const session = paidStrPlanSession(`cs_test_${Date.now()}_PLAN_NO_ADMIN`, host.id, 'basic', 9)
    const creditsBefore = await db().walletEntry.count({ where: { referenceType: 'str_host_plan_fee' } })

    await expect(finalizeStripeStrPlanSession(session)).rejects.toMatchObject({ code: 'PLATFORM_ACCOUNT_MISSING', statusCode: 503 })
    expect(await db().paymentProof.count({ where: { provider: 'str_host_plan', providerRef: session.id } })).toBe(0)
    expect(await db().walletEntry.count({ where: { referenceType: 'str_host_plan_fee' } })).toBe(creditsBefore)
  })

  it('fail-closed: an AUTHED create-str-plan-checkout request returns 503 when Stripe is not configured', async () => {
    const app = testApp()
    // Auth is checked before Stripe, so use a real token; then requireStripe() fails closed (no keys here).
    const email = uniqueTestEmail('strplan-guest')
    const legacyVerificationGrant1 = await verifyEmailForTest(app, email)
    const reg = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(reg.body.user.id)
    const res = await request(app)
      .post('/api/payments/stripe/create-str-plan-checkout-session')
      .set('authorization', `Bearer ${reg.body.token}`)
      .send({ planCode: 'plus', origin: 'https://example.test' })
    expect(res.status).toBe(503)
  })
})
