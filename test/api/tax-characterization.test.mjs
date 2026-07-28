import { describe, expect, it } from 'vitest'
import { bookingFinanceSplit, STR_TAX_RATE } from '../../server/lib/finance-ledger.mjs'

// CHARACTERIZATION test for the P6 tax decision — it PINS what the code does today, it does not
// assert what it SHOULD do (that is the owner/legal decision in docs/product/STR_TAX_DECISION_REQUEST.md).
// If the tax model changes, this test SHOULD fail — that is the signal to revisit the decision doc.
//
// Documented facts, proven below:
//   1. STR tax is a flat rate (default 2%) folded into the guest's total, OR a per-listing taxesMinor.
//   2. The collected tax portion is NOT segregated — it is part of adminShareMinor, i.e. the PLATFORM
//      keeps it. There is no remittance ledger and no jurisdiction-specific rate.

describe('P6 tax characterization — current behaviour (pinned, not endorsed)', () => {
  const stayBooking = (totalMinor) => ({
    amountMinor: totalMinor,
    currency: 'USD',
    metadata: {},
    listing: { division: 'STAYS', metadata: {} },
  })

  it('the default STR tax rate is 2%', () => {
    expect(STR_TAX_RATE).toBe(0.02)
  })

  it('a STAYS booking has a positive tax component derived server-side', () => {
    const split = bookingFinanceSplit(stayBooking(100_00), 100_00)
    expect(split.taxesMinor).toBeGreaterThan(0)
  })

  it('the collected tax is folded into the platform share (kept by the platform, not remitted)', () => {
    // adminShareMinor === taxesMinor + adminCommissionMinor: the tax portion the guest pays flows to
    // the platform wallet as part of booking_admin_share. This is the compliance fact the decision doc
    // must resolve before charging a real, remittable tax.
    const split = bookingFinanceSplit(stayBooking(250_00), 250_00)
    expect(split.adminShareMinor).toBe(split.taxesMinor + split.adminCommissionMinor)
  })

  it('a per-listing configured taxesMinor overrides the flat rate', () => {
    const booking = { amountMinor: 200_00, currency: 'USD', metadata: {}, listing: { division: 'STAYS', metadata: { taxesMinor: 500 } } }
    const split = bookingFinanceSplit(booking, 200_00)
    expect(split.taxesMinor).toBe(500)
  })

  it('a non-STAYS booking carries no tax component', () => {
    const booking = { amountMinor: 100_00, currency: 'USD', metadata: {}, listing: { division: 'CARS', metadata: {} } }
    const split = bookingFinanceSplit(booking, 100_00)
    expect(split.taxesMinor).toBe(0)
  })
})
