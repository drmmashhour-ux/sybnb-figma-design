// Section B — the Sham-Cash-only Syria pilot deliberately DEFERS two not-yet-production-ready paths:
//   (a) card payments (Stripe), and
//   (b) the self-serve AUTOMATED cancellation+refund path (its money-movement is not yet fully tested).
//
// Config-driven via the STR_PILOT_SHAM_CASH_ONLY env flag — re-enabling either path later is a config
// change (unset the flag / redeploy), never a code edit. Default OFF so dev, test, and any non-pilot
// deployment keep the full feature set (baseline behavior is unchanged unless the flag is set).
//
// The server ENFORCES these deferrals at the endpoints (defense-in-depth) so a hidden or bypassed UI can
// never start a card payment or the automated refund. Cancellation is NOT removed — guests/hosts keep an
// admin-handled fallback (open a dispute → an admin resolves it, which can refund), which is never gated
// here — so no one is ever trapped in an un-cancellable booking.

export const CARD_PAYMENT_NOT_IN_PILOT_CODE = 'CARD_PAYMENT_NOT_IN_PILOT'
export const CANCELLATION_VIA_SUPPORT_CODE = 'CANCELLATION_VIA_SUPPORT_IN_PILOT'

export function isShamCashOnlyPilot() {
  const v = process.env.STR_PILOT_SHAM_CASH_ONLY
  return v === '1' || v === 'true'
}

// Machine-readable capabilities the client reads (via /api/config/country) to hide the card option and
// route cancellation to support during the pilot. Kept in one place so the UI and the server enforcement
// can never disagree about what the pilot offers.
export function pilotScopeCapabilities() {
  const shamCashOnly = isShamCashOnlyPilot()
  return {
    shamCashOnly,
    cardPaymentAvailable: !shamCashOnly,
    selfServeCancellation: !shamCashOnly,
  }
}
