import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { recordWalletEntry, debitableMinor, lockWalletForSpend } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Proves the two distinct DEBIT policies the codebase deliberately uses, and that ledger + wallet state
// stay internally consistent in every case:
//   1. UNFLOORED debit (the S5 host-payout clawback): recovers the full amount, going negative = debt
//      owed. Flooring it would let a host who already spent a released payout keep the money while the
//      platform absorbs the loss — exactly what S5 forbids. So debt semantics are CORRECT here.
//   2. FLOORED debit (host-cancel fee + share reversals, via debitableMinor): never drives a wallet
//      negative; an empty wallet is simply not charged.
// The invariant asserted throughout: cachedBalanceMinor === signed sum of that wallet's WalletEntry rows.

const SYP = 'SYP'

async function makeUser(label) {
  const u = await db().user.create({
    data: { email: uniqueTestEmail(label), displayName: label, referralCode: uniqueTestReferralCode() },
  })
  trackTestUser(u.id)
  return u.id
}

async function credit(userId, amountMinor, key) {
  return db().$transaction((tx) =>
    recordWalletEntry(tx, { userId, type: 'CREDIT', amountMinor, currency: SYP, referenceType: 'test_fund', referenceId: key, keyParts: ['test-fund', key], note: 'fund' }),
  )
}

// Models the S5 clawback: an UNFLOORED debit keyed on the (booking, payment) pair.
async function clawback(userId, amountMinor, key) {
  return db().$transaction((tx) =>
    recordWalletEntry(tx, { userId, type: 'DEBIT', amountMinor, currency: SYP, referenceType: 'booking_payout_clawback', referenceId: key, keyParts: ['booking-host-payout-clawback', key], note: 'clawback' }),
  )
}

// Models the FLOORED fee/reversal: cap at available, then debit only what's available.
async function flooredDebit(userId, requestedMinor, key) {
  return db().$transaction(async (tx) => {
    await lockWalletForSpend(tx, userId, SYP) // serialize the read-then-write, as the real fee paths now do
    const amt = await debitableMinor(tx, userId, SYP, requestedMinor)
    if (amt > 0) {
      await recordWalletEntry(tx, { userId, type: 'DEBIT', amountMinor: amt, currency: SYP, referenceType: 'test_floored_fee', referenceId: key, keyParts: ['test-floored', key], note: 'floored fee' })
    }
    return amt
  })
}

async function walletState(userId, currency = SYP) {
  const wallet = await db().wallet.findUnique({ where: { userId_currency: { userId, currency } } })
  if (!wallet) return { balance: 0, entrySum: 0, entryCount: 0 }
  const entries = await db().walletEntry.findMany({ where: { walletId: wallet.id } })
  const sign = (t) => (t === 'CREDIT' || t === 'RELEASE' || t === 'REFUND' ? 1 : t === 'DEBIT' ? -1 : 0)
  const entrySum = entries.reduce((acc, e) => acc + sign(e.type) * e.amountMinor, 0)
  return { balance: wallet.cachedBalanceMinor, entrySum, entryCount: entries.length }
}

// The core invariant: cache matches the ledger, exactly.
async function expectReconciled(userId) {
  const s = await walletState(userId)
  expect(s.balance).toBe(s.entrySum)
  return s
}

