import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPhone } from '../../server/lib/security.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestPhone,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// Regression coverage for L1: GET /api/wallet/gifts/:id used to return a gift's amount, message and
// parties to ANY authenticated user who knew (or guessed a leaked) gift id. It is now scoped to the
// sender and the intended recipient; everyone else gets a 404 that doesn't even confirm the id exists.
describe('GET /api/wallet/gifts/:id is private to sender + recipient (L1)', () => {
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
    return { id: res.body.user.id, token: res.body.token }
  }

  async function createGift(senderId, recipientPhone) {
    return db().walletGift.create({
      data: {
        senderUserId: senderId,
        recipientPhoneHash: hashPhone(recipientPhone),
        amountMinor: 7_500,
        currency: 'SYP',
        message: 'private note',
        status: 'SENT',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      },
    })
  }

  const preview = (token, id) =>
    request(app).get(`/api/wallet/gifts/${id}`).set('Authorization', `Bearer ${token}`)

  it('lets the sender preview their own gift', async () => {
    const sender = await registerGuest('gift-priv-sender')
    const gift = await createGift(sender.id, uniqueTestPhone())

    const res = await preview(sender.token, gift.id)
    expect(res.status).toBe(200)
    expect(res.body.gift.amountMinor).toBe(7_500)
    expect(res.body.gift.message).toBe('private note')
  })

  it('404s an unrelated authenticated user (no info disclosure)', async () => {
    const sender = await registerGuest('gift-priv-sender2')
    const stranger = await registerGuest('gift-priv-stranger')
    const gift = await createGift(sender.id, uniqueTestPhone())

    const res = await preview(stranger.token, gift.id)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('GIFT_NOT_FOUND')
    expect(res.body.gift).toBeUndefined()
  })

  it('lets the intended recipient (matching phone hash) preview it', async () => {
    const sender = await registerGuest('gift-priv-sender3')
    const recipient = await registerGuest('gift-priv-recipient')
    const phone = uniqueTestPhone()
    // The recipient is identified by phone hash; give the recipient account that phone.
    await db().user.update({ where: { id: recipient.id }, data: { phoneHash: hashPhone(phone) } })
    const gift = await createGift(sender.id, phone)

    const res = await preview(recipient.token, gift.id)
    expect(res.status).toBe(200)
    expect(res.body.gift.amountMinor).toBe(7_500)
  })
})
