# AGENT 2 — Engineering, Systems & Architecture Review (Independent)

**Reviewer role:** Principal Software and Systems Architect
**Review type:** Independent, read-only. No source, test, config, or dependency file was modified.
**Date of review:** 2026-07-22

---

## 1. Baseline and scope

**Baseline reviewed:** commit `8a4eba7` (`8a4eba79e342c1d4386905514626ff2fd866ea89`) on branch
`claude/intelligent-kilby-5ff258`.

`git status` at review start showed a clean tracked tree; untracked entries present were `.claude/`,
`vite.uicheck.config.ts`, and five untracked `docs/product/SYBNB_*.md` files. Nothing tracked was
modified by this review. The only file written is this report.

**Referenced ancestors:** `79a3bbb` (storage implementation), `6b92b07` (storage documentation),
`3f7d08e` (C5 verification states), `507d237` (C2 photo upload).

**Scope covered:** domain ownership and source-of-truth boundaries, route ownership, API boundaries,
module isolation, data lifecycle, state machines, error handling, storage architecture, database
dependencies, configuration, environment separation, test architecture, scalability, reliability,
maintainability, production failure modes, deployment assumptions, local-filesystem dependencies,
division coupling, duplicate implementations, unfinished migrations, technical debt, and observability
gaps.

**Explicitly out of scope:** visual UX redesign; the parallel reviews
`AGENT_1_PRODUCT_UX_ARCHITECTURE_REVIEW.md` and `AGENT_3_GOVERNANCE_SECURITY_COMPLIANCE_REVIEW.md`
(both present in this directory at review time and deliberately **not opened**, to keep this pass
uninfluenced).

---

## 2. Method

Every finding below carries the eight mandated fields:

1. **Baseline** — all findings are against `8a4eba7`.
2. **Inspected** — the exact files read.
3. **CONFIRMED FACT vs INFERENCE** — a claim is marked CONFIRMED FACT only where I read the code that
   establishes it. Anything requiring runtime behaviour I could not execute (no deploy, no
   provider access, no full-suite rerun) is marked INFERENCE and its assumption is named.
4. **Evidence** — file path plus symbol or line reference.
5. **Severity** — Critical / High / Medium / Low.
6. **Launch impact** — blocks internal testing / blocks closed beta / blocks public production / does
   not block launch.
7. **Narrow correction** — the smallest change that closes the finding.
8. **Requirement class** — code / documentation / governance / infrastructure / owner input.

Verification technique: direct file reads, exhaustive `grep` for symbol producers *and* consumers
(a written-but-never-read state variable is only provable by finding zero readers), `git show` against
`79a3bbb~1` to establish what the storage migration changed, and static counting of tests and route
literals. **No test suite was executed** and **no network call was made**. Documented claims were
treated as hypotheses to be checked against code, not as evidence.

---

## 3. Inspected inventory

### Deployment / configuration
`vercel.json` · `package.json` · `.vercel/project.json` · `.env.production.example` · `.env.example` ·
`.env.test.example` · `.env` and `.env.test` (key names only) · `.gitignore` ·
`.github/workflows/sybnb-v6-ci.yml` · `vitest.config.ts` · `vitest.unit.config.ts` ·
`vite-csp-plugin.mjs` · `index.html` · `prisma/schema.prisma` (generator/datasource/`User`)

### Server entry and cross-cutting
`api/index.mjs` · `server/index.mjs` · `server/contracts.mjs` · `server/lib/env.mjs` ·
`server/lib/prisma.mjs` · `server/lib/responses.mjs` · `server/lib/security-headers.mjs` ·
`server/lib/allowed-origins.mjs` · `server/lib/compliance-feature-flags.mjs`

### Storage subsystem (frozen at `79a3bbb`)
`server/lib/object-storage.mjs` · `content-signature.mjs` · `private-document-download.mjs` ·
`document-access-audit.mjs` · `listing-media-storage.mjs` · `id-document-storage.mjs` ·
`listing-document-storage.mjs` · `thread-document-storage.mjs` · `driver-document-storage.mjs` ·
`quebec-document-storage.mjs`; plus `git show 79a3bbb~1:` of the pre-migration modules.

### Domain / lifecycle
`server/lib/booking-lifecycle.mjs` · `listing-lifecycle.mjs` · `finance-ledger.mjs` ·
`server/routes/bookings.mjs` · `listings.mjs` · `payments.mjs` · `admin.mjs` · `auth.mjs` · `me.mjs` ·
`wallet.mjs` (route table) · `host.mjs` (references)

### Frontend
`src/app/App.tsx` · `src/shared/api/platformApi.ts` ·
`src/modules/listings/ListingDetailPage.tsx` · `src/modules/bookings/BookingReviewPage.tsx` ·
`src/modules/bookings/BookingDetailPage.tsx` (payment routing) ·
`src/modules/payments/SyrianLocalWalletPaymentPage.tsx` · `src/modules/search/DateRangePicker.tsx` ·
`src/modules/host/hostVerificationModel.ts` · `src/modules/host/HostEarningsPage.tsx` ·
`src/modules/seller/listingPhotos.ts` · `src/backend/contracts.ts`

### Scripts and tests
`scripts/seed-demo-accounts.mjs` · `test/support/setup.env.mjs` · `test/support/setup.mjs` ·
directory listings of `test/unit`, `test/api`, `test/security`, `test/browser`

### Documentation (checked *against* code, not trusted)
`docs/architecture/ARCHITECTURE_FREEZE_REVIEW_2026.md` ·
`docs/architecture/ADR/ADR-0010-PERSISTENT_OBJECT_STORAGE.md` (header/§ scan) ·
`docs/engineering/TECHNICAL_DEBT_REGISTER.md` · `docs/product/STR_LAUNCH_ROADMAP_v1.1.md`

---

## 4. Findings

Ordered by severity, then by blast radius.

---

### CRITICAL

---

#### A2-C01 — `/api/auth/checkout-guest` is an unauthenticated, un-rate-limited account factory

**Baseline:** `8a4eba7`.

**Inspected:** `server/routes/auth.mjs:196-244`; `server/index.mjs` `RATE_LIMIT_RULES` (lines 48-83);
`src/shared/api/platformApi.ts` `ensurePrototypeGuestSession` (2898-2911), `getOrCreateGuestDeviceId`
(2887-2896).

**CONFIRMED FACT.** `POST /api/auth/checkout-guest` requires no authentication. It accepts a
client-generated `deviceId` (`/^[a-zA-Z0-9-]{8,100}$/`), derives
`guest-${deviceId}@device.sybnb.local`, and on first sight of a device id creates — in one
transaction — a `User` row, a `UserRole` row, a `Wallet` row, and a unique referral code, then returns
`createSessionToken(user)`. There is no CAPTCHA, no proof of work, no email verification, and no
device attestation.

**CONFIRMED FACT.** The central rate-limit table in `server/index.mjs` contains no rule matching
`/api/auth/checkout-guest`. The table covers `AUTH_LOGIN`, `AUTH_REGISTER`, `AUTH_EMAIL_CODE_SEND`,
`AUTH_EMAIL_CODE_VERIFY`, `AUTH_PHONE_CODE_SEND`, `AUTH_PHONE_CODE_VERIFY`, `PUBLIC_SEARCH`,
`MESSAGING`, `BOOKING_CREATE`, `PAYMENT_PROOF`, `ADMIN_DECISION`, `DOCUMENT_ACCESS`, `GEOCODING`,
`DRIVER_STATUS`, `BOOKING_LOOKUP` — and nothing else. `matchRateLimitRule()` returns undefined for
this path, so the request is dispatched unthrottled.

**CONFIRMED FACT.** This is a strictly cheaper path to a real, role-bearing, session-token-holding
account than `POST /api/auth/register`, which *is* capped at 5 per 15 minutes per IP and (per the
roadmap and `server/lib/email-verification.mjs` integration) requires a verified email code for GUEST.
The account produced here carries the `GUEST` role, which is exactly what `POST /api/bookings`
requires (`requireAuth(context, ['GUEST'])`, `server/routes/bookings.mjs:470`).

**INFERENCE** (assumption: a caller can issue HTTP requests at ordinary internet rates): unbounded
`User`/`Wallet`/`UserRole` growth against the Neon Postgres instance, and an unbounded supply of valid
7-day bearer tokens. Because `BOOKING_CREATE` is keyed `byUser: true`, a fresh device id also resets
the per-user booking quota — which is what makes A2-C02 exploitable at scale.

**Severity:** Critical.
**Launch impact:** blocks public production; blocks closed beta if the beta is open-registration.

**Narrow correction:** add one rule to `RATE_LIMIT_RULES` in `server/index.mjs`, e.g.
`{ name: 'AUTH_CHECKOUT_GUEST', method: 'POST', pattern: /^\/api\/auth\/checkout-guest$/, max: 5, windowMs: 15*60*1000, byUser: false, failMode: 'closed' }`
— same shape and same fail-closed bucket as the other pre-authentication auth rules. This is a
one-line, in-pattern change.

**Required:** code (one line) + documentation (add the rule to
`docs/security/SYBNB_V6_RATE_LIMIT_POLICY.md`, which the table's own comment names as the reviewable
policy record).

---

#### A2-C02 — `PAYMENT_PENDING` bookings never expire, and there is no scheduler; a listing calendar can be blocked permanently

**Baseline:** `8a4eba7`.

**Inspected:** `server/routes/bookings.mjs:537-635` (create transaction), `:549-570` (overlap check);
`server/routes/listings.mjs:396-427` (availability endpoint); `server/lib/booking-lifecycle.mjs` (whole
file); `server/lib/listing-lifecycle.mjs:37-42`; `vercel.json`; grep for `PAYMENT_PENDING` across
`server/`.

**CONFIRMED FACT.** `POST /api/bookings` creates the booking with `status: 'PAYMENT_PENDING'`
(`bookings.mjs:620`) *before* any payment is attempted.

**CONFIRMED FACT.** `PAYMENT_PENDING` participates in the exclusivity check
(`status: { in: ['REQUESTED','PAYMENT_PENDING','CONFIRMED'] }`, `bookings.mjs:553`) and is reported as
an occupied `bookedRanges` entry by the public availability endpoint (`listings.mjs:400`).

