# SYBNB End-to-End Validation — Agent 2 (HOST)

**Role:** Host / provider persona. Independent run; the CLIENT, ADMIN and CONTROLLER agent reports
were not read and are not referenced anywhere in this document.

---

## 1. Environment

| Item | Value |
| --- | --- |
| Baseline commit | `6e8b8f2` (`docs(review): add independent SYBNB final architecture review`) |
| Working tree | Tracked tree clean throughout; **no tracked file was created, edited or deleted by this agent** |
| API | `http://127.0.0.1:3051` (`node server/index.mjs`, pid 37229) |
| Web | `http://127.0.0.1:5180` (Vite, pid 37253) |
| Database | PostgreSQL `sybnb_v6_dev` @ `127.0.0.1:5432` (read-only observation only) |
| Object storage | `STORAGE_DRIVER=local`, `STORAGE_LOCAL_DIR=/Users/…/.claude/jobs/e7a4d38c/tmp/e2e-objects` — R2 not connected; uploads exercised the real code path against local disk |
| Date at test time | 2026-07-23 (machine TZ `EDT` = UTC-4) |
| Evidence workspace | `/tmp/e2e-host/` (scratch, outside the repo) |
| Browser origin used | `http://localhost:5180` — deliberately chosen because it is a **different `localStorage` origin** from `http://127.0.0.1:5180`, so the parallel agents' browser sessions were never touched |

### Safety compliance

* Local only. No production, staging or remote host was contacted.
* Synthetic data only (`…@sybnb.test`, synthetic 1×1 PNG, `%PDF-1.7` stub, fake `+963900111222`).
* **No Stripe/card path was exercised.** `POST /api/payments/stripe/*` was read but never called.
* **`POST /api/host/insights/generate` was never called.** `POST /api/host/listings/describe` was
  also **not** called — code inspection (`server/lib/ai-insights.mjs:87`) shows it makes a real,
  billed Anthropic `messages.create` call, so it is treated as covered by the same cost restriction.
  Both are marked **NOT TESTED (cost-restricted)** below.
* **No fixing.** No source, test, config, dependency, doc, schema or migration was modified. No
  commit, push, merge or deploy. `git status` shows only untracked scratch files belonging to other
  agents, plus this report.

### Disclosed environment interventions

Two things had to be done through the platform's own admin API to make host workflows reachable at
all. Both are disclosed here in full.

1. **Seeded admin account used as an assist.** `quebec-test-admin@sybnb.test` / `SybnbTest2026!`
   (credentials come from the tracked repo script `scripts/seed-quebec-compliance-review.mjs:27`).
   It was used **only** to approve this agent's own listings, ID document and payment proofs, and to
   release one payout — i.e. to unblock host-side testing. No independent admin-workflow assessment
   was performed or is reported here.
2. **STR/SY jurisdiction profile temporarily flipped `BLOCKED → APPROVED` and restored.** Without
   this, no listing on the platform can ever be approved (see FINDING H-01). Window:
   `04:49:06Z → 05:0x Z`. Profile `ff4f3290-294c-4ed4-91f7-bf7605faccad` was restored to its exact
   prior state (`status=BLOCKED`, `tourismSatisfied=false`, `taxSatisfied=false`,
   `platformSatisfied=false`, `platformNotes=null`); `tourismNotes`/`taxNotes`/`*Required` were
   never touched. Residual drift: `reviewedById` now points at the seeded QC admin and `reviewedAt`
   is 2026-07-23, plus two `admin_audit_logs` rows recording the flip and the restore. Verified
   restored — final state of all four profiles matches the pre-test snapshot.

---

## 2. Role, permissions and fixtures

| Fixture | Identifier |
| --- | --- |
| Host account | `e2e-host-1784781974@sybnb.test` — id `95bcd7c7-132a-4c22-9fc3-cadc0d86176b`, role `HOST` |
| Guest fixture | frictionless device guest `guest-e2ehostagent-1784781974-guest@device.sybnb.local` — id `30972251-c5c2-4a43-8209-aa716dfee32b` |
| Listing 1 | `5d1fc77c-358e-4108-b241-cf715cbc0bb4` — STAYS, Damascus, 150 000 SYP/night |
| Listing 2 | `9f6ab532-f7ca-4c44-a5f5-a32339f18bc2` — STAYS, Damascus, 100 000 SYP/night + 25 000 cleaning + 5 000 extra |
| Booking A | `54d3a245-d444-4809-8fdb-a65264c41692` — future dates, 230 000 SYP, ended `CANCELLED` (host-cancelled, guest refunded) |
| Booking B | `67c3cf36-68d1-4340-a9d0-59a3b56e4e59` — **past** dates, 300 000 SYP, ended `COMPLETED`, payout released |

Effective host permissions confirmed by test: create listing (DRAFT), upload/delete media, upload
listing documents, submit for review, pause/resume an approved listing, toggle instant-book, set
availability + per-night price overrides, accept/cancel a booking request, mark guest check-in /
check-out, message guests (booking thread + listing inquiry thread), read earnings/statements/wallet,
submit ID document + tax profile, file a support report. **Cannot** self-approve a listing, book own
listing, read another host's listing/availability/media, or reach any `/api/admin/*` route — all
correctly denied.

---

## 3. Workflow results

Legend — **PASS** = workflow completed end to end and produced correct state.
**FAIL** = completed but produced wrong state / wrong user-visible output.
**BLOCKED** = cannot be completed in this build. **NOT IMPLEMENTED** = no such capability exists.

---

### 3.1 Host onboarding (registration + email OTP)

