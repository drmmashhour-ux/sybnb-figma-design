import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import {
  cleanupTestUsers,
  fundWallet,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestPhone,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// Regression coverage for the wallet overdraw race (M2). Every balance-gated spend
// (gift-send here, plus SR fare/tip/cancellation) reads cachedBalanceMinor, checks affordability,
// then writes a DEBIT. Under READ COMMITTED, two concurrent gifts on the same wallet could BOTH read
// the same balance, BOTH pass the check, and BOTH debit -- overdrawing the wallet negative. The fix
// takes a per-(user,currency) advisory lock (lockWalletForSpend) at the top of each spend
// transaction, forcing them to run one at a time. This test funds a wallet for exactly ONE gift and
// fires two simultaneously: exactly one must succeed, the wallet must never go negative.
describe('POST /api/wallet/gifts is overdraw-safe under concurrent sends (M2)', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'correct-horse-battery',
    })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }

  it('funds one gift, fires two concurrently: exactly one succeeds and the wallet never goes negative', async () => {
    const sender = await registerGuest('gift-race-sender')
    const GIFT = 10_000
    // Fund the sender for EXACTLY one gift.
    await fundWallet(sender.id, GIFT, 'SYP')

    const send = (recipientPhone) =>
      request(app)
        .post('/api/wallet/gifts')
        .set('Authorization', `Bearer ${sender.token}`)
        .send({ amountMinor: GIFT, currency: 'SYP', recipientPhone })

    const [resA, resB] = await Promise.all([send(uniqueTestPhone()), send(uniqueTestPhone())])

    // Exactly one send succeeds; the other is rejected for insufficient credit -- never both.
    const statuses = [resA.status, resB.status].sort()
    expect(statuses).toEqual([201, 402])
    const rejected = [resA, resB].find((r) => r.status === 402)
    expect(rejected.body.error.code).toBe('INSUFFICIENT_CREDIT')

    // The wallet settled at exactly zero -- never negative, never double-spent.
    const wallet = await db().wallet.findUnique({
      where: { userId_currency: { userId: sender.id, currency: 'SYP' } },
    })
    expect(wallet.cachedBalanceMinor).toBe(0)
    expect(wallet.cachedBalanceMinor).toBeGreaterThanOrEqual(0)

    // Ledger reflects a single gift DEBIT, and exactly one gift row exists.
    const debits = await db().walletEntry.count({
      where: { walletId: wallet.id, type: 'DEBIT' },
    })
    expect(debits).toBe(1)
    const gifts = await db().walletGift.count({ where: { senderUserId: sender.id } })
    expect(gifts).toBe(1)
  })
})
