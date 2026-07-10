export type CardPaymentMethod = 'CARD_OR_PREPAID'

export type CardProcessor = 'STRIPE'

export type CardPaymentStatus =
  | 'REQUIRES_PAYMENT_METHOD'
  | 'REQUIRES_CONFIRMATION'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'REFUNDED'

export type CardPaymentCurrency = 'USD' | 'EUR' | 'SYP'

export type CardPaymentRecord = {
  bookingId: string
  userId: string
  paymentMethod: CardPaymentMethod
  processor: CardProcessor
  amount: number
  currency: CardPaymentCurrency
  status: CardPaymentStatus
  createdAt: string
  idempotencyKey: string
  processorPaymentIntentId?: string
  processorCustomerId?: string
  last4?: string
  cardBrand?: string
  prepaid?: boolean
  riskFlags: string[]
}

export type CardPaymentDraftInput = Pick<CardPaymentRecord, 'bookingId' | 'userId' | 'amount' | 'currency'> &
  Partial<Pick<CardPaymentRecord, 'processorPaymentIntentId' | 'processorCustomerId' | 'last4' | 'cardBrand' | 'prepaid'>>

export const cardPrepaidPaymentConfig = {
  paymentMethod: 'CARD_OR_PREPAID',
  label: {
    ar: 'بطاقة ائتمان أو بطاقة مسبقة الدفع',
    en: 'Credit or prepaid card',
  },
  processor: 'STRIPE',
  mode: 'placeholder_until_provider_confirmed',
  frontendEnv: {
    publishableKey: 'VITE_STRIPE_PUBLISHABLE_KEY',
  },
  serverOnlyEnv: {
    secretKey: 'STRIPE_SECRET_KEY_SERVER_ONLY',
    webhookSecret: 'STRIPE_WEBHOOK_SECRET_SERVER_ONLY',
    accountId: 'STRIPE_ACCOUNT_ID_SERVER_ONLY',
  },
  securityNote:
    'Never store Stripe secret keys, webhook secrets, card numbers, CVC, or full card data in frontend code or GitHub.',
} as const

export function createCardPaymentIdempotencyKey(
  bookingId: string,
  userId: string,
  amount: number,
  currency: CardPaymentCurrency,
) {
  return [
    'CARD',
    bookingId.trim(),
    userId.trim(),
    amount.toFixed(2),
    currency,
  ].join(':')
}

export function createCardPrepaidPaymentDraft(input: CardPaymentDraftInput): CardPaymentRecord {
  const riskFlags: string[] = []

  if (!input.bookingId || !input.userId) {
    throw new Error('Missing booking or user for card payment')
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Invalid card payment amount')
  }
  if (input.currency === 'SYP') {
    riskFlags.push('syp_card_processing_requires_provider_confirmation')
  }
  if (input.prepaid) {
    riskFlags.push('prepaid_card_verify_capture_and_refund_rules')
  }

  return {
    bookingId: input.bookingId.trim(),
    userId: input.userId.trim(),
    paymentMethod: 'CARD_OR_PREPAID',
    processor: 'STRIPE',
    amount: input.amount,
    currency: input.currency,
    status: 'REQUIRES_PAYMENT_METHOD',
    createdAt: new Date().toISOString(),
    idempotencyKey: createCardPaymentIdempotencyKey(input.bookingId, input.userId, input.amount, input.currency),
    processorPaymentIntentId: input.processorPaymentIntentId,
    processorCustomerId: input.processorCustomerId,
    last4: input.last4,
    cardBrand: input.cardBrand,
    prepaid: input.prepaid,
    riskFlags,
  }
}

export function bookingPaymentStatusFromCard(status: CardPaymentStatus) {
  if (status === 'SUCCEEDED') return 'PAID'
  if (status === 'FAILED' || status === 'CANCELED') return 'REJECTED'
  if (status === 'REFUNDED') return 'REFUNDED'
  return 'PENDING_PAYMENT'
}

export function stripeWebhookEventCanMarkPaid(eventType: string, verifiedSignature: boolean) {
  return verifiedSignature && eventType === 'payment_intent.succeeded'
}