**CONFIRMED FACT.** No code path transitions `PAYMENT_PENDING` to any terminal state on a timeout.
`completeExpiredBookings()` (`booking-lifecycle.mjs:9-20`) only moves `CONFIRMED → COMPLETED`. Every
other `PAYMENT_PENDING` reference is a *read* guard (`payments.mjs:206,283,561`,
`finance-ledger.mjs:221`, `host.mjs:102`, `me.mjs:10`). Exhaustive grep found no expiry.

**CONFIRMED FACT.** There is no scheduler of any kind. `vercel.json` has no `crons` key. The codebase
says so itself: *"Called opportunistically from read paths … instead of a cron job, since there is no
scheduler in this deployment"* (`booking-lifecycle.mjs:7-8`) and *"run on read instead of a cron"*
(`listing-lifecycle.mjs:37`).

**Consequences, CONFIRMED from the code paths above:**
- Every abandoned checkout permanently removes those nights from the listing's inventory. Nothing —
  no admin action, no host action — is exposed to release them.
- Combined with **A2-C01**, an unauthenticated actor can mint a fresh guest per booking and saturate
  every approved listing's calendar indefinitely at negligible cost. `BOOKING_CREATE`'s
  `byUser: true` keying provides no protection because the user is free.
- Independently: because payout eligibility is derived from `COMPLETED` status
  (`isPayoutEligible`, `booking-lifecycle.mjs:27-32`) and `COMPLETED` is only reached when a host,
  guest, or admin happens to load a page that calls `completeExpiredBookings()`, a host who does not
  log in never has their 14-day payout clock start.

**Severity:** Critical.
**Launch impact:** blocks closed beta (inventory correctness), blocks public production.

**Narrow correction:** two independent, small changes.
(a) Bound the hold: add `expiresAt` (or reuse `updatedAt`) to the overlap predicate so a
`PAYMENT_PENDING` booking older than N minutes stops occupying dates, and add an
`expirePendingBookings()` sweep in `booking-lifecycle.mjs` called from the same opportunistic read
paths that already call `completeExpiredBookings()`. This matches the established pattern exactly.
(b) Add a Vercel Cron entry invoking a single maintenance route that runs the three existing sweeps
(`completeExpiredBookings`, `expireOldListings`, the wallet gift sweep) so lifecycle no longer depends
on traffic.

**Required:** code + infrastructure (one `crons` entry in `vercel.json`) + owner input on the hold
window.

---

#### A2-C03 — `.env.production.example` omits every variable `validateProductionConfig()` requires for storage and rate limiting; a deployment built from the template cannot boot

**Baseline:** `8a4eba7`.

**Inspected:** `.env.production.example` (whole file); `server/lib/env.mjs:30-100`;
`server/lib/object-storage.mjs:72-116`; `api/index.mjs:12-15`; `.env.example`; `.env.test.example`;
`test/unit/env-production-config.test.mjs` (variable list only).

**CONFIRMED FACT.** `validateProductionConfig()` hard-fails when `UPSTASH_REDIS_REST_URL` or
`UPSTASH_REDIS_REST_TOKEN` is unset (`env.mjs:54-59`), and delegates to `validateStorageConfig({...process.env, NODE_ENV:'production'})`
(`env.mjs:74-81`), which requires `STORAGE_DRIVER === 's3'` plus `STORAGE_S3_ENDPOINT`,
`STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`, `STORAGE_BUCKET_MEDIA`,
`STORAGE_BUCKET_DOCUMENTS` (`object-storage.mjs:85-101`).

**CONFIRMED FACT.** `grep -n "STORAGE_\|UPSTASH\|REDIS" .env.production.example` returns **nothing**.
Nine required-in-production variables are absent from the file whose own header states *"Copy the
values into the Vercel project's Environment Variables (Production scope)"* and which enumerates
`REQUIRED (app will not run correctly without these)`. `.env.example` carries the two Upstash keys
(lines 55-56) but no `STORAGE_*`. `.env.test.example` carries neither.

**CONFIRMED FACT.** `api/index.mjs:13-15` calls `validateProductionConfig()` at module scope when
`NODE_ENV === 'production'`. A throw there occurs during cold start, before `handler` is exported.

**INFERENCE** (assumption: Vercel surfaces a module-scope throw in a serverless entry as a function
invocation failure): an operator who follows the production template verbatim gets a 500 on *every*
`/api/*` request, with the diagnostic only in function logs. The failure is loud by design — the
defect is that the template guarantees it.

**Additional CONFIRMED FACT (documentation drift).** `.env.production.example`'s "One-time DB setup"
block instructs `DEMO_ACCOUNT_PASSWORD=... node scripts/seed-demo-accounts.mjs` at deploy time. See
**A2-C07** for what that script actually creates.

**Severity:** Critical.
**Launch impact:** blocks internal testing of any deployed environment; blocks closed beta; blocks
public production.

