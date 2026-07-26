// Platform Contract Kit — FIXTURE TEMPLATE. Copy this per vertical/product, fill in the methods, and pass
// an array of fixtures to defineConformanceSuite(). Each method translates YOUR platform's behavior into
// the small generic evidence object the suite asserts on — all domain specifics (numbers, currency, route
// paths, ORM calls, HTTP client) stay in here.
//
// `supports` declares which invariants this fixture proves; omit/false ⇒ the suite SKIPS it (add a
// `skipReason` so the skip is documented, e.g. a read-only fixture that asserts against frozen behavior).
// A fixture that mutates shared state MUST clean up in teardown — see ISOLATION.md.

export const exampleFixture = {
  name: 'example', // shown in the suite output: "CONFORMANCE · example"

  supports: {
    leak: false,
    authz: false,
    commissionOnBaseExcludingTax: false,
    settlementRef: false,
    sandboxRefRejectedInProd: false,
    jurisdictionFailClosed: false,
    frozenTerms: false,
    noDoubleBook: false,
    auditAppendOnly: false,
  },

  // Optional: why an unsupported invariant is N/A here (a read-only fixture, a model that doesn't apply).
  skipReason: {
    // noDoubleBook: 'this product has no slot inventory',
  },

  // Build any state the invariants need (users, listings, an app handle). Return it as `ctx`.
  async setup() {
    return { /* app, actors, ids, … */ }
  },
  // Delete EVERYTHING this fixture created (rows, audit entries, uploaded files). Restore any env you set.
  async teardown(_ctx) {},

  // C1 — return the buyer-visible payloads to scan. { label: json }.
  async buyerFacingPayloads(_ctx) {
    return { /* quote: {...}, order: {...} */ }
  },

  // C2 — make the requests yourself (no-token ⇒ expect 401; wrong-role ⇒ expect 403) and return the
  // offending "METHOD path -> status" strings. Empty array ⇒ all correct.
  async authz(_ctx) {
    return { failures: [] }
  },

  // C4 — commission computed at a LOW and a HIGH tax; both must equal each other AND the tax-excluded base
  // commission. { commissionAtLowTax, commissionAtHighTax, expectedOnBase } (integer minor units).
  async commissionOnBaseExcludingTax(_ctx) {
    return { commissionAtLowTax: 0, commissionAtHighTax: 0, expectedOnBase: 0 }
  },

  // C5 — attempt to mark paid WITHOUT a real settlement reference; it must be rejected.
  async settlementRef(_ctx) {
    return { paidWithoutRef: false }
  },

  // C5b — exercise your production settlement guard: a sandbox/test ref must be rejected under a simulated
  // production env, a real one accepted, and sandbox allowed outside production. (See secretNotInProd.mjs's
  // productionGuardOutcome to test a pure guard without mutating process.env.)
  async sandboxRefRejectedInProd(_ctx) {
    return { sandboxRejectedInProd: true, realAcceptedInProd: true, allowedOutsideProd: true }
  },

  // C6 — while the jurisdiction is not legally confirmed, nothing is charged and status != confirmed.
  async jurisdictionFailClosed(_ctx) {
    return { chargedWhileUnconfirmed: false, confirmed: false }
  },

  // C7 — issue an order at rate X, then change the live rate to Y. The frozen record must be unchanged, the
  // live rate must have genuinely changed, and a statement must render the frozen terms (not Y).
  async frozenTerms(_ctx) {
    return { liveChanged: true, frozenUnchanged: true, statementReflectsFrozen: true }
  },

  // C8 — fire two concurrent claims on the SAME slot; exactly one wins and the slot is never double-booked.
  async noDoubleBook(_ctx) {
    return { oneWinner: true, noDoubleAllocation: true }
  },

  // C9 — make a money/config/consent change: it appends an audit row with before AND after, and a static
  // scan (contracts/security/appendOnlyAudit.mjs) finds NO mutation path. { changeAppendedAudit,
  // auditHasBeforeAfter, mutationPaths }.
  async auditAppendOnly(_ctx) {
    return { changeAppendedAudit: true, auditHasBeforeAfter: true, mutationPaths: [] }
  },
}
