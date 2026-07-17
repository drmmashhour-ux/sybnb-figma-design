import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import {
  CARD_TOPUP_FEE_RATE,
  cardTopupChargeCents,
  cardTopupFeeMinor,
  creditWalletTopupSession,
} from '../../server/routes/payments.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

async function registerRider(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email)
  const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return res.body.user
}

async function ensureAdmin(label) {
  const user = await db().user.create({
    data: {
      email: uniqueTestEmail(label),
      passwordHash: hashPassword('correct-horse-battery'),
      displayName: 'Test ADMIN',
      referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'ADMIN' } },
    },
  })
  trackTestUser(user.id)
  return user
}

function paidTopupSession(id, userId, baseMinor) {
  return {
    id,
    payment_status: 'paid',
    metadata: { kind: 'wallet_topup', userId, baseMinor: String(baseMinor), feeMinor: String(cardTopupFeeMinor(baseMinor)), currency: 'USD' },
  }
}

describe('Card (Mastercard) wallet top-up: 2.35% on top, webhook-only credit', () => {
  let app
  beforeAll(async () => {
    app = testApp()
    await ensureAdmin('topup-card-admin')
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('base-100 charges 10235 cents ($102.35) and records a $2 whole-unit fee', () => {
    expect(CARD_TOPUP_FEE_RATE).toBe(0.0235)
    expect(cardTopupChargeCents(100)).toBe(10235)
    expect(cardTopupFeeMinor(100)).toBe(2)
  })

  it('credits BASE (100) to the rider and the fee to platform on a paid session', async () => {
    const rider = await registerRider(app, 'topup-card-rider')
    const session = paidTopupSession(`cs_test_topup_${Date.now()}_A`, rider.id, 100)
    await creditWalletTopupSession(session)
    const wallet = await db().wallet.findUnique({ where: { userId_currency: { userId: rider.id, currency: 'USD' } } })
    expect(wallet.cachedBalanceMinor).toBe(100)
    const credit = await db().walletEntry.findFirst({ where: { referenceType: 'wallet_topup', referenceId: session.id, type: 'CREDIT' } })
    expect(credit.amountMinor).toBe(100)
    const fee = await db().walletEntry.findFirst({ where: { referenceType: 'card_processing_fee', referenceId: session.id, type: 'CREDIT' } })
    expect(fee.amountMinor).toBe(2)
  })

  it('an unpaid session credits nothing', async () => {
    const rider = await registerRider(app, 'topup-card-unpaid')
    const session = paidTopupSession(`cs_test_topup_${Date.now()}_U`, rider.id, 100)
    session.payment_status = 'unpaid'
    const result = await creditWalletTopupSession(session)
    expect(result).toBeNull()
    const wallet = await db().wallet.findUnique({ where: { userId_currency: { userId: rider.id, currency: 'USD' } } })
    expect(wallet?.cachedBalanceMinor || 0).toBe(0)
  })

  it('a replayed webhook does NOT double-credit', async () => {
    const rider = await registerRider(app, 'topup-card-replay')
    const session = paidTopupSession(`cs_test_topup_${Date.now()}_R`, rider.id, 100)
    await creditWalletTopupSession(session)
    await creditWalletTopupSession(session)
    const wallet = await db().wallet.findUnique({ where: { userId_currency: { userId: rider.id, currency: 'USD' } } })
    expect(wallet.cachedBalanceMinor).toBe(100)
    const credits = await db().walletEntry.findMany({ where: { referenceType: 'wallet_topup', referenceId: session.id } })
    expect(credits).toHaveLength(1)
  })
})
