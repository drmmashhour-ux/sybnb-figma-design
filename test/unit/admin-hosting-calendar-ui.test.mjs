import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// AD1 (part 2) — the grouped "Hosting" booked-vs-vacant view renders ONLY the /api/admin/hosting-calendar
// endpoint (the single availability source) and replaces the old "Coming soon" placeholder. Source guard.

const comp = readFileSync(new URL('../../src/modules/operations/AdminHostingCalendar.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../../src/modules/operations/OperationsCalendarPage.tsx', import.meta.url), 'utf8')

describe('AD1 part 2 — admin hosting calendar UI', () => {
  it('reads the single-source endpoint (fetchAdminHostingCalendar) and no divergent data', () => {
    expect(comp).toMatch(/fetchAdminHostingCalendar\(/)
    expect(comp).not.toMatch(/fetchPrototypeReviewQueue|listingAvailability|bookingFinanceSplit/)
  })

  it('renders booked vs blocked vs vacant across hosts', () => {
    expect(comp).toMatch(/row\.bookedRanges\.map/)
    expect(comp).toMatch(/row\.blockedDates\.map/)
    expect(comp).toMatch(/row\.hostName/)
    expect(comp).toMatch(/t\.vacant/)
  })

  it('replaces the OperationsCalendarPage "Coming soon" placeholder', () => {
    expect(page).toMatch(/<AdminHostingCalendar lang=\{lang\} \/>/)
    // The old placeholder text is gone.
    expect(page).not.toMatch(/\{t\.aiText\}/)
  })
})
