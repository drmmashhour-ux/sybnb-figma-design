import { describe, expect, it } from 'vitest'
import { extractStripePaymentIntentId, stripeRefundCents } from '../../server/routes/payments.mjs'

// Backs the real-card-refund path added to the guest cancel flow (server/routes/bookings.mjs): when a
// guest cancels a Stripe-paid booking we refund the CARD, not just credit an internal wallet.
describe('Stripe refund helpers', () => {
  it('refunds a $1 USD booking as exactly 100 cents (no 50-cent floor, unlike a charge)', () => {
    expect(stripeRefundCents(1, 'USD')).toBe(100)
  })

  it('refunds larger USD amounts to the exact cent', () => {
    expect(stripeRefundCents(2, 'USD')).toBe(200)
    expect(stripeRefundCents(49, 'USD')).toBe(4900)
  })

  it('refunds nothing for a zero/blank amount', () => {
    expect(stripeRefundCents(0, 'USD')).toBe(0)
  })

  it('extracts the PaymentIntent id from the stored proof reference', () => {
    expect(extractStripePaymentIntentId('stripe://payment_intents/pi_3ABC123xyz')).toBe('pi_3ABC123xyz')
  })

  it('returns null for a non-Stripe / missing reference (so we fall back to a wallet credit)', () => {
    expect(extractStripePaymentIntentId('local-sham-cash-confirmed')).toBe(null)
    expect(extractStripePaymentIntentId(null)).toBe(null)
    expect(extractStripePaymentIntentId('')).toBe(null)
  })
})
