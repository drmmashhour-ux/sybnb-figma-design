import { describe, it, expect } from 'vitest'
import { matchReconciliation, RECONCILIATION_STATUS, RECONCILIATION_MISMATCH_REASON } from '../../server/lib/reconciliation.mjs'

// Fix E, Slice 1 — the pure, server-side match function. Given a frozen Payment (the guest's gross paid
// amount + currency + settlement reference) and a merchant-statement line, it computes MATCHED only when the
// received amount, currency, AND reference all tie out; otherwise MISMATCH with a computed reason. It is
// pure (no DB, no clock): the caller passes the set of statement references already consumed by prior matches.

const PAYMENT = { grossMinor: 120_00, currency: 'USD', settlementRef: 'SHAM-TX-777' }
const line = (over = {}) => ({ amountMinor: 120_00, currency: 'USD', reference: 'SHAM-TX-777', ...over })

describe('matchReconciliation (Fix E — pure received-funds match)', () => {
  it('exact amount + currency + reference -> MATCHED', () => {
    const r = matchReconciliation({ payment: PAYMENT, statementLine: line() })
    expect(r.status).toBe(RECONCILIATION_STATUS.MATCHED)
    expect(r.reason).toBeNull()
  })

  it('statement amount below the frozen gross -> MISMATCH UNDERPAYMENT', () => {
    const r = matchReconciliation({ payment: PAYMENT, statementLine: line({ amountMinor: 119_00 }) })
    expect(r.status).toBe(RECONCILIATION_STATUS.MISMATCH)
    expect(r.reason).toBe(RECONCILIATION_MISMATCH_REASON.UNDERPAYMENT)
  })

  it('statement amount above the frozen gross -> MISMATCH OVERPAYMENT', () => {
    const r = matchReconciliation({ payment: PAYMENT, statementLine: line({ amountMinor: 121_00 }) })
    expect(r.status).toBe(RECONCILIATION_STATUS.MISMATCH)
    expect(r.reason).toBe(RECONCILIATION_MISMATCH_REASON.OVERPAYMENT)
  })

  it('a reference that does not tie to the payment -> MISMATCH WRONG_REFERENCE', () => {
    const r = matchReconciliation({ payment: PAYMENT, statementLine: line({ reference: 'SHAM-TX-000' }) })
    expect(r.status).toBe(RECONCILIATION_STATUS.MISMATCH)
    expect(r.reason).toBe(RECONCILIATION_MISMATCH_REASON.WRONG_REFERENCE)
  })

  it('reference matches but currency differs -> MISMATCH CURRENCY_MISMATCH (distinct from WRONG_REFERENCE)', () => {
    const r = matchReconciliation({ payment: PAYMENT, statementLine: line({ currency: 'EUR' }) })
    expect(r.status).toBe(RECONCILIATION_STATUS.MISMATCH)
    expect(r.reason).toBe(RECONCILIATION_MISMATCH_REASON.CURRENCY_MISMATCH)
  })

  it('a wrong reference outranks a currency difference (WRONG_REFERENCE beats CURRENCY_MISMATCH)', () => {
    const r = matchReconciliation({ payment: PAYMENT, statementLine: line({ reference: 'SHAM-TX-000', currency: 'EUR' }) })
    expect(r.status).toBe(RECONCILIATION_STATUS.MISMATCH)
    expect(r.reason).toBe(RECONCILIATION_MISMATCH_REASON.WRONG_REFERENCE)
  })

  it('a currency difference outranks an amount discrepancy (CURRENCY_MISMATCH beats OVER/UNDERPAYMENT)', () => {
    const r = matchReconciliation({ payment: PAYMENT, statementLine: line({ currency: 'EUR', amountMinor: 999_00 }) })
    expect(r.status).toBe(RECONCILIATION_STATUS.MISMATCH)
    expect(r.reason).toBe(RECONCILIATION_MISMATCH_REASON.CURRENCY_MISMATCH)
  })

  it('a statement line already consumed by a prior match -> MISMATCH DUPLICATE', () => {
    const r = matchReconciliation({ payment: PAYMENT, statementLine: line(), usedStatementRefs: ['SHAM-TX-777'] })
    expect(r.status).toBe(RECONCILIATION_STATUS.MISMATCH)
    expect(r.reason).toBe(RECONCILIATION_MISMATCH_REASON.DUPLICATE)
  })

  it('a reused line takes precedence over an amount discrepancy (DUPLICATE beats OVERPAYMENT)', () => {
    const r = matchReconciliation({ payment: PAYMENT, statementLine: line({ amountMinor: 121_00 }), usedStatementRefs: ['SHAM-TX-777'] })
    expect(r.status).toBe(RECONCILIATION_STATUS.MISMATCH)
    expect(r.reason).toBe(RECONCILIATION_MISMATCH_REASON.DUPLICATE)
  })

  it('normalizes surrounding whitespace on references before comparing', () => {
    const r = matchReconciliation({ payment: PAYMENT, statementLine: line({ reference: '  SHAM-TX-777 ' }) })
    expect(r.status).toBe(RECONCILIATION_STATUS.MATCHED)
  })
})
