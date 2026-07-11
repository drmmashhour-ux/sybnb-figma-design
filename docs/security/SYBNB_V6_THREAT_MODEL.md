# SYBNB V6 — Threat Model & Risk Register

Date: 2026-07-10. Companion document to `SYBNB_V6_SECURITY_AUDIT_2026_07_10.md` — read that first for
full evidence and code context; this document classifies each finding and tracks remediation status.

## Severity scale
- **Critical** — remotely exploitable, no auth required, direct data/financial loss or full compromise.
- **High** — exploitable with modest effort, meaningful data/financial/availability impact.
- **Medium** — exploitable under specific conditions, or high-effort/low-probability but real impact.
- **Low** — narrow impact, requires unusual circumstances, or primarily a hardening/defense-in-depth gap.
- **Informational** — not a vulnerability; a process, policy, or completeness note.
- **Needs confirmation** — plausible risk identified by pattern inspection; not yet empirically proven exploitable or safe.

---

## Risk register

### F-08 — No rate limiting anywhere
- **Severity:** High
- **Affected path/symbol:** every endpoint in `server/routes/*.mjs`; no limiter middleware exists in `server/index.mjs`'s dispatch pipeline.
- **Evidence:** `grep -rln "rateLimit\|rate-limit\|express-rate\|Retry-After" server/` → zero matches.
- **Failure scenario:** unlimited automated login/registration/verification-code/booking-creation/payment-proof requests — credential stuffing, account-creation spam, SMS/verification-code cost abuse, and search/geocoding cost amplification are all currently unthrottled.
- **Affected role:** all — unauthenticated (login, registration, verification codes) and authenticated (messaging, booking, admin decisions) alike.
- **Impact:** availability (resource exhaustion), cost (geocoding/verification-code abuse), and credential-stuffing exposure.
- **Current mitigation:** none.
- **Proposed repair:** configurable, in-memory sliding-window limiter on the endpoints named in the order (login, registration, password reset once it exists, verification codes, public search, messaging, inquiries, booking creation, payment-proof submission, admin decisions, document access, geocoding, driver status changes). Standard `429` + `Retry-After`. Explicitly documented as single-instance-only.
- **Tests required:** limit enforced; `429` shape correct; window resets; unrelated users don't share a bucket; safe behind a trusted proxy (don't trust a spoofable client-supplied IP header by default).
- **Deployment-blocking:** **Yes**, before any public-facing deployment.
- **Status:** Repaired this phase (Phase 6).

