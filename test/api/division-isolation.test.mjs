import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { testApp } from '../support/testServer.mjs'

// SYB-008 — STR-only division isolation, API-entry enforcement. The test env sets
// CLOSED_BETA_ALLOW_GATED_ROUTES=1 so the SR suites run; here we temporarily UNSET it to prove the gate
// actually refuses gated traffic in beta/production configuration.

describe('SYB-008 — closed-beta API gate enforces STR-only', () => {
  const app = testApp()
  let priorFlag

  beforeEach(() => { priorFlag = process.env.CLOSED_BETA_ALLOW_GATED_ROUTES; delete process.env.CLOSED_BETA_ALLOW_GATED_ROUTES })
  afterEach(() => { if (priorFlag === undefined) delete process.env.CLOSED_BETA_ALLOW_GATED_ROUTES; else process.env.CLOSED_BETA_ALLOW_GATED_ROUTES = priorFlag })

  it('refuses the Ride/SR API families with a governed 403 (direct call cannot bypass hidden nav)', async () => {
    for (const path of ['/api/driver/overview', '/api/sr/rides/quote']) {
      const res = await request(app).get(path)
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('CLOSED_BETA_DIVISION_UNAVAILABLE')
    }
  })

  it('refuses browsing a gated listing division with a governed 403', async () => {
    // These are real listing-browse divisions and hit the closed-beta division gate.
    for (const division of ['RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION']) {
      const res = await request(app).get(`/api/listings?division=${division}`)
      expect(res.status, `${division} must be gated`).toBe(403)
      expect(res.body.error.code).toBe('CLOSED_BETA_DIVISION_UNAVAILABLE')
    }
  })

  it('never serves a non-STAYS division through listings (SELL is the seller flow, gated at nav)', async () => {
    // SELL is not a listings-browse division — it is rejected as an invalid listing division (non-200),
    // and is gated as a Soon division at the navigation layer. Either way it is never served.
    const res = await request(app).get('/api/listings?division=SELL')
    expect(res.status).not.toBe(200)
  })

  it('keeps STAYS active', async () => {
    const res = await request(app).get('/api/listings?division=STAYS')
    expect(res.status).toBe(200)
  })

  it('does not gate admin routes (staff oversight must keep working)', async () => {
    // Unauthenticated -> 401 (auth), NOT 403 CLOSED_BETA — proving the gate did not intercept it.
    const res = await request(app).get('/api/admin/review-queue')
    expect(res.status).not.toBe(403)
    expect(res.body?.error?.code).not.toBe('CLOSED_BETA_DIVISION_UNAVAILABLE')
  })

  it('with the explicit test flag set, gated routes pass through to their handlers (SR suites)', async () => {
    process.env.CLOSED_BETA_ALLOW_GATED_ROUTES = '1'
    const res = await request(app).get('/api/sr/rides/quote')
    // No longer the closed-beta 403 — the request reaches the handler (which returns its own status).
    expect(res.body?.error?.code).not.toBe('CLOSED_BETA_DIVISION_UNAVAILABLE')
  })
})
