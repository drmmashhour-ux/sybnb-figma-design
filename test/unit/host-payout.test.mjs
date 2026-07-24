import { describe, expect, it } from 'vitest'
import { APPROVED_PAYOUT_METHODS, maskPayoutMethod, normalizePayoutMethod, HOST_PAYOUT_POLICY_VERSION } from '../../server/lib/host-payout.mjs'

// SYB-011 — pure payout-method validation + masking.

describe('SYB-011 — payout method validation', () => {
  it('accepts sham_cash with the minimum fields', () => {
    const m = normalizePayoutMethod({ type: 'sham_cash', receiverName: 'Layla', phone: '0999123456' })
    expect(m).toEqual({ type: 'sham_cash', version: 1, receiverName: 'Layla', phone: '0999123456' })
  })
  it('accepts bank_transfer with the minimum fields', () => {
    const m = normalizePayoutMethod({ type: 'bank_transfer', receiverName: 'Omar', accountRef: 'SY0000000001' })
    expect(m.type).toBe('bank_transfer')
    expect(m.accountRef).toBe('SY0000000001')
  })
  it('rejects an unknown method type', () => {
    expect(() => normalizePayoutMethod({ type: 'paypal', receiverName: 'x', phone: 'y' })).toThrow(/PAYOUT_METHOD_TYPE_INVALID|Unsupported/)
  })
  it('rejects a missing required field', () => {
    expect(() => normalizePayoutMethod({ type: 'sham_cash', receiverName: 'Layla' })).toThrow(/required/i)
  })
  it('rejects an unexpected/sensitive field (no smuggled data)', () => {
    expect(() => normalizePayoutMethod({ type: 'sham_cash', receiverName: 'Layla', phone: '0999', password: 'secret' })).toThrow(/PAYOUT_METHOD_UNKNOWN_FIELD|Unexpected/)
  })
  it('only sham_cash and bank_transfer are approved', () => {
    expect(Object.keys(APPROVED_PAYOUT_METHODS).sort()).toEqual(['bank_transfer', 'sham_cash'])
  })
})

describe('SYB-011 — payout method masking', () => {
  it('masks phone/account, keeps type + receiver name', () => {
    const masked = maskPayoutMethod({ type: 'sham_cash', receiverName: 'Layla', phone: '0999123456' })
    expect(masked.type).toBe('sham_cash')
    expect(masked.receiverName).toBe('Layla')
    expect(masked.phone).toMatch(/^••••/)
    expect(masked.phone).not.toContain('0999123')
  })
  it('returns null for an absent method', () => {
    expect(maskPayoutMethod(null)).toBeNull()
  })
})

describe('SYB-011 — policy version', () => {
  it('exposes a stable policy version', () => {
    expect(HOST_PAYOUT_POLICY_VERSION).toBe('host-payout-v1')
  })
})
