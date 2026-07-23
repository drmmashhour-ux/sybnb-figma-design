# SYBNB — End-to-End Independent Validation
## Agent 3 — ADMIN role report

**Author:** Agent 3 (Admin), autonomous validation run
**Date:** 2026-07-23 (UTC)
**Scope:** Authorized-admin and support-staff behaviour of the running SYBNB API/web stack.
**Independence:** Written without reading the CLIENT, HOST or CONTROLLER agent reports. Three other
agents were exercising the same server concurrently; where that interference is visible in the
evidence it is called out explicitly.

---

## 1. Environment

| Item | Value |
|---|---|
| Baseline commit | `6e8b8f2` (`docs(review): add independent SYBNB final architecture review`) |
| Branch | `claude/intelligent-kilby-5ff258` (worktree) |
| Tracked tree | Clean at start and at end — **no tracked file was modified** |
| API | `http://127.0.0.1:3051` (`node server/index.mjs`, PID 37229) |
| Web | `http://127.0.0.1:5180` (Vite, in the CORS allowlist) |
| Database | local Postgres `sybnb_v6_dev` @ `127.0.0.1:5432` (shared dev DB, **not** the isolated `sybnb_v6_test` DB) |
| Storage driver | `local` filesystem, `STORAGE_LOCAL_DIR=/Users/.../tmp/e2e-objects` — **R2 not connected** |
| `NODE_ENV` | not `production` (dev-only `devCode` OTP path active) |
| Requests issued | 224 (98×200, 10×201, 1×204, 15×400, 22×401, 56×403, 12×404, 3×405, 3×409, 4×429) |
| Raw evidence | request/response/header log captured per call (see §9) |

**Excluded by instruction and honoured:** no Stripe/card path was exercised; `POST /api/host/insights/generate`
was never called; nothing was run against production, staging or any remote host.

---

## 2. Role and permissions under test

Staff roles are excluded from `PUBLIC_REGISTER_ROLES` (`server/routes/auth.mjs:27`), so ADMIN and
SUPPORT fixtures were created directly through Prisma with `hashPassword` / `createSessionToken`
from `server/lib/security.mjs`, the same pattern as `test/api/verification-states.test.mjs`.

Authority model as implemented (`requireAuth(context, [...])`):

| Capability | ADMIN | SUPPORT | Other roles |
|---|---|---|---|
| Review queue (read), audit log, platform metrics, revenue summary, payouts list, SOS list, driver registry + export, jurisdiction profiles (read), reports list, disputes list | yes | yes | 403 |
| Host insights | yes | **no (403)** | 403 |
| Identity-document **file** download, identity-document **upload on behalf of a user**, user lookup, driver-document file, listing-document file, review hide | yes | yes | 403 |
| Review decisions (listing / payment / gift / booking / ID document), payout release, driver + listing document decisions, legal hold, driver account status, accommodation approve-all, jurisdiction PATCH, dispute + report resolution, SOS resolve, SR payout / commission flag | yes | **no (403)** | 403 |

The ADMIN/SUPPORT split is coherent and enforced server-side on every route tested: SUPPORT is a
*read + identity-document* role and cannot make a reviewable decision or move money. The one
asymmetry that does not fit that description is identity-document authority — see F-1 and F-5.

---

## 3. Sections tested

Admin sign-in and step-up authentication · session revocation · user lookup · role visibility ·
account review · listing review · booking visibility · booking intervention · payment-state
visibility · payment approval and reconciliation · document review · identity-document access
controls · support operations · cancellation administration · inventory release · payout controls ·
audit-log visibility and immutability · driver/host registry export · permissions matrix ·
forbidden actions · error handling · security headers · download controls · access logging ·
rate limiting.

---

## 4. Workflow results

Every row records: starting state · action · expected · **actual** · resulting system state ·
message · handoff · status.

### 4.1 Staff sign-in and step-up authentication

**W-01 — ADMIN sign-in without step-up OTP — PASS**
* Start: ADMIN account ACTIVE, no recent `staff-login` code.
* Action: `POST /api/auth/login {email, password}`.
* Expected: refusal.
* **Actual: `403 STAFF_OTP_REQUIRED`** — `{"ok":false,"error":{"code":"STAFF_OTP_REQUIRED","message":"Verify your email or phone with the access code before signing in."}}`
* DB: unchanged, no token issued. Handoff: none.

**W-02 — SUPPORT sign-in without step-up OTP — FAIL (confirms known-context item (a))**
* Start: SUPPORT account ACTIVE, no `staff-login` code ever issued.
* Action: identical `POST /api/auth/login`.
* Expected (by the security posture the ADMIN gate implies): refusal.
* **Actual: `200 OK` with a full staff session token** — body `{"ok":true,"user":{...,"roles":["SUPPORT"]},"token":"eyJzdWIi..."}`
* Root cause: `STAFF_ROLES_REQUIRING_OTP = new Set(['ADMIN','HOST','DRIVER','SELLER'])`
  (`server/routes/auth.mjs:37`) — `SUPPORT` is absent.
* The token is not degraded: using it (W-03) I read the review queue, downloaded a guest's identity
  document, exported the full driver registry, and read the platform-wide audit log.
* Status: **FAIL** (see F-1).

