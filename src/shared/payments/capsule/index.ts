// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT CAPSULE — isolated + reusable
//
// The one place any surface (or any platform) imports payment primitives from: the gate config +
// payload/reference builders + gate predicates, plus the reusable scan-to-pay <PaymentQr>. Built so a
// sibling platform (Canada-STR clone, workforce app…) config-clones payments instead of re-deriving
// them. Money logic stays in the engine (re-exported here); this capsule is the stable public surface.
//
// Config-clone surface: platformPaymentGateMethods[*].destinationCode (Sham Cash / wallet / bank /
// Stripe account codes), currency, and the `purpose` string passed to createPlatformPaymentQrPayload.
// ─────────────────────────────────────────────────────────────────────────────
export { PaymentQr } from './PaymentQr'
export {
  platformPaymentGateMethods,
  normalizePaymentGateMethod,
  createPlatformPaymentQrPayload,
  createStripeReference,
  canStartPaymentGate,
  canUploadPaymentGateProof,
  canSendPaymentGateForReview,
} from '../../../engines/payments/platformPaymentGate'
export type {
  PlatformPaymentGateMethod,
  PlatformPaymentGateMethodId,
  PlatformPaymentGateProvider,
} from '../../../engines/payments/platformPaymentGate'
