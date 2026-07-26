// Platform Contract Kit — security check: NO buyer-facing economics leak.
//
// Any payload a paying BUYER can see (a quote, a booking, an order) must expose NONE of the platform's
// economics — the platform's cut and the supplier's payout are internal. This is a pure function: pass a
// JSON payload PLUS your domain's forbidden-key list, and it returns the forbidden keys it found (empty ⇒
// clean).
//
// `forbiddenKeys` is REQUIRED — there is deliberately no default. A default would be a SYBNB-shaped
// assumption: a consumer whose payout field is named differently would scan for the wrong keys, find none,
// and get a false pass. EXAMPLE_ECONOMICS_KEYS below is a starting point to spread + extend, not an
// auto-default — you must pass it (or your own) explicitly.

export const EXAMPLE_ECONOMICS_KEYS = [
  'commission',
  'commissionMinor',
  'platformFee',
  'platformFeeMinor',
  'hostGross',
  'hostGrossMinor',
  'hostPayout',
  'hostPayoutMinor',
  'driverEarn',
  'driverEarnings',
  'driverPayout',
  'driverPayoutMinor',
  'supplierPayout',
  'supplierPayoutMinor',
  'netPayout',
]

// Returns the subset of `forbiddenKeys` that appears as an object key anywhere in `json` (case-insensitive,
// substring match on the key name — so `hostPayoutMinor` is caught by the `hostPayout` entry too).
export function findLeakedEconomicsKeys(json, forbiddenKeys) {
  if (!Array.isArray(forbiddenKeys) || forbiddenKeys.length === 0) {
    throw new Error(
      'findLeakedEconomicsKeys: `forbiddenKeys` is required — pass your platform\'s buyer-forbidden economics keys ' +
        '(spread + extend EXAMPLE_ECONOMICS_KEYS). Refusing to default to SYBNB keys, which would risk a false pass.',
    )
  }
  const raw = JSON.stringify(json ?? {})
  return forbiddenKeys.filter((key) => new RegExp(`"[^"]*${key}[^"]*"\\s*:`, 'i').test(raw))
}
