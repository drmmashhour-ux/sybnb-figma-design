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
| P1 | **Production DB baseline** | 🔴 (prepared) | Verified READ-ONLY diagnostic `scripts/prod-db-diagnose.mjs` + decision tree + known-good dev reference in `docs/ops/DB_BASELINE_RUNBOOK.md`. Prod lineage still UNKNOWN | Owner runs the diagnostic + `migrate diff --script` against prod, returns evidence (never blind-resolve) | **Owner** |
| P2 | Production `RATE_LIMIT_STORE=db` | 🔴 | DB limiter built + tested locally; documented in `.env.production.example` | Set env var in Vercel prod | **Owner** |
| P3 | Staging deployment + validate | 🔴 (prepared) | Exact runbook `docs/ops/STR_STAGING_DEPLOY_RUNBOOK.md` (env vars, fresh-DB migrate deploy, seed, Stripe test webhook, staging deploy, real-target E2E). Fresh staging DB does NOT depend on P1 | Owner grants Vercel access OR runs Steps 1–6 + returns staging URL | **Owner** |
| P4 | Full guest book→pay→confirm journey | 🟢 (API, local-wallet) / 🔴 (browser+staging) | `test/api/guest-journey-book-pay-confirm.test.mjs`: full book→pay→approve→confirm over HTTP w/ DB-state assertions, host/admin views, failure paths, server-authoritative payment state. Browser-UI + staging leg + Stripe card path remain | Owner unblocks staging (P3) + Stripe (P5) | Claude + Owner |
| P5 | **Stripe payment architecture** | 🟢 (immediate-capture path) / 🔴 (auth→capture + real card E2E) | `test/api/stripe-booking-payment.test.mjs`: paid session confirms; duplicate/delayed/out-of-order webhook idempotent; unpaid stays pending; no double-pay; endpoints fail closed (503). Capture model = immediate; auth→capture NOT built | Owner decides immediate vs auth→capture; provide test-mode keys (sk_test_/whsec_/pk_test_) | **Owner** decides, Claude builds |
| P6 | **Tax** | 🔴 (decision request ready) | Facts pinned (`test/api/tax-characterization.test.mjs`): flat 2% folded into platform adminShare (kept, not remitted), no jurisdiction rates, no persisted taxMinor. Decision doc `docs/product/STR_TAX_DECISION_REQUEST.md` | Owner/legal replies A (no tax) / B (reclassify as fee) / C (real remitted tax) | **Owner** |
| P7 | Wallet / financial integrity | 🟢 | Ledger-invariant suite (bal==Σentries & ≥0); DEBIT floors added (host-cancel fee both-legs, share reversals); payout-clawback intentionally keeps debt semantics; SR-payout lock aligned | done + tested | Claude |
| P8 | Booking / availability concurrency | 🟢 | 8-case no-double-booking suite; DISPUTED added to occupying set; STAYS dates required | done + tested | Claude |
| P9 | Security final audit | 🟢 (code) / 🔴 (prod cfg) | All 5 hardening fixes re-verified clean; added fail-closed RATE_LIMIT_STORE=db guard + TRUST_PROXY warning | Verify deployed Vercel env (→ P17) | Claude + Owner |
| P10 | Admin operational UI (fleet suspend / SOS console) | 🟠 | Backend endpoints exist; no admin UI | Owner decides if in STR launch scope; if yes, Claude builds | **Owner** decides |
| P11 | Mobile (iOS/Android production builds) | 🔴 | Capacitor config store-clean; CLI v7→v8 bump staged. Needs devices/signing | Owner builds + tests on device (prod API) | **Owner** |
| P12 | Accessibility / RTL / Arabic | 🔵 | Mobile overflow fixed (14 e2e). Broader a11y/RTL pass not yet run | Claude runs a11y/RTL audit + fixes | Claude |
| P13 | Package manager / lockfile | 🟢 | Standardized on npm; clean reinstall; lockfile synced to capacitor v8; `npm ci --dry-run` passes; pnpm-lock gitignored | done | Claude |
| P14 | Dependency / supply-chain audit | 🟢 | `npm audit` = 0 vulnerabilities (postcss/brace-expansion/tar patched); engines pinned node 20.x | done | Claude |
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
