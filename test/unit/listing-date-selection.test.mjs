import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// SYB-001 — the listing page must own a governed date-selection control. This is a source-level guard
// (the project has no jsdom component runner): it asserts the control is wired and would fail if the
// picker, its availability feed, or the date-change handler were removed — the exact regression that
// produced SYB-001. Runtime behaviour is exercised by the closed-beta browser E2E.

const listing = readFileSync(new URL('../../src/modules/listings/ListingDetailPage.tsx', import.meta.url), 'utf8')
const review = readFileSync(new URL('../../src/modules/bookings/BookingReviewPage.tsx', import.meta.url), 'utf8')

describe('SYB-001 — listing page renders a governed, availability-aware date picker', () => {
  it('renders a DateRangePicker (previously zero on this page)', () => {
    expect(listing).toMatch(/<DateRangePicker/)
  })

  it('feeds the server-computed disabledDates into the picker (availability is truthful)', () => {
    expect(listing).toMatch(/disabledDates=\{disabledDates\}/)
  })

  it('wires a date-change handler that updates dateRange (drives re-quote + draft persistence)', () => {
    expect(listing).toMatch(/onChange=\{\(range\)\s*=>\s*setDateRange\(range\)\}/)
  })

  it('refreshes availability when the date control is opened', () => {
    expect(listing).toMatch(/loadAvailability\(\)/)
    // the open handler both opens the calendar and re-fetches availability
    expect(listing).toMatch(/setOpenCalendar\(true\);\s*void loadAvailability\(\)/)
  })

  it('exposes both check-in and check-out fields', () => {
    const fields = (listing.match(/<DateField/g) || []).length
    expect(fields).toBeGreaterThanOrEqual(2)
  })
})

describe('SYB-001 — Booking Review no longer instructs an impossible action', () => {
  it('does not tell the guest to choose dates on the listing page WITHOUT pointing at the selector', () => {
    // The old copy said "on the listing page first" with no control there. The corrected copy names the
    // date selector, which now exists.
    expect(review).toMatch(/date selector on the listing page/)
    expect(review).not.toMatch(/on the listing page first/)
  })
})
