# SYBNB E2E Validation — Agent 1: Client / Guest

**Date:** 2026-07-23
**Agent role:** Client / Guest (unauthenticated visitor, device-guest, and registered `GUEST` account)
**Baseline commit:** `6e8b8f2` — *docs(review): add independent SYBNB final architecture review*
**Working tree:** clean for tracked files at start; **no tracked file was modified by this agent**

---

## 1. Environment tested

| Item | Value |
|---|---|
| API | `http://127.0.0.1:3051` (local Node HTTP server, `server/index.mjs`) |
| Web | `http://127.0.0.1:5180` (Vite dev, hash router) |
| Database | local Postgres `127.0.0.1:5432` (read via `server/lib/prisma.mjs`) |
| Storage driver | `local` filesystem, ephemeral temp dir (R2 **not** connected) |
| Email / SMS | **not configured** — OTP returned inline as `devCode` |
| Stripe | live test key present — **deliberately never exercised** |
| Browser | Chrome via MCP, viewport fixed at 767×1039 (see BLOCKED item W-13) |

**Guardrails honoured:** local only; synthetic `@sybnb.test` / device-guest identities only; no Stripe/card path invoked; `POST /api/host/insights/generate` never called; no source, config, schema, test or dependency change.

---

## 2. Role and permissions observed

| Capability | Result |
|---|---|
| Browse public listings, detail, quote, availability, reviews | allowed, unauthenticated |
| Create booking | requires `GUEST` role — but any visitor can silently mint one via `POST /api/auth/checkout-guest` |
| Read own booking / payment proof | allowed |
| Read another guest's booking / proof | **403 `BOOKING_FORBIDDEN` / `PAYMENT_FORBIDDEN`** — correctly denied |
| `/api/host/*`, `/api/admin/*` | **403 `FORBIDDEN`** on all tested routes (one exception, W-11) |
| Forged token with `roles:["ADMIN"]` | **401 `AUTH_REQUIRED`** — HMAC signature verified, tampering rejected |
| Session token lifetime | **90 days** (`exp − iat = 7 776 000 s`) |
| Server-side logout | works — `sessionVersion` bump invalidates old token immediately (401) |

---

## 3. Sections tested

Public landing · stay search + filters + calendar · listing detail · availability · quote · account creation (email OTP) · sign-in / sign-out / session revocation · password reset · guest checkout (frictionless device-guest) · booking creation · contact capture · payment-pending state · local-wallet (Sham Cash) payment · Stripe path (inspected, not executed) · booking confirmation · cancellation · refund-status visibility · trips / trip lookup · favourites · messages (listing inquiry + booking thread) · profile / settings · identity verification submission · reports (support) · disputes · reviews · wallet · error states · access restrictions · CORS & security headers · mobile usability.

---

## 4. Findings — severity ordered

### C-1 · CRITICAL · Non-card payment is a dead end; the guest is told nothing and is then permanently trapped

- **Starting state:** booking `2e0a9e75-9f75-4d1f-95eb-e7e6409a1257`, `PAYMENT_PENDING`, 6 000 USD, contact details saved.
- **Action:** UI → *Local wallet / Sham Cash* → page `#/payment/local-wallet/<id>/6000/USD` → click **“Sham Cash · 6,000 USD”**.
- **Expected:** a proof reference / file upload is submitted to `POST /api/payments/local-wallet-proof`; booking moves toward admin review.
- **Actual:**
  1. The page has **no file-upload control and no transaction-reference input**. Verified via accessibility tree — the only interactive elements are the two method toggles and the footer links. The on-page instruction still reads *“Scan the QR code with your local wallet app, complete the transfer, then upload or enter the transaction reference.”* (`src/engines/payments/syrianLocalWallet.ts:52`).
  2. Clicking the Sham Cash button calls `confirmWalletPayment()` (`src/modules/payments/SyrianLocalWalletPaymentPage.tsx:187`), which does **not** call the real API. It calls the client-only `createLocalFallbackPaymentProof()` (`src/shared/api/platformApi.ts:1580`), which throws `Fallback booking not found` for any real (non-`fallback-booking-*`) booking id.
  3. The `catch` sets `paymentState('error')` but the `finally` immediately overwrites it with `setPaymentState('idle')`, so the error element `{paymentState === 'error' && <p className="wallet-error">…}` (line 302) **never renders**. The button click is a completely silent no-op.
