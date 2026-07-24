// M3-A — one PaymentGateway shape over the two settlement rails: Stripe (card) and Sham Cash (the manual
// admin-reviewed proof). A booking may be marked paid/approved/CONFIRMED ONLY with a REAL settlement
// reference:
//   - stripe: the captured charge / payment_intent id (pi_… / ch_…) from the completed session — NEVER
//     the cs_… Checkout Session id (a session id is not proof of a capture).
//   - sham_cash and other manual proofs: the admin-approved proof itself is the settlement reference (an
//     admin reviewed and approved the real funds).
// Test-mode Stripe settlement is rejected in production via Stripe's livemode flag (checked at finalize
// time, below) — never by string-matching "cs_test". (True authorize→capture is deferred M3-B.)

// A captured charge / payment_intent id starts with pi_ or ch_ (never cs_ for a Checkout Session). The
// charset is permissive after the prefix — the security guarantee is the prefix + non-empty body, not the
// exact id format — so it accepts both live ids and test/mock ids.
const STRIPE_CAPTURE_REF = /^(pi_|ch_)[A-Za-z0-9_-]+$/

export const SETTLEMENT_REFERENCE_REQUIRED_CODE = 'SETTLEMENT_REFERENCE_REQUIRED'
export const STRIPE_TEST_MODE_IN_PRODUCTION_CODE = 'STRIPE_TEST_MODE_IN_PRODUCTION'

// The real settlement reference for a payment proof, or null if it has none (so it must not confirm a booking).
export function settlementReference(proof) {
  if (!proof) return null
  if (proof.provider === 'stripe') {
    return STRIPE_CAPTURE_REF.test(proof.providerRef || '') ? proof.providerRef : null
  }
  // Manual, admin-reviewed proofs (Sham Cash, bank transfer, …): the reviewed + approved proof is the
  // settlement. It is only ever approved by an authenticated admin through the review queue.
  return proof.id || null
}

// Throws (409) if the proof has no real settlement reference — the hard guarantee that a booking can never
// be marked paid/CONFIRMED without one.
export function assertRealSettlementReference(proof) {
  if (!settlementReference(proof)) {
    const error = new Error('This payment has no real settlement reference and cannot confirm a booking.')
    error.statusCode = 409
    error.code = SETTLEMENT_REFERENCE_REQUIRED_CODE
    error.expose = true
    throw error
  }
}

// Reject a TEST-mode Stripe settlement in production, using Stripe's own livemode flag on the session/object
// (not a fragile "cs_test" string match). A missing livemode in production is treated as test/unsafe.
export function assertStripeLivemodeForProduction(stripeObject, { isProduction = process.env.NODE_ENV === 'production' } = {}) {
  if (isProduction && stripeObject?.livemode !== true) {
    const error = new Error('A test-mode Stripe payment cannot settle a booking in production.')
    error.statusCode = 402
    error.code = STRIPE_TEST_MODE_IN_PRODUCTION_CODE
    error.expose = true
    throw error
  }
}
