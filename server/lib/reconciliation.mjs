// Fix E — received-funds reconciliation. A payout may only be disbursed once the money it pays out has been
// independently reconciled to a real received-funds line on the Sham Cash merchant statement. This module holds
// the PURE match logic; it is reused by the manual entry path (Slice 2) and the CSV importer (Slice 4). It has
// no DB and no clock — the caller supplies the frozen Payment, the statement line, and the set of statement
// references already consumed by prior MATCHED records (for duplicate detection).

export const RECONCILIATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  MATCHED: 'MATCHED',
  MISMATCH: 'MISMATCH',
})

export const RECONCILIATION_MISMATCH_REASON = Object.freeze({
  UNDERPAYMENT: 'UNDERPAYMENT',
  OVERPAYMENT: 'OVERPAYMENT',
  WRONG_REFERENCE: 'WRONG_REFERENCE',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  DUPLICATE: 'DUPLICATE',
})

const normalizeRef = (value) => String(value ?? '').trim()
const normalizeCurrency = (value) => String(value ?? '').trim().toUpperCase()

/**
 * Compute whether a merchant-statement line reconciles to a frozen Payment. Pure — no side effects.
 *
 * @param {object}   args
 * @param {object}   args.payment           frozen Payment: { grossMinor, currency, settlementRef }
 * @param {object}   args.statementLine     received-funds line: { amountMinor, currency, reference }
 * @param {string[]} [args.usedStatementRefs] statement references already consumed by prior MATCHED records
 * @returns {{ status: string, reason: string|null }}
 *   MATCHED (reason null) only when the reference, currency, and amount all tie out; otherwise MISMATCH with a
 *   single computed reason. Precedence: DUPLICATE > WRONG_REFERENCE > CURRENCY_MISMATCH > UNDER/OVERPAYMENT.
 */
export function matchReconciliation({ payment, statementLine, usedStatementRefs = [] }) {
  const stmtRef = normalizeRef(statementLine?.reference)
  const paymentRef = normalizeRef(payment?.settlementRef)
  const used = new Set((usedStatementRefs || []).map(normalizeRef))

  // A statement line already consumed by an earlier match cannot be applied again — regardless of amount.
  if (stmtRef && used.has(stmtRef)) {
    return { status: RECONCILIATION_STATUS.MISMATCH, reason: RECONCILIATION_MISMATCH_REASON.DUPLICATE }
  }

  // The reference must tie out — otherwise the line is not this payment's settlement at all.
  if (!stmtRef || stmtRef !== paymentRef) {
    return { status: RECONCILIATION_STATUS.MISMATCH, reason: RECONCILIATION_MISMATCH_REASON.WRONG_REFERENCE }
  }

  // Right reference, wrong denomination: report it distinctly rather than as a reference or amount error.
  if (normalizeCurrency(statementLine?.currency) !== normalizeCurrency(payment?.currency)) {
    return { status: RECONCILIATION_STATUS.MISMATCH, reason: RECONCILIATION_MISMATCH_REASON.CURRENCY_MISMATCH }
  }

  const grossMinor = Math.round(Number(payment?.grossMinor))
  const amountMinor = Math.round(Number(statementLine?.amountMinor))
  if (amountMinor < grossMinor) {
    return { status: RECONCILIATION_STATUS.MISMATCH, reason: RECONCILIATION_MISMATCH_REASON.UNDERPAYMENT }
  }
  if (amountMinor > grossMinor) {
    return { status: RECONCILIATION_STATUS.MISMATCH, reason: RECONCILIATION_MISMATCH_REASON.OVERPAYMENT }
  }

  return { status: RECONCILIATION_STATUS.MATCHED, reason: null }
}