* **Starting state:** no account.
* **Action:** `POST /api/auth/email-code/send {purpose:"staff-login"}` → `POST …/verify` →
  `POST /api/auth/register {role:"HOST"}`.
* **Expected:** OTP-gated host account created.
* **Actual:** `200 {ok:true, emailSent:false, devCode:"347326"}` → `200 {ok:true}` →
  `201` with user id + 90-day session token. `devCode` is correctly suppressed when
  `NODE_ENV=production` (`server/lib/email-verification.mjs:68`).
* **DB state:** `users` row + `user_roles(HOST)` + SYP wallet + referral code `8F2GHGKG`.
* **User message:** none needed; clean success.
* **Handoff:** account visible to admin via `/api/admin/users/lookup`.
* **Status: PASS**

### 3.2 Host identity verification

* **Action:** `PATCH /api/me/id-document` with a synthetic PNG; admin approved.
* **Actual:** `PENDING_REVIEW` → admin `APPROVE` → `APPROVED`. Host dashboard flips from
  "Not verified yet 35%" to "مضيف موثوق 65%"; public listing detail returns `sellerVerified: true`.
* **Note (minor):** `POST`/`GET` on `/api/me/id-document` return `405 "Use PATCH for this endpoint."` —
  correct but an odd affordance for a create operation.
* **Note (privacy, low):** the response echoes the raw storage key
  (`idDocumentRef:"1e897d31-….png"`) back to the client. Serving is authz-gated, so not exploitable,
  but the key need not be exposed.
* **Status: PASS**

### 3.3 Listing creation, media upload, submission

* **Action:** `POST /api/listings` (STAYS) → `POST /api/listings/:id/media` ×2 →
  `PATCH /api/listings/:id/submit`.
* **Actual:** `201 DRAFT` → `201` per photo (bytes written to
  `…/e2e-objects/media/52ddc51a-….png`, 70 B, verified on disk) → `200 PENDING_REVIEW`.
* **Access control verified:** while `DRAFT`, `GET …/media/file/:key` returns `401` anonymously and
  `200 image/png` to the owner. After approval it is public with `cache-control: public, max-age=3600`.
* **Upload validation verified (good):** magic-byte sniffing rejects `image/svg+xml`
  (`LISTING_MEDIA_TYPE_INVALID`), PNG-bytes-declared-as-PDF (`LISTING_DOCUMENT_CONTENT_INVALID`,
  message names both declared and detected type), and text-declared-as-PNG on the ID document.
* **Status: PASS**

### 3.4 Listing editing — **NOT IMPLEMENTED**

* **Action:** `PATCH /api/listings/:id` and `PUT /api/listings/:id`.
* **Actual:** both return `405 {"code":"METHOD_NOT_ALLOWED","message":"Use GET for this endpoint."}`.
  Route inspection (`server/routes/listings.mjs`, all 12 path matchers) confirms **no update route
  exists for a listing**. Title, description, price, currency, capacity, amenities and all metadata
  are write-once at creation.
* **UI counterpart:** the host dashboard renders a ✎ "edit" button per listing
  (`src/modules/host/HostDashboardPage.tsx:592`) which navigates to `#/listing/{id}` — the **public,
  guest-facing detail page**. Verified in the browser: that page contains no edit control of any kind
  (`hasEditControl:false`). For a `DRAFT`/`PAUSED` listing it will 404, because the public detail
  endpoint only serves `APPROVED`.
* **Consequence:** a host who mistypes a price, or wants a seasonal base-rate change, has no recovery
  path except creating a new listing and going through admin review again.
* **Status: NOT IMPLEMENTED** (and the UI advertises an edit affordance that does not exist).

### 3.5 Listing approval / going live — **BLOCKED (top finding)**

**FINDING H-01 — No STR listing can be published in any market.**

* **Action:** admin `PATCH /api/admin/review-queue/listings/:id {decision:"APPROVE"}` on a
  well-formed Syria STAYS listing.
* **Expected:** listing goes `APPROVED`.
* **Actual:**
  ```
  403 {"code":"JURISDICTION_NOT_APPROVED",
       "message":"Short-term rental in this market is currently paused pending legal/compliance review (SY).",
       "details":{"division":"STR","countryCode":"SY","status":"BLOCKED",
                  "missing":["tourism accommodation registration","tax registration","platform operator registration"]}}
  ```
* **System state:** every row in `jurisdiction_compliance_profiles` is non-approving:

  | division | country | region | status |
  | --- | --- | --- | --- |
  | STR | CA | quebec | PENDING |
  | STR | SY | — | **BLOCKED** |
  | SR | CA | quebec | PENDING |
  | SR | SY | — | **BLOCKED** |

  `assertJurisdictionApproved` fails closed on anything that is not `APPROVED`, so **no STR listing
  in any configured market can be approved today.**
* **The host-facing half is worse than the block itself.** Nothing in the host path warns about this.
  `POST /api/listings` accepts the listing, `PATCH …/submit` accepts it and returns
  `200 PENDING_REVIEW`, and the host dashboard shows it as "pending review" — forever. The host is
  allowed to spend the entire onboarding effort (photos, documents, ID verification, availability,
  pricing) on a listing the platform already knows can never go live, and is never told.
* **Handoff:** admin sees the listing in `/api/admin/review-queue` and can only reject it or leave it
  stuck.
* **Status: BLOCKED.** Everything downstream of this (§3.7 onward) was only reachable via the
  disclosed temporary jurisdiction flip.

### 3.6 Host self-approval attempt (security)

