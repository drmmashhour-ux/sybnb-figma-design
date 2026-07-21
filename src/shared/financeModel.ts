// Mirrors the real STR revenue split (server/lib/finance-ledger.mjs bookingFinanceSplit, STAYS
// branch) so the what-if calculator on the Finance page projects using the platform's actual
// commission math, not an invented flat percentage. Kept read-only/pure — this file only ever
// computes numbers from user-entered assumptions, it never touches the database.
export const STR_CLEANING_RATE = 0.05
// Tax-compliance foundation (030): removed STR_TAX_RATE (was 0.02) -- it was never backed by any
// jurisdiction's real tax law, just an invented placeholder folded into the rent/cleaning
// decomposition. See server/lib/finance-ledger.mjs's matching comment.
// Must match server/lib/finance-ledger.mjs's STR_ADMIN_COMMISSION_RATE -- see that file's comment
// for why 13% (still below Airbnb's ~17-19% combined take and Booking.com's ~15%+ commission).
export const STR_ADMIN_COMMISSION_RATE = 0.13
export const CANCELLATION_PROTECTION_RATE = 0.03

// Real SYBNB revenue per booking (tax + commission share), for a STAYS booking paid in full at
// `paidTotalMinor`, before any cancellation-protection add-on. taxesMinor here is only ever a
// rounding remainder (rent+cleaning almost always reconstructs paidTotalMinor exactly) -- a real
// configured tax (e.g. Quebec's lodging tax/GST/QST) is a separate, explicitly-tracked figure this
// what-if projection does not model.
export function strAdminShareMinor(paidTotalMinor: number) {
  const divisor = 1 + STR_CLEANING_RATE
  const rentMinor = Math.round(paidTotalMinor / divisor)
  const cleaningFeeMinor = Math.round(rentMinor * STR_CLEANING_RATE)
  const taxesMinor = Math.max(0, paidTotalMinor - rentMinor - cleaningFeeMinor)
  const adminCommissionMinor = Math.round(rentMinor * STR_ADMIN_COMMISSION_RATE)
  return taxesMinor + adminCommissionMinor
}

export function cancellationProtectionFeeMinor(paidTotalMinor: number) {
  return Math.round(paidTotalMinor * CANCELLATION_PROTECTION_RATE)
}
