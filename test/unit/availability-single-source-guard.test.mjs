import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// H4 — pins that the availability readers cannot silently diverge: the guest availability endpoint and the
// booking overlap guard must resolve "unavailable" from the SAME two facts — ListingAvailability status
// 'BLOCKED' and Booking rows in the SAME active-status set — and the host calendar must read that one
// endpoint rather than a private path.

const listings = readFileSync(new URL('../../server/routes/listings.mjs', import.meta.url), 'utf8')
const bookings = readFileSync(new URL('../../server/routes/bookings.mjs', import.meta.url), 'utf8')
const calendar = readFileSync(new URL('../../src/modules/host/HostAvailabilityCalendar.tsx', import.meta.url), 'utf8')

const ACTIVE_BOOKING_STATUSES = /\[\s*'REQUESTED',\s*'PAYMENT_PENDING',\s*'CONFIRMED'\s*\]/

describe('H4 — availability single source (no divergent path)', () => {
  it('the guest availability endpoint reads BLOCKED + the active-booking status set', () => {
    expect(listings).toMatch(/status: 'BLOCKED'/)
    expect(listings).toMatch(ACTIVE_BOOKING_STATUSES)
  })

  it('the booking overlap guard reads the SAME BLOCKED + active-booking status set', () => {
    expect(bookings).toMatch(/status: 'BLOCKED'/)
    expect(bookings).toMatch(ACTIVE_BOOKING_STATUSES)
  })

  it('the host calendar reads the single availability endpoint (fetchListingAvailability) — blocked + booked', () => {
    expect(calendar).toMatch(/fetchListingAvailability\(/)
    expect(calendar).toMatch(/response\.blockedDates/)
    expect(calendar).toMatch(/response\.bookedRanges/)
  })

  it('the host calendar locks booked dates (a booked date cannot be toggled)', () => {
    expect(calendar).toMatch(/bookedDates\.has\(iso\)/)
  })
})
