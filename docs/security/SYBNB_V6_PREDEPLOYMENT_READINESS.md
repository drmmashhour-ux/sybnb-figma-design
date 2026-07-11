# SYBNB V6 — Pre-Deployment Readiness Report

Date: 2026-07-10. Branch: `security/sybnb-v6-predeployment` (not merged to `main`). This report
closes out the "SYBNB V6 — Security Hardening and Automated Test Foundation" order. It does not
authorize deployment; see Recommendation at the end.

## Code readiness

- TypeScript: clean (`npx tsc --noEmit`, 0 errors).
- Production build: succeeds (`npx vite build`).
- No lint tooling is configured in this repo; not introduced this phase.
- Working tree on this branch contains only files touched by this order's scope — verified via
  `git status --short` against the branch's own history (see `SYBNB_V6_RELEASE_GATE.md`).

## Security readiness

Full detail in `SYBNB_V6_SECURITY_AUDIT_2026_07_10.md` and `SYBNB_V6_THREAT_MODEL.md`. Summary:

- **Repaired this phase:** no rate limiting (F-08/F-04), zero security headers (F-13), CORS
  fallback-to-first-origin (F-14), overly-permissive error exposure (F-15), no `.env.example`
  (F-16), login timing side-channel (F-03), a malformed-token 500 discovered while writing tests
  (F-18), no production-config validation, narrow input validation on the two highest-risk
  unauthenticated endpoints (F-09, partial).
- **Explicitly deferred, flagged for an owner decision (not silently implemented):**
  - **F-01 — no password-reset flow.** Needs a delivery-channel decision (SMS/WhatsApp/email) with
    real cost implications for the Syria-specific context. Not blocking for continued
    internal/controlled testing; recommended before public launch.
  - **F-02 — no server-side session revocation/logout.** Needs a small auth-data-model addition
    (`sessionVersion`); flagged rather than implemented per this order's explicit caution around
    touching authentication architecture. Same launch-blocking posture as F-01.
  - **F-11/F-12 — no malware scanning, no document-retention policy.** Infrastructure/policy
    decisions, not code defects.
- **Known, accepted limitation:** the rate limiter is single-instance (in-memory). Fine for the
  current single-process deployment; a multi-instance production deployment needs a shared store
  first (see `SYBNB_V6_RATE_LIMIT_POLICY.md`).
- **Sessions remain in `sessionStorage`** (not migrated to httpOnly cookies) — F-06 in the threat
  model. Explicitly not changed this phase per the order's instruction; CSP now provides some
  containment. This is the largest remaining architectural item and needs its own dedicated,
  reviewed effort, not a rushed fix folded into this phase.
- No secrets found in this phase's diff or in the full git-history scan performed during the audit
  (see `SYBNB_V6_SECURITY_AUDIT_2026_07_10.md` §"Secrets/config").

## Test readiness

**Updated (same-day follow-up pass):** 114 Vitest tests across 12 files (unit/API/security/guard),
16 smoke checks, and a new repository-owned Playwright suite (15 checks × 2 browser projects), all
running against a genuinely isolated `sybnb_v6_test` database — never the development database. An
earlier version of this suite (93 tests) was found to run against the shared development database;
that gap is now closed with a fail-closed application-level guard, not just a config change — see
`docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md` for the full design and
`docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md` for the proof (development database confirmed
byte-identical, MD5-verified, across two full suite runs). See `SYBNB_V6_TEST_STRATEGY.md` for the
coverage map and `SYBNB_V6_RELEASE_GATE.md` for the full gate-by-gate run.

## Infrastructure readiness

- Single-process Node HTTP server, no process manager/orchestration configured in this repo.
- Rate limiting and session storage are both single-instance-only by current design — horizontal
  scaling is not yet supported without further work (shared rate-limit store; session model).
- `validateProductionConfig()` fails startup loudly if `NODE_ENV=production` is set without a
  strong `AUTH_SECRET`/`PHONE_HASH_SECRET`, an explicit `DATABASE_URL`, an explicit `CORS_ORIGIN`,
  and rate limiting enabled — this is a real safety net, but it has never been exercised against an
  actual production environment (no such environment exists yet for this project).
- No CI pipeline was found or added — `npm run test:ci` exists and passes locally but is not yet
  wired into any automated pipeline that runs on every push/PR.

## Legal-content readiness

Unchanged from before this phase — legal pages still carry the `"DRAFT — NOT FINAL"` /
`"مسودة — غير نهائية"` badge (`src/modules/legal/LegalPlaceholderPage.tsx`), per the standing
instruction from earlier in this engagement not to publish draft legal content as final. **Not
ready** — this is a business/legal decision outside this order's scope, not a code gap.

## Payment readiness

No live payment provider is wired into this environment. The manual admin-review path
(guest-submitted payment proof → admin approve/reject → wallet ledger entries) is real, tested,
and race-condition-guarded, but there is no Stripe/PSP integration live. **Not ready** for a
deployment that expects automated payment processing; the current manual-review model is a
deliberate, working design for the current stage, not a placeholder.

## Deployment readiness

**Not ready.** This phase explicitly did not authorize deployment, and several items above
(password reset, session revocation, session-storage/XSS containment posture, no CI pipeline, no
live payment provider, draft legal content) are launch-relevant even though none of them are code
defects introduced or missed by this phase — they are pre-existing, known, and now formally
documented gaps.

## Recommendation

**READY FOR INDEPENDENT REVIEW.**

*(Updated same-day: previously READY FOR REVIEW with an open HIGH database-isolation blocker; that
blocker is now resolved, and this recommendation is upgraded accordingly — see
`docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md` and `docs/review/SYBNB_V6_SECURITY_BRANCH_REVIEW.md`.)*

All work for this order is complete: security repairs verified, 114 tests + 16 smoke checks + a
new Playwright browser suite all passing against a genuinely isolated test database,
build/types/schema/audit all clean, `main` untouched, everything committed to
`security/sybnb-v6-predeployment` (not merged), no destructive or unauthorized actions taken
against the development database or LECIPM. This branch is ready for the owner to review the diff
and the findings above. It is **not** recommended to jump directly to READY TO MERGE or READY FOR
STAGING without an explicit decision on F-01/F-02 (deferred, launch-relevant) and the legal/payment
items, which are product decisions this phase deliberately did not make unilaterally — and without
a human triage of the two newly-found, honestly-left-failing test cases (320px responsive overflow;
WebKit's default keyboard-navigation behavior, which is expected and not a bug).
