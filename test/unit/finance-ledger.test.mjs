import { describe, expect, it } from 'vitest'
import {
  STR_ADMIN_COMMISSION_RATE,
  bookingFinanceSplit,
  buildPayoutRow,
} from '../../server/lib/finance-ledger.mjs'
import { isPayoutEligible, payoutEligibleAt } from '../../server/lib/booking-lifecycle.mjs'

function strBooking(overrides = {}) {
  return {
    amountMinor: 100000,
    currency: 'USD',
    status: 'COMPLETED',
    checkOut: new Date('2026-01-01T00:00:00Z'),
    metadata: {},
    listing: { division: 'STAYS', metadata: {} },
    ...overrides,
  }
}

describe('bookingFinanceSplit: STAYS division invariant (rent + cleaning + tax reconstructs the paid amount)', () => {
  it('rent + cleaning + taxes equals the paid amount for a short-stay booking with no protection add-on', () => {
    const booking = strBooking()
    const split = bookingFinanceSplit(booking, booking.amountMinor)

    expect(split.stayAmountMinor + split.cleaningFeeMinor + split.taxesMinor).toBe(split.paidTotalMinor)
    expect(split.paidTotalMinor).toBe(100000)
  })

  // Regression: a host-set tax is a FRACTIONAL rate (metadata.taxRate, e.g. 0.13). It must be read raw,
  // NOT via a rounding helper that turns 0.13 into 0 and silently drops all tax from the money split.
  it('applies a fractional host taxRate (0.13) instead of rounding the rate to zero', () => {
    const rent = 100000
    const expectedTax = Math.round(rent * 0.13) // 13000 — 13% of the stay, NOT 0
    const paid = rent + expectedTax // the guest pays stay + tax (no cleaning here)
    const taxed = strBooking({ amountMinor: rent, listing: { division: 'STAYS', metadata: { taxRate: 0.13 } } })
    const split = bookingFinanceSplit(taxed, paid)
    expect(split.taxesMinor).toBe(expectedTax)
    // Control: with no taxRate set, STR tax stays 0 (disclosed-not-charged).
    expect(bookingFinanceSplit(strBooking(), 100000).taxesMinor).toBe(0)
    // The reconstruct invariant must still hold with tax applied.
    expect(split.stayAmountMinor + split.cleaningFeeMinor + split.taxesMinor).toBe(split.paidTotalMinor)
  })

  it('host gross + admin share reconstructs the paid amount (nothing silently vanishes)', () => {
    const booking = strBooking()
    const split = bookingFinanceSplit(booking, booking.amountMinor)

    expect(split.hostGrossMinor + split.adminShareMinor).toBe(split.paidTotalMinor)
  })

  it('admin commission is exactly STR_ADMIN_COMMISSION_RATE of the rent component', () => {
    const booking = strBooking()
    const split = bookingFinanceSplit(booking, booking.amountMinor)

    expect(split.adminCommissionMinor).toBe(Math.round(split.stayAmountMinor * STR_ADMIN_COMMISSION_RATE))
  })

  it('excludes a purchased cancellation-protection fee from the rent/cleaning/tax split, tracking it separately', () => {
    const protectionFeeMinor = Math.round(100000 * 0.03)
    const booking = strBooking({
      amountMinor: 100000,
      metadata: { cancellationProtectionPurchased: true, cancellationProtectionFeeMinor: protectionFeeMinor },
    })
    const paid = 100000 + protectionFeeMinor
    const split = bookingFinanceSplit(booking, paid)

    expect(split.cancellationProtectionPurchased).toBe(true)
    expect(split.cancellationProtectionFeeMinor).toBe(protectionFeeMinor)
    expect(split.stayAmountMinor + split.cleaningFeeMinor + split.taxesMinor).toBe(paid - protectionFeeMinor)
  })

  it('routes add-on service fees to the host with NO commission, kept separate from cleaning', () => {
    const rent = 100000
    const cleaning = 5000
    const addOns = 8000
    const booking = strBooking({
      amountMinor: rent,
      metadata: { addOnFeesMinor: addOns },
      listing: { division: 'STAYS', metadata: { cleaningFeeMinor: cleaning } },
    })
    const paid = rent + cleaning + addOns
    const split = bookingFinanceSplit(booking, paid)

    expect(split.addOnFeesMinor).toBe(addOns)
    expect(split.cleaningFeeMinor).toBe(cleaning) // add-ons are NOT lumped into cleaning
    // commission is 10% of RENT only — never on cleaning or add-ons
    expect(split.adminCommissionMinor).toBe(Math.round(rent * STR_ADMIN_COMMISSION_RATE))
    expect(split.hostGrossMinor).toBe(rent + cleaning + addOns - split.adminCommissionMinor)
    // nothing vanishes; everything reconciles to what the guest paid
    expect(split.hostGrossMinor + split.adminShareMinor).toBe(paid)
    expect(split.stayAmountMinor + split.cleaningFeeMinor + split.taxesMinor + split.addOnFeesMinor).toBe(paid)
  })

  it('carves add-on fees out of the cleaning residual when cleaning is not set explicitly', () => {
    const rent = 100000
    const addOns = 12000
    const booking = strBooking({ amountMinor: rent, metadata: { addOnFeesMinor: addOns } })
    const paid = rent + addOns
    const split = bookingFinanceSplit(booking, paid)

    expect(split.addOnFeesMinor).toBe(addOns)
    expect(split.cleaningFeeMinor).toBe(0) // the whole residual was add-ons, so cleaning is 0
    expect(split.adminCommissionMinor).toBe(Math.round(rent * STR_ADMIN_COMMISSION_RATE))
    expect(split.hostGrossMinor + split.adminShareMinor).toBe(paid)
  })

  it('never produces a negative host gross or admin share regardless of a tiny paid amount', () => {
    const booking = strBooking({ amountMinor: 1 })
    const split = bookingFinanceSplit(booking, 1)

    expect(split.hostGrossMinor).toBeGreaterThanOrEqual(0)
    expect(split.adminShareMinor).toBeGreaterThanOrEqual(0)
  })
})

