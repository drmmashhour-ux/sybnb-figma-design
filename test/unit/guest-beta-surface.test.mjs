import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// SYB-010 — /account and /dashboard must not silently render the landing page, and the unfinished guest
// account pages must not be wired. Source-level route guard (no jsdom runner); runtime is covered by the
// closed-beta E2E.

const app = readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8')
const surface = readFileSync(new URL('../../src/modules/beta/GuestBetaSurface.tsx', import.meta.url), 'utf8')

describe('SYB-010 — honest guest beta surface', () => {
  it('routes /account and /dashboard to the governed GuestBetaSurface, not LandingPage', () => {
    const idx = app.indexOf("path === '/dashboard' || path === '/account'")
    expect(idx).toBeGreaterThan(-1)
    const branch = app.slice(idx, idx + 400)
    expect(branch).toMatch(/GuestBetaSurface/)
    expect(branch).not.toMatch(/<LandingPage/)
  })

  it('does not wire the orphaned guest account/dashboard pages', () => {
    expect(app).not.toMatch(/import.*GuestAccountPage/)
    // The guest dashboard/DashboardPage is not imported (only Host/Driver dashboards are).
    expect(app).not.toMatch(/from '\.\.\/modules\/dashboard\/DashboardPage'/)
  })

  it('keeps /track as the official guest self-service flow', () => {
    expect(app).toMatch(/path === '\/track'/)
  })

  it('the guest surface points at /track and does not fabricate an account', () => {
    expect(surface).toMatch(/window\.location\.hash = '\/track'/)
    expect(surface).toMatch(/no full guest account|لا يوجد حساب ضيف كامل/)
  })
})