- **Visible user message:** none. Capsule stays “Ready to pay”, “Payment proofs: 0 file”.
- **Resulting DB state:** `booking.status = PAYMENT_PENDING`, `payments = 0` (verified directly).
- **Note:** the same helper would have set `status: 'APPROVED'`, `reviewedById: 'local-payment-test'` client-side had the booking been a fallback id — i.e. the code path is designed to *tell the guest their payment is approved* without any server record.
- **Handoff:** nothing reaches the admin payment-review queue. Admin agent will see no proof.
- **Status:** **FAIL**. The only completable payment path in the product is Stripe, which is out of scope for the Syrian market this page exists to serve.
- **Evidence:** `src/modules/payments/SyrianLocalWalletPaymentPage.tsx:172-198, 302`; `src/shared/api/platformApi.ts:1580-1610`; accessibility tree of the payment page; DB read showing `payments: 0`.
- **Corollary:** `PaymentProofUpload` (`src/modules/payments/PaymentProofUpload.tsx`) is imported **only** by seller/host modules. There is no guest-facing payment-proof upload anywhere in the app. The working server endpoint `POST /api/payments/local-wallet-proof` — which I exercised successfully by `curl` — is unreachable from the product.

---

### C-2 · CRITICAL · `PAYMENT_PENDING` bookings never expire and can never be cancelled by anyone → permanent inventory denial

- **Action:** `PATCH /api/bookings/<id>/cancel` on three `PAYMENT_PENDING` bookings.
- **Expected:** guest can abandon an unpaid checkout.
- **Actual:** `HTTP 400 BOOKING_NOT_CANCELLABLE` — *“Only requested or confirmed bookings can be cancelled by the guest.”* Bookings are **created** as `PAYMENT_PENDING` (`server/routes/bookings.mjs:620`), so a guest can never cancel a booking they just made.
- **Nobody else can either:**
  - Host: `canCancel = status === 'CANCELLED' && ['REQUESTED','CONFIRMED'].includes(existing.status)` (`server/routes/host.mjs:258`).
  - Admin review queue: `if (!existing || !['REQUESTED','DISPUTED'].includes(existing.status)) throw BOOKING_NOT_REVIEWABLE` (`server/routes/admin.mjs:1570`).
  - Payment-proof rejection: no `REJECT` branch in `server/lib/finance-ledger.mjs` touches `booking.status`.
- **No expiry job:** `completeExpiredBookings()` (`server/lib/booking-lifecycle.mjs`) only moves `CONFIRMED → COMPLETED`. Repo-wide search confirms *“there is no cron in this codebase”*; nothing sweeps `PAYMENT_PENDING`.
- **Impact:** `PAYMENT_PENDING` is in the availability-overlap status list (`server/routes/listings.mjs:251, 400`; `server/routes/bookings.mjs:553`), so every abandoned checkout removes those dates from search and from booking **forever**.
- **Demonstrated:** an unauthenticated visitor (device-guest, no email, no verification, no payment) created a booking `2030-01-01 → 2035-01-01` on listing `375d4780…`; the listing immediately disappeared from `GET /api/listings?division=STAYS&checkIn=2031-06-01&checkOut=2031-06-05`. A separate 500-year booking (`2027-01-01 → 2527-01-01`) was accepted with `amountMinor = 273 931 500`.
- **Amplifier:** `POST /api/auth/checkout-guest` has **no rate-limit rule** in `RATE_LIMIT_RULES` (`server/index.mjs:50-75`); 5 consecutive new device ids all returned 200. `BOOKING_CREATE` is limited `byUser: true`, so unlimited fresh identities means unlimited fresh buckets.
- **Status:** **FAIL** (also a security finding — unauthenticated inventory DoS).
- **Confirms the review-package hypothesis.** Both parts verified as real.

---

### H-3 · HIGH · Past-dated and unbounded bookings are accepted end-to-end

| Input | Expected | Actual |
|---|---|---|
| `checkIn 2020-01-01 / checkOut 2020-01-04` | 400 | **201 Created**, `PAYMENT_PENDING`, 4 500 USD |
| No `checkIn`/`checkOut` at all | 400 | **201 Created**, `checkIn: null`, `checkOut: null`, amount = one night |
| `2027-01-01 → 2527-01-01` (182 621 nights) | 400 / max-nights error | **201 Created**, 273 931 500 USD |
| Search calendar, today = 2026-07-23 | past days disabled | **1–22 July 2026 fully selectable** |

