# Platform Contract Kit — v1

A portable, self-contained kit of the executable **CORE contract** and **reusable security checks** proven
on SYBNB's STR (short-term-rental) golden path. It is **generic**: no product fixtures are baked in — a
consuming platform (Resident Workforce OS, the next marketplace) supplies its own fixtures and the same
invariants + checks run against it.

This folder is dependency-free (Node built-ins only) and framework-agnostic where it can be: the pure
helpers need nothing; the conformance suite is handed your test framework's primitives.

## What's in the kit

```
contracts/
  README.md                      ← you are here: contents + how to wire your fixtures
  ISOLATION.md                   ← the isolation contract every fixture must honor
  VERSION                        ← v1 + the golden STR commit it was cut from
  conformance/
    suite.mjs                    ← defineConformanceSuite(fixtures, harness) — the generic runner
    fixture.template.mjs         ← copy per product; translate your behavior into generic evidence
  security/
    economicsLeak.mjs            ← findLeakedEconomicsKeys(json, forbiddenKeys)   [keys required]
    appendOnlyAudit.mjs          ← findAuditMutationPaths(dir, { model })          [model required]
    elevatedRoutes.mjs           ← discoverElevatedRoutes(dir, { elevatedRoles, guardCall })  [both required]
    secretNotInProd.mjs          ← findUngatedDevSecrets(dir, { token, buildFlag }) + productionGuardOutcome(guard, …)
    enumeration.mjs              ← bodyShape(res), sameResponseShape(a, b)
    index.mjs                    ← one import surface for all security checks
```

## The CORE contract (conformance invariants)

Each is a fixture method returning a tiny generic evidence object the suite asserts on. Declare which ones
your fixture proves via `supports`; the rest skip with your documented `skipReason`.

| Invariant | What it guarantees |
| --- | --- |
| **C1** leak | No buyer-facing payload exposes the platform cut / supplier payout |
| **C2** authz | Sensitive routes reject unauth (401) and wrong-role (403) |
| **C4** commission-on-base | Commission is on the tax-excluded base; unchanged when tax changes |
| **C5** settlementRef | Nothing is "paid" without a real settlement reference |
| **C5b** sandbox-in-prod | A test/sandbox settlement ref is rejected in production; a real one accepted |
| **C6** fail-closed jurisdiction | Nothing charged until the jurisdiction is legally confirmed |
| **C7** frozen-terms | An issued order keeps its economics after the live rate changes |
| **C8** no-double-book | Concurrent claims on one slot → exactly one winner, no double-allocation |
| **C9** append-only audit | Money/config/consent changes append immutable before/after rows; no mutation path |

## The security checks (S1–S7, reusable helpers)

| Check | Helper | Use |
| --- | --- | --- |
| **S1** no-economics-leak | `findLeakedEconomicsKeys` | Assert `=== []` on every buyer-facing payload |
| **S2** elevated-route authz sweep | `discoverElevatedRoutes` | Discover all admin/elevated routes, assert a low-role token gets 401/403 on **every** one |
| **S3** append-only audit scan | `findAuditMutationPaths` | Assert `=== []` — no `update/delete/upsert` on the audit model anywhere |
| **S4a** secret-not-in-prod (static) | `findUngatedDevSecrets` | Assert `=== []` — no dev-secret display ungated by the build flag |
| **S4b** reject-sandbox-in-prod (runtime) | `productionGuardOutcome` | Assert your prod guard rejects a sandbox object and accepts a real one |
| **S5** enumeration resistance | `bodyShape` / `sameResponseShape` | Assert a seeded vs fresh identifier yields the same response shape |
| **S6** rate limiting | (pattern, see `enumeration.mjs`) | Assert the endpoint returns 429 past the limit (fail-closed) |
| **S7** authz IDOR/ownership | (pattern, via S2 sweep + fixture) | Assert cross-user access returns 401/403/404, never another user's row |

