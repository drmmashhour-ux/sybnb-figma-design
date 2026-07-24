import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// FIX 2 (client) — the contact-before-payment form must collect Email + Confirm email, validate they
// match and are a valid email, block continue otherwise, and send the email to the server. Source guard
// (no jsdom runner): asserts the fields + match validation + wiring are present.

const page = readFileSync(new URL('../../src/modules/bookings/BookingDetailPage.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../src/shared/api/platformApi.ts', import.meta.url), 'utf8')

describe('FIX 2 — contact form captures + validates guest email', () => {
  it('has email and confirm-email state', () => {
    expect(page).toMatch(/contactEmail\b/)
    expect(page).toMatch(/contactEmailConfirm\b/)
  })

  it('validates that the two emails match', () => {
    expect(page).toMatch(/contactEmail\s*===\s*contactEmailConfirm|contactEmailConfirm\s*===\s*contactEmail/)
  })

  it('passes guestEmail to submitBookingContact', () => {
    expect(page).toMatch(/guestEmail:/)
  })

  it('submitBookingContact accepts guestEmail', () => {
    const block = api.slice(api.indexOf('export async function submitBookingContact'), api.indexOf('export async function submitBookingContact') + 260)
    expect(block).toMatch(/guestEmail/)
  })
})
