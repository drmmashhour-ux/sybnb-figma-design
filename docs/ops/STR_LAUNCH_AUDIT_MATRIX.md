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
| P1 | **Production DB baseline** | 🟢 (resolved by construction — no legacy prod DB) | Owner confirmed 2026-07-27: NO existing production DB with real data (pre-launch). So there is nothing to reconcile — a fresh prod DB takes the clean squashed baseline via `prisma migrate deploy` (proven to replay with zero drift). The read-only diagnostic + runbook remain for the future case of an existing DB | Fresh deploy: `prisma migrate deploy` on the new prod DB (no diagnostic needed) | **Owner** deploys, Claude verified baseline |
| P2 | Production `RATE_LIMIT_STORE=db` | 🔴 | DB limiter built + tested locally; documented in `.env.production.example` | Set env var in Vercel prod | **Owner** |
| P3 | Staging deployment + validate | 🔴 (prepared) | Exact runbook `docs/ops/STR_STAGING_DEPLOY_RUNBOOK.md` (env vars, fresh-DB migrate deploy, seed, Stripe test webhook, staging deploy, real-target E2E). Fresh staging DB does NOT depend on P1 | Owner grants Vercel access OR runs Steps 1–6 + returns staging URL | **Owner** |
| P4 | Full guest book→pay→confirm journey | 🟢 (API, local-wallet) / 🔴 (browser+staging) | `test/api/guest-journey-book-pay-confirm.test.mjs`: full book→pay→approve→confirm over HTTP w/ DB-state assertions, host/admin views, failure paths, server-authoritative payment state. Browser-UI + staging leg + Stripe card path remain | Owner unblocks staging (P3) + Stripe (P5) | Claude + Owner |
| P5 | **Stripe payment architecture** | 🟡 **BLOCKED FOR EXTERNAL VALIDATION** | LOCAL evidence only (NOT real Stripe): `test/api/stripe-booking-payment.test.mjs` uses **fabricated session objects** — proves finalize logic, idempotency, fail-closed 503. Capture model = immediate; auth→capture NOT built. **No real Stripe test-mode transaction/webhook has been executed.** | Owner provides test-mode keys → then run the external-validation matrix (see below) with real Stripe event IDs | **Owner** + Claude |
| P6 | **Tax** | 🟢 (A applied) | Owner chose **A** (2026-07-27): no auto-charged tax. `STR_TAX_RATE=0` (server + frontend mirror); per-listing host-configured `taxesMinor` still honoured; guests no longer pay the old 2%. Pinned by `test/api/tax-characterization.test.mjs`. Decision recorded in `docs/product/STR_TAX_DECISION_REQUEST.md` | done | Claude |
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
| P20 | Final launch checklist doc | 🟢 | Produced: `docs/ops/STR_FINAL_LAUNCH_CHECKLIST.md` (go/no-go). Code/repo certified READY FOR DEPLOYMENT | done | Claude |

## P5 — Stripe EXTERNAL VALIDATION MATRIX (real test-mode; NOT yet executed)
Local fake-session tests are NOT equivalent to this. Once test-mode keys exist, execute and capture
**real** Stripe evidence for each case:

| # | Case | Real evidence required |
|---|------|------------------------|
| 1 | Successful test card (`4242…`) | Stripe PaymentIntent + Checkout Session id; booking → CONFIRMED; `stripe` proof APPROVED; payout HOLD + admin-share entries |
| 2 | Declined card (`4000000000000002`) | session NOT paid; booking stays PAYMENT_PENDING; no proof |
| 3 | Webhook success (`checkout.session.completed`) | Stripe dashboard delivery id + 200 response; booking CONFIRMED |
| 4 | Duplicate webhook (redeliver same event) | second delivery id; exactly ONE proof + ONE payout (no duplicate financial effect) |
| 5 | Delayed webhook | late delivery id; idempotent confirm |
| 6 | Out-of-order webhook | event ids; no double payout |
| 7 | Unpaid/expired session | session id, unpaid; booking PAYMENT_PENDING → later reaped |
| 8 | Idempotency/replay (same session to confirm + webhook) | one proof only |
| 9 | Refund/reversal (if in scope) | Stripe refund id; ledger reversal entry |
| 10 | Booking + DB state after each event | booking status, proof status, wallet entries, audit-log rows per event |

Deliverable: Stripe test-mode transaction/event IDs + webhook delivery evidence + resulting DB/app state,
proving duplicate events cause no duplicate financial effect. Until then P5 is YELLOW (external-validation).

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
Code/repo: **READY FOR DEPLOYMENT** (all code gates green, verified). Overall: **NOT LIVE** until owner completes deploy + real Stripe validation (see STR_FINAL_LAUNCH_CHECKLIST.md §C).