### F-13 — Zero security headers
- **Severity:** High
- **Affected path/symbol:** `server/index.mjs`, response pipeline (`setCors`, the main request handler).
- **Evidence:** only 4 headers set anywhere in the server, all CORS-related; no CSP/X-Frame-Options/X-Content-Type-Options/Referrer-Policy/Permissions-Policy/HSTS.
- **Failure scenario:** clickjacking (no frame protection), MIME-sniffing-based content-type confusion, no CSP containment if any script-injection vector is ever introduced.
- **Affected role:** all browser clients.
- **Impact:** defense-in-depth loss across multiple browser-side attack classes.
- **Current mitigation:** none directly; partially offset by the near-zero first-party XSS surface documented in the audit (F-06).
- **Proposed repair:** header middleware applied to every response — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (deny by default, allow only what's used), environment-aware `Content-Security-Policy` (permissive enough for Vite dev, tightened for production), and `Strict-Transport-Security` gated to only apply when actually served over HTTPS.
- **Tests required:** headers present on representative responses across HTML/API routes; CSP doesn't break the running app in dev.
- **Deployment-blocking:** **Yes**, before any public-facing deployment.
- **Status:** Repaired this phase (Phase 6).

### F-01 — No password-reset flow
- **Severity:** Medium
- **Affected path/symbol:** `server/routes/auth.mjs` (absent entirely).
- **Evidence:** no reset/forgot-password route in any server file.
- **Failure scenario:** legitimate users permanently locked out; likely drives unaudited manual DB workarounds, which are themselves riskier.
- **Affected role:** all.
- **Impact:** availability/support burden; indirect security risk from manual-reset workarounds.
- **Current mitigation:** none.
- **Proposed repair:** requires a decision on delivery channel (the phone-verification-code channel already exists and could plausibly be reused) — **this is a product/UX decision, not a narrow code repair**, so per Phase 3's stop condition it is documented here and not implemented automatically this phase.
- **Tests required:** N/A until implemented.
- **Deployment-blocking:** Recommended before public launch; not blocking for continued internal/controlled testing.
- **Status:** **Deferred — needs explicit approval**, flagged per Phase 3 stop condition ("legal-policy decisions" / "substantial product redesign" adjacent — the delivery-channel choice has cost and reliability implications for a Syria-specific SMS/WhatsApp context that shouldn't be decided unilaterally).

### F-02 — No server-side session revocation / logout endpoint
- **Severity:** Medium
- **Affected path/symbol:** `server/lib/security.mjs` (stateless token design), `server/routes/auth.mjs` (no logout route).
- **Evidence:** no revocation store; no logout endpoint anywhere in `server/`.
- **Failure scenario:** a compromised token remains valid for up to 7 days even after client-side "logout" or a password change.
- **Affected role:** all authenticated users.
- **Impact:** extended window of unauthorized access following any token compromise.
- **Current mitigation:** role/status are re-checked fresh every request (F-nothing — this is the existing strength that limits blast radius to "impersonate this one already-issued token," not "escalate privileges via a stale claim").
- **Proposed repair:** add a lightweight per-user `sessionVersion` (or `tokenNotBefore`) column, bump it on password change and on explicit logout, check it in `getAuthContext`. Narrow, additive, no auth-model rewrite required.
- **Tests required:** token issued before a revocation event is rejected after that event; unaffected tokens for other users keep working.
- **Deployment-blocking:** Recommended before public launch; not blocking for continued internal/controlled testing.
- **Status:** **Deferred — needs explicit approval** (touches the authentication data model; flagged rather than silently implemented, consistent with Phase 3's caution around auth-system changes even when narrow).

### F-03 — Login timing side-channel (account enumeration)
- **Severity:** Low
- **Affected path/symbol:** `server/routes/auth.mjs:83`.
- **Evidence:** `!user || ... || !verifyPassword(...)` short-circuits before the expensive scrypt call when no user matches.
- **Failure scenario:** attacker measures response latency to determine whether a given email/phone has an account, independent of the generic error message.
- **Affected role:** all — enumeration target is any registered identifier.
- **Impact:** information disclosure (account existence), not credential compromise.
- **Current mitigation:** identical error message text in both cases (message-level leak already closed; only the timing channel remains).
- **Proposed repair:** always perform an equivalent-cost dummy scrypt computation on the no-user path before returning the error, so both paths take comparable time.
- **Tests required:** functional test confirms both "no such account" and "wrong password" return the same status/error code; timing-equivalence itself is not asserted in CI (timing-based test assertions are inherently flaky) — documented as a manual/informal check instead.
- **Deployment-blocking:** No.
- **Status:** **Repaired this phase** (Phase 6) — on reflection this was a narrow, low-risk fix (compare against a fixed decoy password hash when no user matches, so `verifyPassword`'s scrypt cost runs unconditionally) rather than one that needed deferral; implemented in `server/routes/auth.mjs`.

### F-04 — No login-attempt throttling / account lockout
- **Severity:** Medium (subsumed by F-08's rate-limiting repair for the login endpoint specifically)
- **Status:** Repaired this phase as part of F-08's rate limiter, scoped specifically to `/api/auth/login` and `/api/auth/register`.

### F-06 — sessionStorage token exposure / no CSP as containment
- **Severity:** Medium (architecture-level, "Needs confirmation" on real-world exploitability given the near-zero first-party XSS surface found)
- **Proposed repair:** CSP header (see F-13) as containment; **do not migrate off sessionStorage** this phase per the order's explicit instruction.
- **Status:** Partially addressed via F-13's CSP header this phase; full architectural change deferred and documented as the approved next step, not auto-implemented.

### F-07 — Horizontal-escalation coverage confirmed by pattern, not exhaustive live testing
- **Severity:** Needs confirmation
- **Proposed repair:** automated authorization tests (Phase 5) covering the highest-value cross-account cases, converting this from a one-time reading judgment into a continuously re-verified property.
- **Status:** Addressed via Phase 5 test coverage this phase.

### F-09 — No centralized input-validation schema
- **Severity:** Low-Medium
- **Proposed repair:** targeted validation helper introduced for the highest-risk write endpoints (auth, admin decisions) without a platform-wide rewrite.
- **Status:** Partially addressed this phase (validation helper added, applied narrowly); full platform-wide adoption deferred as a larger, non-narrow effort.

### F-11 — No malware-scanning integration point
- **Severity:** Informational
- **Status:** Documented, not implemented — infrastructure decision (which scanner, hosted vs. self-run) out of scope for a narrow code repair.

### F-12 — No document retention/deletion policy
- **Severity:** Informational
- **Status:** Documented — a data-retention *policy* decision, not a code defect; needs an owner decision on retention period before implementation.

### F-14 — CORS fallback-to-first-origin behavior
- **Severity:** Low
- **Proposed repair:** omit the CORS header entirely for disallowed origins instead of falling back to the first configured one.
- **Status:** Repaired this phase (Phase 6).

### F-15 — Error-exposure logic more permissive than the `expose` flag implies
- **Severity:** Low
- **Proposed repair:** simplify to gate strictly on `error.expose === true`.
- **Status:** Repaired this phase (Phase 6).

### F-16 — No `.env.example`
- **Severity:** Low
- **Status:** Repaired this phase (Phase 9) — added, with placeholder values only, no real secrets.

### F-17 — No systematic denial-event auditing
- **Severity:** Informational
- **Status:** Documented — a logging-infrastructure decision (access-log vs. application-audit-log placement), not implemented this phase.

### F-18 — Malformed session subject crashed to 500 instead of failing closed to 401
- **Severity:** Low
- **Affected path/symbol:** `server/lib/auth-context.mjs:10` (discovered while writing the Phase 5 authorization test suite, not in the original 17-finding sweep).
- **Evidence:** a validly-signed session token whose `sub` is not a well-formed UUID caused `db().user.findUnique()` to throw Prisma error `P2023` (UUID parse failure), which fell through to the generic 500 handler instead of the intended "no such user -> 401" path. A well-formed but nonexistent UUID (e.g. the ordinary deleted-user case) was already handled correctly.
- **Failure scenario:** only reachable with a validly-signed token carrying an unexpected subject shape — requires possession of `AUTH_SECRET` (already a full compromise) or a future change to the user-id format. Not independently exploitable pre-secret-compromise; classified Low rather than the "auth bypass" severity this might otherwise suggest, since `error.expose` was already `false` for 500s (F-15), so no internal detail leaked either way.
- **Proposed repair:** catch `P2023` in `getAuthContext` and treat it the same as "no matching user" (return `null`, which the caller turns into a clean 401).
- **Tests required:** functional test with a well-formed nonexistent UUID (401) and a malformed-subject token (401, not 500) — both added to `test/api/authorization.test.mjs`.
- **Deployment-blocking:** No.
- **Status:** Repaired this phase (Phase 5, discovered via test-writing) — narrow, in-scope hardening of a file already touched for F-03; does not alter the authentication architecture.

### F-05, F-10 — Informational/needs-confirmation notes
- **F-05** (no account deletion endpoint): Informational, documented, no action — product-scope decision.
- **F-10** (`$executeRaw` parameterization in `sr-rides.mjs`): confirmed safe (tagged-template auto-parameterization used correctly) during the audit itself — no separate repair needed; recorded here for completeness since it was explicitly checked.

---

## Stop-conditions triggered (per Phase 3 instruction)

Per the order's own instruction to stop before implementation if a fix requires certain categories of
change, the following findings were **deliberately not auto-implemented** and are flagged for your
decision instead:

- **F-01 (password reset)** — requires choosing a delivery channel with real cost/reliability
  implications for the Syria-specific context (SMS vs. WhatsApp vs. email), which is a product
  decision, not a narrow repair.
- **F-02 (session revocation)** — requires a small but real data-model addition
  (`sessionVersion`/`tokenNotBefore`) to the authentication system; flagged rather than silently
  implemented given the order's explicit caution around anything touching authentication
  architecture.
- **F-11/F-12 (malware scanning, retention policy)** — infrastructure/policy decisions, not code
  defects.

Everything else classified High or Low with a narrow, evidence-supported repair was implemented in
Phase 6 (see `SYBNB_V6_RELEASE_GATE.md` and the Phase 10 commit list for exactly what changed).