The UI reproduces this: I selected 2026-07-01 → 2026-07-05 in the stay-search calendar, the listing page and booking-review page both accepted it, and the booking was created for those past dates. The review page displayed *“Free cancellation: Free cancellation until June 28, 2026”* — a date three weeks in the past.
**Server code:** `server/routes/bookings.mjs:474` validates only `checkOut > checkIn`; there is no lower bound against `now` and no maximum stay length.
**Status:** **FAIL**.

---

### H-4 · HIGH · No client account UI exists — sign-up, sign-in and sign-out are unreachable

- The backend guest registration + email/phone OTP works correctly (verified by `curl`, see W-1/W-2 below).
- `GuestAccountPage.tsx` — the guest sign-up/sign-in screen — is **never imported or rendered**. `grep -rn "GuestAccountPage" src/` returns only its own definition and two comments.
- `/#/account/open` routes to `SearchPreviewPage`, not to any account form (`src/app/App.tsx:99-101`). Confirmed in browser: no email, password, or sign-in field exists on that route.
- `login()` / `register()` in `platformApi.ts` are called only by `ensurePrototypeSession` / `createStaffAccount` (staff paths).
- The header exposes only *Stays · Become a host · Wallet · Settings · Book now*. There is **no Sign in, no Sign out, no profile**.
- **Consequence:** every real client is an anonymous, device-bound `guest-<deviceId>@device.sybnb.local` account. Change browser, clear storage, or switch phone → all trips are lost; the only recovery is `/#/track` with the confirmation number + phone.
- **Status:** **NOT IMPLEMENTED (client-facing)** — backend PASS, product FAIL.

---

### H-5 · HIGH · No trips list; guest dashboard is dead code

`/#/dashboard` and `/#/account` both render `LandingPage` (`src/app/App.tsx:102`). `src/modules/dashboard/DashboardPage.tsx` is never imported. `GET /api/me/overview` returns a correct, complete trip list (verified: 5 bookings, payments, wallet, gifts, referrals) — but nothing in the client UI consumes it. A guest's only view of their own trips is one-at-a-time via `/#/track`.
**Status:** **NOT IMPLEMENTED (client-facing)**.

---

### H-6 · HIGH · Search card mixes currencies: fee shown and summed as USD without conversion

- Listing `00000000-0000-4000-8000-000000000001` (“Test apartment in Montreal”), `priceMinor = 150000`, `currency = SYP`, `metadata.taxFeeMinor = 5250` (SYP).
- Card renders: **Price 10 USD · Tax 5,250 USD · Before booking 5,260 USD**.
- Cause: `StayFeeDisclosure` (`src/modules/search/SearchPreviewPage.tsx:355-381`) converts only the base price (`sypMinorToRoundedUsdMinor`) and then adds `cleaningFee` / `taxFee` straight from metadata, labelling all three `'USD'` unconditionally.
- The real quote for this listing is `600 000` for 4 nights in **SYP**, with `estimatedTaxMinor = 110 850` — and the Québec tax is explicitly **disclosure-only, never collected** (`collectedTaxMinor: 0`).
- A guest browsing sees a headline “Before booking 5,260 USD” that is wrong in magnitude, wrong in currency, and implies a tax is charged.
- **Status:** **FAIL**.

---

### M-7 · MEDIUM · Broken listing images with no fallback

9 of 12 STAYS media URLs returned **404** from `GET /api/listings/:id/media/file/:key` (e.g. `19166867-…png`, `00000000-0000-0000-0000-000000000000.png`). The search grid and listing gallery render bare broken-image icons — no placeholder, no `onError` fallback, no skeleton. The API returns media records for objects that no longer exist in the storage driver.
*Caveat:* the 404s themselves are largely an artefact of the ephemeral local temp storage dir. The **absence of any client-side fallback** is a real product gap and is what a user actually experiences.
**Status:** **FAIL (UI robustness)**.

---

### M-8 · MEDIUM · Guest cannot message the host until the booking is confirmed

`GET /api/bookings/<id>/thread` and `POST …/thread/messages` → `400 MESSAGING_NOT_ELIGIBLE` — *“Messaging opens once the booking is confirmed.”* Combined with C-1/C-2, a guest whose payment is stuck has no in-booking channel to the host. (Listing-inquiry threads *do* work — `POST /api/listings/<id>/thread/messages` returned 201.)
**Status:** by design, but a real support gap given C-1. **PASS (contract) / FAIL (journey)**.

