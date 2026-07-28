# STR — Launch Audit Matrix (governing document)
**Owner of this doc:** launch-readiness program · **Updated:** 2026-07-27 · **Branch:** `security/sybnb-v6-predeployment`

Legend for **Status**:
- 🟢 **GREEN** — done and proven with evidence this session.
- 🟡 **IN-PROGRESS** — actively being worked (agent or code), not yet proven.
- 🔵 **DOABLE** — can be completed locally, not yet started.
- 🟠 **NEEDS-DECISION** — a product/business decision must be made before code can be correct.
- 🔴 **BLOCKED-EXTERNAL** — requires credentials/access/approval only the human owner can provide. Per the launch order (Phase 22), these are prepared but never faked.

> Ground rule (Phase 21): no false green. A gate flips to GREEN only with reproducible evidence.
> Hard rule (Phase 1): the production DB is NEVER blindly baselined — it is diffed first, and stops on divergence.

| # | Gate | Status | Evidence / Note | Required action | Owner |
|---|------|--------|-----------------|-----------------|-------|
| P0 | Launch audit matrix | 🟢 | This document | Keep updated each phase | Claude |
| — | **Local test baseline** | 🟢 | 66 unit + 371 API + 19 security + 38 e2e (0 fail) + smoke; tsc + build clean; CI ✅ | Preserve (RULE 1) | Claude |
| P1 | **Production DB baseline** | 🔴 | Root cause + dev fix done (B1). Prod schema lineage UNKNOWN. Runbook: `docs/ops/DB_BASELINE_RUNBOOK.md` | Owner runs `migrate diff` against prod (never blind resolve); paste result | **Owner** |
| P2 | Production `RATE_LIMIT_STORE=db` | 🔴 | DB limiter built + tested locally; documented in `.env.production.example` | Set env var in Vercel prod | **Owner** |
| P3 | Staging deployment + validate | 🔴 | Vercel MCP not authorized this session; needs Vercel access + staging DB | Owner grants Vercel access OR deploys staging; then run smoke/e2e vs staging | **Owner** |
| P4 | Full guest book→pay→confirm journey (E2E) | 🟡 / partial 🔴 | API-level journey partially testable; full UI-payment leg needs Stripe (P5) | Agent mapping testable-now vs Stripe-blocked | Claude + Owner |
| P5 | **Stripe payment architecture (authorize→capture)** | 🟠 + 🔴 | Currently checkout-session only; 2-step capture NOT built. Stripe MCP not authorized | Owner decides immediate-capture vs authorize→capture; provide Stripe test keys | **Owner** decides, Claude builds |
| P6 | **Tax** | 🟠 + 🔴 | Disclosed-not-charged. Real rate needs collection+remittance + compliance sign-off | Owner decides launch tax requirement + legal approval | **Owner** |
| P7 | Wallet / financial integrity | 🟡 | M2 race fixed + proven. Ledger-invariant + concurrency test expansion in progress (agent) | Integrate + run new invariant tests centrally | Claude |
| P8 | Booking / availability concurrency | 🟡 | Advisory lock + reaper done. Dedicated no-double-booking concurrency tests in progress (agent) | Integrate + run new concurrency tests | Claude |
| P9 | Security final audit | 🟡 | Prior review clean; re-audit of new code (rate_limit_hits, locks, gift-privacy, reaper) in progress (agent) | Fix any findings + add regression tests | Claude |
| P10 | Admin operational UI (fleet suspend / SOS console) | 🟠 | Backend endpoints exist; no admin UI | Owner decides if in STR launch scope; if yes, Claude builds | **Owner** decides |
| P11 | Mobile (iOS/Android production builds) | 🔴 | Capacitor config store-clean; CLI v7→v8 bump staged. Needs devices/signing | Owner builds + tests on device (prod API) | **Owner** |
| P12 | Accessibility / RTL / Arabic | 🔵 | Mobile overflow fixed (14 e2e). Broader a11y/RTL pass not yet run | Claude runs a11y/RTL audit + fixes | Claude |
| P13 | Package manager / lockfile | 🟡 | Dual lockfile (npm committed, pnpm untracked; node_modules pnpm). Recommendation in progress (agent) | Adopt one PM per CI/Vercel; remediate | Claude (+ Owner confirm) |
| P14 | Dependency / supply-chain audit | 🟡 | `npm audit` + compatibility review in progress (agent) | Apply prioritized fixes | Claude |
| P15 | Backups / disaster recovery | 🔴 | Needs prod DB provider access | Owner sets up backups/PITR; rehearse restore; record RPO/RTO | **Owner** |
| P16 | Observability / monitoring / alerts | 🔴 | Needs prod infra (Vercel/DB provider) | Owner enables error/latency/webhook alerts + incident runbooks | **Owner** (Claude drafts runbooks) |
| P17 | Production environment audit | 🔴 | Prod env-var guard exists (`server/lib/env.mjs`); needs prod env access to verify actuals | Owner verifies prod env vars vs required list | **Owner** |
| P18 | Complete E2E matrix (guest/host/admin/wallet/security/mobile) | 🔵/🟡 | Smoke-level exists; expansion tracked via P4/P7/P8 | Claude expands where local + Stripe permit | Claude + Owner |
| P19 | Final cleanup (dead code, debug, secrets scan) | 🔵 | Several dead-code items already removed | Claude runs final sweep + secret scan | Claude |
| P20 | Final launch checklist doc | 🔵 | To be produced: `docs/ops/STR_FINAL_LAUNCH_CHECKLIST.md` | Claude assembles at end | Claude |

## What is genuinely BLOCKED on you (the owner) — and exactly what I need

To close the 🔴 gates, I need one or more of:
1. **Production DB** — run the diff yourself per the runbook and paste the output (do NOT send me the connection string). This resolves the single biggest unknown (P1).
2. **Vercel access / staging** — either authorize the Vercel connector in an interactive session, or deploy the branch to staging yourself so I can validate against it (P2, P3, P17, and P16/P15 setup).
3. **Stripe** — decide immediate-capture vs authorize→capture (P5), and provide **test-mode** keys so I can build + verify. I will never handle live keys.
4. **Tax** — the launch tax requirement + any legal/compliance sign-off (P6).
5. **Product decisions** — is the admin SOS/fleet console in STR launch scope (P10)? Is contextual-only guest auth accepted (already confirmed yes)?

## What I will drive to GREEN without you (this program)
P7 (financial invariants), P8 (booking concurrency), P9 (security re-audit), P12 (a11y/RTL), P13/P14 (deps/lockfile), P19 (cleanup), and the local-testable portions of P4/P18 — each with reproducible evidence, preserving the existing green baseline.

## Final status (updated at the end)
Not yet assigned. Will be exactly one of: `NOT READY` / `READY FOR FINAL HUMAN APPROVAL` / `APPROVED FOR DEPLOYMENT` (last one only with explicit owner approval).
