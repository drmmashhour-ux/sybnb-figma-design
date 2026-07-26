// Platform Contract Kit — the GENERIC conformance suite.
//
// A vertical/product supplies a FIXTURE (see fixture.template.mjs) that translates its own behavior into
// the small, generic evidence objects each invariant asserts on. The suite runs every invariant a fixture
// declares support for, and SKIPS the rest with the fixture's documented reason — so the suite is a
// growing, executable spec of the CORE contract, and each product proves exactly what it can today.
//
// No product specifics live here: no fixtures, no magic numbers, no domain types. Numbers/currency/route
// shapes stay inside your fixture; the suite only checks the invariant holds. Wire it from a one-line test:
//
//   import { describe, it, expect, beforeAll, afterAll } from 'vitest'
//   import { defineConformanceSuite } from '<kit>/conformance/suite.mjs'
//   import { myFixtures } from './fixtures/index.mjs'
//   defineConformanceSuite(myFixtures, { describe, it, expect, beforeAll, afterAll })
//
// The harness object is your test framework's primitives (shown with vitest; any describe/it/expect with a
// `.skip` on `it` works). Economics-leak detection is imported from the kit; everything else is fixture
// evidence.

import { findLeakedEconomicsKeys } from '../security/economicsLeak.mjs'

export function defineConformanceSuite(fixtures, harness) {
  const { describe, it, expect, beforeAll, afterAll } = harness
  const runOr = (supported, title, reason, fn) =>
    supported ? it(title, fn) : it.skip(`${title} — SKIPPED (${reason || 'not supported by this fixture'})`, () => {})

  for (const fx of fixtures) {
    describe(`CONFORMANCE · ${fx.name}`, () => {
      let ctx
      beforeAll(async () => {
        ctx = await fx.setup()
      })
      afterAll(async () => {
        await fx.teardown?.(ctx)
      })

      // C1 — no economics leak: no buyer-facing payload exposes the platform cut / supplier payout.
      runOr(fx.supports.leak, 'C1 no buyer-facing economics leak', fx.skipReason?.leak, async () => {
        const payloads = await fx.buyerFacingPayloads(ctx)
        for (const [label, json] of Object.entries(payloads)) {
          expect(findLeakedEconomicsKeys(json), `${label} leaked economics keys`).toEqual([])
        }
      })

      // C2 — authz: sensitive routes reject unauthenticated (401) and wrong-role (403). The fixture makes
      // the requests and returns the offending "METHOD path -> status" strings; empty ⇒ all correct.
      runOr(fx.supports.authz, 'C2 sensitive routes reject unauth (401) + wrong-role (403)', fx.skipReason?.authz, async () => {
        const { failures = [] } = await fx.authz(ctx)
        expect(failures, `authz failures:\n${failures.join('\n')}`).toEqual([])
      })

      // C4 — commission is computed on the base EXCLUDING tax, and does not move when tax changes.
      runOr(fx.supports.commissionOnBaseExcludingTax, 'C4 commission on base excluding tax; unchanged when tax changes', fx.skipReason?.commissionOnBaseExcludingTax, async () => {
        const c = await fx.commissionOnBaseExcludingTax(ctx)
        expect(c.commissionAtLowTax, 'commission unchanged when tax changes').toBe(c.commissionAtHighTax)
        expect(c.commissionAtLowTax, 'commission computed on the tax-excluded base').toBe(c.expectedOnBase)
      })

      // C5 — no "paid" without a real settlement reference.
      runOr(fx.supports.settlementRef, 'C5 no "paid" without a real settlement reference', fx.skipReason?.settlementRef, async () => {
        const s = await fx.settlementRef(ctx)
        expect(s.paidWithoutRef, 'payment without a settlement reference was accepted').toBe(false)
      })

      // C5b — a test/sandbox settlement reference is REJECTED in production; a real one is accepted.
      runOr(fx.supports.sandboxRefRejectedInProd, 'C5b sandbox settlement ref rejected in production (real ref accepted)', fx.skipReason?.sandboxRefRejectedInProd, async () => {
        const s = await fx.sandboxRefRejectedInProd(ctx)
        expect(s.sandboxRejectedInProd, 'sandbox ref rejected in production').toBe(true)
        expect(s.realAcceptedInProd, 'real ref accepted in production').toBe(true)
        expect(s.allowedOutsideProd, 'sandbox allowed outside production (dev/test)').toBe(true)
      })

      // C6 — fail-closed jurisdiction: nothing is charged until the jurisdiction is legally confirmed.
      runOr(fx.supports.jurisdictionFailClosed, 'C6 fail-closed jurisdiction: nothing charged until confirmed', fx.skipReason?.jurisdictionFailClosed, async () => {
        const j = await fx.jurisdictionFailClosed(ctx)
        expect(j.chargedWhileUnconfirmed, 'nothing charged while unconfirmed').toBe(false)
        expect(j.confirmed, 'jurisdiction is not yet confirmed').toBe(false)
      })

      // C7 — frozen terms: an ISSUED order keeps its economics even after the live rate changes.
      runOr(fx.supports.frozenTerms, 'C7 frozen-terms: an issued order keeps its terms after a rate change', fx.skipReason?.frozenTerms, async () => {
        const f = await fx.frozenTerms(ctx)
        expect(f.liveChanged, 'the live rate genuinely changed').toBe(true)
        expect(f.frozenUnchanged, 'the frozen record is unchanged').toBe(true)
        expect(f.statementReflectsFrozen, 'the statement renders the frozen terms, not the new rate').toBe(true)
      })

      // C8 — no double-book: concurrent claims on one slot resolve to exactly one winner, no double-alloc.
      runOr(fx.supports.noDoubleBook, 'C8 no-double-book: concurrent claims on one slot — exactly one wins', fx.skipReason?.noDoubleBook, async () => {
        const n = await fx.noDoubleBook(ctx)
        expect(n.oneWinner, 'exactly one concurrent claim wins').toBe(true)
        expect(n.noDoubleAllocation, 'the slot is never double-allocated').toBe(true)
      })

      // C9 — append-only audit on money/config/consent: a change appends an immutable before/after row and
      // there is no mutation path anywhere in the source.
      runOr(fx.supports.auditAppendOnly, 'C9 append-only audit (change appends before/after; no mutation path)', fx.skipReason?.auditAppendOnly, async () => {
        const a = await fx.auditAppendOnly(ctx)
        expect(a.changeAppendedAudit, 'a money/config/consent change appends an audit row').toBe(true)
        expect(a.auditHasBeforeAfter, 'the change audit records before AND after').toBe(true)
        expect(a.mutationPaths, `audit must be append-only; mutation paths: ${JSON.stringify(a.mutationPaths)}`).toEqual([])
      })
    })
  }
}