---

### M-9 · MEDIUM · Identity verification is host-only; no guest ID submission UI

`PATCH /api/me/id-document` works well server-side (see W-9). The only UI that calls it is `HostDashboardPage.tsx:364`. A client has no way to submit identity documents.
**Status:** **NOT IMPLEMENTED (client-facing)**.

---

### M-10 · MEDIUM · Favourites / wishlist not implemented

No API, no route, no UI. The only reference in the codebase is a comment: `src/modules/marketplace/MarketplaceBrowsePage.tsx:9` — *“Boosts/favorites/offers are Phase 2 (not built).”*
**Status:** **NOT IMPLEMENTED**.

---

### M-11 · MEDIUM · Cancellation protection is unreachable from the UI

`POST /api/bookings` with `cancellationProtection: true` correctly computes a **server-side** 3 % premium (3 000 → 90) and ignores a forged `cancellationProtectionFeeMinor: 1` — the S2 control works. But no UI anywhere offers the purchase; `grep -rn "cancellationProtection" src/` finds only type definitions and a read-only display in `BookingCancelDispute.tsx:61`.
**Status:** **NOT IMPLEMENTED (client-facing)**; the security control itself is **PASS**.

---

### L-12 · LOW · Assorted UI/UX defects

| # | Observation | Evidence |
|---|---|---|
| a | Booking-review header renders listing title and host handle concatenated with no separator and mixed RTL/LTR: `غرفة اختبارc2-host-1784686644` | screenshot, `#/booking/review/<id>` |
| b | Settings page card headings (“Blocked accounts”, “Delete account”) are near-invisible — light text on a white card in the dark theme | screenshot, `#/settings` |
| c | Unknown routes (`#/no-such-page-xyz`) silently render the landing page — no 404 state | browser |
| d | `/#/track` hint says the confirmation number is *“Shown on the payment page”*, but the payment page shows *“Follow-up code”* = the full 36-char UUID; the lookup expects the 12-char prefix. The full UUID happens to work, but the labels never match | browser |
| e | Settings offers only block-list + delete account — no name, email, phone, password, language or notification preferences | browser |
| f | The Sham Cash payee is a **hardcoded constant** — `Nazem Karman`, `•••• 3188` (`src/engines/payments/syrianLocalWallet.ts:40-48`) — presented on a live payment page as the account to transfer real money to, with the account number masked so it cannot actually be used | source + browser |
| g | `checkOut < checkIn`, `checkIn=notadate`, `minPrice=-5` on `GET /api/listings` are silently ignored rather than rejected (search still returns all 7) | curl |

---

### L-13 · LOW · `/api/host/inquiries` accepts a `GUEST` token

`GET /api/host/inquiries` with a guest token → `200 {"ok":true,"threads":[]}`. The query is scoped by `listing.ownerId = context.user.id`, so **no data leaks**, but `requireAuth(context)` is called without a role list (`server/routes/messages.mjs:311`) unlike every sibling host route.
**Status:** **PASS (no leak) / FAIL (missing role check)**.

---

## 5. Workflows that PASSED