S3, S2 and S4a are **self-maintaining static scans** — they read the source tree, so new routes / audit
calls / secret displays are covered automatically without editing a list.

**No SYBNB defaults for product-specific params.** The scanners make you pass the values that encode YOUR
platform — and **throw** if you don't — so you can't get a false pass by forgetting to override (scanning
the wrong audit model → 0 → silent pass is exactly what this prevents). Required, no default:

| Helper | Required param(s) |
| --- | --- |
| `findAuditMutationPaths` | `model` (your audit table's ORM accessor) |
| `discoverElevatedRoutes` | `elevatedRoles`, `guardCall` |
| `findLeakedEconomicsKeys` | `forbiddenKeys` (spread + extend `EXAMPLE_ECONOMICS_KEYS`) |
| `findUngatedDevSecrets` | `token`, `buildFlag` |

Only genuinely-neutral knobs default: the ORM mutation verbs (`methods`), source-file extensions (`exts`),
and the Node-http router accessors (`pathAccessor`/`methodAccessor`) — verify the last match your router.

## How to wire your fixtures (consumer steps)

1. **Copy the template.** `cp contracts/conformance/fixture.template.mjs test/fixtures/<yourVertical>.fixture.mjs`.
2. **Set `name` + `supports`.** Turn on only the invariants you can prove today; leave the rest `false` with
   a one-line `skipReason`. A read-only fixture (asserting against a frozen system you don't own) is fine —
   it just never mutates.
3. **Implement `setup()` / `teardown()`.** Create isolated test state; delete all of it (and restore any env
   you set) in teardown. Follow **ISOLATION.md**.
4. **Fill each supported invariant method** to return the generic evidence shape documented in the template
   (translate your numbers/currency/routes/ORM into `{ oneWinner: true }`-style booleans + a few integers).
5. **Register the suite** in a one-line test file:
   ```js
   import { describe, it, expect, beforeAll, afterAll } from 'vitest'
   import { defineConformanceSuite } from '../../contracts/conformance/suite.mjs'
   import { yourFixture } from './fixtures/yourVertical.fixture.mjs'
   defineConformanceSuite([yourFixture], { describe, it, expect, beforeAll, afterAll })
   ```
6. **Wire the security checks** as ordinary tests, pointing the scanners at your tree and passing YOUR
   product params (they throw if omitted):
   ```js
   import {
     findAuditMutationPaths, discoverElevatedRoutes, findLeakedEconomicsKeys, EXAMPLE_ECONOMICS_KEYS,
   } from '../../contracts/security/index.mjs'

   expect(findAuditMutationPaths('server', { model: 'auditLog' })).toEqual([])           // your audit model
   const elevated = discoverElevatedRoutes('server/routes', {
     elevatedRoles: ['ADMIN', 'STAFF'], guardCall: 'requireAuth',                        // your roles + guard
   })
   // …then assert a low-role token gets 401/403 on every discovered route.
   const KEYS = [...EXAMPLE_ECONOMICS_KEYS, 'agentCommission']                            // extend for your domain
   expect(findLeakedEconomicsKeys(buyerPayload, KEYS)).toEqual([])
   ```

## Dependencies & assumptions

- **Pure helpers**: Node built-ins only (`node:fs`, `node:path`). No install.
- **Conformance suite**: needs a test framework with `describe / it (+ it.skip) / expect / beforeAll /
  afterAll` — you inject them (examples use vitest). All HTTP / DB / ORM I/O lives in YOUR fixture, so the
  kit never depends on supertest/Prisma/etc.
- **Determinism**: C8 (no-double-book) needs a real transactional store (e.g. Postgres advisory locks) for
  a genuine concurrency test; if your test store can't, assert the one-winner guard at the transaction
  level instead — and say so — rather than faking it.

## Versioning

**v1** is cut from the SYBNB STR golden state (see `VERSION`). Bump the kit when the CORE contract itself
changes (a new invariant, a changed evidence shape) — adding a product fixture is not a kit change.
