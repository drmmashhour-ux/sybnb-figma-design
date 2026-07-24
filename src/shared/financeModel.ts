// Mirrors the STANDARD-CASE STR revenue split (server/lib/finance-ledger.mjs's bookingFinanceSplit,
// STAYS branch, no declared cleaning-fee override) so the what-if calculator on the Finance page
// projects using the platform's actual commission math, not an invented flat percentage. This is a
// pure, single-number "what if a stay cost $X" projection with no real listing to consult, so it
// cannot (and structurally never will) reflect the exact-subtraction path bookingFinanceSplit uses
// for a real booking with an explicitly declared cleaningFeeMinor (money-model correction,
// 2026-07-22, docs/architecture/STR_MONEY_MODEL.md) -- it always uses the 1.05-divisor estimate.
// Kept read-only/pure — this file only ever computes numbers from user-entered assumptions, it
// never touches the database.
export const STR_CLEANING_RATE = 0.05
// Tax-compliance foundation (030): removed STR_TAX_RATE (was 0.02) -- it was never backed by any
// jurisdiction's real tax law, just an invented placeholder folded into the rent/cleaning
// decomposition. See server/lib/finance-ledger.mjs's matching comment.
// M1: the STR commission rate is NO LONGER a client constant. It is resolved server-side from the
// JurisdictionCommissionPolicy (serviceType STAY) and exposed on the authenticated host/admin responses
// as `platformFeePct`. Callers pass that fetched rate in, so the client never re-hardcodes 13% and can
// never silently drift from the server's single source.
export const CANCELLATION_PROTECTION_RATE = 0.03

// Real SYBNB revenue per booking (tax + commission share), for a STAYS booking paid in full at
// `paidTotalMinor`, before any cancellation-protection add-on. taxesMinor here is only ever a
// rounding remainder (rent+cleaning almost always reconstructs paidTotalMinor exactly) -- a real
// configured tax (e.g. Quebec's lodging tax/GST/QST) is a separate, explicitly-tracked figure this
// what-if projection does not model.
export function strAdminShareMinor(paidTotalMinor: number, commissionRate: number) {
  const divisor = 1 + STR_CLEANING_RATE
  const rentMinor = Math.round(paidTotalMinor / divisor)
  const cleaningFeeMinor = Math.round(rentMinor * STR_CLEANING_RATE)
  const taxesMinor = Math.max(0, paidTotalMinor - rentMinor - cleaningFeeMinor)
  // M2: commission base = accommodation + cleaning (tax excluded).
  const adminCommissionMinor = Math.round((rentMinor + cleaningFeeMinor) * commissionRate)
  return taxesMinor + adminCommissionMinor
}

export function cancellationProtectionFeeMinor(paidTotalMinor: number) {
  return Math.round(paidTotalMinor * CANCELLATION_PROTECTION_RATE)
}