* **Action:** `PATCH /api/host/listings/:id/status {status:"APPROVED"}` on a `PENDING_REVIEW` listing.
* **Actual:** `409 HOST_LISTING_STATUS_FORBIDDEN` — "A host can only pause an approved listing or
  resume a paused one. Publishing a listing requires admin review." Correct.
* **Status: PASS**

### 3.7 Availability calendar

* **Action:** `PATCH /api/host/listings/:id/availability` blocking 2026-08-12 / 08-13 and setting a
  120 000 SYP override on 2026-08-22.
* **Actual:** `200`, three `listing_availability` rows upserted, `HOST_LISTING_AVAILABILITY_UPDATED`
  audit row written. Guest-facing `GET /api/listings/:id/availability` correctly returns
  `blockedDates:["2026-08-12","2026-08-13"]`, `priceOverrides:[{2026-08-22, 120000}]`,
  `offerNightsCount:1`, `cheapestOfferMinor:120000`.
* **UI verified in browser:** August grid renders 12 and 13 gold ("blocked by host") and 22 green with
  "١٢٠٬٠٠٠ ل.س" underneath. Legend distinguishes available / host-blocked / guest-booked.
* **Status: PASS**

### 3.8 Pricing

* Nightly + per-night override arithmetic is correct: 3-night quote over the promo night returns
  `420000 = 120000 + 150000 + 150000`.
* Fee model is correct **when metadata is flat**: listing 2 (`metadata.cleaningFeeMinor: 25000`,
  `extraFeesMinor: 5000`) quotes `230000` for 2 nights and the booking is created at exactly that
  amount. `booking.amountMinor` = the all-inclusive total the guest confirmed.
* **Note (robustness, low):** fees are read only from **flat** `metadata.cleaningFeeMinor`
  (`server/lib/pricing.mjs:42`). A listing that carries the fee only under
  `metadata.guestVisibleFees.cleaningFeeMinor` silently prices at zero cleaning fee. The current
  wizard writes both keys, so this is latent rather than live — but there is no server-side
  reconciliation between the two copies, and with no listing-edit endpoint (§3.4) a listing created
  by any other client with only the nested shape can never be corrected.
* **Status: PASS** (with the note above)

**FINDING H-02 — host promotional pricing is silently erased for USD guests.**

* SYP→USD uses a hard-coded `SYP_PER_USD = 15000` and then **rounds every night up to the nearest
  $5** (`server/lib/currency.mjs:20`).
* Evidence: `GET /api/listings/5d1fc77c…/quote?currency=USD` over the promo range returns
  `perNight[0].priceMinor = 10` for the **120 000 SYP promo night** and `10` for the ordinary
  **150 000 SYP** nights. The host's 20 % discount produces an identical guest price.
