// SYB-002 — abandoned payment-hold expiry policy (approved design).
//
// A booking is created PAYMENT_PENDING and immediately occupies availability. An abandoned hold (no
// payment ever completed) must eventually release its inventory. This module is the pure, configurable
// policy: how long a hold may live before it is eligible for release, keyed on the payment method, and
// how eligibility is decided. It stores no state and has no I/O — the sweep in booking-lifecycle.mjs
// applies it.
//
// Design decisions (owner-approved):
//  - S-2: eligibility is computed AT SWEEP TIME from the creation timestamp + payment/proof state +
//    policy version. No expiry timestamp is persisted.
//  - Windows are CONFIGURABLE per method (env overrides), never hardcoded as a single universal value.
//  - A hold with a proof still under review is NEVER eligible, regardless of age (that is a paid
//    booking awaiting an admin, not an abandoned hold). This is enforced by the caller via
//    ACTIVE_PROOF_STATUSES, and re-stated here so the two never drift.

export const HOLD_POLICY_VERSION = 'hold-policy-v1'

// Proof states that mean "this booking is NOT abandoned" — the sweep must never release such a hold.
export const ACTIVE_PROOF_STATUSES = ['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED']

const MINUTE = 60 * 1000

// Default windows (minutes) per payment method. Every value is overridable via
// HOLD_EXPIRY_<METHOD>_MINUTES so the owner can tune without a code change.
const DEFAULT_WINDOW_MINUTES = {
  card: 30, // stripe / immediate online payment
  wallet: 60, // syrian_local_wallet
  bank_transfer: 72 * 60, // slow manual settlement — deliberately generous
  unknown: 24 * 60, // no proof: the default and most common abandoned case
}

function positiveIntOr(raw, fallback) {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && Number.isInteger(n) && n >= 1 ? n : fallback
}

// Resolve a booking's payment method from its most recent payment proof's provider. A hold with no
// proof at all has an UNKNOWN method — which is the common abandoned case, and gets its own window.
export function resolvePaymentMethod(payments = []) {
  if (!payments.length) return 'unknown'
  const latest = [...payments].sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  )[payments.length - 1]
  const provider = String(latest.provider || '').toLowerCase()
  if (provider.includes('stripe')) return 'card'
  if (provider.includes('wallet') || provider.includes('sham')) return 'wallet'
  if (provider.includes('bank')) return 'bank_transfer'
  return 'unknown'
}

// Window in ms for a method, read at call time so an env override takes effect without re-import.
export function holdWindowMs(method, env = process.env) {
  const key = `HOLD_EXPIRY_${String(method).toUpperCase()}_MINUTES`
  const minutes = positiveIntOr(env[key], DEFAULT_WINDOW_MINUTES[method] ?? DEFAULT_WINDOW_MINUTES.unknown)
  return minutes * MINUTE
}

/**
 * Decide whether an abandoned hold is eligible for automatic release, computed at sweep time.
 * Returns { eligible, method, reason }.
 *
 * NOT eligible when: the booking is not PAYMENT_PENDING, any proof is active (under review/approved),
 * or the hold is younger than its method window AND its check-in has not already passed.
 * A past-dated check-in is a fast-path: those dates are useless and the hold only causes harm
 * (blocks inventory / account closure), so it is eligible immediately.
 */
export function evaluateHoldEligibility(booking, { now = Date.now(), env = process.env } = {}) {
  if (!booking || booking.status !== 'PAYMENT_PENDING') {
    return { eligible: false, method: null, reason: 'not-pending' }
  }
  const payments = booking.payments || []
  if (payments.some((p) => ACTIVE_PROOF_STATUSES.includes(p.status))) {
    return { eligible: false, method: null, reason: 'proof-under-review' }
  }
  const method = resolvePaymentMethod(payments)
  const ageMs = now - new Date(booking.createdAt).getTime()
  const windowMs = holdWindowMs(method, env)
  const checkInPassed = booking.checkIn && new Date(booking.checkIn).getTime() < now
  if (ageMs >= windowMs) return { eligible: true, method, reason: `expired:${method}` }
  if (checkInPassed) return { eligible: true, method, reason: 'check-in-passed' }
  return { eligible: false, method, reason: 'within-window' }
}

// Expected expiry instant for host-facing display. Computed, never persisted (S-2). Null if the
// booking is not a live hold. A past-dated check-in shows as already-expired.
export function expectedHoldExpiryAt(booking, env = process.env) {
  if (!booking || booking.status !== 'PAYMENT_PENDING') return null
  const method = resolvePaymentMethod(booking.payments || [])
  return new Date(new Date(booking.createdAt).getTime() + holdWindowMs(method, env))
}