**W-03 — the password-only SUPPORT session is fully privileged — FAIL (severity carrier for F-1)**
* `GET /api/admin/review-queue` → 200; `GET /api/admin/id-document/<guestId>/file` → 200 (bytes
  returned); `GET /api/admin/drivers/export?format=csv` → 200 (every driver's name/email/plate);
  `GET /api/admin/audit-log` → 200. All with a session obtained from `email + password` alone.

**W-04 — ADMIN sign-in with step-up — PASS**
* `POST /api/auth/email-code/send {purpose:'staff-login'}` → 200 (dev `devCode` returned);
  `POST /api/auth/email-code/verify` → 200; `POST /api/auth/login` → **200 + token**;
  the login-issued token then worked on `GET /api/admin/review-queue?limit=1` → 200.

**W-05 — wrong password — PASS** — `401 INVALID_CREDENTIALS`, identical shape to "no such account";
`server/routes/auth.mjs` runs `verifyPassword` against a decoy hash on the miss path, so response
timing does not enumerate accounts.

**W-06 — staff self-registration — PASS** — `POST /api/auth/register {role:'ADMIN'}` → `403
ROLE_REGISTRATION_FORBIDDEN`; same for `role:'SUPPORT'`.

**W-07 — server-side logout revokes every outstanding token — PASS**
* `POST /api/auth/logout` (login-issued token) → 200.
* Re-use of that token → **401**.
* A *different*, previously-minted token for the same ADMIN user → **401** as well
  (`sessionVersion` bump invalidates all sessions, not just the one that logged out).

**W-08 — step-up is a 30-minute trust window, not a per-session challenge — OBSERVATION**
* After a successful OTP verification, a second `POST /api/auth/login` with **no new code** → 200.
* `CONSUMED_TRUST_WINDOW_MINUTES = 30` (`server/lib/email-verification.mjs:9`), and
  `hasRecentlyVerifiedEmail` only checks `consumedAt > now-30min` for the email+purpose pair — it is
  not bound to a device, IP, or session. Anyone holding the ADMIN password within 30 minutes of a
  legitimate OTP gets a session without a code. Status: **PASS with caveat** (see F-6).

### 4.2 Identity-document access controls, download controls, access logging

Audit-row deltas were measured around every single call.

**W-09 — ADMIN downloads a guest identity document — PASS**
* `GET /api/admin/id-document/<guestId>/file` → **200**, audit rows **+1**.
* Response headers, verbatim:
```
access-control-allow-headers: content-type,authorization
access-control-allow-methods: GET,POST,PATCH,DELETE,OPTIONS
access-control-allow-origin: http://127.0.0.1:5180
cache-control: private, no-store
content-disposition: attachment; filename="sybnb-identity.png"
content-length: 68
content-security-policy: default-src 'none'; frame-ancestors 'none'
content-type: image/png
permissions-policy: geolocation=(), camera=(), microphone=(), payment=()
referrer-policy: strict-origin-when-cross-origin
vary: origin
x-content-type-options: nosniff
x-frame-options: DENY
```
* Audit row written:
```json
{"action":"STAFF_DOCUMENT_ACCESSED","entityType":"users",
 "entityId":"7d9af91b-db8f-4c26-9f7f-558455ae8531","before":null,
 "after":{"result":"ALLOWED","actorRoles":["ADMIN"],"documentCategory":"identity"},
 "ipHash":null}
```

**W-10 — SUPPORT downloads a guest identity PDF — PASS (control works) / FAIL (authority) **
* → **200**, audit rows **+1**, `after.actorRoles = ["SUPPORT"]`,
  `content-disposition: attachment; filename="sybnb-identity.pdf"`, `content-type: application/pdf`.
* The forced-download + audit controls behave correctly. The *authority* is the problem: this is a
  passport-equivalent read performed by an account that never passed a step-up (F-1).

**W-11 — non-staff cannot reach identity documents — PASS**
* GUEST → `403 FORBIDDEN`; HOST → `403 FORBIDDEN`; unauthenticated → `401 AUTH_REQUIRED`.
* Audit delta **0** in every refused case — refusals are *not* logged (see F-7).

**W-12 — bad identifiers — PASS**
* Unknown UUID → `404 ID_DOCUMENT_NOT_FOUND`, no audit row.
* Non-UUID (`not-a-uuid`) → `404`, no 500, no audit row.
* Path traversal `..%2f..%2fetc%2fpasswd` → `404`, no audit row, no filesystem error leaked.

**W-13 — owner self-access — PASS (by design, unaudited)**
* `GET /api/me/id-document/file` as the document's owner → 200 with the same forced-download
  headers; audit delta **0**. `server/lib/document-access-audit.mjs` documents this exclusion
  explicitly ("worker self-access … intentionally NOT audited"). Consistent with the stated design.

**W-14 — driver documents: no forced download, no access audit — FAIL (confirms known-context (b) and (c))**
* `GET /api/admin/driver-documents/<id>/file` as ADMIN → **200**, audit delta **0**.
* Headers, verbatim — note the **absent `content-disposition`**:
```
access-control-allow-origin: http://127.0.0.1:5180
cache-control: private, no-store
content-security-policy: default-src 'none'; frame-ancestors 'none'
content-type: application/pdf
permissions-policy: geolocation=(), camera=(), microphone=(), payment=()
referrer-policy: strict-origin-when-cross-origin
transfer-encoding: chunked
vary: origin
x-content-type-options: nosniff
x-frame-options: DENY
```
* Same result as SUPPORT (`200`, audit delta 0), and same again through the *non-admin* route
  `GET /api/driver/documents/<id>/file`, which staff may also use (`isStaff` branch,
  `server/routes/driver.mjs:305`) — 200, audit delta 0, no `content-disposition`.
* Refusals on those routes are correct: GUEST → 403 on both; owner driver → 200.

**W-15 — listing documents (CITQ certificates): same two gaps — FAIL**
* `GET /api/admin/listing-documents/<id>/file` as ADMIN → 200, **no `content-disposition`**, audit delta 0.
* Same as SUPPORT → 200, audit delta 0.
* Same through `GET /api/listings/<lid>/documents/<did>/file` as SUPPORT (staff branch,
  `server/routes/listings.mjs:693`) → 200, audit delta 0.
* GUEST on that route → `403 LISTING_DOCUMENT_FORBIDDEN`.

**Confirmed:** `privateDocumentDownloadHeaders()` is referenced from exactly two places
(`server/routes/admin.mjs:402`, `server/routes/me.mjs:212`) and `recordStaffDocumentAccess()` from
exactly one (`server/routes/admin.mjs:393`). Four other staff-reachable private-document routes have
neither.

**W-16 — staff can overwrite and de-verify any identity, with only SUPPORT-level authority — FAIL**
* Start: guest with `idDocumentStatus = APPROVED`, `idDocumentReviewedById = <admin>`,
  `idDocumentRef = b0f4b3a8-….png`.
* Action: `PATCH /api/admin/id-document/<guestId>/upload` as **SUPPORT** with an arbitrary base64 image.
* **Actual: 200.** Resulting DB state: `idDocumentStatus = PENDING_REVIEW`,
  `idDocumentReviewedById = null`, `idDocumentReviewedAt = null`, `idDocumentRef = 5e4b3648-….png`
  (previous file deleted from storage).
* Audit row `ID_DOCUMENT_UPLOADED_BY_ADMIN` written with actor = SUPPORT. So it is *audited*, but a
  password-only SUPPORT session can silently revoke any user's verified status and substitute the
  evidence of identity. Status: **FAIL** (see F-5).
* GUEST attempting the same → `403`.

**W-17 — document-access rate limiting — PASS**
* 34 rapid `GET /api/admin/id-document/…/file` as one ADMIN: requests 1–30 → 404 (nonexistent target,
  deliberately chosen so no audit noise was created), request 31 → **`429` with `retry-after: 60`**.
* Matches `DOCUMENT_ACCESS` rule (30 / 60 s, per user). Audit rows created by the burst: **0**.

### 4.3 User lookup and role visibility

**W-18 — lookup by email — PASS (with a data-minimisation caveat)**
* ADMIN → 200; SUPPORT → 200; GUEST → 403; HOST → 403; unknown email → `404 USER_NOT_FOUND`;
  missing `?email=` → `400 USER_LOOKUP_EMAIL_REQUIRED`; `?email=' OR 1=1 --` → `404` (no SQL error,
  no 500).
* Payload is the ID-document projection only:
```json
{"ok":true,"user":{"id":"…","displayName":"E2E GUEST guest","email":"…@sybnb.test",
 "idDocumentRef":"b0f4b3a8-3146-4699-8fee-f82bbbccc64c.png","idDocumentMimeType":"image/png",
 "idDocumentSubmittedAt":"…","idDocumentStatus":"PENDING_REVIEW",
 "idDocumentReviewedById":null,"idDocumentReviewedAt":null}}
```
* No `passwordHash`, no `phoneHash` — correct. It **does** return the raw object-storage key
  (`idDocumentRef`), which the audit module elsewhere promises never to record (F-8).

**W-19 — role visibility — NOT IMPLEMENTED**
* There is no admin endpoint that returns a user's roles. `users/lookup` omits them, and there is no
  `GET /api/admin/users/:id`. Aggregate counts are available at `/api/admin/platform-metrics`
  (`usersByRole: {ADMIN:6, SUPPORT:1, HOST:5, GUEST:14, SELLER:4, DRIVER:3}`), and the driver
  registry lists DRIVERs, but an admin cannot answer "what roles does this account hold?" from the
  API. Status: **NOT IMPLEMENTED**.

**W-20 — account review / suspension — PARTIAL**
* Only the driver kill-switch exists: `PATCH /api/admin/drivers/:id/status`. There is no equivalent
  for GUEST / HOST / SELLER accounts. Status for non-driver account suspension: **NOT IMPLEMENTED**.

### 4.4 Listing review

**W-21 — SUPPORT cannot decide a listing — PASS** — `PATCH /api/admin/review-queue/listing/<id>`
as SUPPORT → `403 FORBIDDEN`; as GUEST → `403`.

**W-22 — ADMIN approves a listing — PASS**
* Start: RENTALS listing `PENDING_REVIEW`. Action: `{"decision":"APPROVED"}`. → **200**.
* DB: `status = APPROVED`, `expiresAt = 2026-09-21T04:50:24Z` (free-tier freshness clock started at
  approval, as designed). Audit row `REVIEW_APPROVED / listing` written with full before+after.
* Handoff: listing becomes publicly bookable — consumed by the CLIENT-role flow below.

**W-23 — double-decision guard — PASS** — repeating the same approval → `400 LISTING_NOT_REVIEWABLE`,
**no** second audit row, no state change (`updateMany` re-checks status in the WHERE clause).

**W-24 — ADMIN rejects a listing — PASS** — second RENTALS listing → 200, `status = REJECTED`,
audit row `REVIEW_REJECTED / listing`.

**W-25 — jurisdiction fail-closed gate — PASS (verified on the SR path)**
* At 04:47 UTC the `STR / SY / ''` jurisdiction profile was `BLOCKED`. **At 04:49:06 UTC a parallel
  agent (actor `1b58f693-…`, not one of my fixtures) approved it** — audit row
  `JURISDICTION_COMPLIANCE_APPROVED`. My STAYS approval at 04:50 therefore legitimately returned 200.
  This is environment interference, recorded here for honesty rather than claimed as a result.
* The gate itself was proven on the still-`BLOCKED` `SR / SY` profile:
  `PATCH /api/admin/driver-documents/<id> {"decision":"APPROVED"}` → **`403 JURISDICTION_NOT_APPROVED`**,
  `{"details":{"division":"SR","countryCode":"SY","status":"BLOCKED","missing":["transport / ride-hailing authorization"…]}}`,
  driver document left `PENDING_REVIEW`, **no audit row** (the whole transaction rolled back).

**W-26 — invalid review targets — PASS**
* Unknown entity type `unicorn` → `400 UNSUPPORTED_REVIEW_ENTITY`.
* Missing UUID / malformed id / missing `decision` field → `400 …_NOT_REVIEWABLE`, no audit row,
  no 500 from Prisma's P2023.

### 4.5 Document review and legal hold

**W-27 — driver document decision — PASS** — SUPPORT → 403; ADMIN `REJECTED` → 200,
`status = REJECTED`, `reviewedById = <admin>`, audit `DRIVER_DOCUMENT_REJECTED`.

**W-28 — listing document decision — PASS** — SUPPORT → 403; ADMIN → 200, status
`ADMIN_REVIEWED_TEST` (deliberately *not* a legal "verified"), audit
`LISTING_DOCUMENT_ADMIN_REVIEWED_TEST`.

**W-29 — legal hold requires a documented reason — PASS** —
`{"hold":true}` with no reason → `400 LISTING_DOCUMENT_LEGAL_HOLD_REASON_REQUIRED`;
`{"hold":true,"reason":"…"}` → 200, `legalHold = true`, audit `LISTING_DOCUMENT_LEGAL_HOLD_SET`.

**W-30 — a mistyped legal-hold field silently performs the OPPOSITE action — FAIL**
* Action: `PATCH /api/admin/listing-documents/<id>/legal-hold` with body `{"legalHold": true}`
  (correct field is `hold`).
* Expected: `400` for an unrecognised body (the pattern used by `assertNoUnknownFields` elsewhere in
  this codebase).
* **Actual: `200 OK`.** `body.hold === true` was false, so the server **cleared** the hold and wrote
  an audit row `LISTING_DOCUMENT_LEGAL_HOLD_CLEARED`. Reproduced twice: once from a clean state, and
  once against a document that genuinely had `legalHold = true`, which was silently released.
* Resulting DB: `legalHold = false`, `legalHoldReason` cleared. Status: **FAIL** (see F-2).

### 4.6 Booking visibility, payment state, admin intervention, inventory

Money flow driven end-to-end against a real approved listing (no card path — Syrian local wallet
proof only).

**W-31 — booking visibility and redaction — PASS**
* `GET /api/bookings/<id>`: ADMIN 200 (full), SUPPORT 200 (full), owning HOST 200 (payment proofs
  projected down — `proofAssetUrl`/`providerRef`/`adminNote`/`reviewedById` stripped), unrelated
  GUEST → `403 BOOKING_FORBIDDEN`.

**W-32 — payment-state visibility — PASS** — the pending proof appeared in
`GET /api/admin/review-queue` for both ADMIN and SUPPORT with payer identity and provider reference;
`GET /api/payments/<proofId>` as ADMIN → 200.

**W-33 — SUPPORT cannot approve a payment — PASS** — `403 FORBIDDEN`, proof untouched.

**W-34 — Sham Cash reconciliation is mandatory and server-recomputed — PASS**
* ADMIN approve with no reconciliation packet → **`409 SHAM_CASH_RECONCILIATION_REQUIRED`**.
* ADMIN approve with `accountMinor: 1` against a 250 000 SYP proof → **`409 SHAM_CASH_RECONCILIATION_MISMATCH`**.
* After both failures: proof still `PENDING_ADMIN_REVIEW`, booking still `PAYMENT_PENDING`, audit
  count unchanged. Nothing was half-applied.
* ADMIN approve with the correct `accountMinor` → **200**. Booking `PAYMENT_PENDING → REQUESTED`
  (non-instant-book), ledger: `host: HOLD 250000 SYP (booking_payout)`. Audit `REVIEW_APPROVED / payments`.

**W-35 — payout release controls — PASS**
* SUPPORT → `403`. ADMIN on a `REQUESTED` booking → **`400 PAYOUT_NOT_ELIGIBLE`**
  ("must be COMPLETED and past the 14-day hold, with no open dispute"). ADMIN on an unknown booking
  → `404 BOOKING_NOT_FOUND`. No wallet entry created in any refused case.
* `GET /api/admin/payouts` correctly listed only COMPLETED, unreleased bookings with computed
  `eligibleAt` / `eligibleNow:false` and `holdDays: 14`.

**W-36 — inventory is held while a booking is live — PASS** — a second guest requesting the same
listing and dates → **`409 BOOKING_DATES_UNAVAILABLE`**.

**W-37 — admin booking intervention / cancellation administration — PASS (with audit caveat)**
* SUPPORT → `403`. ADMIN `PATCH /api/admin/review-queue/booking/<id> {"decision":"REJECTED",
  "adminNote":"…"}` → **200**.
* Resulting DB state: booking `REQUESTED → CANCELLED`; payment proof `APPROVED → REFUNDED` with
  `adminNote = "Auto-refunded after admin rejected/ruled against this booking."` and
  `reviewedById = <admin>`; ledger gained `guest: REFUND 250000 SYP (booking_refund)`.
* Commission reversal correctly did **not** fire — for a non-STAYS division `adminShareMinor` is 0,
  so there was nothing to reverse; the arithmetic is consistent.
* Audit: exactly **one** row (`REVIEW_REJECTED / booking`) for the entire cascade. See F-3.

**W-38 — inventory release after admin cancellation — PASS** — the second guest immediately
re-booked the identical dates → **`201`**. Dates were released the moment the booking was cancelled.

**W-39 — cancelled booking cannot be re-decided — PASS** — a follow-up `APPROVED` decision on the
cancelled booking → `400 BOOKING_NOT_REVIEWABLE`; status stayed `CANCELLED`.

**W-40 — stale HOLD entry after cancellation — OBSERVATION (not a money bug)**
* The host's `HOLD 250000 SYP` ledger entry from payment approval is never reversed or annotated when
  the admin cancels. `recordWalletEntry` gives `HOLD` a balance delta of **0**
  (`server/lib/finance-ledger.mjs`), so **no money moved and no balance is wrong** — but the host's
  ledger permanently shows a hold against a cancelled booking. Reporting hygiene, not a loss.

### 4.7 Support operations, fleet, and remaining staff surfaces

All confirmed in one pass; ADMIN-only routes correctly refuse SUPPORT.

| Route | SUPPORT | ADMIN | Status |
|---|---|---|---|
| `PATCH /api/admin/reviews/:id/hide` | 404 (reached handler — permitted) | — | PASS |
| `PATCH /api/admin/disputes/:id` | **403** | 400 (missing dispute) | PASS |
| `PATCH /api/admin/reports/:id` | **403** | 400 | PASS |
| `PATCH /api/admin/accommodations/:id/approve-all` | **403** | 404 | PASS |
| `PATCH /api/admin/jurisdiction-compliance/:id` | **403** | 404 | PASS |
| `POST /api/admin/sr-payouts/:id/release` | 405 on PATCH (POST-only route) | — | PASS |
| `PATCH /api/admin/sr-rides/:id/commission-flag` | **403** | — | PASS |
| `PATCH /api/admin/sos/:id/resolve` | **403** | — | PASS |
| `GET /api/admin/drivers/:id`, `…/cancellations` | 200 | 200 | PASS |
| `PATCH /api/admin/vehicles/:id` | 400 (reached handler — permitted) | — | PASS |

**W-41 — fleet kill switch and session revocation — PASS**
* SUPPORT suspend → `403`. ADMIN `{"status":"SUSPENDED"}` → 200, audit `DRIVER_STATUS_SUSPENDED`
  with `before/after` and the reason.
* Side effect verified empirically: the suspended driver's previously valid token then returned
  **401 on every subsequent request**, and reinstating to ACTIVE did **not** resurrect it — a
  suspension is an immediate logout, not just a login block.
* ADMIN reinstate → 200, audit `DRIVER_STATUS_ACTIVE`.

**W-42 — driver/host registry export and download controls — PASS**
* `GET /api/admin/drivers/export?format=csv` (ADMIN and SUPPORT) → 200 with:
```
content-type: text/csv; charset=utf-8
content-disposition: attachment; filename="driver-vehicle-registry-2026-07-23.csv"
cache-control: no-store
x-content-type-options: nosniff
x-frame-options: DENY
content-security-policy: default-src 'none'; frame-ancestors 'none'
```
* Content: every driver's id, real name, email, account status, verification status, country,
  payout method, vehicle make/model/year/**plate**, and per-document status.
* Forced-download and no-store are correct. **No audit row is written for this export** — the single
  broadest PII egress in the admin surface leaves no trace (F-4). All non-staff roles → 403/401.
* There is **no host registry export**; only drivers. `GET /api/admin/host-insights` is ADMIN-only
  and returned an empty set (no insights generated — the generation endpoint was deliberately not
  called).

### 4.8 Audit-log visibility and integrity

**W-43 — audit log readable by ADMIN and SUPPORT — PASS** — 200 for both, `403` GUEST/HOST/SELLER,
`401` anonymous. `limit` clamped to 100 (`?limit=99999` → 100 rows).

**W-44 — audit log is append-only over HTTP — PASS** — `DELETE /api/admin/audit-log` → `405`;
`DELETE /api/admin/audit-log/<rowId>` → `404`; `PATCH /api/admin/audit-log/<rowId>` → `404`.
There is no write/delete route for audit rows.

**W-45 — audit rows are produced for every state-changing action tested — PASS**
18 rows were written by my two staff fixtures across this run:
`STAFF_DOCUMENT_ACCESSED` ×3, `ID_DOCUMENT_UPLOADED_BY_ADMIN` ×2, `REVIEW_APPROVED` ×3 (listing,
iddocument, payments), `REVIEW_REJECTED` ×2 (listing, booking), `DRIVER_DOCUMENT_REJECTED`,
`LISTING_DOCUMENT_ADMIN_REVIEWED_TEST`, `LISTING_DOCUMENT_LEGAL_HOLD_SET`,
`LISTING_DOCUMENT_LEGAL_HOLD_CLEARED` ×2, `DRIVER_STATUS_SUSPENDED`, `DRIVER_STATUS_ACTIVE`.
Every failed/refused action produced **zero** rows and **zero** state change.

**W-46 — admin reads do not mutate authoritative records — PASS**
Snapshot of my 3 listings, 2 bookings, payment proof, guest verification state, wallet-entry count
and audit count taken before and after seven consecutive admin GETs (`review-queue`, `payouts`,
`platform-metrics`, `revenue-summary`, `audit-log`, `drivers`, `jurisdiction-compliance`):
**byte-identical**. Caveat: `GET /api/admin/review-queue` and `GET /api/admin/payouts` both call
`completeExpiredBookings()` — a documented lazy-expiry write path. No record of mine was eligible, so
nothing moved, but these reads *are* capable of transitioning bookings to `COMPLETED`.

### 4.9 Error handling, security headers, transport

**W-47 — security headers on every response — PASS.** Present on 200s, 4xx, binary downloads and the
204 preflight alike:
`x-content-type-options: nosniff` · `x-frame-options: DENY` ·
`referrer-policy: strict-origin-when-cross-origin` ·
`permissions-policy: geolocation=(), camera=(), microphone=(), payment=()` ·
`content-security-policy: default-src 'none'; frame-ancestors 'none'` · `cache-control: no-store`
(JSON) / `private, no-store` (documents) · `vary: origin`.
`strict-transport-security` is correctly **absent** on plain-HTTP local dev
(`server/lib/security-headers.mjs` gates it on `NODE_ENV=production && FORCE_HTTPS=1`).

**W-48 — CORS — PASS** — allowlisted origin `http://127.0.0.1:5180` echoed in
`access-control-allow-origin`; `OPTIONS` preflight → 204 with the allow-methods/headers set.
Request from `http://evil.example` → the response carries **no** `access-control-allow-origin`
(browser-blocked). Note the request is still *processed* server-side and returns 200 — correct, since
CORS is a browser control and the bearer token is the real authorisation, but worth stating plainly.

**W-49 — malformed input — PASS** — malformed JSON body → `400`; 200 KB oversized base64 upload →
`400`; unknown admin path → `404`; wrong verb → `405` with the correct allow-list; no stack traces,
no Prisma error text and no 500 was produced anywhere in 224 requests.

**W-50 — rate limiting — PASS (and it is real)** — `AUTH_EMAIL_CODE_SEND` returned
`429 RATE_LIMITED` with `retry-after: 719` while another agent's traffic shared the 5-per-15-min
per-IP budget; `AUTH_REGISTER` likewise; `DOCUMENT_ACCESS` returned 429 at request 31 of 34 with
`retry-after: 60`. Error body: `{"ok":false,"error":{"code":"RATE_LIMITED","message":"Too many requests. Try again in 719 seconds."}}`.

---

## 5. Findings

### F-1 — SUPPORT holds identity-document authority with no step-up authentication — HIGH
`STAFF_ROLES_REQUIRING_OTP` (`server/routes/auth.mjs:37`) covers `ADMIN, HOST, DRIVER, SELLER` but
**not `SUPPORT`**. Observed: `POST /api/auth/login` with email+password alone → `200` + staff token
(W-02). With that token I read a guest's identity document, exported the entire driver registry
(names, emails, plates), read the platform-wide audit log, and reset a verified user's identity
document (W-03, W-10, W-16, W-42). ADMIN — a role with *strictly fewer* identity-document powers than
SUPPORT in no respect but strictly more decision powers — is gated; SUPPORT is not. A single
credential compromise on any support account is a full PII breach with no second factor.

### F-2 — a mistyped legal-hold request silently clears an active legal hold — HIGH
`PATCH /api/admin/listing-documents/:id/legal-hold` reads only `body.hold === true` and treats
*anything else* — including the plausible misspelling `{"legalHold": true}` — as "clear the hold". It
returns `200 OK` and writes an audit row labelled `LISTING_DOCUMENT_LEGAL_HOLD_CLEARED`. An admin who
believes they have placed a litigation hold has in fact removed one, and the document becomes
eligible for the retention purge job (`purgeExpiredListingDocuments` filters on `legalHold: false`).
The route has no `assertNoUnknownFields` guard, unlike sibling routes in this codebase.

### F-3 — one audit row covers a multi-record financial cascade, and the admin's stated reason is dropped — MEDIUM
An admin booking rejection changes three record classes (booking status, payment-proof status +
reviewer + note, wallet REFUND entry) and emits a **single** `REVIEW_REJECTED` row whose `before`/
`after` describe only the booking. Verified: the `adminNote` I supplied
(`"e2e synthetic admin cancellation"`) appears **nowhere** in the audit row — checked by full-text
search of the persisted JSON. The comparable guest-cancellation path (`server/routes/bookings.mjs:185`)
*does* record `cancellationNote` and a fee breakdown. "Why did an admin cancel this paid booking?" is
not answerable from the audit trail.

### F-4 — the broadest PII export in the product is unaudited — MEDIUM
`GET /api/admin/drivers/export` returns every driver's name, email, account status, verification
status, payout method and vehicle plate, in CSV, to any ADMIN **or SUPPORT** session, and writes no
audit row. Confirmed by measuring audit deltas: 0. The same is true of `/api/admin/drivers`,
`/api/admin/users/lookup` and `/api/admin/audit-log` itself.

### F-5 — staff can revoke a verified identity and substitute the evidence — MEDIUM
`PATCH /api/admin/id-document/:id/upload` (ADMIN **and SUPPORT**) unconditionally sets
`idDocumentStatus = PENDING_REVIEW`, nulls `idDocumentReviewedById`/`ReviewedAt`, writes the caller's
bytes as the user's identity document and deletes the previous file. Demonstrated against an
already-`APPROVED` account (W-16). It is audited, but it is not a step-up-gated action and there is
no confirmation, no "reason", and no reversibility — the prior file is gone.

### F-6 — the staff step-up is a 30-minute account-wide window, not a session challenge — MEDIUM
`hasRecentlyVerifiedEmail` matches on `[email, purpose, consumedAt > now-30min]` only. A second,
third, *n*-th login within 30 minutes — from any device or IP — needs no code (W-08). The OTP
therefore raises the bar for the first login in a window and for nothing after it.

### F-7 — refused document access leaves no trace — LOW
`recordStaffDocumentAccess` supports a `result` field and the only call site passes the constant
`'ALLOWED'`, *after* the authorization check. Every 401/403/404 attempt against a private document
produced audit delta 0 (W-11, W-12). Probing for other users' identity documents is invisible.

### F-8 — object-storage keys are returned to staff clients — LOW
`ID_DOCUMENT_SAFE_SELECT` includes `idDocumentRef`, so `users/lookup`, the review queue's ID-document
decision response and the `REVIEW_APPROVED/iddocument` audit `after` blob all carry the raw storage
key (e.g. `b0f4b3a8-3146-4699-8fee-f82bbbccc64c.png`). `server/lib/document-access-audit.mjs`
explicitly states storage keys are "never recorded"; that promise holds for its own rows but not for
the surrounding surfaces.

### F-9 — `admin_audit_logs.ipHash` exists and is never populated — LOW
0 of 86 rows in the database carry an `ipHash`. No code path writes it. "Which network did this
staff action come from" is structurally unanswerable despite the column being present.

### F-10 — no role visibility, and no account suspension outside the driver fleet — NOT IMPLEMENTED
No admin endpoint returns an individual user's roles (W-19); no admin endpoint can suspend a GUEST,
HOST or SELLER account (W-20). Both are ordinary trust-and-safety operations.

### F-11 — the audit-log endpoint is an unfiltered PII firehose — LOW/MEDIUM
`GET /api/admin/audit-log` returns raw `before`/`after` blobs for **all** entity types with no
projection and no filtering, to ADMIN and SUPPORT. Observed in the live response: guest contact phone
numbers (`metadata.guestContactPhone: "+963931234567"`), payment provider references, full listing
metadata and identity-document storage keys.

---

## 6. Security and privacy observations (non-findings)

* Every authorization decision tested is enforced **server-side** on the route itself; nothing relied
  on a client-side role check. 56 of 224 responses were `403` and 22 were `401`, all correctly shaped.
* Token handling is sound: forged, truncated and re-signed tokens → 401; logout bumps `sessionVersion`
  and revokes *all* outstanding tokens for that user, including ones minted out-of-band.
* Every state-changing admin decision re-checks the expected status inside the `UPDATE … WHERE`
  clause, so concurrent decisions cannot both apply — verified behaviourally by the double-decision
  tests (W-23, W-39).
* Failure atomicity is genuinely transactional: the two rejected Sham Cash approvals and the
  jurisdiction-blocked driver-document approval left **no** partial writes and **no** audit rows.
* Error bodies are uniformly `{ok:false,error:{code,message}}`; no stack trace, SQL fragment or
  internal path leaked in 224 requests, including deliberate traversal and injection-shaped inputs.
* PII redaction for the *host* view of a booking is correctly implemented (guest email and payment
  proof internals stripped).
* The dev environment is honest about being a dev environment: `devCode` in the OTP response and no
  HSTS on plain HTTP are both explicitly gated on `NODE_ENV`.

---

## 7. Unresolved blockers and limitations

1. **Shared database and shared rate-limit buckets.** Three other agents drove the same server and
   the same `sybnb_v6_dev` database from the same IP. Two consequences are visible in this report:
   `AUTH_EMAIL_CODE_SEND` / `AUTH_REGISTER` returned `429` on first attempt and had to be retried
   ~12 minutes later; and the `STR/SY` jurisdiction profile was flipped from `BLOCKED` to `APPROVED`
   by another agent mid-run (04:49:06 UTC), which changed the outcome of my STAYS listing approval.
   I re-verified the jurisdiction gate on the still-blocked `SR/SY` profile instead.
2. **Payout release could not be exercised on the success path.** It requires a `COMPLETED` booking
   past a 14-day hold; manufacturing that would have meant back-dating rows, which is outside a
   read-only-plus-own-fixtures mandate. Only the refusal paths (403 / 400 / 404) were validated.
3. **Dispute and report resolution, SOS resolve, SR payout release, vehicle review, accommodation
   approve-all and review-hide** were validated for **authorization and error handling only** — no
   pre-existing dispute/report/SOS/vehicle/accommodation fixtures existed and creating them was out
   of scope for this role. Their happy paths are untested here.
4. **Card/Stripe payment states** were excluded by instruction, so payment-state visibility was
   validated only on the Syrian local-wallet proof path.
5. **R2 object storage is not connected**; all document reads went through the local filesystem
   driver. Storage-layer behaviour under the production driver is unvalidated.
6. `POST /api/host/insights/generate` was not called, so `/api/admin/host-insights` was exercised
   against an empty result set.

---

## 8. No-fix confirmation

**I made no fixes.** No source file, test, configuration file, dependency, migration, Prisma schema
or documentation file under version control was modified. `git status` shows the tracked tree clean
and identical to the state at commit `6e8b8f2`; the only additions are this report and the untracked
files that were already present before I started. No commit, push, merge, branch change or deploy was
performed. Every defect above is documented as observed and left in place.

Working artefacts I created for this run (`.e2e-admin-*.mjs` driver scripts, `.e2e-admin-evidence.jsonl`,
`.e2e-admin-state.json`) live at the worktree root, are untracked, and are noted in §10.

---

## 9. Evidence

All 224 requests were captured with method, path, HTTP status, the **complete** response header set
and the response body (binary document bodies recorded as length + SHA-256 prefix rather than
content). Header blocks quoted in §4 are verbatim from that capture. Database state was read directly
via Prisma before and after each workflow, and audit-row counts were measured immediately before and
after every individual privileged call so that "an audit row appeared" is a measured delta, never an
inference.

Key raw artefacts:
* `.e2e-admin-evidence.jsonl` — one JSON record per request.
* `.e2e-admin-state.json` — fixture identifiers.

---

## 10. Synthetic fixtures left behind

All synthetic, all `@sybnb.test`, all created during this run. **Nothing was deleted** — every one of
these accounts is referenced by `admin_audit_logs` rows (or created them), and the standing order is
that audit rows are never removed, so removing the actors would break referential history.

| Label | Email | Id | Role | End state |
|---|---|---|---|---|
| admin | `e2e-admin-admin-mrx15u3h@sybnb.test` | `d96163da-dd4b-4d22-ad60-1c27ac671db3` | ADMIN | ACTIVE, `sessionVersion` bumped by logout |
| support | `e2e-admin-support-mrx15u3h@sybnb.test` | `0ada5ef7-e404-4cf8-bbc0-276b9b8f8569` | SUPPORT | ACTIVE |
| host | `e2e-admin-host-mrx15u3h@sybnb.test` | `9338a680-081a-4e04-a5fe-045f3a7da06d` | HOST | ACTIVE |
| guest | `e2e-admin-guest-mrx15u3h@sybnb.test` | `7d9af91b-db8f-4c26-9f7f-558455ae8531` | GUEST | ACTIVE, ID doc `PENDING_REVIEW` (reset by W-16) |
| guest2 | `e2e-admin-guest2-mrx15u3h@sybnb.test` | `9eada65b-629d-4f81-b9dd-85deabb004be` | GUEST | ACTIVE, ID doc `PENDING_REVIEW` |
| driver | `e2e-admin-driver-mrx15u3h@sybnb.test` | `fabdd366-5bb4-4354-be2d-8135b621e82c` | DRIVER | ACTIVE (suspended then reinstated), LICENSE doc `REJECTED` |
| seller | `e2e-admin-seller-mrx15u3h@sybnb.test` | `94aea022-b327-4818-8b38-75a6c2343b94` | SELLER | ACTIVE, ID doc `PENDING_REVIEW` (uploaded by SUPPORT in W-16) |

Domain fixtures:

| Object | Id | End state |
|---|---|---|
| STAYS listing | `4f1d7229-0ab9-4985-86fc-4a5ba35201d7` | `APPROVED` |
| RENTALS listing #1 | `4c0fb883-35a9-4839-af06-2bb55f28ee31` | `APPROVED`, `expiresAt 2026-09-21` |
| RENTALS listing #2 | `9b4e0905-79ec-4efd-a2f3-d137c4ce9a51` | `REJECTED` |
| Booking #1 | `db1712ab-ace0-4f2d-bb98-2724da1c3064` | `CANCELLED` (admin intervention) |
| Booking #2 | `9a56a09b-6603-4146-baee-8608c79a13b5` | `PAYMENT_PENDING` (guest2, re-booked released dates) |
| Payment proof | `e79f9b1c-9428-48ac-9e05-1f87a88a3c23` | `REFUNDED` |
| Driver document | `492694f2-9ba2-4349-87af-7c5f5cd531dc` | `REJECTED` |
| Listing document | `907bd178-935b-41a1-9d0d-7516c29f7900` | `ADMIN_REVIEWED_TEST`, `legalHold false` |

Plus 12 wallet entries (2 attached to booking #1: a host `HOLD` and a guest `REFUND`, both SYP), a
handful of local-filesystem objects under `STORAGE_LOCAL_DIR`, and **18 `AdminAuditLog` rows** written
by my staff fixtures. **No audit-log row was deleted or altered.**

---

## 11. Summary table

| # | Workflow | Status |
|---|---|---|
| W-01 | ADMIN sign-in without step-up refused | PASS |
| W-02 | SUPPORT sign-in without step-up | **FAIL** |
| W-03 | Password-only SUPPORT session is fully privileged | **FAIL** |
| W-04 | ADMIN sign-in with step-up | PASS |
| W-05 | Wrong password / no enumeration | PASS |
| W-06 | Staff self-registration refused | PASS |
| W-07 | Logout revokes all sessions | PASS |
| W-08 | Step-up trust window semantics | PASS (caveat) |
| W-09 | ADMIN identity-document download + audit | PASS |
| W-10 | SUPPORT identity-document download + audit | PASS (control) / **FAIL** (authority) |
| W-11 | Non-staff refused identity documents | PASS |
| W-12 | Bad/hostile identifiers on document route | PASS |
| W-13 | Owner self-access (unaudited by design) | PASS |
| W-14 | Driver-document route: no forced download, no audit | **FAIL** |
| W-15 | Listing-document route: no forced download, no audit | **FAIL** |
| W-16 | Staff overwrite / de-verify an identity | **FAIL** |
| W-17 | Document-access rate limiting | PASS |
| W-18 | User lookup + refusals | PASS (caveat) |
| W-19 | Role visibility | **NOT IMPLEMENTED** |
| W-20 | Non-driver account suspension | **NOT IMPLEMENTED** |
| W-21 | SUPPORT cannot decide listings | PASS |
| W-22 | ADMIN listing approval | PASS |
| W-23 | Double-decision guard | PASS |
| W-24 | ADMIN listing rejection | PASS |
| W-25 | Jurisdiction fail-closed gate | PASS |
| W-26 | Invalid review targets | PASS |
| W-27 | Driver-document decision authority | PASS |
| W-28 | Listing-document decision authority | PASS |
| W-29 | Legal hold requires a reason | PASS |
| W-30 | Mistyped legal-hold field clears the hold | **FAIL** |
| W-31 | Booking visibility + host redaction | PASS |
| W-32 | Payment-state visibility | PASS |
| W-33 | SUPPORT cannot approve payments | PASS |
| W-34 | Sham Cash reconciliation enforcement | PASS |
| W-35 | Payout release controls (refusal paths) | PASS |
| W-36 | Inventory held while booking live | PASS |
| W-37 | Admin booking intervention + refund cascade | PASS (audit caveat) |
| W-38 | Inventory release after cancellation | PASS |
| W-39 | Cancelled booking cannot be re-decided | PASS |
| W-40 | Stale HOLD entry after cancellation | OBSERVATION |
| W-41 | Fleet kill switch + session revocation | PASS |
| W-42 | Driver registry export + download controls | PASS (unaudited — F-4) |
| W-43 | Audit-log visibility | PASS |
| W-44 | Audit log append-only over HTTP | PASS |
| W-45 | Audit rows for all state-changing actions | PASS |
| W-46 | Admin reads do not mutate records | PASS |
| W-47 | Security headers | PASS |
| W-48 | CORS behaviour | PASS |
| W-49 | Malformed-input handling | PASS |
| W-50 | Rate limiting | PASS |

**Counts — workflows:** 50 recorded · **PASS 41** (3 with explicit caveats) · **FAIL 6** ·
**NOT IMPLEMENTED 2** · **OBSERVATION 1** · **BLOCKED 0**.
(W-10 is counted once as FAIL, on the authority axis.)

**Counts — findings:** 11 · HIGH 2 · MEDIUM 4 · LOW 4 · NOT IMPLEMENTED 1.

**Counts — requests:** 224 · 2xx 109 · 4xx 111 (400×15, 401×22, 403×56, 404×12, 405×3, 409×3, 429×4)
· **5xx 0**.

---

## 12. Bottom line

The admin surface is, mechanically, in good shape: authorization is enforced server-side on every
route, the ADMIN/SUPPORT split is real and consistent, state transitions are TOCTOU-guarded and
transactional, failed actions leave nothing behind, reads do not mutate, and no request in this run
produced a 5xx. The problems are concentrated in one theme — **the perimeter around private documents
and staff identity**: SUPPORT reaches identity documents on a password alone; only one of five
staff-reachable private-document routes forces a download or writes an access record; the widest PII
export is unlogged; and a plausible typo silently releases a legal hold. None of these are
architectural rewrites, but each is a real gap between the security posture the code documents and
the behaviour the running system exhibits.
