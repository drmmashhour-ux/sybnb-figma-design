export type PlatformPaymentGateMethodId = 'shamCash' | 'localWallet' | 'bankTransfer' | 'creditCard'

export type PlatformPaymentGateProvider = 'sham_cash' | 'syrian_local_wallet' | 'bank_transfer' | 'stripe'

export type PlatformPaymentGateMethod = {
  id: PlatformPaymentGateMethodId
  provider: PlatformPaymentGateProvider
  label: {
    ar: string
    en: string
  }
  codeTitle: {
    ar: string
    en: string
  }
  destinationCode: string
  requiresExternalProof: boolean
  usesStripe: boolean
}

export const platformPaymentGateMethods: Record<PlatformPaymentGateMethodId, PlatformPaymentGateMethod> = {
  shamCash: {
    id: 'shamCash',
    provider: 'sham_cash',
    label: { ar: 'Sham Cash', en: 'Sham Cash' },
    codeTitle: { ar: 'كود شام كاش للدفع', en: 'Sham Cash payment code' },
    destinationCode: 'SYBNB-SHAM-ADV',
    requiresExternalProof: true,
    usesStripe: false,
  },
  localWallet: {
    id: 'localWallet',
    provider: 'syrian_local_wallet',
    label: { ar: 'المحفظة المحلية السورية', en: 'Syrian Local Wallet' },
    codeTitle: { ar: 'كود المحفظة المحلية', en: 'Local wallet code' },
    destinationCode: 'SYBNB-WALLET-ADV',
    requiresExternalProof: true,
    usesStripe: false,
  },
  bankTransfer: {
    id: 'bankTransfer',
    provider: 'bank_transfer',
    label: { ar: 'تحويل بنكي', en: 'Bank transfer' },
    codeTitle: { ar: 'مرجع التحويل البنكي', en: 'Bank transfer reference' },
    destinationCode: 'SYBNB-BANK-ADV',
    requiresExternalProof: true,
    usesStripe: false,
  },
  creditCard: {
    id: 'creditCard',
    provider: 'stripe',
    label: { ar: 'Stripe / بطاقة ائتمان', en: 'Stripe / Credit card' },
    codeTitle: { ar: 'مرجع Stripe', en: 'Stripe reference' },
    destinationCode: 'STRIPE-SYBNB-ADV',
    requiresExternalProof: true,
    usesStripe: true,
  },
}

export function normalizePaymentGateMethod(methodId: string): PlatformPaymentGateMethodId {
  return methodId in platformPaymentGateMethods ? (methodId as PlatformPaymentGateMethodId) : 'shamCash'
}

export function createPlatformPaymentQrPayload({
  amountMinor,
  currency,
  destinationCode,
  followCode,
  provider,
  purpose,
}: {
  amountMinor: number
  currency: string
  destinationCode: string
  followCode: string
  provider: PlatformPaymentGateProvider | string
  purpose: string
}) {
  return JSON.stringify({
    type: 'SYBNB_PAYMENT_GATE',
    platform: 'SYBNB',
    provider,
    destinationCode,
    followCode,
    amountMinor,
    currency,
    purpose,
  })
}

export function createStripeReference(followCode: string) {
  return `STRIPE-${followCode}`
}

export function canStartPaymentGate({
  amountConfirmed,
}: {
  amountConfirmed: boolean
}) {
  return amountConfirmed
}

export function canUploadPaymentGateProof({
  hasPaymentReference,
  paymentStarted,
  requiresExternalProof,
}: {
  hasPaymentReference: boolean
  paymentStarted: boolean
  requiresExternalProof: boolean
}) {
  if (!requiresExternalProof) return false
  return paymentStarted && hasPaymentReference
}

export function canSendPaymentGateForReview({
  hasPaymentReference,
  paymentSucceeded,
  proofUploaded,
  requiresExternalProof,
}: {
  hasPaymentReference: boolean
  paymentSucceeded: boolean
  proofUploaded: boolean
  requiresExternalProof: boolean
}) {
  if (!hasPaymentReference) return false
  return requiresExternalProof ? proofUploaded : paymentSucceeded
}
