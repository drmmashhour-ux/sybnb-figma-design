import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  activeDivisions, assertDivisionActiveForBeta, closedBetaRouteBlocked, gatedRoutesAllowed, isDivisionActive,
} from '../../server/lib/closed-beta-gate.mjs'

// SYB-008 — pure closed-beta gate logic (Layer 3 primitives) + navigation-layer source guard.

describe('SYB-008 gate — active divisions', () => {
  it('STAYS is active by default; the other divisions are not', () => {
    expect(isDivisionActive('STAYS', {})).toBe(true)
    for (const d of ['RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION', 'SELL', 'RIDE']) {
      expect(isDivisionActive(d, {})).toBe(false)
    }
  })
  it('is case-insensitive and configurable via CLOSED_BETA_ACTIVE_DIVISIONS', () => {
    expect(isDivisionActive('stays', {})).toBe(true)
    expect(activeDivisions({ CLOSED_BETA_ACTIVE_DIVISIONS: 'STAYS,RENTALS' }).has('RENTALS')).toBe(true)
  })
})

describe('SYB-008 gate — gated API route families (Ride/SR)', () => {
  it('blocks /api/driver and /api/sr when the gate is enforced (flag unset)', () => {
    for (const p of ['/api/driver', '/api/driver/quebec-onboarding/x', '/api/sr', '/api/sr/rides/1']) {
      expect(closedBetaRouteBlocked(p, {})).toBe(true)
    }
  })
  it('never blocks admin or stays/listings routes', () => {
    for (const p of ['/api/admin/review-queue', '/api/listings', '/api/bookings', '/api/me/overview']) {
      expect(closedBetaRouteBlocked(p, {})).toBe(false)
    }
  })
  it('is relaxed only under the explicit CLOSED_BETA_ALLOW_GATED_ROUTES=1 flag', () => {
    expect(gatedRoutesAllowed({ CLOSED_BETA_ALLOW_GATED_ROUTES: '1' })).toBe(true)
    expect(closedBetaRouteBlocked('/api/sr/rides/1', { CLOSED_BETA_ALLOW_GATED_ROUTES: '1' })).toBe(false)
    expect(gatedRoutesAllowed({})).toBe(false)
  })
})

describe('SYB-008 gate — division-parameter assertion', () => {
  it('passes STAYS, throws 403 CLOSED_BETA for a gated division', () => {
    expect(() => assertDivisionActiveForBeta('STAYS', {})).not.toThrow()
    let err
    try { assertDivisionActiveForBeta('RENTALS', {}) } catch (e) { err = e }
    expect(err?.statusCode).toBe(403)
    expect(err?.code).toBe('CLOSED_BETA_DIVISION_UNAVAILABLE')
  })
  it('does not throw for a gated division when the test flag is set', () => {
    expect(() => assertDivisionActiveForBeta('RENTALS', { CLOSED_BETA_ALLOW_GATED_ROUTES: '1' })).not.toThrow()
  })
})

describe('SYB-008 navigation layer — divisions.ts and the route gate', () => {
  const divisions = readFileSync(new URL('../../src/engines/navigation/divisions.ts', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8')
  it('exactly one division is active (Stays); the other seven are Soon', () => {
    expect((divisions.match(/status: 'active'/g) || []).length).toBe(1)
    expect((divisions.match(/status: 'soon'/g) || []).length).toBe(7)
  })
  it('App routes a gated division to the closed-beta notice before its page', () => {
    expect(app).toMatch(/gatedDivisionForPath\(path\)/)
    expect(app).toMatch(/ClosedBetaDivisionNotice/)
  })
})
