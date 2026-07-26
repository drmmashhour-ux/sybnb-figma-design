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

    runOr(fx.supports.frozenTerms, 'C7 frozen-terms: an issued booking keeps its commission terms after a later rate change', fx.skipReason?.frozenTerms, async () => {
      const f = await fx.frozenTerms(ctx)
      expect(f.issuedRateParts, 'booking issued at the 13% rate (parts-per-million)').toBe(130_000)
      expect(f.issuedCommissionMinor, 'issued commission = 13% of the 120.00 base').toBe(15_60)
      expect(f.liveRateNow, 'the LIVE rate genuinely changed to 25%').toBeCloseTo(0.25)
      expect(f.stillFrozenRateParts, 'the frozen Payment rate is unchanged after the policy change').toBe(130_000)
      expect(f.stillFrozenCommissionMinor, 'the frozen commission amount is unchanged').toBe(15_60)
      expect(f.statementCommissionMinor, 'the statement renders the frozen 13% commission, NOT the new 25%').toBe(15_60)
    })

    runOr(fx.supports.sandboxRefRejected, 'C5b sandbox settlement ref rejected in production (real live-mode ref accepted)', fx.skipReason?.sandboxRefRejected, async () => {
      const s = await fx.sandboxRefRejected()
      expect(s.testModeRejectedInProd, 'a test-mode (livemode:false) settlement is rejected in production').toBe(s.expectedRejectCode)
      expect(s.missingLivemodeRejectedInProd, 'a missing livemode is treated as unsafe (rejected) in production').toBe(s.expectedRejectCode)
      expect(s.liveAcceptedInProd, 'a real live-mode settlement is accepted in production').toBeNull()
      expect(s.testModeAllowedOutsideProd, 'test-mode settles fine outside production (dev/test)').toBeNull()
      expect(s.settlementPathRejectsSandboxInProd, 'the REAL Stripe settlement path rejects a sandbox ref in production (guard wired)').toBe(s.expectedRejectCode)
    })

    runOr(fx.supports.noDoubleBook, 'C8 no-double-book: concurrent bookings for one slot — exactly one wins, no double-allocation', fx.skipReason?.noDoubleBook, async () => {
      const c = await fx.noDoubleBook(ctx)
      expect(c.successCount, `exactly one concurrent attempt succeeds (got statuses ${JSON.stringify(c.statuses)})`).toBe(1)
      expect(c.conflictCount, 'the other concurrent attempt is rejected').toBe(1)
      expect(c.conflictCode, 'the loser is rejected with the dates-unavailable conflict').toBe('BOOKING_DATES_UNAVAILABLE')
      expect(c.activeForSlot, 'exactly one active booking exists for the slot (no double-allocation)').toBe(1)
    })

    runOr(fx.supports.auditAppendOnly, 'C9 append-only audit on money/config/consent (config change appends before/after; no mutation path)', fx.skipReason?.auditAppendOnly, async () => {
      const a = await fx.auditAppendOnly(ctx)
      expect(a.configChangeAppended, 'a config/rate change appends an audit row').toBe(true)
      expect(a.updateHasBeforeAfter, 'the config-change audit records before AND after (values differ)').toBe(true)
      expect(a.mutationPaths, `audit log must be append-only; mutation paths: ${JSON.stringify(a.mutationPaths)}`).toEqual([])
    })

    runOr(fx.supports.reconciliationGate, 'C10 reconcile-before-payout: no disburse without a MATCHED reconciliation; disburser != verifier/releaser/reconciler; records append-only, one MATCHED per payment', fx.skipReason?.reconciliationGate, async () => {
      const r = await fx.reconciliationGate(ctx)
      // 1. money-out gate: a payout cannot disburse until its funds are reconciled to a MATCHED record.
      expect(r.disbursedWithoutMatch, 'a payout with no MATCHED reconciliation must be refused').toBe(false)
      expect(r.noMatchRejectionCode, 'the refusal code is PAYOUT_NOT_RECONCILED').toBe('PAYOUT_NOT_RECONCILED')
      expect(r.matchRecorded, 'an exact statement line records a MATCHED (computed, never asserted)').toBe('MATCHED')
      // 2. maker != checker includes the reconciler; a distinct admin can still disburse.
      expect(r.reconcilerCouldDisburse, 'the admin who reconciled must not also disburse').toBe(false)
      expect(r.reconcilerRejectionCode, 'the reconciler disburse is refused as dual-control').toBe('PAYOUT_DUAL_CONTROL_REQUIRED')
      expect(r.distinctDisburserSucceeded, 'a distinct disburser CAN disburse reconciled funds').toBe(true)
      // 3. append-only + at most one MATCHED per payment.
      expect(r.matchedCount, 'at most one MATCHED reconciliation per payment').toBe(1)
      expect(r.duplicateStatus, 'a re-submitted line is recorded as a MISMATCH, never a second MATCHED').toBe('MISMATCH')
      expect(r.appendOnlyRowsAccumulate, 'a re-attempt appends a NEW row (records are append-only, never mutated)').toBe(true)
    })
  })
}

afterAll(async () => {
  await cleanupTestUsers()
})

// ---- COVERAGE — the CORE contract is fully wired: every invariant above is LIVE (no pending stubs) ----
// The historical pending set (C7 frozen-terms, C8 no-double-book, C9 append-only audit, C5b sandbox-ref)
// is now proven per-fixture above. This makes Stays the first fully conformance-covered golden brick.
describe('CONFORMANCE · contract coverage (STR is the golden reference brick)', () => {
  it('Stays declares support for EVERY CORE invariant — nothing is documented-only', () => {
    const CORE_INVARIANTS = [
      'leak', 'authz', 'commissionTaxInvariant', 'jurisdictionFailClosed', 'settlementRef',
      'sandboxRefRejected', 'frozenTerms', 'noDoubleBook', 'auditAppendOnly',
    ]
    for (const inv of CORE_INVARIANTS) {
      expect(staysFixture.supports[inv], `Stays must prove ${inv} as a live invariant`).toBe(true)
    }
  })
})
