import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// A3.1 defense-in-depth — even though the STR wizard UI is locked to STAYS, the server must refuse
// CREATING a listing in a gated (non-STR) division during the closed beta (not just the UI). The test
// env relaxes the gate (CLOSED_BETA_ALLOW_GATED_ROUTES=1); each assertion below enforces it by
// temporarily clearing the flag, then restores it in afterEach so the rest of the suite is unaffected.

describe('A3.1 — server rejects non-STR listing create under the enforced closed-beta gate', () => {
  let app
  let host
  const priorFlag = process.env.CLOSED_BETA_ALLOW_GATED_ROUTES

  beforeAll(async () => {
    app = testApp()
    const u = await db().user.create({
      data: {
        email: uniqueTestEmail('a3-host'),
        passwordHash: hashPassword('correct-horse-battery'),
        displayName: 'A3 Host',
        referralCode: uniqueTestReferralCode(),
        status: 'ACTIVE',
        roles: { create: { role: 'HOST' } },
      },
    })
    trackTestUser(u.id)
    host = { token: createSessionToken(u), id: u.id }
  })

  afterEach(() => {
    if (priorFlag === undefined) delete process.env.CLOSED_BETA_ALLOW_GATED_ROUTES
    else process.env.CLOSED_BETA_ALLOW_GATED_ROUTES = priorFlag
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  function enforceGate() {
    delete process.env.CLOSED_BETA_ALLOW_GATED_ROUTES
  }
  function createListing(division) {
    return request(app)
      .post('/api/listings')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ division, titleAr: 'اختبار الإعلان', priceMinor: 100_00, currency: 'USD', metadata: { country: 'XC' } })
  }

  it('rejects a CARS create with 403 CLOSED_BETA_DIVISION_UNAVAILABLE when the gate is enforced', async () => {
    enforceGate()
    const res = await createListing('CARS')
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('CLOSED_BETA_DIVISION_UNAVAILABLE')
  })

  it('rejects BUY / RENTALS / MARKETPLACE / NEW_CONSTRUCTION creates when the gate is enforced', async () => {
    enforceGate()
    for (const division of ['BUY', 'RENTALS', 'MARKETPLACE', 'NEW_CONSTRUCTION']) {
      const res = await createListing(division)
      expect(res.status, `${division} should be gated`).toBe(403)
      expect(res.body.error?.code, `${division}`).toBe('CLOSED_BETA_DIVISION_UNAVAILABLE')
    }
  })

  it('allows a STAYS (STR) create when the gate is enforced (STR is the active division)', async () => {
    enforceGate()
    const res = await createListing('STAYS')
    expect(res.status).toBe(201)
    expect(res.body.listing.division).toBe('STAYS')
  })
})
