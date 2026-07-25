// SYBNB CORE Conformance Suite — the vertical-agnostic contract every division must satisfy.
//
// A vertical supplies a FIXTURE (see fixtures/*.fixture.mjs) implementing the shape below; the harness
// (conformance.test.mjs) runs each CORE invariant the fixture declares support for, and marks the rest
// pending/skipped with a documented reason. This makes the suite a growing, executable spec of the CORE
// contract — not an STR-only test. Two verticals are wired today: Stays (STR) and Ride (SR, read-only).
//
// GUARDRAIL: the Ride fixture is READ-ONLY — it asserts against Ride's existing behavior and never
// mutates Ride/frozen state. A failing invariant for Ride is a documented FINDING, not a fix target.
//
// Fixture shape:
//   {
//     name: 'stays' | 'ride',
//     supports: { leak, authz, commissionTaxInvariant, jurisdictionFailClosed, settlementRef: boolean },
//     skipReason?: { <invariant>: string },   // why an unsupported invariant is N/A for this vertical
//     async setup() -> ctx,
//     async teardown(ctx),
//     async buyerFacingPayloads(ctx) -> { [label]: json },        // C1 — must not leak economics
//     sensitiveRoutes(ctx) -> [{ method, path, wrongRoleToken? }], // C2 — unauth 401, wrong-role 403
//     async commissionTaxInvariant(ctx) -> { atLowTax, atHighTax },// C4 — commission unchanged by tax
//     async jurisdictionFailClosed(ctx) -> { chargedWhileUnconfirmed: boolean }, // C6
//     async settlementRef(ctx) -> { paidWithoutRef: boolean },     // C5
//   }

// Any buyer-facing payload (quote / booking / ride) must expose NONE of these host/driver-economics
// fields — the platform's cut and the supplier's payout are never shown to the paying buyer.
export const FORBIDDEN_ECONOMICS_KEYS = [
  'commission',
  'commissionMinor',
  'platformFee',
  'platformFeeMinor',
  'hostGross',
  'hostGrossMinor',
  'hostPayout',
  'hostPayoutMinor',
  'driverEarn',
  'driverEarnings',
  'driverPayout',
  'driverPayoutMinor',
  'netPayout',
]

export function findLeakedEconomicsKeys(json) {
  const raw = JSON.stringify(json ?? {})
  return FORBIDDEN_ECONOMICS_KEYS.filter((key) => new RegExp(`"[^"]*${key}[^"]*"\\s*:`, 'i').test(raw))
}
