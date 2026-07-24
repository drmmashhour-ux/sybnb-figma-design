import { describe, expect, it } from 'vitest'
import {
  CANCELLATION_PROTECTION_RATE,
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

  it('host gross + admin share reconstructs the paid amount (nothing silently vanishes)', () => {
    const booking = strBooking()
    const split = bookingFinanceSplit(booking, booking.amountMinor)

    expect(split.hostGrossMinor + split.adminShareMinor).toBe(split.paidTotalMinor)
  })

  it('admin commission is STR_ADMIN_COMMISSION_RATE of the accommodation + cleaning base (M2)', () => {
    const booking = strBooking()
    const split = bookingFinanceSplit(booking, booking.amountMinor)

    // M2: commission base = accommodation + cleaning (tax excluded, never commissioned).
    expect(split.adminCommissionMinor).toBe(Math.round((split.stayAmountMinor + split.cleaningFeeMinor) * STR_ADMIN_COMMISSION_RATE))
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

  it('never produces a negative host gross or admin share regardless of a tiny paid amount', () => {
    const booking = strBooking({ amountMinor: 1 })
    const split = bookingFinanceSplit(booking, 1)

    expect(split.hostGrossMinor).toBeGreaterThanOrEqual(0)
    expect(split.adminShareMinor).toBeGreaterThanOrEqual(0)
  })

  // Tax-compliance foundation (030): a listing with no explicit metadata.taxesMinor used to have an
  // invented 2% "tax" folded into the split (STR_TAX_RATE), never backed by any jurisdiction's real
  // tax law. Removed -- an unconfigured booking now shows an honest ~0 tax, only ever a rounding
  // remainder (at most a handful of minor units), never a meaningful fraction of the booking.
  it('a listing with no explicit taxesMinor shows only a rounding-artifact tax, never an invented percentage', () => {
    const booking = strBooking({ amountMinor: 1000000 })
    const split = bookingFinanceSplit(booking, 1000000)

    expect(split.taxesMinor).toBeLessThanOrEqual(2)
    expect(split.taxesMinor).toBeGreaterThanOrEqual(0)
  })

  it('an explicit metadata.taxesMinor (e.g. Quebec real lodging tax) is always honored exactly, never overridden', () => {
    const booking = strBooking({
      amountMinor: 1000000,
      listing: { division: 'STAYS', metadata: { rentMinor: 900000, cleaningFeeMinor: 50000, taxesMinor: 50000 } },
    })
    const split = bookingFinanceSplit(booking, 1000000)

    expect(split.taxesMinor).toBe(50000)
    expect(split.stayAmountMinor).toBe(900000)
    expect(split.cleaningFeeMinor).toBe(50000)
  })

  // Money-model correction (2026-07-22): the real product path -- the host wizard has never written
  // metadata.rentMinor, only cleaningFeeMinor. Before the fix, rentMinor was estimated via the 1.05
  // divisor regardless of the declared cleaning fee, so rent+cleaning did NOT reconstruct the paid
  // amount whenever a real cleaning fee was set (rentMinor was overstated, silently shrinking the
  // host's commission base and misattributing the difference to admin). Direct subtraction fixes this.
  it('rentMinor is derived by direct subtraction (not the 1.05 divisor) when cleaningFeeMinor is declared without an explicit rentMinor', () => {
    const booking = strBooking({
      amountMinor: 120,
      listing: { division: 'STAYS', metadata: { cleaningFeeMinor: 20 } },
    })
    const split = bookingFinanceSplit(booking, 120)

    expect(split.stayAmountMinor).toBe(100) // 120 - 20, not round(120/1.05)=114
    expect(split.cleaningFeeMinor).toBe(20)
    expect(split.stayAmountMinor + split.cleaningFeeMinor + split.taxesMinor + split.extraFeesMinor).toBe(split.paidTotalMinor)
    expect(split.adminCommissionMinor).toBe(Math.round((100 + 20) * STR_ADMIN_COMMISSION_RATE))
  })

  it('host gross + admin share still reconstructs the paid amount exactly when a cleaning fee is declared', () => {
    const booking = strBooking({
      amountMinor: 120,
      listing: { division: 'STAYS', metadata: { cleaningFeeMinor: 20 } },
    })
    const split = bookingFinanceSplit(booking, 120)

    expect(split.hostGrossMinor + split.adminShareMinor).toBe(120)
  })

  it('multiple nights: a flat declared cleaning fee is still subtracted exactly once, not per night', () => {
    // 4 nights x 100 = 400 nightly + a single flat 20 cleaning fee = 420 paid.
    const booking = strBooking({
      amountMinor: 420,
      listing: { division: 'STAYS', metadata: { cleaningFeeMinor: 20 } },
    })
    const split = bookingFinanceSplit(booking, 420)

    expect(split.stayAmountMinor).toBe(400)
    expect(split.cleaningFeeMinor).toBe(20)
  })

  it('extraFeesMinor, when declared, is subtracted correctly and flows to the host (not silently absorbed into admin share)', () => {
    const booking = strBooking({
      amountMinor: 130,
      listing: { division: 'STAYS', metadata: { cleaningFeeMinor: 20, extraFeesMinor: 10 } },
    })
    const split = bookingFinanceSplit(booking, 130)

    expect(split.stayAmountMinor).toBe(100) // 130 - 20 - 10
    expect(split.extraFeesMinor).toBe(10)
    expect(split.hostGrossMinor + split.adminShareMinor).toBe(130)
  })

  it('cancellation protection, cleaning fee, and a declared tax all reconcile together', () => {
    const protectionFeeMinor = Math.round(120 * CANCELLATION_PROTECTION_RATE)
    const booking = strBooking({
      amountMinor: 120,
      metadata: { cancellationProtectionPurchased: true, cancellationProtectionFeeMinor: protectionFeeMinor },
      listing: { division: 'STAYS', metadata: { cleaningFeeMinor: 20, country: 'CA', taxFeeMinor: 350 } },
    })
    const paid = 120 + protectionFeeMinor
    const split = bookingFinanceSplit(booking, paid)

    expect(split.cancellationProtectionFeeMinor).toBe(protectionFeeMinor)
    expect(split.cleaningFeeMinor).toBe(20)
    expect(split.stayAmountMinor).toBe(100)
    // Legacy taxesMinor key is honored as a fallback when the canonical taxFeeMinor key is absent.
    const legacyBooking = strBooking({
      amountMinor: 120,
      listing: { division: 'STAYS', metadata: { cleaningFeeMinor: 20, taxesMinor: 350 } },
    })
    const legacySplit = bookingFinanceSplit(legacyBooking, 120)
    expect(legacySplit.taxesMinor).toBe(350)
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