**Narrow correction:** append a `REQUIRED` block to `.env.production.example` containing
`STORAGE_DRIVER="s3"`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION`, `STORAGE_S3_ACCESS_KEY_ID`,
`STORAGE_S3_SECRET_ACCESS_KEY`, `STORAGE_BUCKET_MEDIA`, `STORAGE_BUCKET_DOCUMENTS`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — with placeholder values, matching the file's
existing convention. Optionally add a CI assertion that every key named in `validateProductionConfig()`
appears in `.env.production.example`, so the two cannot diverge again.

**Required:** documentation (the template) — no code change needed. A CI guard is code and optional.

---

#### A2-C04 — C4 confirmed and broader than recorded: the listing page has no date selection at all, and the fetched availability set is dead state

**Baseline:** `8a4eba7`.

**Inspected:** `src/modules/listings/ListingDetailPage.tsx` (whole file, with exhaustive grep for
`disabledDates`, `setDateRange`, `dateRange`, `DateRangePicker`);
`src/modules/search/DateRangePicker.tsx:15,106,124-137,188`;
`src/modules/bookings/BookingReviewPage.tsx:162-168,278-279`;
`src/modules/search/UnifiedSearchBar.tsx:64,519`; `server/routes/bookings.mjs:537-573`;
`server/routes/listings.mjs:375-427`.

**CONFIRMED FACT (the reported symptom).** `disabledDates` is declared at
`ListingDetailPage.tsx:217`, written once at `:281` from `blockedDates` plus expanded `bookedRanges`,
and **read nowhere**. Grep across the entire `src/` tree finds only those two occurrences in this file;
all other hits are in `DateRangePicker.tsx`, which declares the prop.

**CONFIRMED FACT (worse than reported).** `setDateRange` is likewise **never called** — it appears
only in its own `useState` declaration at `:214`. `ListingDetailPage` imports *types and helpers*
from `../search/DateRangePicker` (line 22) but never renders the `DateRangePicker` component; the only
consumer of that component anywhere in `src/` is `UnifiedSearchBar.tsx:519`. There is no `<input
type="date">` and no `dateFieldsRow` usage in the JSX — the style key exists at `:942` but is orphaned.
**The listing detail page contains no date-selection affordance of any kind.**

**CONFIRMED FACT (what the guest actually books).** The date range is seeded at `:214-216` from
`bookingDraft.dateRange || loadSearchDatesDraft() || defaultStayDateRange()`. `defaultStayDateRange()`
(`:775-779`) returns *tomorrow → tomorrow + 2 nights*. A guest who deep-links to a listing without
having used the search bar is silently quoted, and can proceed to checkout, on a date range they
never chose and cannot change. `BookingReviewPage` renders those dates read-only
(`:278-279`) and its own copy tells the guest to *"Choose check-in and check-out dates on the listing
page first"* (`:104`) — an instruction that cannot be followed.

**CONFIRMED FACT (server does hold the line).** `POST /api/bookings` re-checks inside a transaction
guarded by `pg_advisory_xact_lock(hashtext(listing.id))` and rejects with 409
`BOOKING_DATES_UNAVAILABLE` on either an overlapping booking or a `BLOCKED`
`listingAvailability` row (`bookings.mjs:544-573`). So a blocked date is **quotable and
walkable-through-checkout, but not creatable**. This is a correctness-of-experience and
conversion defect, not a double-booking defect.

**CONFIRMED FACT (secondary dead code).** The special-offer panel at `:559` is gated on
`!dateRange.checkIn`, which is never true because the default range always populates `checkIn`.
That branch is unreachable.

**Severity:** Critical (product correctness; the roadmap already ranks C4 as P1 booking-correctness).
**Launch impact:** blocks closed beta.

**Narrow correction:** render the existing `DateRangePicker` on the listing page, wired to
`dateRange`/`setDateRange` and passed the already-computed `disabledDates` as its `disabledDates`
prop. Every piece required already exists — the picker supports the prop (`DateRangePicker.tsx:15,
124-137, 188`), the set is already built correctly, and the server already enforces the same rule.
This is wiring, not new capability. Delete or re-gate the unreachable offer panel in the same change.

**Required:** code.

---

#### A2-C05 — "Pay by wallet" fabricates payment approval entirely in the browser; the real endpoint has zero callers

**Baseline:** `8a4eba7`.

**Inspected:** `src/modules/payments/SyrianLocalWalletPaymentPage.tsx:29,155-198,200-228,285-300`;
`src/shared/api/platformApi.ts:1528-1545` (`submitPrototypeLocalWalletProof`), `:1580-1620`
(`createLocalFallbackPaymentProof`); `src/modules/bookings/BookingDetailPage.tsx:271-272,317-440`;
`src/app/App.tsx:86,185-191`; `server/routes/payments.mjs:536+`.

**CONFIRMED FACT.** `confirmWalletPayment()` (`SyrianLocalWalletPaymentPage.tsx:186-198`) makes **no
network request**. It calls `createLocalProof('syrian_local_wallet')` → `createLocalFallbackPaymentProof`,
which constructs a `PlatformPaymentProof` object with `status: 'APPROVED'`,
`adminNote: 'local_payment_approved'`, `reviewedById: 'local-payment-test'`, and a synthetic
`reviewedAt`, persists it to `sessionStorage`, and returns it. The page then sets it as the confirmed
proof and, via the effect at `:155-171`, writes a `sybnb_v6_confirmed_payment` record with
`status: 'APPROVED'` and offers a **receipt** at `/payment/receipt/:id`.

**CONFIRMED FACT.** `submitPrototypeLocalWalletProof()` — the function that actually posts to
`POST /api/payments/local-wallet-proof` — has **zero callers** in `src/`. Grep across `src` returns
only its own definition. The server endpoint is implemented (`payments.mjs:536`), rate-limited
(`server/index.mjs:61`), and covered by at least four API test files
(`booking-contact`, `str-security-hardening`, `str-checkout-fee-total`), yet it is **unreachable from
the application**.

**CONFIRMED FACT (behaviour on a real booking).** `createLocalFallbackPaymentProof` throws
`'Fallback booking not found'` when the booking is neither a locally-cached fallback booking nor
prefixed `fallback-booking-` (`platformApi.ts:1589`). Since `BookingDetailPage` routes real bookings
to this page via `paymentRoute` (`:271-272`), a real guest pressing "Pay by wallet" receives a raw,
untranslated internal error string in the UI (`:194-196`). The Syrian local wallet payment method —
the primary non-card path for the Syria-first launch — is a **hard dead end**.

**CONFIRMED FACT (behaviour on a fallback booking).** When the listing came from
`FALLBACK_APPROVED_LISTINGS` (see **A2-C06**), the booking id *is* `fallback-booking-…`, the throw does
not fire, and the guest is shown a fabricated *approved payment and receipt* for money that was never
requested, moved, or recorded anywhere on the server.

**CONFIRMED FACT (adjacent).** The amount charged is carried in the client route itself —
`/^\/payment\/local-wallet\/([^/]+)\/(\d+)\/([^/]+)$/` (`App.tsx:86`), passed as
`amountMinor={Number(bookingPaymentMatch[2])}`. The server is authoritative for the real Stripe path
(`expectedTotalMinor(booking)`, `payments.mjs:67-77,293`), so this is a display-integrity issue, not a
charge-amount vulnerability — but it means the amount a guest sees is URL-controlled.

**Severity:** Critical.
**Launch impact:** blocks closed beta; blocks public production. Also violates the roadmap's own
Truthfulness rule (`STR_LAUNCH_ROADMAP_v1.1.md`, PART A: *"Never fabricate: … financial values …
If something is simulated, clearly label it."*).

**Narrow correction:** replace the body of `confirmWalletPayment()` with a call to the existing,
tested `submitPrototypeLocalWalletProof({ bookingId, amountMinor, currency, providerRef })`, and render
the returned `PENDING_ADMIN_REVIEW` state honestly instead of an approval. Delete
`createLocalFallbackPaymentProof`, `createLocalProof`, and the `stripe_test` fallback branches in
`payByCreditCard` (`:210-222`) together with **A2-C06**.

**Required:** code + owner input (confirm that "submitted for admin review" is the correct
post-payment state for the Sham Cash path, which is what the server already implements).

---

#### A2-C06 — Fabricated listing inventory is served to real users on *any* API failure

**Baseline:** `8a4eba7`.

**Inspected:** `src/shared/api/platformApi.ts:144-148` (`PROTOTYPE_OWNER`), `:152-364`
(`FALLBACK_APPROVED_LISTINGS`), `:365-367` (`fallbackApprovedListings`), `:1182-1187`
(`fetchPrototypeListings`), `:1512-1521` (`fetchPrototypeListing`), `:2496-2510`
(`createPrototypeBooking`), `:2558-2612` (`createLocalFallbackBooking`).

**CONFIRMED FACT.** `fetchPrototypeListings` wraps its `apiRequest` in a bare
`try { … } catch { return fallbackApprovedListings(division) }` (`:1182-1187`). The catch is
**untyped and unconditional** — a 500, a 503, a database outage, a rate-limit 429, or a network
failure all produce the same result: fourteen hard-coded listings across STAYS, RENTALS, BUY, CARS,
MARKETPLACE, and NEW_CONSTRUCTION, every one attributed to
`PROTOTYPE_OWNER = { id: 'prototype-owner-sybnb', displayName: 'SYBNB Verified Provider' }`.

**CONFIRMED FACT.** `fetchPrototypeListing` applies the same fallback to the *detail* page
(`:1512-1521`), so a fabricated listing is fully browsable. `createPrototypeBooking` then completes
the loop: on any API error, if the listing id starts with `fallback-`, it fabricates a booking
client-side (`:2504-2508` → `createLocalFallbackBooking`), which chains directly into the fabricated
payment approval of **A2-C05**.

**Assessment.** There is no environment gate on any of this — it is not `import.meta.env.DEV`-guarded,
not behind a flag, and not labelled in the UI. The displayed owner name asserts a verification
("SYBNB Verified Provider") that no real process produced. This is precisely the failure mode the
project's own trust rules forbid, and it activates exactly when the platform is least healthy.

**Severity:** Critical.
**Launch impact:** blocks closed beta; blocks public production.

**Narrow correction:** delete `PROTOTYPE_OWNER`, `FALLBACK_APPROVED_LISTINGS`,
`fallbackApprovedListings`, `createLocalFallbackBooking`, `getLocalFallbackBooking`,
`readLocalFallbackBookings`, `createLocalFallbackPaymentProof`, `getLocalFallbackPaymentProof`, and the
two `sessionStorage` keys `LOCAL_FALLBACK_BOOKINGS_KEY` / `LOCAL_FALLBACK_PAYMENT_PROOFS_KEY`. Let the
error propagate and render the existing honest error state. This is a pure deletion.

**Required:** code.

---

#### A2-C07 — The deploy-time demo seed publishes a real, publicly bookable listing and three ID-verified accounts with no documents

**Baseline:** `8a4eba7`.

**Inspected:** `scripts/seed-demo-accounts.mjs` (whole file); `.env.production.example` (setup block);
`prisma/schema.prisma` `User.isDemo`, `User.idDocumentStatus`; grep for `isDemo` across
`server/routes/`.

**CONFIRMED FACT.** `.env.production.example` instructs, as step 3 of one-time production setup:
`DEMO_ACCOUNT_PASSWORD=... node scripts/seed-demo-accounts.mjs`.

**CONFIRMED FACT.** `seedDemoAccounts()` creates a `Listing` with
`{ division: 'STAYS', status: 'APPROVED', titleEn: 'Reviewer Demo Apartment', priceMinor: 40,
currency: 'USD', instantBookEnabled: true }` (`:81-83`). `status: 'APPROVED'` is exactly the state the
public search and availability endpoints filter on (`listings.mjs:386`, `bookings.mjs:482-486`).

**CONFIRMED FACT.** Grep for `isDemo` across `server/routes/*.mjs` returns **zero** hits. The
`isDemo` flag is written by the seed and by nothing else; no query anywhere excludes demo users or
their listings from public search, availability, quoting, or booking. The listing has no owning
`isDemo` filter of its own — `Listing` has no demo flag at all.

**CONFIRMED FACT.** All three demo accounts are created with `idDocumentStatus: 'APPROVED'` and
`idDocumentSubmittedAt: new Date()` while `idDocumentRef` is never set — i.e. **approved identity
verification with no identity document**. Per `src/modules/host/hostVerificationModel.ts:19-24`, that
status renders the host as `'verified'` and adds `VERIFICATION_TRUST_WEIGHT = 20` to the displayed
trust score. The demo driver similarly receives `APPROVED` `LICENSE` and `VEHICLE_REGISTRATION`
`DriverDocument` rows pointing at non-existent `demo-LICENSE.pdf` / `demo-VEHICLE_REGISTRATION.pdf`.

**Assessment.** Following the committed production runbook injects fabricated inventory and fabricated
verification into the live public marketplace. A real guest can find, quote, and instant-book
"Reviewer Demo Apartment" for $40. The C5 work (`3f7d08e`) correctly removed the *client-side* path to
a fake verified badge; this script reintroduces the same claim from the *server* side.

**Severity:** Critical.
**Launch impact:** blocks public production; blocks closed beta if the seed is run.

**Narrow correction:** two narrow changes. (a) Add `isDemo` (or a `Listing.isDemo` column) to the
public listing search/availability/booking predicates so demo rows are structurally invisible to real
users — one `where` clause per query, mirroring the existing `status: 'APPROVED'` filter. (b) Remove
the seed instruction from `.env.production.example` and move it to a documented store-review-only
procedure, or gate the script behind an explicit `ALLOW_DEMO_SEED=1`. Separately, decide whether
`idDocumentStatus: 'APPROVED'` without a document is acceptable even for demo accounts.

**Required:** code + documentation + owner input (store-review requirements versus marketplace
integrity).

---

### HIGH

---

#### A2-H01 — H3 confirmed: `payoutMethod` has no write path anywhere, and there is no way for money to leave the platform

**Baseline:** `8a4eba7`.

**Inspected:** `prisma/schema.prisma:151` (`User.payoutMethod`), `:297` (`DriverProfile.payoutMethod`);
`server/routes/admin.mjs:127-176` (payout queue), `:180-241` (release), `:1273-1310` (driver payout);
`server/lib/finance-ledger.mjs:388-408` (`buildPayoutRow`); `server/routes/wallet.mjs` route table;
`server/routes/me.mjs:43-83`; `src/modules/host/HostEarningsPage.tsx` (whole file); exhaustive grep for
`payoutMethod` across `server/` and `src/`.

**CONFIRMED FACT.** `User.payoutMethod` (`Json?`) is **read** in exactly one place —
`admin.mjs:135,165`, surfaced to the admin payout queue as `hostPayoutMethod` — and **written** in
exactly two places, both of which set it to `null` (account closure, `me.mjs:55`; driver-profile
scrub, `me.mjs:72`). There is no host-facing endpoint, no admin-facing endpoint, and no frontend
surface anywhere in `src/` that assigns it. `hostPayoutMethod` in the admin queue is therefore
**always `null`**.

**CONFIRMED FACT.** The host payout release path (`admin.mjs:180-241`) does **not** require a payout
method — unlike the SR driver payout path, which explicitly refuses without one
(`admin.mjs:1273`). Release calls `recordWalletEntry(… type: 'RELEASE' …)`, i.e. it credits the host's
**internal SYBNB wallet ledger**. No external transfer is initiated or recorded.

**CONFIRMED FACT.** `server/routes/wallet.mjs` exposes exactly five paths: `topup/sham-cash`,
`/api/wallet`, `/api/wallet/gifts`, `gifts/:id`, `gifts/:id/claim`. Grep for
`withdraw|WITHDRAW|cashout|CASH_OUT|payout` in that file returns nothing. **There is no withdrawal
endpoint.** Money can enter the wallet and be spent inside the platform; it cannot leave.

**CONFIRMED FACT (compounding).** `HostEarningsPage.tsx:141-149` displays a `RELEASED` pill —
copy `'Released'` / `'تم الصرف'` — for a state that means only "credited to an internal ledger".
And account closure refuses while any wallet is non-zero (`me.mjs:21-28`, *"Withdraw or spend your
balance before closing"*), so a host who has been "paid" can neither withdraw nor close their account.

**Severity:** High.
**Launch impact:** blocks closed beta (no host can be paid); blocks public production.

**Narrow correction:** the roadmap's H3 scope (payout-method setup UI + endpoint) closes only the
configuration half. Minimally: (a) add `PATCH /api/me/payout-method` with a validated JSON shape plus a
host-dashboard form; (b) require a non-null `payoutMethod` in `admin.mjs`'s host release path, matching
the driver path's existing guard at `:1273`; (c) correct the `RELEASED` copy so it does not assert an
external transfer that has not occurred. A real withdrawal rail is a separate, larger decision.

**Required:** code + documentation (copy) + owner input (whether "released to wallet" is the intended
beta model, and what the withdrawal rail is).

---

#### A2-H02 — The S3 storage driver has never executed; it is unreachable from every test and unproven against R2

**Baseline:** `8a4eba7` (storage frozen at `79a3bbb`).

**Inspected:** `server/lib/object-storage.mjs:176-287`; `test/support/setup.env.mjs`;
`vitest.unit.config.ts`; `vitest.config.ts`; `test/unit/object-storage.test.mjs` (presence);
`docs/architecture/ARCHITECTURE_FREEZE_REVIEW_2026.md` §5, §9.

**CONFIRMED FACT.** The test harness pins `STORAGE_DRIVER = 'local'` unconditionally and deletes
`STORAGE_S3_ENDPOINT` / `STORAGE_S3_ACCESS_KEY_ID` / `STORAGE_S3_SECRET_ACCESS_KEY` from the
environment before any test file loads (`setup.env.mjs`). `driverFor()` additionally throws if
`STORAGE_DRIVER === 's3'` while `NODE_ENV === 'test'` (`object-storage.mjs:277-285`). **No test in
the repository can reach `s3Driver`.** Its `put`/`get`/`remove`/`exists` implementations
(`:216-273`), the lazy `S3Client` construction and caching (`:183-205`), and `wrapS3Error`
(`:208-214`) have never been executed against anything.

**CONFIRMED FACT (documentation agrees).** The freeze review states plainly: *"no object has been
written to R2"* and *"That verification is the gate between internal testing and any deployed
environment."* This finding independently confirms that statement from the code and corrects nothing
in it.

**Assessment.** This is a deliberate and correctly documented posture, not a defect of design. It is
recorded here because it is load-bearing: the entire claim of `79a3bbb` — that uploads now survive
instance replacement — rests on an untested code path. Specific untested behaviours with plausible
failure modes: R2's response to `forcePathStyle: true` with a Cloudflare account endpoint; the
`bucketClass/key` prefix scheme; `HeadObjectCommand` 404 shape (`:269` checks both
`$metadata.httpStatusCode === 404` and `error.name === 'NotFound'`, which is defensive but unverified);
and the `transformToByteArray()` buffering of large objects under the 30-second function limit.

**Severity:** High.
**Launch impact:** blocks closed beta (the freeze review's own gate). Does not block internal testing
on the local driver.

**Narrow correction:** execute the already-planned cross-instance durability verification against the
R2 **test** bucket (`docs/product/STORAGE_VALIDATION_WAVE_1_PLAN.md` exists for this), writing and
reading one object from two separate processes. No code change is expected; if one is needed, that is
exactly the information this verification exists to produce.

**Required:** infrastructure + owner input (authorisation to write to R2).

---

#### A2-H03 — The storage migration has no backfill; every pre-migration object is now unreachable

**Baseline:** `8a4eba7`. Compared against `79a3bbb~1`.

**Inspected:** `git show 79a3bbb~1:server/lib/id-document-storage.mjs`,
`git show 79a3bbb~1:server/lib/listing-media-storage.mjs`; `server/lib/object-storage.mjs:22,147-155`;
`ls server/uploads/`; `ls scripts/`.

**CONFIRMED FACT.** Before `79a3bbb`, each module wrote to its own directory:
`server/uploads/id-documents/`, `server/uploads/listing-media/`, `server/uploads/listing-documents/`,
`server/uploads/thread-documents/` (`STORAGE_DIR = path.join(__dirname, '..', 'uploads', '<name>')`).

**CONFIRMED FACT.** After `79a3bbb`, the local driver resolves
`path.join(root, bucketClass, key)` where `bucketClass` is `'media'` or `'documents'`
(`object-storage.mjs:147-155`, `:24-29`). Reads now go to `server/uploads/media/<key>` and
`server/uploads/documents/<key>`.

**CONFIRMED FACT.** The old directories still exist on disk in this worktree and hold ~12 MB across
`driver-documents`, `id-documents`, `listing-documents`, `listing-media`, `quebec-documents`,
`thread-documents`. They are gitignored (`.gitignore:server/uploads/`) and 0 files are tracked.

**CONFIRMED FACT.** `ls scripts/ | grep -i "migrat\|backfill\|storage"` returns **nothing**. No
migration or backfill script exists.

**Assessment.** Every `ListingMedia.storageKey`, `User.idDocumentRef`, `ListingDocument.assetUrl`, and
thread-document reference created before `79a3bbb` now points at a path the current code will not
look in. Reads fail with `STORAGE_OBJECT_NOT_FOUND` (404). The key *format* is unchanged
(`<uuid>.<ext>`), so this is purely a relocation with no accompanying data move — a classic
half-completed migration. Because production has never been deployed and R2 has never been written to
(**A2-H02**), the affected data is development and local-test data only *today*; the finding is that
the migration procedure itself is incomplete and would repeat this shape on any future backend change.

**Severity:** High (as a process/completeness defect). Low in present data impact.
**Launch impact:** does not block launch. Blocks any environment that already holds real objects.

**Narrow correction:** add `scripts/migrate-local-storage-layout.mjs` that moves
`uploads/{id-documents,listing-documents,thread-documents}/*` → `uploads/documents/` and
`uploads/listing-media/*` → `uploads/media/`, verifying each key against
`assertSafeObjectKey()` before moving. Record in ADR-0010 that a driver/layout change requires a
migration step, so this is not rediscovered.

**Required:** code (one script) + documentation (ADR-0010 addendum).

---

#### A2-H04 — Prisma client generation is absent from the Vercel build, `@prisma/client` is a devDependency, and no Vercel runtime binary target is declared

**Baseline:** `8a4eba7`.

**Inspected:** `package.json` (scripts, dependencies, devDependencies); `vercel.json`;
`prisma/schema.prisma:1-9`; `.vercel/project.json`; `.github/workflows/sybnb-v6-ci.yml`;
`server/lib/prisma.mjs`.

**CONFIRMED FACT.** `vercel.json`'s `buildCommand` is `npm run build`, which is `tsc && vite build`.
It does **not** run `prisma generate`. There is no `postinstall` script in `package.json`. The
`db:generate` script exists (`package.json:28`) but is never invoked by the build.

**CONFIRMED FACT.** CI *does* run it — `.github/workflows/sybnb-v6-ci.yml` has an explicit
`- run: npx prisma generate` step. So the requirement is known and satisfied in CI, and omitted in the
deployment path.

**CONFIRMED FACT.** `@prisma/client` and `prisma` are both in **`devDependencies`**
(`package.json:56,59`), while genuinely build-only tools (`typescript`, `vite`,
`@vitejs/plugin-react`) were deliberately placed in `dependencies`. `@prisma/client` is a **runtime**
import of `server/lib/prisma.mjs`, which `api/index.mjs` reaches transitively. This classification is
inverted relative to the rest of the file.

**CONFIRMED FACT.** `.env.production.example` instructs setting `NODE_ENV="production"` as a Vercel
environment variable.

**CONFIRMED FACT.** `prisma/schema.prisma:1-4` declares
`binaryTargets = ["native", "linux-arm64-openssl-3.0.x"]`. The x86-64 Linux target used by Vercel's
Node runtime (`rhel-openssl-3.0.x`) is **not** listed explicitly; it is covered only if `native`
resolves on the Vercel build container.

**INFERENCE** (assumptions named): (1) if `NODE_ENV=production` is present during Vercel's install
step, npm omits `devDependencies`, so `@prisma/client` would be absent from the function bundle and
every DB-backed request fails at import; (2) with `node_modules` restored from Vercel's build cache,
`@prisma/client`'s postinstall generation may not re-run, leaving a stale or absent query engine;
(3) if generation ever happens anywhere other than the Vercel build container, `native` resolves to
the wrong platform and the query engine binary is missing at runtime. I could not test any of these —
no deployment was performed.

**Severity:** High.
**Launch impact:** blocks internal testing of any deployed environment; blocks closed beta.

**Narrow correction:** three one-line changes. (a) `"build": "prisma generate && tsc && vite build"`.
(b) Move `@prisma/client` from `devDependencies` to `dependencies` (leave the `prisma` CLI in
devDependencies only if `prisma generate` is guaranteed to run before pruning; safest is to move both).
(c) Add `"rhel-openssl-3.0.x"` to `binaryTargets`.

**Required:** code (build configuration) + infrastructure verification (one preview deploy proves or
disproves all three).

---

#### A2-H05 — Observability is a single `console.error`; there is no request correlation, structure, aggregation, or alerting

**Baseline:** `8a4eba7`.

**Inspected:** `server/lib/responses.mjs` (whole file); grep for `console\.` across `server/` (4 total
occurrences); `server/lib/document-access-audit.mjs:29-58`; `server/index.mjs` (no logging middleware);
`vercel.json` (no monitoring integration).

**CONFIRMED FACT.** The entire server-side error-observability surface is
`console.error('[api:error]', error)` at `responses.mjs:57`, fired only when
`!error.statusCode || error.statusCode >= 500`. There are four `console.*` calls in all of `server/`.

**CONFIRMED FACT.** There is no request id, no correlation id, no user id, no route, no latency, no
structured (JSON) log line, and no severity taxonomy. Deliberately-thrown 4xx errors — including every
`STORAGE_OBJECT_NOT_FOUND` (404), every `BOOKING_DATES_UNAVAILABLE` (409), every 429, and every
authorization denial — are **never logged at all**, so an authorization-denial spike or a storage
outage manifesting as 404s is completely invisible.

**CONFIRMED FACT.** Audit-write failure is swallowed by design and routed nowhere:
`recordStaffDocumentAccess` returns `{ recorded: false, reason }` on error
(`document-access-audit.mjs:54-56`), and no caller inspects the return value. The module's own comment
acknowledges this: *"today nothing does, because there is no alerting to route it to (STG-22)."*

**Assessment.** Multiple controls elsewhere in the system are only effective if someone notices them
firing — the storage 503 wrapper, the rate limiter's fail-closed buckets, the payout TOCTOU guards,
the advisory-lock booking conflict. None of them can be noticed. This is correctly listed as a known
gap in the freeze review; I confirm it is total, not partial.

**Severity:** High.
**Launch impact:** blocks public production. Does not block internal testing.

**Narrow correction:** a minimal, self-contained first step that does not require a vendor: emit one
structured JSON line per request from `handleRequest` in `server/index.mjs` (method, pathname, status,
duration, a per-request UUID, and `context.user?.id`), and thread that request id into
`handleRouteError` so a 500 log line can be joined to its request. Vercel captures stdout, so this
yields correlatable logs with zero infrastructure. Vendor aggregation and alert routing are a separate
decision.

**Required:** code (small) + infrastructure + owner input (log aggregation vendor).

---

#### A2-H06 — Two upload subsystems still write to ephemeral local disk, and their routes are unconditionally registered in the single production deployment

**Baseline:** `8a4eba7`.

**Inspected:** `server/lib/driver-document-storage.mjs:2,7,47-70`;
`server/lib/quebec-document-storage.mjs:2,7,51-70`; `server/routes/driver.mjs:5`;
`server/routes/quebec-driver-onboarding.mjs:38`; `server/routes/admin.mjs:11`;
`server/lib/quebec-document-compliance.mjs:8`; `server/index.mjs` `dispatch()` (lines 156-181);
`server/lib/compliance-feature-flags.mjs` (whole file); `src/app/App.tsx:121-128`.

**CONFIRMED FACT.** `driver-document-storage.mjs` and `quebec-document-storage.mjs` both retain
`const STORAGE_DIR = path.join(__dirname, '..', 'uploads', '<name>')` and call `writeFile`/`readFile`/
`unlink` directly. Neither imports `object-storage.mjs`. They are the only two of six that were not
migrated — matching the freeze review's own account.

**CONFIRMED FACT (the part not recorded).** `handleDriver` and `handleQuebecDriverOnboarding` are
listed unconditionally in `server/index.mjs`'s `dispatch()` array. There is **no** environment flag,
market gate, or feature flag that removes them from a deployment.
`compliance-feature-flags.mjs` gates only two *regulatory behaviours*
(`RIDE_GOVERNMENT_REMITTANCE_ACTIVE`, `STAY_TAX_PLATFORM_COLLECTION`) — it does not gate route
registration. `src/app/App.tsx:121-128` likewise ships `/driver`, `/driver/vehicles`, and
`/driver/tax-profile` in the same bundle.

**Consequence, CONFIRMED from the code paths.** A production deployment of the "STR-only" launch
exposes live endpoints that accept driver licences, vehicle registrations, and Québec compliance
documents and write them to the function's ephemeral filesystem, returning HTTP success. The
documents are lost at the next cold start or instance replacement, with no error surfaced to the
uploader and — per **A2-H05** — no log entry either.

**Assessment.** The freeze review characterises this as *"contained only by SR remaining frozen."*
I disagree with the word *contained*: freezing is a **development-process** state, not a **runtime**
state. Nothing in the deployed artifact enforces the freeze. Containment currently rests entirely on
no user discovering the route.

**Severity:** High.
**Launch impact:** does not block internal testing; blocks public production as long as these routes
are reachable.

**Narrow correction:** do not migrate the modules (that would violate the bounded-context freeze).
Instead add a single explicit gate — e.g. `ENABLED_DIVISIONS` (default `str`) read once in
`server/index.mjs` — and conditionally omit `handleDriver`, `handleQuebecDriverOnboarding`, and
`handleSrRides` from the `dispatch()` array when their division is not enabled, with the matching
frontend routes removed from `App.tsx`. This is additive, touches no SR or Québec logic, and makes the
freeze enforceable at runtime.

**Required:** code (small, additive) + owner input (confirming that the launch deployment serves STR
only).

---

#### A2-H07 — Upload payloads are sized above the serverless request-body limit, and `readJson` has no body cap at all

**Baseline:** `8a4eba7`.

**Inspected:** `server/lib/responses.mjs` `readJson` (lines 34-50); `MAX_*_BYTES` in all six storage
modules; `src/modules/seller/listingPhotos.ts:11,25-29,51-62`;
`src/modules/seller/ListingPhotoUploader.tsx:29,85`; `vercel.json`.

**CONFIRMED FACT.** All six storage modules cap the **decoded** buffer at exactly 8 MB
(`MAX_LISTING_MEDIA_BYTES`, `MAX_ID_DOCUMENT_BYTES`, `MAX_LISTING_DOCUMENT_BYTES`,
`MAX_THREAD_DOCUMENT_BYTES`, `MAX_DRIVER_DOCUMENT_BYTES`, `MAX_QUEBEC_DOCUMENT_BYTES`). Bytes arrive
base64-encoded inside a JSON body (≈ +33 %), so an at-limit upload is a request body of roughly
10.9 MB.

**CONFIRMED FACT.** `readJson` (`responses.mjs:34-50`) buffers the entire request stream into memory
with `for await (const chunk of req) chunks.push(chunk)` and **no size check whatsoever**. There is no
`content-length` inspection anywhere in `server/`.

**CONFIRMED FACT (partial mitigation, media only).** The listing-photo client downscales to a
1600 px longest edge at quality 0.82 before upload (`listingPhotos.ts:51-58`), which keeps most JPEG
photos well under any platform cap. But `needsDownscale` only triggers above 1600 px
(`:60-62`), and PNG is re-encoded at `quality: 1`, so a large sub-1600 px PNG is uploaded essentially
as-is. **Identity documents, listing documents (CITQ certificates), thread documents, driver documents
and Québec documents have no client-side compression at all** — an 8 MB PDF is transmitted whole.

**INFERENCE** (assumption: the documented Vercel Serverless Function request-body limit of 4.5 MB
applies to this deployment; I could not verify against a live deployment): any document upload above
roughly 3.3 MB decoded is rejected at the platform edge before `handleRequest` is entered. The client
receives a platform error response rather than the application's JSON error envelope, which
`apiRequest` in `platformApi.ts` is not written to parse. The application's own 8 MB limit and its
tested 400 responses would therefore be unreachable in production.

**Secondary CONFIRMED risk (local/self-hosted):** `npm run api:dev` and any non-serverless host have no
body cap at all, so `readJson` will buffer an arbitrarily large body into memory.

**Severity:** High.
**Launch impact:** blocks closed beta (identity verification and CITQ certificate upload are core
flows).

**Narrow correction:** (a) reject on `content-length` in `readJson` before reading a single chunk,
using a limit derived from the 8 MB decoded ceiling plus base64 overhead — this fixes the unbounded
local path immediately; (b) lower the effective document ceiling to a value that fits the platform
limit (≈3 MB decoded) or move document uploads to a direct-to-R2 presigned-PUT flow; (c) verify the
actual platform limit against a preview deployment before choosing between (b)'s two options.

**Required:** code + infrastructure verification + owner input (acceptable maximum document size).

---

#### A2-H08 — There is no division isolation at any layer: one router, one bundle, one API, one domain

**Baseline:** `8a4eba7`.

**Inspected:** `src/app/App.tsx` (whole routing tree, 253 lines); `server/index.mjs` `dispatch()`;
`ls src/modules` (29 directories); `ls server/routes` (19 handlers); `vercel.json`;
`docs/product/STR_LAUNCH_ROADMAP_v1.1.md` PART A rule 3.

**CONFIRMED FACT.** A single `App.tsx` ternary chain routes STR (`/stays`, `/listing/:id`,
`/booking/*`, `/payment/*`), SYBNB Ride (`/ride`, `/ride-preview`, `/driver`, `/driver/vehicles`),
Québec (`/driver/tax-profile`, `/host/tax-profile`), and six other divisions (`/rentals`, `/buy`,
`/cars`, `/marketplace`, `/marketplace/sell`, `/new-construction`) plus internal consoles (`/admin/*`,
`/finance`, `/operations`, `/ai-brain`, `/competitors`, `/status`, `/immocontact`). All 29
`src/modules/*` directories ship in one Vite build to one domain.

**CONFIRMED FACT.** `server/index.mjs`'s `dispatch()` registers all 19 route handlers
unconditionally, including `handleSrRides`, `handleDriver`, `handleQuebecDriverOnboarding`, and
`handleCompliance`.

**CONFIRMED FACT.** Frontend staff gating (`getStaffRequiredRole`, `App.tsx:212-222`) is a
**client-side render gate** only; it decides which component to render, not what the API will serve.
Server-side authorization is separately and properly enforced by `requireAuth(context, [...])` in the
route handlers, so this is not an authorization hole — but it means the division boundary has no
representation on either side of the wire.

**Assessment.** The governing policy (`STR_LAUNCH_ROADMAP_v1.1.md` PART A rule 3) states the six
bounded contexts must stay independent, and the freeze review lists *"eight divisions publicly exposed
when one is operable"* as outstanding. I confirm the finding and add the structural point: **the
bounded-context boundary exists only as a development convention and a directory layout.** There is no
build-time, route-time, or deploy-time mechanism that could enforce it, and therefore no mechanism
that could fail if it were violated. This is the root cause of **A2-H06** and a standing risk for every
future "STR-only" claim.

**Severity:** High.
**Launch impact:** blocks public production (exposes divisions with known defects, e.g. A2-H06).

**Narrow correction:** introduce one `ENABLED_DIVISIONS` configuration value read in exactly two
places — `server/index.mjs`'s `dispatch()` array and `App.tsx`'s route table — and default it to STR.
Add a unit test asserting that a disabled division's routes are absent from both. This gives the freeze
a runtime representation without touching any division's internals.

**Required:** code (small, additive) + governance (record the mechanism in the isolation plan) + owner
input.

---

### MEDIUM

---

#### A2-M01 — Every time-driven state transition is traffic-driven

**Baseline:** `8a4eba7`.
**Inspected:** `server/lib/booking-lifecycle.mjs:5-20`; `server/lib/listing-lifecycle.mjs:25-42`;
`server/routes/wallet.mjs:70,200`; callers in `admin.mjs:129,247`, `me.mjs:226`, `host.mjs:38,93`;
`vercel.json`.

**CONFIRMED FACT.** Three lifecycle sweeps — booking completion, listing expiry, gift expiry — run
opportunistically on read paths. `vercel.json` contains no `crons` key and there is no scheduler
anywhere in the repository. Both lifecycle modules document this explicitly as a deliberate choice.

**Assessment.** For an operator-attended platform this is a defensible pattern; the architectural
problem is that correctness of a *financial* clock (the 14-day payout hold) and of *public inventory*
(listing expiry) now depends on unrelated traffic. A low-traffic beta is precisely the regime where it
degrades: an inactive host's completed stays never transition, so their earnings never become
`ELIGIBLE`. This is the same root cause as **A2-C02** but is recorded separately because it is broader
and independently fixable.

**Severity:** Medium.
**Launch impact:** blocks closed beta for payout correctness; does not block internal testing.
**Narrow correction:** one `crons` entry in `vercel.json` invoking one authenticated maintenance route
that calls the three existing exported sweeps. No new logic.
**Required:** code (thin route) + infrastructure.

---

#### A2-M02 — Two divergent API contract registries, both stale; the served one covers under half the surface

**Baseline:** `8a4eba7`.
**Inspected:** `server/contracts.mjs` (58 lines, 34 endpoint tuples); `src/backend/contracts.ts`
(238 lines); `server/index.mjs` `/api/contracts`; static count of distinct `/api/...` literals across
`server/routes/*.mjs` (**81 unique**) plus 105 `url.pathname.match(...)` pattern routes.

**CONFIRMED FACT.** `GET /api/contracts` advertises itself as *"the prototype endpoint and security
contract registry"* and returns `API_ENDPOINTS` from `server/contracts.mjs` — 34 entries. The actual
route surface is at least 81 distinct literal paths plus parameterised patterns. Entire subsystems are
absent from the registry: all media and document routes, all Stripe routes, compliance, Québec driver
onboarding, tax profile, disputes, reports, messages, accommodations, reviews, sellers.

**CONFIRMED FACT.** `src/backend/contracts.ts` is a second, structurally different registry (238 lines,
starting with a `ApiMethod` type) that shares no content with `server/contracts.mjs`. `diff` of the two
shows no common lines.

**Assessment.** A registry that documents 42 % of the surface is worse than none: it is presented as
authoritative and used as the machine-readable description of the security contract. Two divergent
copies compound the problem.

**Severity:** Medium.
**Launch impact:** does not block launch; degrades every review and audit performed against it.
**Narrow correction:** either regenerate `server/contracts.mjs` from the route handlers and delete
`src/backend/contracts.ts`, or demote `/api/contracts` to a clearly-labelled partial index. Add a test
asserting that every path literal in `server/routes/` appears in the registry.
**Required:** code + documentation.

---

#### A2-M03 — Three independent CSP definitions, one of which contradicts the split-API design

**Baseline:** `8a4eba7`.
**Inspected:** `vercel.json` `headers` block; `index.html:35-37`; `vite-csp-plugin.mjs`;
`server/lib/security-headers.mjs`.

**CONFIRMED FACT.** Three separate Content-Security-Policy sources exist: (1) `vercel.json` applies a
policy to `source: "/(.*)"`; (2) `index.html` carries a `<meta http-equiv>` CSP with a build-time
`__CSP_CONNECT_SRC_EXTRA__` placeholder filled by `vite-csp-plugin.mjs`; (3)
`applySecurityHeaders()` sets `default-src 'none'; frame-ancestors 'none'` on every API response.

**CONFIRMED FACT (contradiction).** `vite-csp-plugin.mjs`'s `cspConnectSrcExtra` exists specifically so
that a split-API deployment (`VITE_API_BASE_URL` set to another origin) has its origin added to
`connect-src`. But `vercel.json`'s policy hard-codes `connect-src 'self'` with no such templating and
applies to the same HTML document. Browsers enforce the intersection of multiple policies, so the
`vercel.json` header would **override the plugin's entire purpose** and block the split-API calls.

**INFERENCE** (assumption: Vercel's `headers` `source: "/(.*)"` also matches `/api/*` requests): API
JSON responses would carry both the `vercel.json` HTML-oriented policy and the handler's
`default-src 'none'`. The intersection is the stricter one, so this is not a weakening — but it is
ambiguous configuration and makes the effective policy hard to reason about.

**Severity:** Medium.
**Launch impact:** does not block launch today (`VITE_API_BASE_URL` is empty for the same-origin
deploy); blocks any future API split.
**Narrow correction:** scope the `vercel.json` header block away from `/api/` (add an explicit
`/api/(.*)` entry, or narrow the source), and make `vercel.json`'s `connect-src` consistent with the
plugin's contract — or delete one of the two HTML policies and keep a single source of truth.
**Required:** code (configuration) + documentation.

---

#### A2-M04 — No region pinning anywhere; the production template leaves the database region unfilled

**Baseline:** `8a4eba7`.
**Inspected:** `vercel.json`; `.env.production.example` `DATABASE_URL` line; `.vercel/project.json`;
`server/lib/object-storage.mjs:19` (R2 EU jurisdiction, per ADR-0010).

**CONFIRMED FACT.** `vercel.json` has **no `regions` key**. `.env.production.example`'s
`DATABASE_URL` placeholder is
`postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/sybnb?...` — the region segment is a
literal unfilled `REGION` placeholder, with no accompanying guidance on which value to choose.
`object-storage.mjs`'s header comment specifies *"S3-compatible (Cloudflare R2, EU jurisdiction)"*.

**Assessment.** Three region decisions (Vercel function region, Neon project region, R2 jurisdiction)
must agree for both latency and data-residency reasons; one is fixed, one is undeclared, and one is an
unfilled placeholder in the deployment runbook. The freeze review correctly flags D-1 and D-6 as open
and correctly notes the Neon choice is irreversible at project creation. I confirm both from the
artifacts and add that **`.env.production.example` gives the operator no way to make the correct
choice** — it does not name a region, does not state the constraint, and does not reference the
data-residency brief that exists at `docs/product/SYBNB_R2_DATA_RESIDENCY_OWNER_DECISION_BRIEF.md`.

**Severity:** Medium (High if the residency answer turns out to be constrained by law).
**Launch impact:** blocks closed beta (an irreversible decision would be made by accident).
**Narrow correction:** add a comment block to `.env.production.example` naming the required Neon
region and cross-referencing the residency brief; add an explicit `"regions": ["<chosen>"]` to
`vercel.json` once D-1 is settled.
**Required:** documentation + infrastructure + owner input (this is D-6, and it is irreversible).

---

#### A2-M05 — A failed object deletion after account closure makes the object permanently unreachable and undeletable

**Baseline:** `8a4eba7`.
**Inspected:** `server/routes/me.mjs:43-85`; `server/lib/id-document-storage.mjs:85-93`;
`server/lib/object-storage.mjs:306-309`.

**CONFIRMED FACT.** Account self-deletion clears `idDocumentRef` inside the transaction
(`me.mjs:55`), then — **after** the transaction commits — attempts
`deleteIdDocument(oldIdRef).catch(() => {})` (`me.mjs:83`). The failure is swallowed silently and,
per **A2-H05**, logged nowhere.

**Assessment.** The ordering is otherwise correct (never leave a reference to a deleted object), but it
produces an asymmetric failure: on a storage error the only remaining pointer to that identity document
has already been destroyed. The object then sits in the documents bucket with no database reference,
outside every retention path, and outside any future data-subject erasure request — because nothing
knows it exists. This is the concrete, user-triggerable instance of the orphan class the freeze review
records as STG-14, and it is the highest-consequence one because the object is a government identity
document.

**Severity:** Medium.
**Launch impact:** does not block internal testing; relevant to closed beta once real identity
documents exist.
**Narrow correction:** attempt the object deletion **before** clearing the reference, or record the
orphaned key in a small `PendingObjectDeletion` table inside the same transaction so a retry is
possible. Either is a small, local change.
**Required:** code + governance (retention/erasure procedure).

---

#### A2-M06 — `STORAGE_DRIVER` is absent from every committed env template, so a fresh developer's uploads fail closed

**Baseline:** `8a4eba7`.
**Inspected:** `.env.example` (100 lines, full key list); `.env.test.example`; `.env` and `.env.test`
(key names only); `server/lib/object-storage.mjs:57-68`; `test/support/setup.env.mjs`.

**CONFIRMED FACT.** Neither `.env.example`, `.env.test.example`, `.env`, nor `.env.test` sets
`STORAGE_DRIVER`. `resolveStorageDriver()` throws `STORAGE_DRIVER_INVALID` when the value is neither
`'local'` nor `'s3'` — with **no default and no inference**, by explicit design
(`object-storage.mjs:59-66`).

**CONFIRMED FACT.** The API/security test suites are unaffected because `setup.env.mjs` assigns
`STORAGE_DRIVER = 'local'` unconditionally at setup time. So the gap is invisible to CI and visible
only to a human running the dev server.

**Consequence, CONFIRMED.** A developer who follows `.env.example` verbatim and runs
`npm run api:dev` gets a 500 `STORAGE_DRIVER_INVALID` on the first listing-photo, ID-document, or
CITQ-certificate upload. The fail-closed posture is correct; the missing template line is the defect.

**Severity:** Medium.
**Launch impact:** blocks internal testing (developer onboarding), does not block launch.
**Narrow correction:** add `STORAGE_DRIVER="local"` (and optionally `STORAGE_LOCAL_DIR`) to
`.env.example` and `.env.test.example`, next to the existing storage-adjacent keys.
**Required:** documentation.

---

#### A2-M07 — The test architecture cannot detect the defect class that produced A2-C04, A2-C05, and A2-C06

**Baseline:** `8a4eba7`.
**Inspected:** `ls test/unit` (22 files), `ls test/api` (61), `ls test/security` (4),
`ls test/browser` (1: `smoke.spec.ts`); `vitest.unit.config.ts`; `vitest.config.ts`;
`test/unit/listing-detail-display.test.ts` (test names).

**CONFIRMED FACT.** The suite comprises 22 unit files, 61 API files, 4 security files and **one**
Playwright spec. Static counting yields 262 top-level `it(`/`test(` in `test/unit`, 462 in `test/api`,
21 in `test/security`. The freeze review's file counts (22 / 61 / 4) match exactly; its unit test count
(301) is higher than my static count of 262, most plausibly because of parameterised or nested cases —
I did not run the suite, so I make no claim of a discrepancy.

**CONFIRMED FACT.** There are **no component or DOM tests**. Frontend coverage is pure-function only:
`listing-detail-display.test.ts` tests `orderedImageUrls` and `listingAmenities` as functions, never
the rendered `ListingDetailPage`. No test renders a component, and there is no jsdom/happy-dom
environment configured (`environment: 'node'` in both vitest configs).

**Assessment.** This is why three Critical findings above went undetected by a genuinely thorough
784-test suite. A written-but-never-read `useState` (**A2-C04**), a UI button that never reaches the
network (**A2-C05**), and a fabricated fallback branch (**A2-C06**) are all invisible to pure-function
tests and to server-side API tests, both of which pass while the wiring between them is absent. The
server is well tested; the *seam* is not tested at all. `POST /api/payments/local-wallet-proof` is
covered by four API test files and has zero callers in the application — the tests prove the endpoint
works and prove nothing about whether it is used.

**Severity:** Medium (as a structural gap; the consequences are the Criticals above).
**Launch impact:** does not block launch directly; guarantees recurrence of this defect class.
**Narrow correction:** (a) add a lint rule or a small AST check for exported API functions in
`platformApi.ts` with zero callers — this alone would have caught A2-C05; (b) extend
`test/browser/smoke.spec.ts` into a Playwright walkthrough of the single money path
(search → listing → dates → review → payment → receipt) against the real API, which would have caught
A2-C04, A2-C05, and A2-C06 together.
**Required:** code (tests) + governance (make the money path a required check).

---

#### A2-M08 — The public availability endpoint accepts an unbounded date range

**Baseline:** `8a4eba7`.
**Inspected:** `server/routes/listings.mjs:375-427`.

**CONFIRMED FACT.** `from` and `to` come straight from `url.searchParams` via `parseDateOnly`, with
defaults of `now` and `now + 90 days` but **no maximum span and no upper bound on `to`**. The three
`findMany` calls then scan `listingAvailability` and `booking` across whatever range is requested.
The rule matching this path in `RATE_LIMIT_RULES` is `PUBLIC_SEARCH` for `^/api/listings$` only —
`/api/listings/:id/availability` matches no rate-limit rule at all.

**Severity:** Medium.
**Launch impact:** does not block launch.
**Narrow correction:** clamp the span (e.g. reject or truncate anything beyond 365 days) in the same
place `to` is computed; optionally add an availability rate-limit rule.
**Required:** code.

---

#### A2-M09 — `https://localhost` is permanently trusted as a CORS origin, including in production

**Baseline:** `8a4eba7`.
**Inspected:** `server/lib/allowed-origins.mjs` (whole file); `server/index.mjs` `setCors`;
`capacitor.config.ts` (referenced by the comment).

**CONFIRMED FACT.** `CAPACITOR_APP_ORIGINS = ['capacitor://localhost', 'https://localhost']` is merged
into `CORS_ORIGINS` unconditionally — *"ALWAYS allowed — merged in even when a production CORS_ORIGIN
env overrides the default list"*. `isAllowedOrigin` is used both for the CORS response header and to
validate the client-supplied `origin` echoed into Stripe Checkout `success_url` / `cancel_url`
(`server/routes/payments.mjs` `assertAllowedOrigin`).

**Assessment.** The rationale is legitimate (the Android Capacitor webview uses
`server.androidScheme: 'https'`). The comment's claim that *"A browser page cannot forge these as its
origin"* is true of forgery, but `https://localhost` is a real origin that any locally-running HTTPS
service on port 443 legitimately holds. Impact is bounded because sessions are bearer tokens rather
than cookies, so a cross-origin page gains nothing without already holding a token — but the origin is
also accepted into a Stripe redirect URL, which is a different and more sensitive use of the same
allowlist.

**Severity:** Medium.
**Launch impact:** does not block launch.
**Narrow correction:** split the allowlist into two: a CORS list (which may include the Capacitor
origins) and a stricter redirect-target list used by `assertAllowedOrigin` (which should not).
**Required:** code + owner input.

---

#### A2-M10 — The charged amount is carried in a client-side route parameter

**Baseline:** `8a4eba7`.
**Inspected:** `src/app/App.tsx:86,185-191`; `src/modules/bookings/BookingDetailPage.tsx:271-272`;
`server/routes/payments.mjs:67-77,293`.

**CONFIRMED FACT.** The payment route is
`/payment/local-wallet/:bookingId/:amountMinor/:currency`, and the page receives
`amountMinor={Number(bookingPaymentMatch[2])}` directly from the URL.

**CONFIRMED FACT (bounded).** The server is authoritative for the real Stripe path:
`expectedTotalMinor(booking)` recomputes from `booking.amountMinor` plus the server-computed
cancellation-protection premium, and never reads a client amount (`payments.mjs:293`). So this is a
display-integrity issue, not a charge-amount vulnerability — with the exception of the fabricated
wallet path in **A2-C05**, where the URL amount is what the fabricated receipt shows.

**Severity:** Medium.
**Launch impact:** does not block launch (subsumed by A2-C05's correction).
**Narrow correction:** drop `amountMinor`/`currency` from the route and read them from the fetched
booking, as `BookingReviewPage` already does.
**Required:** code.

---

### LOW

---

#### A2-L01 — `scripts/seed-demo-accounts.mjs` uses the naive main-module guard that `server/index.mjs` already fixed

**Baseline:** `8a4eba7`.
**Inspected:** `scripts/seed-demo-accounts.mjs:90`; `server/index.mjs:212-215`.

**CONFIRMED FACT.** The script guards its CLI entry with
``if (import.meta.url === `file://${process.argv[1]}`)``. `server/index.mjs:212-215` documents exactly
why this is wrong and uses `pathToFileURL(process.argv[1]).href` instead, because `import.meta.url`
percent-encodes path characters that naive interpolation does not. I verified the encoding divergence
directly: `pathToFileURL('/Users/x/SYBNB TEST/scripts/a.mjs').href` yields
`file:///Users/x/SYBNB%20TEST/scripts/a.mjs`, which never equals the interpolated form.

**CONFIRMED FACT.** The current repository path contains no spaces, so the guard **does** fire today.
The defect is latent: if the repository is ever checked out under a path containing a space or other
encoded character, `node scripts/seed-demo-accounts.mjs` exits 0 having done nothing, silently. The
comment at `server/index.mjs:213` states this repo has lived at such a path before.

**Severity:** Low.
**Launch impact:** does not block launch.
**Narrow correction:** replace with the `pathToFileURL` form already used in `server/index.mjs`.
Grep confirms this script is the only remaining naive occurrence.
**Required:** code (one line).

---

#### A2-L02 — Unreachable special-offer panel on the listing page

**Baseline:** `8a4eba7`.
**Inspected:** `src/modules/listings/ListingDetailPage.tsx:214-216,559,775-779`.
**CONFIRMED FACT.** The panel is gated `!dateRange.checkIn && offerSummary.count > 0`, but
`dateRange` is always initialised with a populated `checkIn` (`defaultStayDateRange()` never returns an
empty value). The branch cannot render. `offerSummary` — the *other* half of what `loadAvailability()`
fetches — is therefore also effectively unused, making the whole availability fetch dead in practice.
**Severity:** Low. **Launch impact:** does not block launch.
**Narrow correction:** fold into the **A2-C04** fix — once real date selection exists, `checkIn` can
legitimately be empty and the branch becomes meaningful. **Required:** code.

---

#### A2-L03 — CI does not run on the active development branch

**Baseline:** `8a4eba7`.
**Inspected:** `.github/workflows/sybnb-v6-ci.yml` triggers.
**CONFIRMED FACT.** The workflow runs on push to `security/sybnb-v6-predeployment` and `main`, and on
any `pull_request`. All current work is on `claude/intelligent-kilby-5ff258`, which receives no CI on
push. Combined with the local-only, never-pushed policy in the roadmap, CI has not run against this
baseline at all. **Severity:** Low. **Launch impact:** does not block launch.
**Narrow correction:** add `claude/**` to the push trigger, or accept that CI runs only at PR time and
record that as the policy. **Required:** governance.

---

#### A2-L04 — Live-format third-party credentials sit in the untracked worktree `.env`

**Baseline:** `8a4eba7`.
**Inspected:** `.env` (key names and value shapes only); `.gitignore`.
**CONFIRMED FACT.** `.env` is gitignored and untracked (`.gitignore` line 5, with explicit
`!.env.example` / `!.env.test.example` / `!.env.production.example` negations). It holds a Stripe
**test** secret key, a Stripe test publishable key, a Stripe webhook secret, and an
`ANTHROPIC_API_KEY` in live format. `.env.local` is a symlink to the parent checkout.
**Assessment.** No leak into version control; recorded only because the Anthropic key appears to be a
real credential in a working tree that is being copied between worktrees via symlink.
**Severity:** Low. **Launch impact:** does not block launch.
**Narrow correction:** none in-repo; rotate the Anthropic key if it was ever shared.
**Required:** owner input.

---

## 5. Subsystem assessment

| Subsystem | Assessment | Evidence basis | Findings |
|---|---|---|---|
| Object storage abstraction | **Strong.** Explicit driver selection with no default, key regex validated on every I/O, bucket-class separation, environment guards at boot *and* at use, provider errors sanitised. Genuinely well built. | Full read of `object-storage.mjs`, `content-signature.mjs`, `private-document-download.mjs`, `document-access-audit.mjs` | A2-H02, A2-H03, A2-M05 |
| Storage — S3 path | **Unproven.** Structurally sound, zero executions. | Test harness pins `local`; driver throws under `NODE_ENV=test` | A2-H02 |
| Storage — unmigrated modules | **Defective and live.** Two modules on ephemeral disk, routes unconditionally registered. | `driver-document-storage.mjs`, `quebec-document-storage.mjs`, `dispatch()` | A2-H06 |
| Booking state machine | **Incomplete.** Creation is correct and race-safe (advisory lock, transactional re-check); there is no terminal path out of `PAYMENT_PENDING`. | `bookings.mjs:537-635`, `booking-lifecycle.mjs` | A2-C02, A2-M01 |
| Availability enforcement | **Server correct, client absent.** Server enforces; the client never surfaces or even lets a guest pick dates. | `bookings.mjs:549-573` vs `ListingDetailPage.tsx` | A2-C04, A2-L02 |
| Payments — Stripe path | **Sound.** Server-authoritative amounts, origin allowlist, `PAYMENT_PENDING` claim on approval, idempotent ledger writes. | `payments.mjs`, `finance-ledger.mjs` | A2-M10 |
| Payments — wallet path | **Fabricated.** Approval invented in the browser; the real endpoint has no caller. | `SyrianLocalWalletPaymentPage.tsx`, `platformApi.ts` | A2-C05 |
| Payouts | **Non-functional end to end.** No payout-method write path, no withdrawal, "released" means an internal ledger credit. | grep for `payoutMethod`; `wallet.mjs` route table; `admin.mjs:180-241` | A2-H01 |
| Host verification model (C5) | **Correct as written.** Strict server-enum equality, fails closed, credits nothing for a pending submission. | `hostVerificationModel.ts` (full read) | Undermined by A2-C07 (server-side seeded `APPROVED` with no document) |
| Authentication surface | **One unguarded factory.** Register/login/OTP are properly limited; `checkout-guest` is not. | `RATE_LIMIT_RULES` vs `auth.mjs:196` | A2-C01 |
| Rate limiting | **Well designed, incompletely applied.** Central reviewable table, explicit fail-open/fail-closed policy, production requires a distributed store — but the table has gaps. | `server/index.mjs:48-83`, `env.mjs:54-59` | A2-C01, A2-M08 |
| Error handling | **Good discipline.** `error.expose` opt-in gate prevents accidental internal leakage; consistent envelope. | `responses.mjs:52-72` | — |
| Observability | **Effectively absent.** One `console.error`; no correlation, structure, or alerting; 4xx never logged. | grep: 4 `console.*` in all of `server/` | A2-H05 |
| Configuration validation | **Excellent code, broken templates.** `validateProductionConfig()` is thorough and fails loudly; the shipped templates omit nine variables it requires. | `env.mjs` vs `.env.production.example` | A2-C03, A2-M06 |
| Deployment assumptions | **Unverified.** No `prisma generate` in build, runtime client in devDependencies, no Vercel binary target, no region pinning, body-size mismatch. | `package.json`, `vercel.json`, `schema.prisma` | A2-H04, A2-H07, A2-M04 |
| Division isolation | **Nonexistent at runtime.** A development convention with no enforcement mechanism. | `App.tsx`, `dispatch()` | A2-H08, A2-H06 |
| Fabricated data | **Present in three independent places** (fallback inventory, fabricated payment approval, deploy-time demo seed). | `platformApi.ts`, `SyrianLocalWalletPaymentPage.tsx`, `seed-demo-accounts.mjs` | A2-C05, A2-C06, A2-C07 |
| Test architecture | **Strong server-side, no seam coverage.** 87 files, ~745 counted cases, disciplined test-database guard and isolation; zero component tests and one browser spec. | Config + directory + name scan | A2-M07 |
| Documentation accuracy | **Unusually honest.** The freeze review and technical-debt register overstate nothing I could check, and self-report the storage gaps correctly. Gaps are in the *operational* documents (`.env.production.example`) and the contract registry. | Cross-checked every checkable claim | A2-C03, A2-M02, A2-M04 |

---

## 6. Summary counts

| Severity | Count | IDs |
|---|---|---|
| **Critical** | 7 | A2-C01, A2-C02, A2-C03, A2-C04, A2-C05, A2-C06, A2-C07 |
| **High** | 8 | A2-H01, A2-H02, A2-H03, A2-H04, A2-H05, A2-H06, A2-H07, A2-H08 |
| **Medium** | 10 | A2-M01 … A2-M10 |
| **Low** | 4 | A2-L01, A2-L02, A2-L03, A2-L04 |
| **Total** | **29** | |

**By launch impact** (findings may span more than one gate):

| Gate | Findings |
|---|---|
| Blocks internal testing | A2-C03, A2-H04, A2-M06 |
| Blocks closed beta | A2-C01, A2-C02, A2-C04, A2-C05, A2-C06, A2-C07, A2-H01, A2-H02, A2-H03 (conditionally), A2-H07, A2-M01, A2-M04 |
| Blocks public production | A2-C01, A2-C02, A2-C03, A2-C05, A2-C06, A2-C07, A2-H01, A2-H05, A2-H06, A2-H08 |
| Does not block launch | A2-M02, A2-M03, A2-M07, A2-M08, A2-M09, A2-M10, A2-L01, A2-L02, A2-L03, A2-L04 |

**Relationship to previously recorded items.** A2-C04 confirms roadmap **C4** and extends it (the page
has no date picker at all, not merely an unread set). A2-H01 confirms **H3** and extends it (no
withdrawal rail exists at all). A2-H02, A2-H06, A2-M04, A2-M05, and A2-H05 independently confirm items
already recorded in `ARCHITECTURE_FREEZE_REVIEW_2026.md` §3 — I found no case where that document
overstated its position. **A2-C01, A2-C02, A2-C03, A2-C05, A2-C07, A2-H03, A2-H04, A2-H07, A2-M02,
A2-M03, A2-M06, A2-M07, A2-M08 and A2-L01 are, to the best of my determination from the repository, not
recorded in any existing tracked document.**

**Single most consequential chain.** A2-C01 → A2-C02: an unauthenticated, unthrottled account factory
feeding a booking that occupies a listing calendar forever, with no scheduler to release it. Each
finding alone is serious; together they permit an unauthenticated actor to render the entire public
inventory unbookable at negligible cost. Both corrections are small and independent.

---

## 7. Explicit limitations

1. **Nothing was executed.** No test suite, no build, no deployment, no database connection, no
   network call. Every runtime claim above is either derived from reading code (marked CONFIRMED FACT)
   or explicitly marked INFERENCE with its assumption named.
2. **Platform behaviour is asserted from documentation knowledge, not measurement.** Specifically:
   the Vercel serverless request-body limit (A2-H07), Vercel's `headers` matching against rewritten
   `/api/*` paths (A2-M03), npm's `devDependencies` omission under `NODE_ENV=production` and Vercel's
   `node_modules` caching (A2-H04). Each of these should be confirmed against one preview deployment
   before acting on it, and I have said so in the relevant finding.
3. **No live infrastructure was inspected.** Actual Vercel project environment variables, actual Neon
   region, actual R2 bucket configuration, and actual DNS were not accessible. Findings about
   configuration are findings about the **committed templates and code**, which is the only artifact I
   can review.
4. **I did not read the parallel reviews.** `AGENT_1_PRODUCT_UX_ARCHITECTURE_REVIEW.md` and
   `AGENT_3_GOVERNANCE_SECURITY_COMPLIANCE_REVIEW.md` were present in this directory and were not
   opened, per the review instructions. Some overlap in findings is therefore likely, and any
   disagreement between the three reports should be resolved against the code, not by seniority of
   report.
5. **Test-count discrepancy unresolved.** The freeze review reports 301 unit tests; my static count of
   top-level `it(`/`test(` gives 262. File counts match exactly (22/61/4). The difference is most
   plausibly parameterised or nested cases. I did not run the suite and I make **no claim** that the
   documented figure is wrong.
6. **Frontend coverage is not exhaustive.** I read `platformApi.ts` (3,051 lines) via targeted
   symbol-and-consumer search rather than line by line, and I read `ListingDetailPage.tsx`,
   `BookingReviewPage.tsx`, `SyrianLocalWalletPaymentPage.tsx`, and `App.tsx` in the regions relevant
   to the booking and payment path. Other modules — admin, finance, operations, seller, SR — were
   inspected only where a server-side finding pointed into them. **Additional defects of the A2-C05
   class (a UI action that never reaches the server) may exist in the modules I did not walk**, and the
   lint check proposed in A2-M07 is the systematic way to find them.
7. **Severity is engineering severity.** Legal, regulatory, and privacy-regime consequences
   (EV-01…EV-07, D-7, Law 25 / GDPR applicability) are outside my scope and are Agent 3's; where I
   touch them (A2-M04, A2-M05) I flag the engineering fact only and make no legal conclusion.
8. **I did not verify git history beyond the commits named.** Claims about what existed before
   `79a3bbb` rest on `git show 79a3bbb~1` of two specific files.

---

*End of AGENT 2 report. Baseline `8a4eba7`. No tracked file was modified.*