| # | Workflow | Action → Actual |
|---|---|---|
| W-1 | Email OTP send | `POST /api/auth/email-code/send` → `{ok:true, emailSent:false, devCode:"345495"}`. Wrong code → `400 INVALID_OR_EXPIRED_CODE`; correct → `200`. Per-email limit (3/15 min) **and** per-IP limit (5/15 min) both fired correctly under repeat use. |
| W-2 | Guest registration gate | Register without verifying → `403 EMAIL_NOT_VERIFIED`. With verified code → `201`, `roles:["GUEST"]`, referral code issued. Weak password → `400 VALIDATION_PASSWORD_TOO_SHORT`. Duplicate → `409 ACCOUNT_ALREADY_EXISTS`. |
| W-3 | Login | Wrong password and unknown account both → identical `401 INVALID_CREDENTIALS` (constant-time decoy hash present). Mixed-case email (`E2E-Client-Alpha@SYBNB.test`) logs in correctly. |
| W-4 | Logout / session revocation | `POST /api/auth/logout` → 200; the old token then → `401 AUTH_REQUIRED`. Re-login issues a working token. |
| W-5 | Public search + filters | `governorate`, `city`, `area`, `amenities` (AND semantics: `wifi`→4, `wifi,pool`→0), `minPrice`/`maxPrice`, `propertyType`, `sort=priceAsc`, date-availability exclusion all behave correctly. `division=BOGUS` → `400 LISTING_DIVISION_INVALID`. A `' OR 1=1--` city value returns 0 rows (no injection). |
| W-6 | Listing detail / availability / reviews / 404s | Detail 200 with owner + accommodation; availability returns blocked dates, price overrides, booked ranges; reviews returns empty set with `average:null`; unknown UUID and non-UUID (`fallback-1`) both → clean `404 LISTING_NOT_FOUND` (no P2023 500). UI shows *“Listing not found.”* |
| W-7 | Quote | 3 nights × 1 500 = 4 500 with an honest breakdown; `guestServiceFeeMinor: 0`, `refundableDepositMinor: 0`, `collectedTaxMinor: 0`, `remittedTaxMinor: 0` returned as explicit zeros. Québec quote returns lodging 3.5 % / GST 5 % / QST 9.975 % as **estimate only**. Invalid dates → `400 QUOTE_DATES_INVALID`. |
| W-8 | Booking creation + mass-assignment defence | Unauthenticated → `401 AUTH_REQUIRED`. Body carrying `amountMinor:1`, `status:"CONFIRMED"`, `guestId:"0000…"`, `cancellationProtectionFeeMinor:1` was fully ignored — server recomputed 3 000 and forced `PAYMENT_PENDING`. |
| W-9 | Double-booking prevention | Overlapping request on the same listing/dates → `409 BOOKING_DATES_UNAVAILABLE` (advisory-lock-guarded). |
| W-10 | Contact capture before payment | Paying before contact → `403 GUEST_CONTACT_INFO_REQUIRED`. `PATCH /api/bookings/<id>/contact` stores name+phone and (for a placeholder-named device guest) promotes the display name. |
| W-11 | Payment-proof server contract | Underpay (`amountMinor:1`) → `400 PAYMENT_AMOUNT_TOO_LOW`. Full proof → `201`, `status: PENDING_ADMIN_REVIEW`. Duplicate `providerRef` → `409`. *(Reachable only by API — see C-1.)* |
| W-12 | Trip lookup (public, no login) | API: correct ref+phone → 200 with status + `paymentStatus`; wrong phone → `404`; missing phone → `400`. **UI end-to-end PASS**: `/#/track` returned *Confirmation number 2E0A9E75-9F7 · Booking status: Awaiting payment proof · Payment status: No payment yet · Check-in 2026-07-01 · Check-out 2026-07-05*. Rate-limited at 20/15 min per IP. |
| W-13 | Identity document submission (API) | Valid PNG → `200`, `idDocumentStatus: PENDING_REVIEW`. `application/x-msdownload` → `400 ID_DOCUMENT_TYPE_INVALID`. Base64 text mislabelled `image/png` → `400 ID_DOCUMENT_CONTENT_INVALID` (magic-byte check). Self-download returns `content-disposition: attachment`, `cache-control: private, no-store`, `CSP: default-src 'none'`, `x-content-type-options: nosniff`. Strong. |
| W-14 | Support reports | `POST /api/reports` → `201`, status `OPEN`. Guest read of `/api/admin/reports` → `403 FORBIDDEN`. |
| W-15 | Disputes | `GET /api/disputes` scoped to own disputes. Opening one on a `PAYMENT_PENDING` booking → `400 BOOKING_NOT_DISPUTABLE` (correct — only CONFIRMED/COMPLETED). |
| W-16 | Reviews | Review on a non-completed booking → `400 REVIEW_BOOKING_NOT_COMPLETED`. Self-review and duplicate-review guards present in code. |
| W-17 | Listing inquiry messaging | Guest auto-creates the thread and sends; owner cannot fabricate a thread with an arbitrary `guestId`. 4 000-char cap and block-list enforcement present. |
| W-18 | Cross-tenant isolation | Guest A ↔ Guest B: booking read → `403 BOOKING_FORBIDDEN` both directions; payment proof read → `403 PAYMENT_FORBIDDEN`. |
| W-19 | Role gating | `403 FORBIDDEN` on `/api/host/overview`, `/api/host/earnings`, `/api/host/statements`, `/api/admin/disputes`, `/api/admin/reports`, `/api/admin/compliance-dashboard`, `/api/admin/tax-profiles`. |
| W-20 | Token forgery | Payload rewritten to `roles:["ADMIN"]`, signature reused → `401 AUTH_REQUIRED`. |
| W-21 | CORS | `origin: 127.0.0.1:5173` → no `access-control-allow-origin` (blocked). `origin: 127.0.0.1:5180` → allowed. |
| W-22 | Security headers | Every API response carries `x-content-type-options: nosniff`, `x-frame-options: DENY`, `referrer-policy: strict-origin-when-cross-origin`, `permissions-policy: geolocation=(), camera=(), microphone=(), payment=()`, `content-security-policy: default-src 'none'; frame-ancestors 'none'`, `cache-control: no-store`. |
| W-23 | Booking review page copy | Honest and clear: *“Guest service fee — Not charged today”*, *“Refundable deposit — Not applicable today”*, `Total due 6,000 USD`. Explicit STR agreement checkbox required before confirm. |
| W-24 | Wallet | `GET /api/wallet` returns the guest's own SYP wallet, zero balance, no cross-user data. |
| W-25 | XSS | Stored message bodies (`<img src=x onerror=alert(1)>`) are persisted raw but rendered through React with **no `dangerouslySetInnerHTML` anywhere in `src/`** — not exploitable. |

