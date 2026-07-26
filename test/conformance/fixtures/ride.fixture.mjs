import request from 'supertest'
import { db } from '../../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../../server/lib/security.mjs'
import { testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../../support/testServer.mjs'

// Ride (SR) fixture for the CORE conformance suite — READ-ONLY. It asserts against Ride's EXISTING
// behavior (a rider quote is a read-only computation; the authz probes send rejected requests that
// never mutate state). It NEVER modifies Ride/frozen code or data. Ride is frozen, so the money /
// jurisdiction / settlement invariants are not wired here (scoped-skip with a reason) — proving those
// for SR is a separate SR-owned A-item, not part of this STR-track scaffold.

const DAMASCUS = { latitude: 33.5138, longitude: 36.2765 }
const NEARBY = { latitude: 33.53, longitude: 36.29 }

export const rideFixture = {
  name: 'ride',
  supports: { leak: true, authz: true, commissionTaxInvariant: false, jurisdictionFailClosed: false, settlementRef: false, frozenTerms: false, noDoubleBook: false, sandboxRefRejected: false },
  skipReason: {
    commissionTaxInvariant: 'SR commission tiers are frozen/read-only here — proving on the SR path is a separate SR A-item',
    jurisdictionFailClosed: 'SR jurisdiction gating is frozen/read-only here — separate SR A-item',
    settlementRef: 'SR ride settlement is frozen/read-only here — separate SR A-item',
    frozenTerms: 'SR ride settlement/terms are frozen/read-only here — proving the SR frozen-terms guarantee is a separate SR A-item',
    noDoubleBook: 'SR has no date-slot inventory (a ride is a one-off dispatch, not a calendar slot) — its one-winner guard is driver-assignment, a separate frozen SR concern',
    sandboxRefRejected: 'SR ride settlement is frozen/read-only here — the Stripe livemode prod-guard lives on the Stays settlement path; proving it on the SR path is a separate frozen SR concern',
  },

  async setup() {
    const app = testApp()
    const u = await db().user.create({
      data: {
        email: uniqueTestEmail('conf-ride-rider'),
        passwordHash: hashPassword('correct-horse-battery'),
        displayName: 'Conf Rider',
        referralCode: uniqueTestReferralCode(),
        status: 'ACTIVE',
        roles: { create: { role: 'GUEST' } },
        phoneHash: `conf-rider-${Math.random().toString(36).slice(2)}`,
      },
    })
    trackTestUser(u.id)
    return { app, rider: { token: createSessionToken(u), id: u.id } }
  },

  async teardown() {
    // read-only: nothing created beyond the tracked rider user (cleaned by cleanupTestUsers()).
  },

  async buyerFacingPayloads(ctx) {
    // A rider quote (read-only). Must not expose driver earnings / platform commission.
    const quote = await request(ctx.app)
      .post('/api/sr/quote')
      .set({ Authorization: `Bearer ${ctx.rider.token}` })
      .send({ category: 'SR Economy', pickup: 'Damascus A', dropoff: 'Damascus B', pickupCoords: DAMASCUS, dropoffCoords: NEARBY, currency: 'SYP' })
    return { quote: quote.body }
  },

  sensitiveRoutes(ctx) {
    // Driver-only routes: no session → 401; a rider (GUEST) session → 403. Rejected probes only.
    return [
      { method: 'get', path: '/api/driver/vehicles', wrongRoleToken: ctx.rider.token },
      { method: 'get', path: '/api/driver/rides/pending', wrongRoleToken: ctx.rider.token },
    ]
  },
}
