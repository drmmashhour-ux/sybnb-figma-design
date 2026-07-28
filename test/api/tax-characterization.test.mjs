import { describe, expect, it } from 'vitest'
import { bookingFinanceSplit, STR_TAX_RATE } from '../../server/lib/finance-ledger.mjs'

// P6 decision A (owner, 2026-07-27): STR launches with NO automatically-charged tax. This test pins
// that behaviour: the default tax rate is 0, a STAYS booking carries no platform-charged tax, and the
// only tax that ever appears is a per-listing amount a (registered) host explicitly configures. See
// docs/product/STR_TAX_DECISION_REQUEST.md. If the tax model changes, this test SHOULD fail.

describe('P6 tax = A (no default tax) — pinned behaviour', () => {
  const stayBooking = (totalMinor, listingMetadata = {}) => ({
    amountMinor: totalMinor,
    currency: 'USD',
    metadata: {},
    listing: { division: 'STAYS', metadata: listingMetadata },
  })

  it('the default STR tax rate is 0 (no automatically-charged tax)', () => {
    expect(STR_TAX_RATE).toBe(0)
  })

  it('a STAYS booking carries NO platform-charged tax by default', () => {
    const split = bookingFinanceSplit(stayBooking(200_00), 200_00)
    expect(split.taxesMinor).toBe(0)
  })

  it('with no tax, the platform keeps only its commission (± a 1-minor rounding residue); money conserved', () => {
    const split = bookingFinanceSplit(stayBooking(250_00), 250_00)
    expect(split.taxesMinor).toBe(0)
    expect(Math.abs(split.adminShareMinor - split.adminCommissionMinor)).toBeLessThanOrEqual(1)
    expect(split.hostGrossMinor + split.adminShareMinor).toBe(split.paidTotalMinor)
  })

  it('a registered host CAN still charge a per-listing tax (explicit taxesMinor is honoured)', () => {
    const split = bookingFinanceSplit(stayBooking(200_00, { taxesMinor: 500 }), 200_00)
    expect(split.taxesMinor).toBe(500)
  })

  it('a non-STAYS booking carries no tax component', () => {
    const booking = { amountMinor: 100_00, currency: 'USD', metadata: {}, listing: { division: 'CARS', metadata: {} } }
    const split = bookingFinanceSplit(booking, 100_00)
    expect(split.taxesMinor).toBe(0)
  })
})
