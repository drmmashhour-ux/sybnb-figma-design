import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// M8 — the guest checkout must SHOW the jurisdiction tax line, and a PENDING_CONFIRMATION status must
// render an explicit "pending confirmation" message rather than a $0. Source-level guard (no jsdom runner).

const review = readFileSync(new URL('../../src/modules/bookings/BookingReviewPage.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../src/shared/api/platformApi.ts', import.meta.url), 'utf8')

describe('M8 — guest checkout shows the tax line', () => {
  it('the quote breakdown type carries the taxLine', () => {
    expect(api).toMatch(/taxLine: PlatformStayTaxLine/)
    expect(api).toMatch(/PENDING_CONFIRMATION/)
  })

  it('the tax type carries a per-component list', () => {
    expect(api).toMatch(/PlatformStayTaxComponent\[\]/)
  })

  it('pending confirmation renders an explicit line, resolved renders each component separately', () => {
    expect(review).toMatch(/taxLine\?\.status === 'PENDING_CONFIRMATION'/)
    expect(review).toMatch(/t\.taxPending/)
    expect(review).toMatch(/taxLine\?\.status === 'RESOLVED'/)
    // Multi-component: each component renders as its own line.
    expect(review).toMatch(/taxLine\.components\.map\(/)
  })

  it('the pending copy never reads as a zero / free', () => {
    expect(review).toMatch(/taxPending: '[^']*قيد التأكيد/) // ar: "pending confirmation"
    expect(review).toMatch(/taxPending: 'Tax treatment pending confirmation/) // en
  })
})