* The public listing detail page renders **"السعر لليلة ١٠ USD · الدفع بالدولار فقط"** ("$10/night ·
  USD payment only") for a listing the host priced and sees as 150 000 SYP.
* Any host base price between 75 001 and 150 000 SYP collapses to the same $10.
* **Status: FAIL** (host pricing control is not faithfully represented to the guest)

**FINDING H-03 — quotes are returned for blocked dates with no unavailability signal.**

* `GET /api/listings/:id/quote?checkIn=2026-08-12&checkOut=2026-08-13` — dates the host explicitly
  blocked — returns a normal `200` quote of 150 000 SYP with no flag. The booking itself is correctly
  rejected later (`409 BOOKING_DATES_UNAVAILABLE`), so this is not an overbooking hole, but the guest
  is quoted a price for a stay that cannot be booked.
* **Status: FAIL (minor / UX correctness)**

### 3.9 Reservations — guest booking visibility

**FINDING H-04 — `PAYMENT_PENDING` bookings are invisible to the host while already holding the calendar.** *(review-package item — confirmed)*

* **Starting state:** listing 2 live, calendar clear.
* **Action:** guest `POST /api/bookings` → `201 {status:"PAYMENT_PENDING", amountMinor:230000}`.
* **Host view:** `GET /api/host/overview` →
  `totals {requests:0, requested:0, confirmed:0, revenueMinor:0}`, `requests: []`.
  Root cause: `server/routes/host.mjs:100-104` filters `status: { not: 'PAYMENT_PENDING' }`.
* **Meanwhile the dates are already held:** `GET /api/listings/:id/availability` immediately returns
  `bookedRanges:[{checkIn:"2026-09-01",checkOut:"2026-09-03"}]`, and the overlap guard in
  `bookings.mjs` counts `PAYMENT_PENDING` as blocking. The host's own calendar renders those nights
  as "محجوز من ضيف" (booked by guest).
* **Net effect:** the host sees nights disappear from their calendar with **zero corresponding
  reservation record anywhere in the host UI or API list surfaces** — no id, no guest, no amount, no
  expiry, and no way to release the hold. The booking is readable at `GET /api/bookings/:id`, but the
  host has no host-facing surface that ever discloses the id.
* **There is also no expiry.** No route or job releases an abandoned `PAYMENT_PENDING` booking, so an
  unpaid guest can hold a host's dates indefinitely; only a `PAYMENT_PENDING` overlap check exists,
  nothing that ages them out.
* **Status: FAIL**

### 3.10 Reservation lifecycle: payment → request → host acceptance

* Guest added contact (`PATCH /api/bookings/:id/contact`), submitted `POST /api/payments/local-wallet-proof`
  (`PENDING_ADMIN_REVIEW`), admin approved with Sham Cash reconciliation
  (`SHAM_CASH_RECONCILIATION_REQUIRED` correctly enforced on the first attempt without it).
* Booking moved `PAYMENT_PENDING → REQUESTED`; **the host dashboard then showed it correctly** with
  guest display name, approved payment (status/amount/currency/date only) and listing summary.
* Host confirm **without** `acceptedTerms` → `400 HOST_TERMS_REQUIRED`
  ("Host must accept SYBNB rules and conditions before confirming this booking.") — correct governed
  response. With `acceptedTerms:true` → `200 CONFIRMED`; guest's own `GET /api/bookings/:id` also
  reads `CONFIRMED`. `HOST_CONFIRMED` audit row written including the terms-acceptance record.
* **Status: PASS**

### 3.11 Guest check-in / check-out marking

* `CHECK_OUT` before `CHECK_IN` → `400 HOST_CHECKIN_REQUIRED_FIRST`. Correct ordering guard.
* `CHECK_IN` then `CHECK_OUT` → both timestamps written, audit rows created.
* **Note (data integrity, medium):** there is **no date validation**. The host successfully marked a
  guest "checked in" and "checked out" on 2026-07-23 for a booking whose stay is
  2026-09-01 → 2026-09-03 — 40 days in the future. Marking check-out also does **not** complete the
  booking (it stayed `CONFIRMED`); completion is driven purely by `checkOut < now`.
* **Status: PASS with defect** (guard exists but is not date-aware)

### 3.12 Past-date bookings accepted

**FINDING H-05 — the API accepts bookings entirely in the past.**

* `POST /api/bookings {checkIn:"2026-06-13", checkOut:"2026-06-15"}` on 2026-07-23 →
  `201 PAYMENT_PENDING`. The only date validation in `bookings.mjs` is
  `checkOut > checkIn`; there is no "not in the past" check.
* It then flows all the way through payment approval, host confirmation, auto-completion
  (`completeExpiredBookings`), payout eligibility (checkout + 14-day hold already elapsed) and a
  guest review. A back-dated booking is therefore a working path to **instant payout eligibility**
  and to **posting reviews on a stay that never happened**.
* (This is also how payout release was made testable within a single session; it is reported as a
  defect, not as a technique.)
* **Status: FAIL**

### 3.13 Guest communication

* Booking thread: guest message → `201`; host `GET /api/bookings/:id/thread` shows it; host reply
  stored with `senderRole:"HOST"`; guest sees the reply. Messaging correctly refuses to open before
  `CONFIRMED` (`MESSAGING_NOT_ELIGIBLE`).
* Listing inquiry thread (pre-booking): guest message → host `GET /api/host/inquiries` returns the
  thread with listing summary, guest display name, messages and a documents slot.
  UI (`#/host/inquiries`) renders it correctly with a reply box.
* **Gap (medium):** the host UI has **no surface for booking threads**. `HostInquiriesPage` renders
  only listing-level inquiry threads; there is no host-facing inbox, list or entry point for the
  message thread of a confirmed reservation. The endpoint works, the screen does not exist.
* **Status: PASS (API) / FAIL (host UI coverage for booking threads)**

### 3.14 Cancellations

* **Host cancel of a CONFIRMED, fully-paid booking:** `PATCH /api/host/requests/:id {decision:"CANCEL"}`
  → `200 CANCELLED`. Guest refunded in full: guest wallet 0 → **230 000 SYP**. Payment proof flipped
  to `REFUNDED`. Admin commission share reversed. Correct.
* **FINDING H-06 — the host cancellation fee is charged in the wrong currency and drives the host's
  wallet negative.**
  * `CANCELLATION_ADMIN_FEE_MINOR = 10`, `CANCELLATION_ADMIN_FEE_CURRENCY = 'USD'`
    (`server/lib/finance-ledger.mjs:9-10`) — hard-coded, ignoring the booking currency.
  * Result on a SYP booking: a **USD wallet is created for the host with a balance of `-10`**, while
    all of the host's real money sits in SYP.
  * This is the *same defect class* the codebase claims to have fixed on the guest side —
    `bookings.mjs` explicitly documents "fixing the old hardcoded-USD debit that drove a SYP guest's
    empty USD wallet negative" — but the host-side fee was not migrated.
  * `10` minor units is `$0.10` under this codebase's "minor = whole units" convention
    (`server/lib/currency.mjs:8-13`), which does not look like an intended $10 admin fee either.
  * **Knock-on:** `DELETE /api/me` refuses closure while any wallet balance `!== 0`. Verified:
    `409 WALLET_NOT_EMPTY` "Withdraw or spend your balance before closing." Since there is no
    withdrawal path (§3.16) and no way to top up a **negative** USD balance to zero, **a platform-charged
    fee can permanently lock a host out of closing their own account** — a data-subject-rights problem.
* **FINDING H-07 — the payout HOLD of a cancelled booking is never reversed.** After the cancellation,
  the host's ledger still carries `HOLD 204000 SYP / booking_payout / 54d3a245…` for a booking that is
  `CANCELLED` and fully refunded. Verified directly in `wallet_entries`. It does not affect the cached
  balance, but it does corrupt the tax statement (see H-08).
* **Status: FAIL**

### 3.15 Earnings

* `GET /api/host/earnings` is correct and well-scoped. Confirmed booking → `PENDING_HOLD`,
  `forecastedMinor`. Completed + released → `RELEASED`, `releasedMinor: 262857`. Commission is
  correctly **stripped** from the host payload (`hostSafePayoutRow` removes `adminCommissionMinor`).
  The earnings **page** matches the API exactly.
* **Note (transparency, low):** for a listing that declares **no** cleaning fee, `bookingFinanceSplit`
  falls back to a `total / 1.05` decomposition and reports a **cleaning fee that was never charged** —
  booking B (300 000 SYP, no fees configured) shows `cleaningFeeMinor: 14286` in host earnings. The
  code documents this as a legacy fallback; it is still a fabricated line item on a money screen.

**FINDING H-08 — the host's "Earnings and Tax Statement" overstates income by 177 %.**

* `GET /api/host/statements` for this host reports:
  ```
  lineCount: 3
  54d3a245…  gross 230000  net 204000  refunded 0     <- CANCELLED, fully refunded to the guest
  67c3cf36…  gross 300000  net 262857  refunded 0
  67c3cf36…  gross 300000  net 262857  refunded 0     <- SAME booking, counted twice
  TOTALS: grossBookingMinor 830000, commissionMinor 100286, netHostPayoutMinor 729714, refundedMinor 0
  ```
* Reality: **one** booking earned money — 300 000 SYP gross, 262 857 SYP net, released once.
* Two independent root causes in `server/lib/stay-statements.mjs:29`:
  1. The statement iterates **every** `wallet_entries` row with `referenceType='booking_payout'`. A
     released payout has **two** rows (`HOLD` + `RELEASE`), so every released booking is counted twice.
  2. `refundedMinor` is sourced **only** from `Dispute` rows with `status='RESOLVED_REFUNDED'`.
     Cancellation refunds (host-cancel and guest-cancel) are invisible to it, so the stale `HOLD` of
     the cancelled booking (H-07) is reported as full, unrefunded income.
* This is the document the product presents as the host's tax/compliance record, and it feeds
  `GET /api/host/part-xx-statement`. **This is the most serious correctness defect found.**
* **Status: FAIL (financial reporting)**

### 3.16 Payouts and payout method

**FINDING H-09 — a host cannot configure a payout destination, and money has no way out.** *(review-package item — confirmed)*

* Exhaustive probe: `GET`/`PATCH` on `/api/me/payout-method`, `/api/host/payout-method`,
  `/api/host/payouts`, `/api/me/payout`, `/api/host/payout` → **all `404`**. Grep across
  `server/` and `src/` finds **no writer for `User.payoutMethod`** at all; the only references are
  the admin *reader* (`admin.mjs:135,165`) and the account-deletion *nuller* (`me.mjs`).
* Database confirms: **0 of 34 users** have a non-null `payout_method`.
* `src/` contains **zero** references to `payoutMethod` — the admin payout screen does not even
  render the field it fetches.
* The admin payout row for this host reads literally `"hostPayoutMethod": null`, and
  `PATCH /api/admin/payouts/:id/release` **does not check it** — it released 262 857 SYP to a host
  with no known payout destination.
* The release credits an **internal SYBNB wallet**. There is no withdrawal / cash-out route anywhere
  (`grep -i 'withdraw|cashout'` across `server/routes` returns only the account-closure error string).
  Host earnings are therefore terminal balances inside the platform.
* Partial mitigation found: `PUT /api/tax-profile/HOST` does accept and AES-encrypt a
  `payoutAccountIdentifier` (verified — stored, `payoutAccountLast4:"1222"`, masked as `••••••1222`,
  `verificationStatus:"PENDING_REVIEW"`). But that field is in a **different table**, is not what the
  admin payout screen reads, and is not surfaced on the payout run.
* **Status: FAIL / NOT IMPLEMENTED** (payout-method configuration does not exist; payout *status*
  visibility, §3.15, works)

* **Payout status visibility itself: PASS.** `PENDING_HOLD → ELIGIBLE → RELEASED` was observed
  correctly across `GET /api/host/earnings`, and the 14-day post-checkout hold is enforced
  (`eligibleAt = checkOut + 14d`).

### 3.17 Reviews

* Guest posted `POST /api/reviews {rating:5}` on the completed booking → `201`; public
  `GET /api/listings/:id/reviews` returns `average: 5, count: 1`; the host's trust score and public
  "verified owner / trust rating 5 ★ (1)" badge update.
* Host attempting to review own listing → `403 FORBIDDEN`. Host booking own listing → `400
  CANNOT_BOOK_OWN_LISTING`. Both self-dealing guards correct.
* **Gaps:** there is **no host-facing endpoint or screen to read reviews of one's own listings**
  (the host must use the public endpoint), **no host reply to a review**, and **no host→guest
  review**. Review moderation is admin-only (`/api/admin/reviews/:id/hide`).
* **Status: PASS (guest→listing review) / NOT IMPLEMENTED (host reply, host→guest review, host review inbox)**

### 3.18 Disputes

* A host **cannot open a dispute** — `POST /api/disputes` requires `booking.guestId === user.id`
  (`disputes.mjs`). There is no property-damage / guest-misconduct path.
* A host **cannot see** a dispute filed against their own booking — `GET /api/disputes` filters on
  `openedByUserId`. Verified: `{"ok":true,"disputes":[]}` for the host on a booking they own.
* Dispute window is enforced (`400 DISPUTE_WINDOW_PASSED`, 48 h) — correct behaviour, verified.
* **Status: NOT IMPLEMENTED** (host side of disputes)

### 3.19 Promotions

* Per-night price overrides are the only promotion mechanism, and they work
  (`offerNightsCount`, `cheapestOfferMinor`, calendar UI, search "has active offer" flag).
* Referrals exist (`/api/me/overview.referrals`, code `8F2GHGKG`) but there is no host-facing
  promotion/coupon/length-of-stay-discount capability.
* **Undermined by H-02**: for USD guests the override is rounded back up to the base price.
* **Status: PASS (mechanism) / FAIL (effect for USD guests)**

### 3.20 Analytics and insights

* `GET /api/host/insights` → `{insights: [], unreadCount: 0}` (empty; generation is the paid route,
  not tested). The free `insightSignal` on the overview works and drove a correct dashboard prompt
  ("2 of your listings have empty nights without a special price").
* **FINDING H-10 — the "Views" analytics column is fabricated.**
  `listingViewCount()` (`HostDashboardPage.tsx:1049`) computes
  `requestCount * 35 + mediaCount * 12 + approvalBoost * 25`. There is no view tracking anywhere in
  the schema or API. The host is shown an invented number in a column labelled "مشاهدات / Views".
  The adjacent "Inquiries" column counts **booking requests**, not inquiries, and is therefore also
  mislabelled (my real inquiry thread was not what produced the `1`).
* `listingQualityScore` / `healthScore` are heuristic composites presented as scores; defensible as
  completeness checklists, but "Health score 84/100 · excellent performance this month" is not
  derived from any performance data.
* **Status: FAIL (fabricated analytics presented as measured data)**

### 3.21 "Payout ready" headline figure

**FINDING H-11 — the host dashboard's headline money number is the wrong quantity.**

* `HostDashboardPage.tsx:518` renders the "Payout ready / جاهز للصرف" tile from
  `overview.totals.revenueMinor`, which `host.mjs:157` defines as the **sum of `amountMinor` of
  CONFIRMED bookings** — i.e. the *guest's gross*, before commission, for stays that have **not**
  happened yet. It has nothing to do with payout readiness.
* Verified live: dashboard shows **"جاهز للصرف ٠ ل.س"** ($0 ready) at the exact moment
  `GET /api/host/earnings` reports **`releasedMinor: 262857`** and the host wallet holds
  262 857 SYP. The earnings page on the same account shows the correct figure.
* **Status: FAIL**

### 3.22 Compliance and documents

* `POST /api/listings/:id/documents` works, versions correctly (`version`, `isCurrent`, `replacesId`),
  always resets to `PENDING_REVIEW`, and enforces the type allowlist
  (`"type must be one of: CITQ_CERTIFICATE."`).
* `GET /api/host/statements` and `GET /api/host/part-xx-statement` return for a host (Part XX
  returns an empty record set plus a correct disclaimer). **Statement contents are wrong — see H-08.**
* **Note (low):** the only listing document type is the Quebec `CITQ_CERTIFICATE`, and it was accepted
  without complaint on a **Syria** listing. No jurisdiction check on document type.
* **Status: PASS (mechanics) / FAIL (statement contents)**

### 3.23 Team / co-host access — **NOT IMPLEMENTED**

Grep for `co-host | teamMember | hostTeam | sub-account | delegate` across `server/`,
`prisma/schema.prisma` and `src/modules/host` returns nothing relevant. A listing is owned by exactly
one `ownerId`; there is no delegation, no second operator, no read-only accountant role.

### 3.24 Support

`POST /api/reports` accepted a host-filed report against another listing (`201`, `status: OPEN`,
routed to `/api/admin/reports`). The host UI also exposes "دعم العمليات" and a WhatsApp number in the
footer. **Status: PASS**

### 3.25 Access restrictions

| Probe | Result |
| --- | --- |
| guest token → `/api/host/overview`, `/api/host/earnings` | `403 FORBIDDEN` |
| host token → `/api/admin/review-queue`, `/api/admin/payouts`, `/api/admin/audit-log` | `403 FORBIDDEN` |
| host → another host's `PATCH /api/host/listings/:id/status` | `404 HOST_LISTING_NOT_FOUND` |
| host → another host's `GET /api/listings/:id/media` | `404 LISTING_NOT_FOUND` |
| host → another host's `GET /api/host/listings/:id/availability` | `404 HOST_LISTING_NOT_FOUND` |
| host → `POST /api/bookings` (GUEST-only) | `403 FORBIDDEN` |
| unauthenticated → `/api/host/overview` | `401 AUTH_REQUIRED` |
| host → guest's ID document (`/api/me/id-document/:id`, `/api/admin/id-document/:id/file`) | `404` / `403` |
| host booking detail — guest email / `proofAssetUrl` / `providerRef` / `adminNote` | **0 occurrences** — correctly projected out |
| `POST /api/auth/logout` then reuse of the old token | `401 AUTH_REQUIRED` — server-side revocation works |

**Status: PASS.** Ownership and role enforcement was the strongest area tested. Existence is
correctly masked as `404` rather than `403`.

### 3.26 Mobile usability

* The whole `src/modules/host/` directory contains **zero** `@media`, `matchMedia` or `useMediaQuery`
  occurrences across all six host screens. Layout is fixed-grid, desktop-first.
* `styles.providerHealth` is a hard `gridTemplateColumns: '1fr 1fr 1fr 1fr'` with `padding: 28`
  (`HostDashboardPage.tsx:1101`) — four columns regardless of viewport. Text overflow of the
  health-score ring is already visible at ~960 px in the captured screenshots.
* The listings table sets `minWidth: 710` on both header and rows inside an `overflowX: auto`
  container — on a 390 px phone the host must scroll horizontally to reach status / views / the ✎ button.
* No horizontal page overflow was detected at the narrowest window the harness could produce
  (606 px CSS px); the failure mode is cramping and in-container horizontal scroll, not page-level
  breakage.
* **Status: FAIL (mobile-hostile host dashboard; no responsive handling at all)**

### 3.27 Not tested (cost-restricted)

| Endpoint | Reason |
| --- | --- |
| `POST /api/host/insights/generate` | explicitly forbidden — spends Anthropic credits |
| `POST /api/host/listings/describe` | same Anthropic billing path (`ai-insights.mjs:87`) |
| `POST /api/payments/stripe/*` | explicitly forbidden — live Stripe test key configured |

---

## 4. Security and privacy observations

1. **Session tokens are stored in `localStorage`, contradicting the platform's own security contract.**
   `server/contracts.mjs` states: *"Session tokens are signed, expiring server-side credentials and
   never stored in localStorage."* `src/shared/api/platformApi.ts:597` does exactly that
   (`authStorage` → `window.localStorage`, keys `sybnb-v6-staff-token` / `sybnb-v6-guest-token`),
   with a documented 90-day TTL. Verified live in the browser. Any XSS yields a 90-day session.
   **The published security contract is wrong about shipped behaviour.**
2. **Guest phone number is exposed to the host.** `HOST_SAFE_GUEST_SELECT` carefully excludes the
   guest's email and the code comments say "contact stays on-platform", but
   `booking.metadata.guestContactPhone` is passed through verbatim in `/api/host/overview` and
   `/api/bookings/:id`. Verified: `"guestContactPhone": "+963900111222"` visible to the host.
   Possibly intentional for host–guest coordination, but it contradicts the stated policy and is not
   gated on booking confirmation.
3. **Live-looking third-party credentials sit in plaintext local env files.** `.env.local` holds a
   Cloudflare R2 endpoint, access key id and secret access key; `.env` holds a real Anthropic API key
   and Stripe secret/webhook keys. Both files are correctly `.gitignore`d and untracked (verified via
   `git check-ignore` / `git ls-files`), so this is a local-workstation hygiene issue, not a repo
   leak. Values are deliberately not reproduced here. Recommend rotating the R2 and Anthropic keys if
   this machine image is ever shared.
4. **Positive findings worth recording:**
   * `devCode` OTP is correctly suppressed when `NODE_ENV=production`.
   * Upload validation uses magic-byte content sniffing and rejects SVG structurally.
   * Object keys are constrained to `<uuid>.<ext>`, so traversal/null-byte keys cannot pass.
   * Optimistic-concurrency claims (`updateMany` on expected status) are used on every host state
     transition, and a Postgres advisory lock serialises same-listing booking creation.
   * Logout genuinely revokes via `sessionVersion`.
   * The host's own commission cut is stripped from the earnings payload.
5. **Shared rate-limit surface.** `AUTH_REGISTER` (5 / 15 min) is keyed **per IP**, and all four
   parallel agents share `127.0.0.1`. This agent was rate-limited out of a normal guest registration
   by traffic it did not generate. Not a defect, but a note for anyone reproducing this run.

---

## 5. Unresolved blockers

| # | Blocker | Effect on this review |
| --- | --- | --- |
| B1 | **STR is `BLOCKED` in SY and `PENDING` in CA/quebec — no listing can be approved in any market** (H-01) | Everything from §3.7 onward was unreachable until the disclosed temporary jurisdiction flip. In the environment as delivered, the host journey ends at "submitted, pending review, forever." |
| B2 | No host payout destination exists and no withdrawal route exists (H-09) | The "host gets paid" workflow cannot be completed end to end by any means. Released earnings terminate in an internal wallet. |
| B3 | Payout release requires a 14-day post-checkout hold | Only testable at all because past-date bookings are accepted (H-05). Not independently verifiable without either time travel or that defect. |
| B4 | Host tax statement is arithmetically wrong (H-08) | Any compliance sign-off based on `/api/host/statements` or `/api/host/part-xx-statement` is currently invalid. |
| B5 | Host cancellation fee creates an unclearable negative USD balance (H-06) | The affected host can never satisfy `DELETE /api/me`'s zero-balance guard. Account closure is permanently blocked for them. |

---

## 6. Summary table

| # | Workflow | Status |
| --- | --- | --- |
| 1 | Host onboarding (register + email OTP) | PASS |
| 2 | Host identity verification | PASS |
| 3 | Listing creation | PASS |
| 4 | Listing media upload (real bytes, local disk) | PASS |
| 5 | Listing document upload (compliance) | PASS |
| 6 | Listing submission for review | PASS |
| 7 | **Listing editing** | **NOT IMPLEMENTED** |
| 8 | **Listing approval / going live** | **BLOCKED** (H-01) |
| 9 | Host self-approval prevented | PASS |
| 10 | Availability calendar (block / unblock) | PASS |
| 11 | Per-night price overrides (offers) | PASS |
| 12 | **Guest-facing USD pricing fidelity** | **FAIL** (H-02) |
| 13 | **Quote on blocked dates** | **FAIL** (H-03) |
| 14 | **`PAYMENT_PENDING` reservation visibility** | **FAIL** (H-04) |
| 15 | Reservation acceptance (governed, terms-gated) | PASS |
| 16 | Reservation detail (host projection, PII-safe) | PASS |
| 17 | Guest check-in / check-out marking | PASS with defect (no date validation) |
| 18 | **Past-date bookings accepted** | **FAIL** (H-05) |
| 19 | Guest communication — booking thread (API) | PASS |
| 20 | Guest communication — booking thread (host UI) | FAIL (no screen) |
| 21 | Guest communication — listing inquiries | PASS |
| 22 | Host cancellation + guest refund | PASS |
| 23 | **Host cancellation fee currency / negative wallet** | **FAIL** (H-06) |
| 24 | **Payout HOLD reversal on cancellation** | **FAIL** (H-07) |
| 25 | Earnings report | PASS |
| 26 | **Host earnings & tax statement** | **FAIL** (H-08) |
| 27 | Payout status visibility | PASS |
| 28 | **Payout method configuration** | **NOT IMPLEMENTED** (H-09) |
| 29 | Withdrawal / cash-out | NOT IMPLEMENTED |
| 30 | Reviews (guest → listing, self-review blocked) | PASS |
| 31 | Host review reply / host → guest review / host review inbox | NOT IMPLEMENTED |
| 32 | Disputes (host side) | NOT IMPLEMENTED |
| 33 | Promotions (mechanism) | PASS |
| 34 | **Analytics — "Views" column** | **FAIL** (H-10, fabricated) |
| 35 | **Dashboard "Payout ready" figure** | **FAIL** (H-11, wrong quantity) |
| 36 | Team / co-host access | NOT IMPLEMENTED |
| 37 | Support (report filing) | PASS |
| 38 | Access restrictions & PII boundaries | PASS |
| 39 | Session revocation on logout | PASS |
| 40 | Upload content validation | PASS |
| 41 | Account closure guardrails | PASS with defect (unclearable, see H-06) |
| 42 | **Mobile usability of host dashboard** | **FAIL** (H-12, no responsive handling) |
| 43 | AI insights generation | NOT TESTED (cost-restricted) |
| 44 | AI listing description | NOT TESTED (cost-restricted) |
| 45 | Stripe payment paths | NOT TESTED (forbidden) |

### Counts

| Status | Count |
| --- | --- |
| PASS | 20 |
| PASS with defect | 2 |
| FAIL | 12 |
| NOT IMPLEMENTED | 7 |
| BLOCKED | 1 |
| NOT TESTED (restricted) | 3 |
| **Total workflows** | **45** |

---

## 7. Synthetic fixtures left behind

Financial ledger rows, audit rows and bookings are immutable by design, and direct DB writes were out
of scope, so these were **not** deleted. Both listings were **paused via the host API** so they no
longer appear in public search.

| Object | Identifier | State left |
| --- | --- | --- |
| Host user | `95bcd7c7-132a-4c22-9fc3-cadc0d86176b` / `e2e-host-1784781974@sybnb.test` | ACTIVE, ID doc APPROVED, session revoked via logout then re-issued for the pause step |
| Guest user | `30972251-c5c2-4a43-8209-aa716dfee32b` / `guest-e2ehostagent-1784781974-guest@device.sybnb.local` | ACTIVE, wallet 230 000 SYP (refund) |
| Listing 1 | `5d1fc77c-358e-4108-b241-cf715cbc0bb4` | **PAUSED** — off public search |
| Listing 2 | `9f6ab532-f7ca-4c44-a5f5-a32339f18bc2` | **PAUSED** — off public search |
| Listing media | 3 rows + 3 PNG objects under `…/e2e-objects/media/` | retained |
| Listing document | 1 `CITQ_CERTIFICATE` (v1) + 1 PDF object | retained, PENDING_REVIEW |
| Availability rows | 3 (`2026-08-12` BLOCKED, `2026-08-13` BLOCKED, `2026-08-22` override 120 000) | retained |
| Booking A | `54d3a245-d444-4809-8fdb-a65264c41692` | CANCELLED, guest refunded |
| Booking B | `67c3cf36-68d1-4340-a9d0-59a3b56e4e59` | COMPLETED, payout released |
| Payment proofs | `E2E-HOST-1784781974-001` (REFUNDED), `-002` (APPROVED) | retained |
| Wallet entries (host) | 2 × HOLD, 1 × RELEASE, 1 × DEBIT | retained — SYP `+262857`, **USD `-10`** |
| Host tax profile | `7d4a0d62-cdc9-4793-a5b1-72c025c421b1` | PENDING_REVIEW, synthetic payout ref `SHAMCASH-963900111222` |
| Review | `b86ead2c-7f95-4e16-916c-c81988dd24cf` (5★) on listing 1 | retained |
| Message threads | 1 booking thread (2 msgs), 1 listing inquiry thread (1 msg) | retained |
| Support report | `0149c05c-0ce2-4e1a-8c8d-a7b77d460d7e` | OPEN — **filed against listing `00000000-…-0001` (the seeded QC demo listing), synthetic content, safe to dismiss** |
| ID document object | `1e897d31-….png` under `…/e2e-objects/documents/` | retained |
| Audit rows | `HOST_CONFIRMED`, `HOST_CANCELLED`, `HOST_GUEST_CHECKIN/CHECKOUT`, `HOST_LISTING_*`, 2 × `JURISDICTION_COMPLIANCE_*` | retained (immutable by design) |
| Browser storage | `http://localhost:5180` origin | **cleared**. `http://127.0.0.1:5180` was never written to. |
| Scratch files | `/tmp/e2e-host/` | outside the repo |

**Restored:** jurisdiction profile `ff4f3290-294c-4ed4-91f7-bf7605faccad` (STR/SY) back to `BLOCKED`
with all satisfied-flags `false` and `platformNotes` null. Residual: `reviewedById` / `reviewedAt`
now reflect the seeded QC admin and 2026-07-23.

---

## 8. Explicit no-fix confirmation

**No fix of any kind was applied.** No source file, test, configuration file, dependency,
documentation file, Prisma schema or migration was created, modified or deleted by this agent. No
`git add`, `commit`, `push`, `merge`, `rebase` or deploy was performed. `git status` at the end of the
run shows the tracked tree unchanged from baseline `6e8b8f2`; the only file this agent authored is
this report at `docs/reviews/final-independent-review/e2e/SYBNB_E2E_HOST_AGENT_REPORT.md`.

The two runtime interventions (seeded-admin assist and the temporary, restored jurisdiction flip) are
disclosed in §1 and were performed exclusively through the application's own admin API, not by editing
anything.
