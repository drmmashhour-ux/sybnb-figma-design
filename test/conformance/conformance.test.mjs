import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { sumMoney } from '../../server/lib/currency.mjs'
import { findLeakedEconomicsKeys } from './contract.mjs'
import { cleanupTestUsers } from '../support/testServer.mjs'
import { staysFixture } from './fixtures/stays.fixture.mjs'
import { rideFixture } from './fixtures/ride.fixture.mjs'

// SYBNB CORE Conformance Suite — fixture-parameterized. Each CORE invariant runs against EVERY vertical
// that declares support for it (Stays + Ride today), proving this is a CORE contract, not STR-only.
// Ride is READ-ONLY (see fixtures/ride.fixture.mjs). Unsupported invariants are skipped with a reason.

const FIXTURES = [staysFixture, rideFixture]
const runOr = (cond, name, reason, fn) =>
  cond ? it(name, fn) : it.skip(`${name} — SKIPPED (${reason || 'not supported by this vertical'})`, () => {})

// ---- C3 · one money model (vertical-agnostic — both verticals share server/lib/currency.mjs) ----
describe('CONFORMANCE · C3 one money model (integer minor units; convert-then-sum; no mixed-currency sum)', () => {
  it('refuses to add mixed-currency amounts without a target currency', () => {
    expect(() => sumMoney([{ amountMinor: 100, currency: 'USD' }, { amountMinor: 15000, currency: 'SYP' }])).toThrow(/mixed-currency/i)
  })
  it('adds same-currency integer minor units exactly', () => {
    expect(sumMoney([{ amountMinor: 100, currency: 'USD' }, { amountMinor: 200, currency: 'USD' }])).toEqual({ amountMinor: 300, currency: 'USD' })
  })
  it('converts each input to the target currency before summing (integer minor result)', () => {
    const r = sumMoney([{ amountMinor: 100, currency: 'USD' }, { amountMinor: 15000, currency: 'SYP' }], 'USD')
    expect(r.currency).toBe('USD')
    expect(Number.isInteger(r.amountMinor)).toBe(true)
    expect(r.amountMinor).toBeGreaterThan(100)
  })
})

// ---- Per-vertical CORE invariants ----
for (const fx of FIXTURES) {
  describe(`CONFORMANCE · ${fx.name}`, () => {
    let ctx
    beforeAll(async () => {
      ctx = await fx.setup()
    })
    afterAll(async () => {
      await fx.teardown?.(ctx)
    })

    runOr(fx.supports.leak, 'C1 no buyer-facing leak of commission / host-driver economics', fx.skipReason?.leak, async () => {
      const payloads = await fx.buyerFacingPayloads(ctx)
      for (const [label, json] of Object.entries(payloads)) {
        expect(findLeakedEconomicsKeys(json), `${fx.name} ${label} leaked economics keys`).toEqual([])
      }
    })

    runOr(fx.supports.authz, 'C2 sensitive routes reject unauth (401) and wrong-role (403)', fx.skipReason?.authz, async () => {
      for (const r of fx.sensitiveRoutes(ctx)) {
        const unauth = await request(ctx.app)[r.method](r.path).send(r.body || {})
        expect(unauth.status, `${r.method} ${r.path} unauth`).toBe(401)
        if (r.wrongRoleToken) {
          const wrong = await request(ctx.app)[r.method](r.path).set({ Authorization: `Bearer ${r.wrongRoleToken}` }).send(r.body || {})
          expect(wrong.status, `${r.method} ${r.path} wrong-role`).toBe(403)
        }
      }
    })

    runOr(fx.supports.commissionTaxInvariant, 'C4 commission on base excluding tax; unchanged when tax changes', fx.skipReason?.commissionTaxInvariant, async () => {
      const c = await fx.commissionTaxInvariant(ctx)
      expect(c.atLowTax, 'commission unchanged when tax changes').toBe(c.atHighTax)
      expect(c.atLowTax, 'commission is computed on the base (accom+cleaning)').toBe(Math.round(c.baseMinor * c.rate))
      expect(c.atLowTax, 'commission base does NOT include tax').not.toBe(Math.round((c.baseMinor + c.taxMinor) * c.rate))
    })

    runOr(fx.supports.jurisdictionFailClosed, 'C6 fail-closed jurisdiction: nothing charged until legalReviewStatus=confirmed', fx.skipReason?.jurisdictionFailClosed, async () => {
      const j = await fx.jurisdictionFailClosed(ctx)
      expect(j.chargedWhileUnconfirmed, 'no tax charged while jurisdiction is unconfirmed').toBe(false)
      expect(j.legalReviewStatus, 'jurisdiction is not yet confirmed').not.toBe('confirmed')
    })

    runOr(fx.supports.settlementRef, 'C5 no "paid" without a real settlement reference', fx.skipReason?.settlementRef, async () => {
      const s = await fx.settlementRef(ctx)
      expect(s.paidWithoutRef, `payment without a settlement reference was accepted (status ${s.status}, code ${s.rejectionCode})`).toBe(false)
    })

    runOr(fx.supports.auditAppendOnly, 'C9 append-only audit on money/config/consent (config change appends before/after; no mutation path)', fx.skipReason?.auditAppendOnly, async () => {
      const a = await fx.auditAppendOnly(ctx)
      expect(a.configChangeAppended, 'a config/rate change appends an audit row').toBe(true)
      expect(a.updateHasBeforeAfter, 'the config-change audit records before AND after (values differ)').toBe(true)
      expect(a.mutationPaths, `audit log must be append-only; mutation paths: ${JSON.stringify(a.mutationPaths)}`).toEqual([])
    })
  })
}

afterAll(async () => {
  await cleanupTestUsers()
})

// ---- PENDING — the rest of the CORE contract, documented + tied to the A-item that will fill each ----
describe('CONFORMANCE · pending invariants (documented; grow with the A-items)', () => {
  it.skip('C7 frozen-terms: a booking\'s commission terms are immutable once set  [→ A-item: frozen M5 records]', () => {})
  it.skip('C8 no-double-book: two concurrent bookings for one slot cannot both confirm  [→ A-item: H5 concurrency]', () => {})
  // C9 append-only audit — NOW LIVE (A6.3): wired per-fixture above (Stays proves it; Ride skips read-only).
  it.skip('C5b sandbox ref rejected in prod: a test/sandbox settlement ref is refused under NODE_ENV=production  [→ A-item: prod settlement guard]', () => {})
})
