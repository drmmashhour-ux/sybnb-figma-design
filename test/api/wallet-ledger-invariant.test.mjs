import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { recordWalletEntry, lockWalletForSpend } from '../../server/lib/finance-ledger.mjs'
import { giftClaimCode } from '../../server/lib/security.mjs'
import {
  cleanupTestUsers,
  fundWallet,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestPhone,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// ---------------------------------------------------------------------------
// FINANCIAL-INTEGRITY INVARIANT COVERAGE for the SYBNB wallet ledger.
//
// The core money-safety invariant this whole file defends:
//
//     wallet.cachedBalanceMinor  ==  signed sum of that wallet's WalletEntry rows
//
// where CREDIT / RELEASE / REFUND add, DEBIT subtracts, and HOLD contributes 0
// (a HOLD is a reservation marker with a deliberately-zero balance delta — see
// recordWalletEntry in server/lib/finance-ledger.mjs). cachedBalanceMinor is a
// denormalized cache maintained by { increment } on every entry; if it ever
// drifts from the ledger, admin finance totals, income projections, and every
// affordability gate read a lie. These tests reconstruct the balance from the
// raw entries after a mix of real operations and assert the cache still matches.
//
// They also pin the two properties that keep the cache honest under load:
//  - concurrent CREDITs are all applied (no lost updates), and
//  - concurrent spends can never overdraw a wallet negative (advisory-lock M2 fix),
// and the idempotency guarantee that a replayed operation key never double-applies.
// ---------------------------------------------------------------------------

// Reconstruct the balance from the ledger and assert the cache equals it AND that
// the wallet is never negative. Returns the reconciled balance for further asserts.
async function assertLedgerInvariant(userId, currency = 'SYP') {
  const wallet = await db().wallet.findUnique({
    where: { userId_currency: { userId, currency } },
    include: { entries: true },
  })
  if (!wallet) return 0
  const signedSum = wallet.entries.reduce((acc, entry) => {
    if (entry.type === 'CREDIT' || entry.type === 'RELEASE' || entry.type === 'REFUND') {
      return acc + entry.amountMinor
    }
    if (entry.type === 'DEBIT') return acc - entry.amountMinor
    return acc // HOLD carries a zero balance delta
  }, 0)
  expect(wallet.cachedBalanceMinor).toBe(signedSum)
  expect(wallet.cachedBalanceMinor).toBeGreaterThanOrEqual(0)
  return wallet.cachedBalanceMinor
}

describe('Wallet ledger financial-integrity invariant', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    const legacyVerificationGrant1 = await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1,
      role: 'GUEST',
      email,
      password: 'correct-horse-battery',
    })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }

  // A production-shaped balance-gated spend: acquire the per-(user,currency) advisory
  // lock, re-check the cached balance inside the transaction, then DEBIT — exactly the
  // contract chargeCompletedRide / tipCompletedRide / gift-send follow. Used to race a
  // raw ledger DEBIT against the real gift-send endpoint on one wallet.
  async function spendViaLedger(userId, amountMinor, currency, referenceId) {
    return db().$transaction(async (tx) => {
      await lockWalletForSpend(tx, userId, currency)
      const wallet = await tx.wallet.findUnique({
        where: { userId_currency: { userId, currency } },
      })
      if ((wallet?.cachedBalanceMinor || 0) < amountMinor) {
        const error = new Error('Insufficient credit for ledger spend.')
        error.code = 'INSUFFICIENT_CREDIT'
        throw error
      }
      return recordWalletEntry(tx, {
        userId,
        type: 'DEBIT',
        amountMinor,
        currency,
        referenceType: 'test_ledger_spend',
        referenceId,
        keyParts: ['test-ledger-spend', referenceId],
        note: 'test ledger spend',
      })
    })
  }

  const sendGift = (token, amountMinor, currency, recipientPhone) =>
    request(app)
      .post('/api/wallet/gifts')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountMinor, currency, recipientPhone })

  it('1. holds after a mix of fund / debit / gift-claim / gift-refund ops on the same wallet', async () => {
    const sender = await registerGuest('inv-mix-sender')
    const recipient = await registerGuest('inv-mix-recipient')

    // CREDIT: fund the sender.
    await fundWallet(sender.id, 100_000, 'SYP')
    await assertLedgerInvariant(sender.id)

    // DEBIT + downstream CREDIT to a second wallet: send a claimable gift and let the
    // recipient claim it. The sender is debited permanently; the recipient is credited.
    const recipientPhone = uniqueTestPhone()
    const claimable = await sendGift(sender.token, 10_000, 'SYP', recipientPhone)
    expect(claimable.status).toBe(201)
    expect(claimable.body.gift.status).toBe('SENT')
    const claimRes = await request(app)
      .post(`/api/wallet/gifts/${claimable.body.gift.id}/claim`)
      .set('Authorization', `Bearer ${recipient.token}`)
      .send({ phone: recipientPhone, code: giftClaimCode(claimable.body.gift) })
    expect(claimRes.status).toBe(200)

    // DEBIT then REFUND on the same wallet: send a second gift, force it past expiry, and
    // let the sender's own wallet read run the expire-and-refund sweep. Net-zero on balance
    // but leaves a DEBIT and a REFUND entry that must both reconcile.
    const expiring = await sendGift(sender.token, 20_000, 'SYP', uniqueTestPhone())
    expect(expiring.status).toBe(201)
    await db().walletGift.update({
      where: { id: expiring.body.gift.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const sweep = await request(app).get('/api/wallet').set('Authorization', `Bearer ${sender.token}`)
    expect(sweep.status).toBe(200)

    // A couple of raw ledger ops for good measure (one spend, one credit).
    await spendViaLedger(sender.id, 5_000, 'SYP', `inv-mix-spend-${sender.id}`)
    await db().$transaction((tx) =>
      recordWalletEntry(tx, {
        userId: sender.id,
        type: 'CREDIT',
        amountMinor: 3_000,
        currency: 'SYP',
        referenceType: 'test_bonus',
        referenceId: `inv-mix-bonus-${sender.id}`,
        keyParts: ['inv-mix-bonus', sender.id],
        note: 'bonus credit',
      }),
    )

    // Reconcile both wallets against their raw ledgers.
    // sender: 100_000 - 10_000 (gifted away, claimed) - 20_000 + 20_000 (refunded) - 5_000 + 3_000
    const senderBalance = await assertLedgerInvariant(sender.id)
    expect(senderBalance).toBe(88_000)

    // recipient: exactly the one claimed gift.
    const recipientBalance = await assertLedgerInvariant(recipient.id)
    expect(recipientBalance).toBe(10_000)
  })

  it('2. concurrent CREDITs to one wallet are all applied (no lost updates)', async () => {
    const user = await registerGuest('inv-concurrent-credit')
    const N = 12
    const EACH = 1_000

    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        db().$transaction((tx) =>
          recordWalletEntry(tx, {
            userId: user.id,
            type: 'CREDIT',
            amountMinor: EACH,
            currency: 'SYP',
            referenceType: 'test_concurrent_credit',
            referenceId: `inv-cc-${user.id}-${i}`,
            keyParts: ['inv-cc', user.id, String(i)],
            note: 'concurrent credit',
          }),
        ),
      ),
    )

    const balance = await assertLedgerInvariant(user.id)
    expect(balance).toBe(N * EACH) // every increment landed; none lost to a read-modify-write race
    const credits = await db().walletEntry.count({
      where: { referenceType: 'test_concurrent_credit', type: 'CREDIT' },
    })
    expect(credits).toBe(N)
  })

  it('3. concurrent DEBIT + DEBIT (two gift sends) funded for one never overdraws', async () => {
    const sender = await registerGuest('inv-debit-debit')
    const GIFT = 10_000
    // Funded for EXACTLY one gift; fire two simultaneously.
    await fundWallet(sender.id, GIFT, 'SYP')

    const [a, b] = await Promise.all([
      sendGift(sender.token, GIFT, 'SYP', uniqueTestPhone()),
      sendGift(sender.token, GIFT, 'SYP', uniqueTestPhone()),
    ])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([201, 402]) // exactly one succeeds, never both
    const rejected = [a, b].find((r) => r.status === 402)
    expect(rejected.body.error.code).toBe('INSUFFICIENT_CREDIT')

    const balance = await assertLedgerInvariant(sender.id)
    expect(balance).toBe(0) // settled at zero, never negative
    const debits = await db().walletEntry.count({
      where: { referenceType: 'wallet_gift_send', type: 'DEBIT' },
    })
    // only the winning gift produced a debit for this sender
    const senderWallet = await db().wallet.findUnique({
      where: { userId_currency: { userId: sender.id, currency: 'SYP' } },
    })
    const senderDebits = await db().walletEntry.count({
      where: { walletId: senderWallet.id, referenceType: 'wallet_gift_send' },
    })
    expect(senderDebits).toBe(1)
    expect(debits).toBeGreaterThanOrEqual(1)
  })

  it('4. concurrent DEBIT (raw ledger spend) + gift-send funded for one never overdraws', async () => {
    const sender = await registerGuest('inv-debit-gift')
    const AMOUNT = 10_000
    // Funded for EXACTLY one of the two spends; both take the same advisory lock and serialize.
    await fundWallet(sender.id, AMOUNT, 'SYP')

    const results = await Promise.allSettled([
      spendViaLedger(sender.id, AMOUNT, 'SYP', `inv-debit-gift-spend-${sender.id}`),
      sendGift(sender.token, AMOUNT, 'SYP', uniqueTestPhone()),
    ])

    // The raw spend resolves-or-throws; the gift send resolves to a 201/402 response.
    const spendOutcome = results[0]
    const giftOutcome = results[1]
    const spendSucceeded = spendOutcome.status === 'fulfilled'
    const giftSucceeded = giftOutcome.status === 'fulfilled' && giftOutcome.value.status === 201

    // Exactly one of the two mutually-exclusive spends may win.
    expect(spendSucceeded !== giftSucceeded).toBe(true)
    if (!giftSucceeded && giftOutcome.status === 'fulfilled') {
      expect(giftOutcome.value.status).toBe(402)
      expect(giftOutcome.value.body.error.code).toBe('INSUFFICIENT_CREDIT')
    }

    const balance = await assertLedgerInvariant(sender.id)
    expect(balance).toBe(0) // exactly one spend applied; wallet never went negative
  })

  it('5. idempotency: replaying the same operation key never double-applies (sequential + concurrent)', async () => {
    const user = await registerGuest('inv-idempotency')
    const keyParts = ['inv-idem', user.id, 'fixed']
    const AMOUNT = 7_000

    const record = () =>
      db().$transaction((tx) =>
        recordWalletEntry(tx, {
          userId: user.id,
          type: 'CREDIT',
          amountMinor: AMOUNT,
          currency: 'SYP',
          referenceType: 'test_idem_credit',
          referenceId: `inv-idem-${user.id}`,
          keyParts,
          note: 'idempotent credit',
        }),
      )

    // Sequential replay: the second call returns the SAME entry and moves no additional money.
    const first = await record()
    const second = await record()
    expect(second.id).toBe(first.id)
    let balance = await assertLedgerInvariant(user.id)
    expect(balance).toBe(AMOUNT)

    // Concurrent replay of the same key: the unique idempotencyKey constraint means at most one
    // insert wins; any loser rejects on the constraint. Net effect must still be a single credit.
    const settled = await Promise.allSettled([record(), record(), record(), record()])
    const fulfilled = settled.filter((r) => r.status === 'fulfilled')
    expect(fulfilled.length).toBeGreaterThanOrEqual(1)

    const entries = await db().walletEntry.count({
      where: { referenceType: 'test_idem_credit', referenceId: `inv-idem-${user.id}` },
    })
    expect(entries).toBe(1) // exactly one entry ever exists for this key
    balance = await assertLedgerInvariant(user.id)
    expect(balance).toBe(AMOUNT) // still credited exactly once
  })

  it('6. cross-currency isolation: a USD gift cannot be paid from a SYP balance', async () => {
    const sender = await registerGuest('inv-cross-currency')
    // Fund ONLY the SYP wallet.
    await fundWallet(sender.id, 100_000, 'SYP')

    // A USD gift must be gated against the (empty) USD wallet, not the funded SYP one.
    const usdGift = await sendGift(sender.token, 20, 'USD', uniqueTestPhone())
    expect(usdGift.status).toBe(402)
    expect(usdGift.body.error.code).toBe('INSUFFICIENT_CREDIT')

    // SYP balance untouched; USD wallet either absent or zero. Both reconcile.
    const sypBalance = await assertLedgerInvariant(sender.id, 'SYP')
    expect(sypBalance).toBe(100_000)
    const usdBalance = await assertLedgerInvariant(sender.id, 'USD')
    expect(usdBalance).toBe(0)

    // A SYP gift succeeds and only moves SYP; the USD wallet stays isolated.
    const sypGift = await sendGift(sender.token, 10_000, 'SYP', uniqueTestPhone())
    expect(sypGift.status).toBe(201)
    expect(await assertLedgerInvariant(sender.id, 'SYP')).toBe(90_000)
    expect(await assertLedgerInvariant(sender.id, 'USD')).toBe(0)
  })
})