---

## 6. Security & privacy observations

1. **Unauthenticated inventory DoS** (C-2) — `POST /api/auth/checkout-guest` is unrated-limited, mints unlimited isolated identities, each of which can create date-blocking bookings that no actor and no job can ever clear.
2. **90-day session tokens** with only a coarse, all-device `sessionVersion` revocation. No per-session store, no idle timeout, no refresh rotation.
3. **`ownerId` (raw internal user UUID) is returned for every listing on the public, unauthenticated `GET /api/listings`.** Enables enumeration of host account ids without any auth.
4. **`POST /api/payments/local-wallet-proof` accepts `proofAssetUrl: null`** — a payment proof can be filed with no evidence attached at all; only the `providerRef` string is mandatory.
5. **Hardcoded payee on a live payment screen** (L-12f) — a named individual and a masked account number presented as the real transfer destination.
6. **`/api/host/inquiries` lacks a role check** (L-13). No leak today; one query-scope change away from one.
7. **Positive:** ID documents are magic-byte validated, force-downloaded, `no-store`, CSP-locked. Login is timing-equalised. Booking money fields, cancellation-protection fee, and payment amounts are all server-computed and immune to body forgery. PII guards keep host views to `{id, displayName}` with no guest email.

---

## 7. Unresolved blockers

| ID | Blocker |
|---|---|
| B-1 | **Stripe path not exercised** (instructed). The card flow is therefore the one payment route this report cannot certify — and given C-1 it is the *only* route that can complete. |
| B-2 | **Booking confirmation, refund, cancellation-with-refund, review submission, and dispute filing could not be reached.** All require a `CONFIRMED` or `COMPLETED` booking, which requires payment approval, which requires C-1 to be fixed or an admin to approve a proof. Marked BLOCKED, not PASS. |
| B-3 | **Mobile viewport testing blocked.** `resize_window` reported success but the viewport stayed pinned at 767×1039 (shared browser window with parallel agents). Layout at 767 px is single-column and readable; true phone widths (≤430 px) were not verified. |
| B-4 | Password-reset OTP could not be completed — the per-IP `AUTH_EMAIL_CODE_SEND` bucket (5/15 min) was exhausted by legitimate registration testing. The endpoint's existence and rate limiting were confirmed; the reset itself was not driven end-to-end. |

---

## 8. No-fix confirmation

**I made no fix of any kind.** No source file, test, configuration file, dependency, migration, schema, or document under `src/`, `server/`, `prisma/`, `test/`, or `scripts/` was created, edited, or deleted by this agent. Nothing was committed, pushed, merged, or deployed. The only file this agent wrote is this report. `git status` for tracked files is unchanged from the `6e8b8f2` baseline.

---

## 9. Cleanup

**Deleted (my synthetic fixtures only, verified by scoped `deleteMany` on ids I created):**

| Entity | Count |
|---|---|
| users (`e2e-client-*@sybnb.test`, `guest-e2eclient*`, `guest-9da6a322-…@device.sybnb.local`) | 8 |
| bookings | 8 |
| payment proofs | 1 |
| reports | 1 |
| message threads / messages | 1 / 3 |
| wallets / user roles | 8 / 8 |
| email verification codes | 1 |