describe('bookingFinanceSplit: non-STAYS divisions (e.g. RENTALS) use the direct-passthrough split', () => {
  it('host gross plus admin share still reconstructs the paid amount', () => {
    const booking = {
      amountMinor: 50000,
      metadata: {},
      listing: { division: 'RENTALS', metadata: {} },
    }
    const split = bookingFinanceSplit(booking, 50000)

    expect(split.hostGrossMinor + split.adminShareMinor).toBe(split.paidTotalMinor)
    expect(split.cleaningFeeMinor).toBe(0)
    expect(split.taxesMinor).toBe(0)
  })
})

describe('payout eligibility (14-day hold)', () => {
  it('is not eligible before the booking is COMPLETED, regardless of checkout date', () => {
    const booking = { status: 'CONFIRMED', checkOut: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    expect(isPayoutEligible(booking)).toBe(false)
  })

  it('is not eligible immediately after checkout, before the 14-day hold elapses', () => {
    const booking = { status: 'COMPLETED', checkOut: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    expect(isPayoutEligible(booking)).toBe(false)
  })

  it('is eligible once 14+ days have passed since checkout', () => {
    const booking = { status: 'COMPLETED', checkOut: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) }
    expect(isPayoutEligible(booking)).toBe(true)
  })

  it('payoutEligibleAt is exactly checkOut + 14 days', () => {
    const checkOut = new Date('2026-01-01T00:00:00Z')
    const eligibleAt = payoutEligibleAt(checkOut)
    expect(eligibleAt.toISOString()).toBe('2026-01-15T00:00:00.000Z')
  })
})

describe('buildPayoutRow: payout status derivation', () => {
  it('reports PENDING_HOLD for a COMPLETED booking still inside the 14-day hold', () => {
    const booking = strBooking({ status: 'COMPLETED', checkOut: new Date(), payments: [] })
    const row = buildPayoutRow(booking, new Set())
    expect(row.payoutStatus).toBe('PENDING_HOLD')
  })

  it('reports ELIGIBLE once the hold has elapsed and no release entry exists yet', () => {
    const booking = strBooking({
      status: 'COMPLETED',
      checkOut: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      payments: [],
    })
    const row = buildPayoutRow(booking, new Set())
    expect(row.payoutStatus).toBe('ELIGIBLE')
  })

  it('reports RELEASED when the booking id is present in the released set, overriding eligibility math', () => {
    const booking = strBooking({ id: 'released-id', status: 'COMPLETED', checkOut: new Date(), payments: [] })
    const row = buildPayoutRow(booking, new Set(['released-id']))
    expect(row.payoutStatus).toBe('RELEASED')
  })
})
