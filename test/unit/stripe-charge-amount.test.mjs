import { describe, expect, it } from 'vitest'
import { stripeChargeAmount } from '../../server/routes/payments.mjs'

// Regression for the "Stripe charged $0.50 for a $1 stay" bug. STR stays are USD-native: the SYBNB
// total is in WHOLE USD units ($1 = 1), so it must be charged as totalMinor*100 cents — NOT run through
// the SYP→USD FX conversion (which turned $1 into ~0 → floored to Stripe's $0.50 minimum).
describe('stripeChargeAmount — USD-native bookings charge the correct amount', () => {
  it('charges a $1 USD stay as 100 cents (not the old $0.50 floor)', () => {
    expect(stripeChargeAmount(1, 'USD')).toEqual({ currency: 'usd', unitAmount: 100 })
  })

  it('charges a $2 USD stay as 200 cents', () => {
    expect(stripeChargeAmount(2, 'USD')).toEqual({ currency: 'usd', unitAmount: 200 })
  })

  it('charges a $49 USD stay as 4900 cents', () => {
    expect(stripeChargeAmount(49, 'USD')).toEqual({ currency: 'usd', unitAmount: 4900 })
  })

  it('is case-insensitive on the currency and still respects Stripe’s 50-cent minimum', () => {
    expect(stripeChargeAmount(1, 'usd').unitAmount).toBe(100)
    expect(stripeChargeAmount(0, 'USD').unitAmount).toBe(50) // clamp to Stripe minimum
  })

  it('still FX-converts a genuinely SYP-priced booking (unchanged path)', () => {
    // 15000 SYP / 15000 per USD = $1.00 => 100 cents
    const res = stripeChargeAmount(15000, 'SYP')
    expect(res.currency).toBe('usd')
    expect(res.unitAmount).toBe(100)
  })
})