describe('S5 payout clawback — debt semantics (unfloored) + reconciliation', () => {
  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('Case A: payout 100, available 100, clawback 100 → balance 0, reconciles', async () => {
    const u = await makeUser('claw-a')
    await credit(u, 100, `a-${u}`)
    await clawback(u, 100, `a-${u}`)
    const s = await expectReconciled(u)
    expect(s.balance).toBe(0)
  })

  it('Case B: available 40, clawback 100 → balance -60 (debt), full amount recovered, reconciles', async () => {
    const u = await makeUser('claw-b')
    await credit(u, 40, `b-${u}`)
    await clawback(u, 100, `b-${u}`)
    const s = await expectReconciled(u)
    expect(s.balance).toBe(-60) // host now OWES 60 — the platform is made whole for the full 100
  })

  it('Case C: available 0, clawback 100 → balance -100 (debt), reconciles', async () => {
    const u = await makeUser('claw-c')
    await clawback(u, 100, `c-${u}`)
    const s = await expectReconciled(u)
    expect(s.balance).toBe(-100)
  })

  it('Case D: repeated clawback of the same payout is idempotent (no double-charge)', async () => {
    const u = await makeUser('claw-d')
    await credit(u, 100, `d-${u}`)
    await clawback(u, 100, `d-${u}`)
    await clawback(u, 100, `d-${u}`) // replay same key
    const s = await expectReconciled(u)
    expect(s.balance).toBe(0)
    expect(s.entryCount).toBe(2) // one credit + exactly one clawback debit
  })

  it('Case E: two concurrent clawbacks of the same payout apply exactly once', async () => {
    const u = await makeUser('claw-e')
    await credit(u, 100, `e-${u}`)
    // Same idempotency key raced: the unique idempotencyKey guarantees at most one debit lands.
    await Promise.allSettled([clawback(u, 100, `e-${u}`), clawback(u, 100, `e-${u}`)])
    const debits = await db().walletEntry.count({
      where: { wallet: { userId: u }, referenceType: 'booking_payout_clawback' },
    })
    expect(debits).toBe(1)
    const s = await expectReconciled(u)
    expect(s.balance).toBe(0)
  })

  it('Case F: partial debt recovery — later earnings pay down the negative balance', async () => {
    const u = await makeUser('claw-f')
    await clawback(u, 100, `f-${u}`) // balance -100 (debt)
    await credit(u, 60, `f1-${u}`) // earn 60 → -40
    expect((await expectReconciled(u)).balance).toBe(-40)
    await credit(u, 50, `f2-${u}`) // earn 50 → +10
    expect((await expectReconciled(u)).balance).toBe(10)
  })
})

describe('Floored DEBIT (fee/reversal) — never negative + reconciliation', () => {
  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('debit from an empty wallet floors to 0 (no debit, no negative, no wallet row forced)', async () => {
    const u = await makeUser('floor-empty')
    const debited = await flooredDebit(u, 10, `fe-${u}`)
    expect(debited).toBe(0)
    const s = await walletState(u)
    expect(s.balance).toBe(0)
    expect(s.balance).toBeGreaterThanOrEqual(0)
  })

  it('debit 100 against balance 40 floors to 40 → balance 0, reconciles', async () => {
    const u = await makeUser('floor-partial')
    await credit(u, 40, `fp-${u}`)
    const debited = await flooredDebit(u, 100, `fp-${u}`)
    expect(debited).toBe(40)
    const s = await expectReconciled(u)
    expect(s.balance).toBe(0)
  })

  it('fee TRANSFER from an empty wallet mints nothing (both legs use the floored amount = 0)', async () => {
    const payer = await makeUser('fee-payer-empty')
    const payee = await makeUser('fee-payee')
    await credit(payee, 500, `fpe-${payee}`)
    // Transfer 10 from an empty payer → floored to 0 → neither leg records anything.
    const feeMinor = await db().$transaction(async (tx) => {
      const amt = await debitableMinor(tx, payer, SYP, 10)
      if (amt > 0) {
        await recordWalletEntry(tx, { userId: payer, type: 'DEBIT', amountMinor: amt, currency: SYP, referenceType: 'test_fee', referenceId: `t-${payer}`, keyParts: ['t-fee-d', payer], note: 'fee debit' })
        await recordWalletEntry(tx, { userId: payee, type: 'CREDIT', amountMinor: amt, currency: SYP, referenceType: 'test_fee', referenceId: `t-${payer}`, keyParts: ['t-fee-c', payer], note: 'fee credit' })
      }
      return amt
    })
    expect(feeMinor).toBe(0)
    expect((await walletState(payer)).balance).toBe(0)
    expect((await expectReconciled(payee)).balance).toBe(500) // payee unchanged — no money minted
  })

  it('two concurrent floored debits against balance 30 never overdraw (sum debited <= 30, never negative)', async () => {
    const u = await makeUser('floor-concurrent')
    await credit(u, 30, `fc-${u}`)
    await Promise.allSettled([flooredDebit(u, 20, `fc1-${u}`), flooredDebit(u, 20, `fc2-${u}`)])
    const s = await expectReconciled(u)
    expect(s.balance).toBeGreaterThanOrEqual(0)
    expect(s.balance).toBeLessThanOrEqual(30)
  })
})