Inventory was verified restored after cleanup: listing `375d4780…` is available again for 2031 and `9856b936…` for 2026-09; STAYS search count returned to 10 (up from 7 at session start — the extra listings belong to parallel agents and were **not** touched).

**Left behind, deliberately:**
- Listings, hosts, and bookings created by the other three agents — untouched.
- One orphaned ID-document blob (`57300579-8df4-4b56-a007-ac0ef44b31c7.png`) may remain in the ephemeral local storage temp dir; its DB reference is deleted and I could not locate the file to remove it. It disappears with the temp dir. This matches the known `STG-14` orphan-reconciliation gap documented at `server/routes/me.mjs:160`.
- `/tmp/e2e-client/` scratch files on this machine.

---

## 10. Summary table

| Workflow | Status |
|---|---|
| Public landing page | PASS |
| Stay search — filters | PASS |
| Stay search — date calendar | **FAIL** (past dates selectable, H-3) |
| Listing detail page | PASS (content) |
| Listing detail — date picker | **NOT IMPLEMENTED** (confirmed absent) |
| Listing availability API | PASS |
| Listing media / gallery | **FAIL** (M-7) |
| Price quote API + breakdown | PASS |
| Search-card fee/tax display | **FAIL** (H-6) |
| Account creation (email OTP) — API | PASS |
| Account creation — UI | **NOT IMPLEMENTED** (H-4) |
| Sign-in / sign-out — API | PASS |
| Sign-in / sign-out — UI | **NOT IMPLEMENTED** (H-4) |
| Password reset | BLOCKED (B-4) |
| Guest checkout (frictionless device-guest) | PASS |
| Booking creation | PASS (happy path) / **FAIL** (H-3 validation) |
| Mass-assignment defence on booking | PASS |
| Double-booking prevention | PASS |
| Contact capture before payment | PASS |
| Payment — local wallet / Sham Cash | **FAIL** (C-1) |
| Payment — Stripe / card | BLOCKED (B-1, out of scope) |
| Payment-pending state | **FAIL** (C-2, terminal + un-exitable) |
| Booking confirmation | BLOCKED (B-2) |
| Cancellation | **FAIL** (C-2) |
| Refund status visibility | BLOCKED (B-2) |
| Trips list / dashboard | **NOT IMPLEMENTED** (H-5) |
| Trip lookup `/track` | PASS |
| Favourites | **NOT IMPLEMENTED** (M-10) |
| Messages — listing inquiry | PASS |
| Messages — booking thread | **FAIL** (journey, M-8) |
| Profile / settings | PARTIAL — block list + delete only (L-12e) |
| Identity verification — API | PASS |
| Identity verification — client UI | **NOT IMPLEMENTED** (M-9) |
| Cancellation protection — server control | PASS |
| Cancellation protection — UI | **NOT IMPLEMENTED** (M-11) |
| Support reports | PASS |
| Disputes | PASS (guardrails) |
| Reviews | PASS (guardrails) |
| Wallet | PASS |
| Error states | PARTIAL (L-12c) |
| Access restrictions / cross-tenant | PASS |
| Token forgery / CORS / security headers | PASS |
| Mobile usability | BLOCKED (B-3) |

### Counts

| Status | Count |
|---|---|
| **PASS** | 25 |
| **FAIL** | 9 |
| **NOT IMPLEMENTED** | 7 |
| **BLOCKED** | 5 |
| **PARTIAL** | 2 |
| **Total workflows assessed** | 48 |

### Findings by severity

| Severity | Count | IDs |
|---|---|---|
| Critical | 2 | C-1, C-2 |
| High | 4 | H-3, H-4, H-5, H-6 |
| Medium | 5 | M-7, M-8, M-9, M-10, M-11 |
| Low | 2 (+7 sub-items) | L-12, L-13 |

---

## 11. Bottom line for the client role

A guest can find a stay, price it accurately, and create a booking. **They cannot pay for it, cannot cancel it, cannot see it in a trips list, cannot create or sign into a real account, and cannot message the host about it.** The one payment method built for the target market is a silent no-op with no error, and the booking it leaves behind blocks the host's calendar permanently with no recovery path for guest, host, admin, or any background job. The server-side contracts underneath are, with the exception of date validation, well-built and well-defended — the failure is almost entirely in the client surface and in the booking lifecycle's missing terminal transitions.
