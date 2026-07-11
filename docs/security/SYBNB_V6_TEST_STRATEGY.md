# SYBNB V6 — Automated Test Strategy

Date: 2026-07-10. Companion to `SYBNB_V6_SECURITY_AUDIT_2026_07_10.md` and
`SYBNB_V6_THREAT_MODEL.md` — describes the test foundation added on the
`security/sybnb-v6-predeployment` branch.

## Stack and why

- **Vitest** (`vitest.config.ts`) — the project already uses Vite; Vitest shares its config/module
  resolution instead of introducing a second bundler-config surface (Jest would need its own).
- **Supertest** — binds directly to the exported `http.Server` instance from `server/index.mjs`
  (never auto-listens when imported — see the `isMainModule` guard) on an ephemeral port. Tests
  exercise real HTTP request/response handling, real routing, and real middleware ordering
  (CORS → security headers → rate limiting → auth context → dispatch), not a mocked subset of it.
- **Real local Postgres**, not a mocked Prisma client. This project's own architecture leans on
  database-level guarantees (WHERE-guarded `updateMany` for optimistic concurrency, unique
  constraints, real transactions) that a mock would either have to reimplement or silently skip —
  either way defeating the point of testing them.
- **No Playwright.** Browser-level verification (rendering, click-through flows, responsive
  layout, screenshots) is performed via the already-established `mcp__Claude_Preview__*` tooling
  during interactive development sessions instead of a separate headless-browser test runner.
  `npm run test:e2e` is a documented no-op pointing back here rather than a broken/empty suite.

## Directory layout

- `test/unit/` — pure-function and isolated-module tests with no HTTP layer: `rate-limit.mjs`'s
  algorithm, `finance-ledger.mjs`'s split math and payout-status derivation.
- `test/api/` — full-stack tests against the real server + real DB: auth, authorization/isolation,
  verification states, driver/SR ride lifecycle, messaging, wallet idempotency.
- `test/security/` — cross-cutting security properties: headers, CORS, rate-limit HTTP wiring.
- `test/support/testServer.mjs` — shared fixtures: `testApp()`, unique email/phone generators,
  test-user tracking + cleanup.
- `test/support/setup.mjs` — global Vitest setup; currently raises the login/register rate limits
  for the whole run so functional tests aren't incidentally rate-limited (rate limiting itself is
  tested deliberately, with its own narrow overrides, in `test/security/`).

`fileParallelism: false` in `vitest.config.ts`: tests share one local Postgres database via real
HTTP requests, so parallel workers would race on the same rows.

## Coverage map (Phase 5 requirement)

| Area | File(s) |
|---|---|
| Authentication | `test/api/auth.test.mjs` |
| Authorization / isolation | `test/api/authorization.test.mjs` |
| Rate limiting | `test/unit/rate-limit.test.mjs`, `test/security/rate-limit-http.test.mjs` |
| Verification states (ID document review) | `test/api/verification-states.test.mjs` |
| Booking / finance invariants | `test/unit/finance-ledger.test.mjs`, `test/api/wallet-idempotency.test.mjs` |
| Driver / SR ride | `test/api/driver-sr-ride.test.mjs` |
| Messaging | `test/api/messaging.test.mjs` |
| Headers / CORS | `test/security/headers-and-cors.test.mjs` |
| Smoke / routes | `scripts/smoke-v6.mjs`, `scripts/smoke-routes-v6.mjs` (pre-existing, restored; not Vitest — plain Node scripts run via `npm run test:smoke`) |

93 tests across 10 Vitest files, plus 16 smoke checks (8 API + 8 route), all passing as of this
phase — see `SYBNB_V6_RELEASE_GATE.md` for the full validation matrix.

## Test-user cleanup and the audit-log constraint

Every test-created user is tracked (`trackTestUser`) and cleaned up in `afterAll` via
`cleanupTestUsers()`, which deletes dependent rows (payment proofs, ride requests, bookings,
listings) and then the user row itself — **except** for users that ever appear as
`admin_audit_logs.actorUserId` (e.g. a test admin who approved a review, or a test driver who
claimed a ride). Those rows are left in place permanently: the security-hardening order this suite
was built under explicitly prohibits audit-history deletion, and there is no cascade from
`admin_audit_logs` to `users`, so deleting such a user would require deleting their audit rows
first — exactly what's prohibited. These are harmless, clearly-identifiable (`@sybnb.test` email
domain) artifacts left behind by running the suite; there is deliberately no cleanup path for them,
automated or human-run. See `test/support/testServer.mjs` for the in-code version of this note.

## What is not covered

- **Real-time/webhook payment provider integration** — there is no live payment provider wired up
  in this environment; payment-proof approval is tested via the manual admin-review path only.
- **Multi-instance rate-limiter behavior** — the limiter is explicitly single-instance (see
  `SYBNB_V6_RATE_LIMIT_POLICY.md`); no test simulates a multi-process deployment.
- **Real keyboard-driven `:focus-visible` behavior** — see the accessibility notes in
  `SYBNB_V6_PREDEPLOYMENT_READINESS.md`; Chromium's focus-visible heuristic doesn't reliably
  trigger from script-dispatched (non-trusted) events in headless automation, so this was
  spot-checked rather than asserted in an automated test.
