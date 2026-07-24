import { afterEach, describe, expect, it } from 'vitest'
import {
  ACTIVE_PROOF_STATUSES, HOLD_POLICY_VERSION, evaluateHoldEligibility, expectedHoldExpiryAt,
  holdWindowMs, resolvePaymentMethod,
} from '../../server/lib/booking-hold-policy.mjs'

// SYB-002 — pure expiry-policy unit tests. Eligibility is computed at sweep time from the creation
// timestamp + payment/proof state + configurable per-method window. No state, no I/O.

const MIN = 60 * 1000
const NOW = 1_800_000_000_000 // fixed reference instant (Date.now() is unavailable in some contexts)

function hold({ createdMinsAgo = 0, payments = [], status = 'PAYMENT_PENDING', checkIn = null } = {}) {
  return { status, createdAt: new Date(NOW - createdMinsAgo * MIN).toISOString(), checkIn, payments }
}

describe('SYB-002 policy — payment-method resolution', () => {
  it('maps stripe -> card, wallet/sham -> wallet, bank -> bank_transfer, none -> unknown', () => {
    expect(resolvePaymentMethod([{ provider: 'stripe', createdAt: new Date(NOW).toISOString() }])).toBe('card')
    expect(resolvePaymentMethod([{ provider: 'syrian_local_wallet', createdAt: new Date(NOW).toISOString() }])).toBe('wallet')
    expect(resolvePaymentMethod([{ provider: 'bank_transfer', createdAt: new Date(NOW).toISOString() }])).toBe('bank_transfer')
    expect(resolvePaymentMethod([])).toBe('unknown')
  })
  it('uses the most recent proof provider when several exist', () => {
    expect(resolvePaymentMethod([
      { provider: 'syrian_local_wallet', createdAt: new Date(NOW - 10 * MIN).toISOString() },
      { provider: 'stripe', createdAt: new Date(NOW).toISOString() },
    ])).toBe('card')
  })
})

describe('SYB-002 policy — configurable windows by payment method', () => {
  afterEach(() => { delete process.env.HOLD_EXPIRY_UNKNOWN_MINUTES })
  it('unknown default is 24h, wallet 60m, card 30m, bank_transfer 72h', () => {
    expect(holdWindowMs('unknown', {})).toBe(24 * 60 * MIN)
    expect(holdWindowMs('wallet', {})).toBe(60 * MIN)
    expect(holdWindowMs('card', {})).toBe(30 * MIN)
    expect(holdWindowMs('bank_transfer', {})).toBe(72 * 60 * MIN)
  })
  it('is overridable per method via HOLD_EXPIRY_<METHOD>_MINUTES', () => {
    expect(holdWindowMs('unknown', { HOLD_EXPIRY_UNKNOWN_MINUTES: '5' })).toBe(5 * MIN)
    // invalid override falls back to the default rather than a zero/NaN window
    expect(holdWindowMs('unknown', { HOLD_EXPIRY_UNKNOWN_MINUTES: 'nope' })).toBe(24 * 60 * MIN)
    expect(holdWindowMs('unknown', { HOLD_EXPIRY_UNKNOWN_MINUTES: '0' })).toBe(24 * 60 * MIN)
  })
})

describe('SYB-002 policy — eligibility', () => {
  const opts = { now: NOW, env: {} }

  it('NOT eligible — not yet expired (within window)', () => {
    const v = evaluateHoldEligibility(hold({ createdMinsAgo: 10 }), opts) // unknown method, 24h window
    expect(v.eligible).toBe(false)
    expect(v.reason).toBe('within-window')
  })
  it('eligible — expired and no proof (past the unknown 24h window)', () => {
    const v = evaluateHoldEligibility(hold({ createdMinsAgo: 25 * 60 }), opts)
    expect(v.eligible).toBe(true)
    expect(v.method).toBe('unknown')
  })
  it('NOT eligible — a proof is under review, regardless of age', () => {
    for (const status of ACTIVE_PROOF_STATUSES) {
      const v = evaluateHoldEligibility(hold({ createdMinsAgo: 100 * 60, payments: [{ provider: 'syrian_local_wallet', status, createdAt: new Date(NOW).toISOString() }] }), opts)
      expect(v.eligible, `active proof ${status} must not be eligible`).toBe(false)
      expect(v.reason).toBe('proof-under-review')
    }
  })
  it('NOT eligible — confirmed / cancelled / completed / rejected-only bookings', () => {
    for (const status of ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'REQUESTED']) {
      expect(evaluateHoldEligibility(hold({ createdMinsAgo: 100 * 60, status }), opts).eligible).toBe(false)
    }
  })
  it('eligible — a rejected proof does not protect the hold (not an active status)', () => {
    const v = evaluateHoldEligibility(hold({ createdMinsAgo: 100 * 60, payments: [{ provider: 'stripe', status: 'REJECTED', createdAt: new Date(NOW).toISOString() }] }), opts)
    expect(v.eligible).toBe(true)
  })
  it('eligible — past-dated check-in fast-path even within the window', () => {
    const v = evaluateHoldEligibility(hold({ createdMinsAgo: 1, checkIn: new Date(NOW - 24 * 60 * MIN).toISOString() }), opts)
    expect(v.eligible).toBe(true)
    expect(v.reason).toBe('check-in-passed')
  })
  it('respects a per-method window override (wallet, tightened to 5m)', () => {
    const b = hold({ createdMinsAgo: 10, payments: [{ provider: 'syrian_local_wallet', status: 'REJECTED', createdAt: new Date(NOW).toISOString() }] })
    expect(evaluateHoldEligibility(b, { now: NOW, env: {} }).eligible).toBe(false) // 60m window
    expect(evaluateHoldEligibility(b, { now: NOW, env: { HOLD_EXPIRY_WALLET_MINUTES: '5' } }).eligible).toBe(true)
  })
})

describe('SYB-002 policy — expected expiry (host-facing, computed not persisted)', () => {
  it('computes createdAt + method window for a live hold', () => {
    const b = hold({ createdMinsAgo: 0 })
    const at = expectedHoldExpiryAt(b, {})
    expect(at.getTime()).toBe(new Date(b.createdAt).getTime() + 24 * 60 * MIN)
  })
  it('returns null for a non-hold booking', () => {
    expect(expectedHoldExpiryAt(hold({ status: 'CONFIRMED' }), {})).toBeNull()
  })
})

describe('SYB-002 policy — version constant is stable', () => {
  it('exposes a policy version for audit/metadata', () => {
    expect(HOLD_POLICY_VERSION).toBe('hold-policy-v1')
  })
})
