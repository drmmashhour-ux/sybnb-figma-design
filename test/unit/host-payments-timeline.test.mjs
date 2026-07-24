import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// H6 (part 2) — the payments timeline renders the frozen M5 records via fetchHostPayments and performs NO
// money math of its own (every figure comes from the endpoint), so a host sees exactly what was frozen at
// settlement. Source-level guard (no jsdom runner).

const comp = readFileSync(new URL('../../src/modules/host/HostPaymentsTimeline.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8')

describe('H6 part 2 — host payments timeline', () => {
  it('reads the frozen endpoint (fetchHostPayments), not a local recompute', () => {
    expect(comp).toMatch(/fetchHostPayments\(/)
    // No client-side money math: it must not recompute a split/commission itself.
    expect(comp).not.toMatch(/bookingFinanceSplit|computeGuestBookingTotalMinor|platformFee|\*\s*commission/)
  })

  it('renders a booked → payment → release timeline with per-row status', () => {
    expect(comp).toMatch(/row\.checkIn/)
    expect(comp).toMatch(/row\.paymentDate/)
    expect(comp).toMatch(/row\.releaseDate/)
    expect(comp).toMatch(/row\.payoutStatus/)
  })

  it('shows the frozen amounts straight from the row (commission + host payout)', () => {
    expect(comp).toMatch(/row\.commissionMinor/)
    expect(comp).toMatch(/row\.netPayoutMinor/)
    expect(comp).toMatch(/moneyText\(/)
  })

  it('is routed at /host/payments', () => {
    expect(app).toMatch(/path === '\/host\/payments'/)
    expect(app).toMatch(/HostPaymentsTimeline/)
  })
})
