import type { PlatformHostPaymentRow } from '../../shared/api/platformApi'

// H7 — pure period/total helpers for the bi-weekly payout statement. They only READ the frozen M5 record
// fields returned by fetchHostPayments (H6); they never recompute a split, so the statement always matches
// the records. Kept dependency-free (type-only import) so they're unit-testable without a DOM.

function isoDay(value: string | null): string | null {
  return value ? value.slice(0, 10) : null
}

// Rows whose PAYMENT (settlement) date falls in the inclusive [fromISO, toISO] window (YYYY-MM-DD).
export function payrollRowsForPeriod(rows: PlatformHostPaymentRow[], fromISO: string, toISO: string): PlatformHostPaymentRow[] {
  return rows.filter((row) => {
    const d = isoDay(row.paymentDate)
    return d != null && d >= fromISO && d <= toISO
  })
}

// Period totals summed straight from the frozen rows. The card fee is the withheld difference gross − net,
// so the identity gross − commission − cardFee = net holds row-by-row and in aggregate.
export function payrollTotals(rows: PlatformHostPaymentRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.grossMinor += row.grossMinor ?? 0
      acc.commissionMinor += row.commissionMinor ?? 0
      acc.cardFeeMinor += Math.max(0, row.hostPayoutMinor - row.netPayoutMinor)
      acc.netMinor += row.netPayoutMinor
      return acc
    },
    { grossMinor: 0, commissionMinor: 0, cardFeeMinor: 0, netMinor: 0 },
  )
}
