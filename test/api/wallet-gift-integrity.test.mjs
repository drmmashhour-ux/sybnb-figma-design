import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { giftClaimCode, hashPhone, createSessionToken } from '../../server/lib/security.mjs'
import {
  cleanupTestUsers,
  fundWallet,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestPhone,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// Money-conservation coverage for the wallet-gift mint fix (server/routes/wallet.mjs +
// server/lib/gift-ledger.mjs). Before the fix, POST /api/wallet/gifts created a gift WITHOUT debiting the
// sender, while claim credited the recipient the full amount — so a claim minted money. These prove the
// gift is now a conserved transfer: debited at send, credited on claim, refunded on every non-claimed
// terminal state, each keyed on the gift id so nothing double-moves.
describe('Wallet gifts conserve money (mint fix)', () => {
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
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, id: res.body.user.id }
  }

  async function bootstrapAdmin(label) {
    const admin = await db().user.create({
      data: { email: uniqueTestEmail(label), displayName: 'Gift Admin', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'ADMIN' } } },
      include: { roles: true },
    })
    trackTestUser(admin.id)
    return createSessionToken(admin)
  }

  const balance = async (userId, currency = 'SYP') =>
    (await db().wallet.findUnique({ where: { userId_currency: { userId, currency } } }))?.cachedBalanceMinor || 0

  it('1. refuses a gift the sender cannot afford — no gift row, balance untouched', async () => {
    const sender = await registerGuest('gift-poor-sender')
    const res = await request(app).post('/api/wallet/gifts').set('Authorization', `Bearer ${sender.token}`).send({ recipientPhone: uniqueTestPhone(), amountMinor: 5000, currency: 'SYP' })
    expect(res.status).toBe(402)
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDIT')
    expect(await db().walletGift.count({ where: { senderUserId: sender.id } })).toBe(0)
    expect(await balance(sender.id)).toBe(0)
  })

  it('2. debits the sender at send time', async () => {
    const sender = await registerGuest('gift-debit-sender')
    await fundWallet(sender.id, 5000, 'SYP')
    const res = await request(app).post('/api/wallet/gifts').set('Authorization', `Bearer ${sender.token}`).send({ recipientPhone: uniqueTestPhone(), amountMinor: 5000, currency: 'SYP' })
    expect(res.status).toBe(201)
    expect(await balance(sender.id)).toBe(0)
    const debit = await db().walletEntry.findFirst({ where: { referenceType: 'wallet_gift_send', referenceId: res.body.gift.id } })
    expect(debit).not.toBeNull()
    expect(debit.type).toBe('DEBIT')
    expect(debit.amountMinor).toBe(5000)
  })

  it('3. CONSERVATION: send + claim leaves the platform total unchanged (mint regression)', async () => {
    // Meaningful-test note: this is the exact assertion that fails with the send-debit removed. Without
    // debitGiftFromSender, the sender keeps their 5000 AND the recipient gains 5000, so total1 would be
    // total0 + X (money minted). With the fix, total is conserved.
    const X = 5000
    const sender = await registerGuest('gift-cons-sender')
    const recipient = await registerGuest('gift-cons-recipient')
    await fundWallet(sender.id, X, 'SYP')
    const recipientPhone = uniqueTestPhone()

    const total0 = (await balance(sender.id)) + (await balance(recipient.id))
    expect(total0).toBe(X)

    const sendRes = await request(app).post('/api/wallet/gifts').set('Authorization', `Bearer ${sender.token}`).send({ recipientPhone, amountMinor: X, currency: 'SYP' })
    expect(sendRes.status).toBe(201)
    const gift = sendRes.body.gift
    expect(gift.status).toBe('SENT') // < 100k → immediately claimable, no admin gate

    const claimRes = await request(app).post(`/api/wallet/gifts/${gift.id}/claim`).set('Authorization', `Bearer ${recipient.token}`).send({ phone: recipientPhone, code: giftClaimCode(gift) })
    expect(claimRes.status).toBe(200)

    const total1 = (await balance(sender.id)) + (await balance(recipient.id))
    expect(await balance(recipient.id)).toBe(X)
    expect(await balance(sender.id)).toBe(0)
    expect(total1).toBe(total0)
  })

  it('4. expiry refunds the sender exactly once (idempotent on repeated reads)', async () => {
    const X = 5000
    const sender = await registerGuest('gift-expire-sender')
    await fundWallet(sender.id, X, 'SYP')
    const sendRes = await request(app).post('/api/wallet/gifts').set('Authorization', `Bearer ${sender.token}`).send({ recipientPhone: uniqueTestPhone(), amountMinor: X, currency: 'SYP' })
    const gift = sendRes.body.gift
    expect(await balance(sender.id)).toBe(0)

    // Force the gift past its expiry, then let the sender's own wallet read run the expire-and-refund sweep.
    await db().walletGift.update({ where: { id: gift.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const first = await request(app).get('/api/wallet').set('Authorization', `Bearer ${sender.token}`)
    expect(first.status).toBe(200)
    expect((await db().walletGift.findUnique({ where: { id: gift.id } })).status).toBe('EXPIRED')
    expect(await balance(sender.id)).toBe(X) // refunded

    // A second sweep must not refund again.
    await request(app).get('/api/wallet').set('Authorization', `Bearer ${sender.token}`)
    expect(await balance(sender.id)).toBe(X)
    expect(await db().walletEntry.count({ where: { referenceType: 'wallet_gift_refund', referenceId: gift.id } })).toBe(1)
  })

  it('5. admin-block refunds the sender exactly once', async () => {
    const X = 150000 // >= 100k → CLAIM_PENDING, enters the admin gate
    const sender = await registerGuest('gift-block-sender')
    await fundWallet(sender.id, X, 'SYP')
    const adminToken = await bootstrapAdmin('gift-block-admin')
    const sendRes = await request(app).post('/api/wallet/gifts').set('Authorization', `Bearer ${sender.token}`).send({ recipientPhone: uniqueTestPhone(), amountMinor: X, currency: 'SYP' })
    const gift = sendRes.body.gift
    expect(gift.status).toBe('CLAIM_PENDING')
    expect(await balance(sender.id)).toBe(0)

    const reject = await request(app).patch(`/api/admin/review-queue/gift/${gift.id}`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'REJECT' })
    expect(reject.status).toBe(200)
    expect((await db().walletGift.findUnique({ where: { id: gift.id } })).status).toBe('ADMIN_BLOCKED')
    expect(await balance(sender.id)).toBe(X) // refunded
    expect(await db().walletEntry.count({ where: { referenceType: 'wallet_gift_refund', referenceId: gift.id } })).toBe(1)
  })

  it('6. refuses a self-gift', async () => {
    const sender = await registerGuest('gift-self-sender')
    const selfPhone = uniqueTestPhone()
    // Give the sender a phone identity matching the gift target so the self-gift guard applies.
    await db().user.update({ where: { id: sender.id }, data: { phoneHash: hashPhone(selfPhone) } })
    await fundWallet(sender.id, 5000, 'SYP')
    const res = await request(app).post('/api/wallet/gifts').set('Authorization', `Bearer ${sender.token}`).send({ recipientPhone: selfPhone, amountMinor: 5000, currency: 'SYP' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('GIFT_SELF_NOT_ALLOWED')
    expect(await db().walletGift.count({ where: { senderUserId: sender.id } })).toBe(0)
  })
})
