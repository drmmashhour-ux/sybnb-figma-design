import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isCardPaymentOffered, isSelfServeCancellationOffered } from '../../src/shared/booking/pilotScopeUi'

// B2 — the guest UI must reflect the pilot scope from /api/config/country: hide the card option when
// cardPaymentAvailable is false, and route cancellation to the dispute/contact-support path (never the
// automated self-serve cancel) when selfServeCancellation is false. Pure gates are unit-tested in both
// modes; the components are checked to actually be wired to them.

const PILOT = { shamCashOnly: true, cardPaymentAvailable: false, selfServeCancellation: false }
const FULL = { shamCashOnly: false, cardPaymentAvailable: true, selfServeCancellation: true }
const bookingDetail = readFileSync(new URL('../../src/modules/bookings/BookingDetailPage.tsx', import.meta.url), 'utf8')
const cancelDispute = readFileSync(new URL('../../src/modules/bookings/BookingCancelDispute.tsx', import.meta.url), 'utf8')

describe('B2 — pilot-scope UI gates (pure logic, both modes)', () => {
  it('card payment: offered in full mode, hidden in the pilot; missing scope defaults to offered', () => {
    expect(isCardPaymentOffered(undefined), 'no scope = full feature (safe default)').toBe(true)
    expect(isCardPaymentOffered(FULL)).toBe(true)
    expect(isCardPaymentOffered(PILOT)).toBe(false)
  })

  it('self-serve cancellation: offered in full mode, deferred in the pilot; missing scope defaults to offered', () => {
    expect(isSelfServeCancellationOffered(undefined)).toBe(true)
    expect(isSelfServeCancellationOffered(FULL)).toBe(true)
    expect(isSelfServeCancellationOffered(PILOT)).toBe(false)
  })
})

describe('B2 — the guest UI is wired to the scope gates', () => {
  it('BookingDetailPage fetches the config scope and hides the card option when card is not offered', () => {
    expect(bookingDetail, 'imports the card gate').toMatch(/isCardPaymentOffered/)
    expect(bookingDetail, 'fetches the country-config scope').toMatch(/fetchCountryConfig/)
    expect(bookingDetail, 'the card option is gated on the (negated) card offer').toMatch(/!\s*cardPaymentOffered/)
  })

  it('BookingCancelDispute routes to OpenDisputeForm/support when self-serve cancellation is deferred', () => {
    expect(cancelDispute, 'imports the cancellation gate').toMatch(/isSelfServeCancellationOffered/)
    expect(cancelDispute, 'renders the dispute/contact-support entry').toMatch(/OpenDisputeForm/)
    expect(cancelDispute, 'has a pilot cancel-via-support note').toMatch(/pilotCancelNote/)
  })
})
