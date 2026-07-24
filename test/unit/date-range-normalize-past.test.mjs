import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dropPastDates } from '../../src/modules/search/DateRangePicker'

// FIX MINOR (a) — a persisted draft with a check-in/check-out earlier than today must be normalized on
// load so the header never shows a past range. (b) — the contact intro copy now asks for name, phone,
// and email. The server BOOKING_DATE_IN_PAST (400) backstop for a stale submit is covered by FIX 3's
// test/api/booking-past-date-guard.test.mjs.

const listing = readFileSync(new URL('../../src/modules/listings/ListingDetailPage.tsx', import.meta.url), 'utf8')
const review = readFileSync(new URL('../../src/modules/bookings/BookingReviewPage.tsx', import.meta.url), 'utf8')
const detail = readFileSync(new URL('../../src/modules/bookings/BookingDetailPage.tsx', import.meta.url), 'utf8')

describe('FIX MINOR (a) — dropPastDates clears a stale past range', () => {
  const today = '2026-07-24'

  it('clears a past check-in (and its check-out)', () => {
    expect(dropPastDates({ checkIn: '2026-07-20', checkOut: '2026-07-23' }, today)).toEqual({ checkIn: '', checkOut: '' })
  })

  it('keeps a future range', () => {
    expect(dropPastDates({ checkIn: '2026-08-01', checkOut: '2026-08-03' }, today)).toEqual({ checkIn: '2026-08-01', checkOut: '2026-08-03' })
  })

  it('keeps today as check-in but drops a check-out that is not after it', () => {
    expect(dropPastDates({ checkIn: '2026-07-24', checkOut: '2026-07-24' }, today)).toEqual({ checkIn: '2026-07-24', checkOut: '' })
  })

  it('handles an undefined/empty draft', () => {
    expect(dropPastDates(undefined, today)).toEqual({ checkIn: '', checkOut: '' })
  })

  it('the listing + review pages normalize the loaded range with dropPastDates', () => {
    expect(listing).toMatch(/dropPastDates\(/)
    expect(review).toMatch(/dropPastDates\(/)
  })
})

describe('FIX MINOR (b) — contact intro copy asks for name, phone, and email', () => {
  it('English intro mentions email', () => {
    expect(detail).toMatch(/Tell us your name, phone, and email/)
  })
})
