# SYBNB — End-to-End Validation · Agent 4 (Controller / Auditor) Report

**Author:** Agent 4 — independent Controller / Auditor
**Date of run:** 2026-07-23 (UTC), 04:45 – 05:10
**Scope:** platform integrity, not feature acceptance.

---

## 1. Environment

| Item | Value |
|---|---|
| Working tree | `/Users/mohamedalmashhour/Documents/Codex/SYBNB_STR_FINAL_UPDATED_FOR_CLAUDE_2026_07_05_TEST_FIX/.claude/worktrees/intelligent-kilby-5ff258` |
| Branch | `claude/intelligent-kilby-5ff258` |
| **Baseline commit** | **`6e8b8f2`** — `docs(review): add independent SYBNB final architecture review` |
| Tracked tree at start / at end | Clean → **clean** (no tracked file created, modified or deleted by me) |
| API | `http://127.0.0.1:3051` (`node server/index.mjs`, pid 37229) |
| Web | `http://127.0.0.1:5180` (Vite, pid 37253) |
| Database | `postgresql://…@127.0.0.1:5432/sybnb_v6_dev` (read-only queries via `psql`) |
| `NODE_ENV` | `development` |
| Storage driver | `local` → `/Users/mohamedalmashhour/.claude/jobs/e7a4d38c/tmp/e2e-objects` (`documents/`, `media/`). **R2 not connected.** |
| Browser | Chrome (MCP), own tab `1084201281` |

**Constraints observed.** No Stripe/card path was exercised. `POST /api/host/insights/generate` was never
called. No source, test, config, dependency, schema or tracked doc was modified. No commit, push, merge or
deploy. Database access was read-only (`SELECT` only); no audit-log row was deleted. Only synthetic data
(`e2e-ctl-*`) was created, through the application's own public API.

**Independence.** I did not read the CLIENT, HOST or ADMIN agent reports, and I did not reuse their
accounts or fixtures. Pre-existing *repository* documents were read deliberately, because comparing a
tracked document's claims against the running code is part of my mandate (check 4).

---

## 2. Role and scope

I performed no ordinary client/host/admin feature work. Every action below existed to obtain evidence
about one of: role separation · least privilege · lifecycle truthfulness · booking-state integrity ·
inventory release · payment-state consistency · document-access logging · upload/download controls ·
audit history · state transitions · cancellation records · support-intervention records · financial-state
separation · privacy boundaries · security boundaries · irreversible actions · stale/orphaned records ·
fabricated or misleading states · UI ↔ API ↔ database ↔ documentation discrepancies.

---

## 3. Checks performed

Each check records: **what** · **method** · **expected** · **actual** · **evidence** · **verdict**.

---

### C-01 · `PAYMENT_PENDING` booking denies inventory immediately

**What.** Whether a booking that nobody has paid for occupies the listing calendar.
**Method.**
```
POST /api/auth/checkout-guest  {"deviceId":"e2e-ctl-device-0001-aaaa"}
GET  /api/listings/ca226318-…/availability?from=2026-11-01&to=2026-11-30   (before)
POST /api/bookings {"listingId":"ca226318-…","checkIn":"2026-11-10","checkOut":"2026-11-13","currency":"USD"}
GET  /api/listings/ca226318-…/availability?from=2026-11-01&to=2026-11-30   (after)
```
**Expected.** Either the hold is not published as booked, or it is published *and* releasable.
**Actual.** Before: `"bookedRanges": []`. Booking created with `"status":"PAYMENT_PENDING"`
(id `3e4bb954-b1bd-457e-8d16-82843dd9050b`). After: `"bookedRanges":[{"checkIn":"2026-11-10","checkOut":"2026-11-13"}]`
— returned to an **unauthenticated** caller.
**Evidence.** `server/routes/bookings.mjs:620` (creation status), `:553` and `server/routes/listings.mjs:400`
(`status: { in: ['REQUESTED','PAYMENT_PENDING','CONFIRMED'] }`).
**Verdict.** Confirmed behaviour — feeds C-02.

---

### C-02 · Can the hold ever be released? — **no**

**What.** Every actor and every automatic path that could move a booking out of `PAYMENT_PENDING`.
**Method.** Live API calls + exhaustive grep of every booking-status writer in `server/`.
**Expected.** At least one of: timeout expiry, guest cancel, host action, admin/support action.
**Actual.**

| Release route | Result |
|---|---|
| Guest `PATCH /api/bookings/:id/cancel` | **400 `BOOKING_NOT_CANCELLABLE`** — only `REQUESTED`/`CONFIRMED` (`bookings.mjs:57`) |
| Guest `PATCH /api/bookings/:id/dispute` | **400 `BOOKING_NOT_DISPUTABLE`** — only `CONFIRMED`/`COMPLETED` (`bookings.mjs:231`) |
| Host `PATCH /api/host/requests/:id` | Not reachable — `canConfirm` requires `REQUESTED`, `canCancel` requires `REQUESTED`/`CONFIRMED` (`host.mjs:259-260`) |
| Admin `PATCH /api/admin/review-queue/bookings/:id` | Not reachable — `['REQUESTED','DISPUTED']` only (`admin.mjs:1569`) |
| Admin review **queue listing** | Not listed — `bookingWhere.status in ['REQUESTED','DISPUTED']` (`admin.mjs:266`) |
| Dispute adjudication | Not reachable — claims on `CONFIRMED`/`COMPLETED` (`disputes.mjs:110-112`) |
| `completeExpiredBookings()` | Only touches `CONFIRMED` (`booking-lifecycle.mjs:13`) |
| Scheduler / cron | **None exists.** No cron in `vercel.json`, no `setInterval`, no job runner. All housekeeping is opportunistic-on-read (`expireOldListings`, `completeExpiredBookings`, `purgeExpiredListingDocuments`) and none of them targets `PAYMENT_PENDING` |
| Only real exit | `approvePaymentProof()` claiming `PAYMENT_PENDING` (`finance-ledger.mjs:220-221`) — i.e. an **approved payment**, nothing else |

**Evidence.** Live responses above; grep of `booking.update|updateMany` across `server/`.
**Verdict.** **FAIL — CRITICAL.** `PAYMENT_PENDING` is a **permanent stuck state with no governed
recovery for any role.** In the current dev database **4 bookings older than one day** are already sitting
in it, holding real calendar dates.

---

### C-03 · The hold is invisible to the host and to the admin queue

**What.** Whether anyone can even *see* the reason a date is blocked.
**Method.** Source read of `GET /api/host/overview`, `GET /api/host/listings/:id/availability`, admin
review-queue; live call to the public availability endpoint.
**Expected.** The party who owns the inventory can see what is holding it.
**Actual.**
- `host.mjs:100-103` — `bookings: { where: { status: { not: 'PAYMENT_PENDING' } } }`. The host dashboard,
  its `requests` list, its `totals` and its revenue figure all **deliberately exclude** the hold.
- `host.mjs:481-488` — `GET /api/host/listings/:id/availability` returns **only `listing_availability`
  rows** (host-set blocks). It never returns `bookedRanges`.
- `admin.mjs:266` — the admin review queue never lists `PAYMENT_PENDING` bookings.
- The **public** endpoint `GET /api/listings/:id/availability` **does** return the range (C-01).

**Discrepancy (UI ↔ API ↔ DB).** For the same listing and the same dates, the **public/guest** view says
*booked* and the **host's own** view says *available*. The database says `PAYMENT_PENDING`.
**Verdict.** **FAIL — HIGH.** No source of truth is shared between the two views; the owner of the asset
is the only party who cannot see the encumbrance.

---

### C-04 · A stuck booking permanently blocks account closure

**What.** Interaction between C-02 and the irreversible "close my account" right.
**Method.** `DELETE /api/me` as the guest holding booking `3e4bb954-…`.
**Expected.** Either closure succeeds, or the blocking obligation is itself resolvable.
**Actual.** `409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS` — `me.mjs:10` lists `PAYMENT_PENDING` in
`ACTIVE_BOOKING_STATUSES`.
**Evidence.** Live 409 response.
**Verdict.** **FAIL — HIGH.** Because nothing can clear a `PAYMENT_PENDING` booking (C-02), a guest who
abandons one checkout can **never** close their account. This converts a data-subject/store-policy right
into a permanent dead end. The deletion mechanism itself is otherwise well built (see C-13).

---

### C-05 · Fabricated `APPROVED` payment and receipt with **no server call**

**What.** `confirmWalletPayment` in the Sham Cash payment page.
**Method.** Chrome, own tab. Network capture armed *before* the click.
```
navigate  http://127.0.0.1:5180/#/payment/local-wallet/fallback-booking-9001/4500/USD
read_network_requests (clear)           → tracking active
click     "Sham Cash · 4,500 USD"
read_network_requests urlPattern=/api/  → NO REQUESTS
get_page_text
click     "Open receipt"
```
**Expected.** A payment confirmation is produced only by a server that recorded it.
**Actual.**
- Page text after the click: *"Payment confirmed"*, *"Booking confirmed — The booking is confirmed. Keep
  the reference number and continue your trip."*, *"Payment proofs: 1 file"*.
- **`/api/` network requests during the click: zero.**
- Receipt page `#/payment/receipt/fallback-payment-1784782396018` renders **Status: Approved · Total paid
  4,500 USD · Invoice number INV-FALLBACK · Payment method syrian local wallet**.
- Source: `SyrianLocalWalletPaymentPage.tsx:186-199` → `createLocalProof` →
  `platformApi.ts:1580-1617 createLocalFallbackPaymentProof`, which hardcodes
  `status: 'APPROVED'`, `adminNote: 'local_payment_approved'`, `reviewedById: 'local-payment-test'` and
  stores it in `sessionStorage`. The page additionally writes an `status:'APPROVED'` record to
  `sessionStorage['sybnb_v6_confirmed_payment']` (`:155-170`).
**Verdict.** **FAIL — CRITICAL.** A financial confirmation **and a receipt document** are fabricated
entirely in the browser. Nothing on the server ever saw the transaction.

---

### C-06 · The same button on a **real** booking is a silent dead end

**What.** Behaviour of the only local-payment control on a genuine booking.
**Method.** Same page pointed at real booking `3e4bb954-…`; network armed before the click.
**Expected.** Either it submits a proof, or it shows an error.
**Actual.** **Zero `/api/` requests. No visible change. No error message.** Screenshot confirms the page
is unchanged and shows *"Payment proofs: 0 file"* even though a real `PENDING_ADMIN_REVIEW` proof exists
server-side for that booking.
**Root cause.** `createLocalFallbackPaymentProof` throws `Fallback booking not found`
(`platformApi.ts:1589`) for a real id; `confirmWalletPayment`'s `catch` sets `paymentState='error'` and its
`finally` immediately overwrites it with `'idle'` (`:193-198`), so the `{paymentState === 'error' && …}`
error node at `:302` can never render.
**Additional.** `submitPrototypeLocalWalletProof` (`platformApi.ts:1528`) — the only client wrapper for the
real `POST /api/payments/local-wallet-proof` — has **zero call sites** anywhere in `src/`.
`PaymentProofUpload.tsx` is used only by SELLER/host screens, never in the guest booking flow.
**Verdict.** **FAIL — CRITICAL.** The advertised local (Sham Cash) payment method is **non-functional and
fails silently**. Combined with C-02 this is the mechanism by which an ordinary guest reaches a permanent
stuck state through the normal UI: no wallet payment can be made, no booking can leave `PAYMENT_PENDING`,
and no one can release it.

---

### C-07 · Fabricated listings on API failure

**What.** Whether an API error produces invented inventory.
**Method.** Source trace of `fetchApprovedListings` and every consumer.
**Expected.** An API failure surfaces as an error state.
**Actual.** `platformApi.ts:1182-1187` — `catch { return fallbackApprovedListings(division) }`. `apiRequest`
throws on **any** non-OK status (`:3029`), so a 429, 500 or 503 (database outage, rate limit) silently
substitutes 14 hardcoded `FALLBACK_APPROVED_LISTINGS` owned by a fake `PROTOTYPE_OWNER`.
Consumer-by-consumer:

| Page | Discloses the substitution? |
|---|---|
| `SearchPreviewPage` — **stays entry** | **Yes** — filters them out entirely (`:198`) |
| `SearchPreviewPage` — general entry | Weak — an `isSampleMode` flag |
| `DivisionLivePage` | Weak — stat label flips to "sample inventory" (`:166,170`) |
| `RentalsPage` (`/rentals`, `/buy`) | **No** — renders them as real; its own `catch` can never fire |
| `MarketplaceBrowsePage` | **No** — same |
| `fetchPrototypeListing` detail fallback (`:1520-1524`) | **No** — returns the raw entry *without* the `sybnbDataMode:'sample'` marker |

**Verdict.** **FAIL — HIGH** for RENTALS/BUY/MARKETPLACE and listing-detail; **PASS** for the STAYS search
entry. (STR is protected at that one entry point only.)

---

### C-08 · Private-document download presentation vs `STR_STORAGE_THREAT_MODEL.md` (STG-12)

**What.** Which private-document routes force download.
**Method.** Live header capture on two routes + grep of every file-serving `res.writeHead` in `server/routes/`.
**Expected (per the tracked document).** `docs/security/STR_STORAGE_THREAT_MODEL.md:39` states STG-12 is
**"CLOSED. Private documents are served with `Content-Disposition: attachment` …"**; the requirement at
`:278` is *"Add `Content-Disposition: attachment` … to **all class B and C** file responses."*
**Actual.**

Live — `GET /api/me/id-document/file` (class C, self):
```
content-type: image/png
content-disposition: attachment; filename="sybnb-identity.png"
cache-control: private, no-store
x-content-type-options: nosniff
content-length: 70
```
→ **PASS.**

Live — `GET /api/listings/<id>/documents/<id>/file` (**class B**, owner):
```
content-type: image/png
cache-control: private, no-store
x-content-type-options: nosniff
(no content-disposition, no content-length)
```
→ **renders inline.**

`privateDocumentDownloadHeaders` has exactly **two** call sites (`admin.mjs:402`, `me.mjs:212`). The
following private-document routes serve **inline**, with `content-type` only:

| Route | Class |
|---|---|
| `GET /api/listings/:id/documents/:docId/file` (`listings.mjs:709`) | B |
| `GET /api/admin/listing-documents/:id/file` (`admin.mjs:1092`) | B |
| `GET /api/listings/:id/thread/documents/:id/file` (`messages.mjs:243`) | B |
| `GET /api/admin/driver-documents/:id/file` (`admin.mjs:1036`) | C |
| `GET /api/driver/...documents/.../file` (`driver.mjs:314`) | C |
| Québec driver/vehicle document files (`quebec-driver-onboarding.mjs:195, 441`) | C |

**Verdict.** **FAIL — MEDIUM (control), HIGH (documentation).** The mitigation is implemented on the
identity-document routes only. **The tracked threat model asserts a control that the code does not
implement**, and marks the finding CLOSED. Global CSP `default-src 'none'` and `nosniff` are present on
every response and materially reduce exploitability — but they were explicitly named in the document as
insufficient on their own.

---

### C-09 · Staff document-access auditing vs `STR_STORAGE_THREAT_MODEL.md` (STG-24)

**What.** Whether staff reads of private documents are audited.
**Method.** Grep of `recordStaffDocumentAccess` call sites + read-only query of `admin_audit_logs`.
**Expected (per the tracked document).** `:40` — **"CLOSED at the approved boundary. Staff reads emit
`STAFF_DOCUMENT_ACCESSED` …"**; required test at `:402` — *"Staff access to a **class C** document produces
an audit record."*
**Actual.** `recordStaffDocumentAccess` has exactly **one** call site: `admin.mjs:393`
(`GET /api/admin/id-document/:id/file`). Every `STAFF_DOCUMENT_ACCESSED` row in the database has
`entity_type = 'users'` / `documentCategory = 'identity'` (3 rows). **No** staff read of a driver document,
a Québec compliance document, a listing/compliance document or a thread document emits any audit record.
Driver and Québec driver documents are class C.
**Verdict.** **FAIL — HIGH.** The audit control covers identity documents only. **The tracked document
overstates the boundary**: it claims class-C staff reads are audited; class-C *driver* document reads are
not. (I did not obtain an admin token — see §7 — so this is established by exhaustive call-site analysis
plus the complete audit table, which is dispositive for a *negative*.)

---

### C-10 · Role separation and least privilege

**What.** Whether a GUEST can reach host/admin surfaces or another tenant's data.
**Method.** 15 live negative requests.
**Expected.** 401/403/404 on every one.
**Actual.**

| Request (as controller GUEST unless noted) | Status | Code |
|---|---|---|
| `GET /api/admin/audit-log` | 403 | `FORBIDDEN` |
| `GET /api/admin/review-queue` | 403 | `FORBIDDEN` |
| `GET /api/admin/users/lookup?email=…` | 403 | `FORBIDDEN` |
| `GET /api/admin/platform-metrics` | 403 | `FORBIDDEN` |
| `GET /api/admin/payouts` | 403 | `FORBIDDEN` |
| `GET /api/admin/id-document/<other user>/file` | 403 | `FORBIDDEN` |
| `GET /api/host/overview` | 403 | `FORBIDDEN` |
| `GET /api/host/earnings` | 403 | `FORBIDDEN` |
| `PATCH /api/host/requests/<own booking>` | 403 | `FORBIDDEN` |
| `GET /api/bookings/<other guest's booking>` | 403 | `BOOKING_FORBIDDEN` |
| `GET /api/bookings/<id>` unauthenticated | 401 | `AUTH_REQUIRED` |
| Guest-2 `PATCH …/cancel` on guest-1's booking | 404 | `BOOKING_NOT_FOUND` |
| Guest-2 `PATCH …/contact` on guest-1's booking | 404 | `BOOKING_NOT_FOUND` |
| Guest-2 `POST /api/reviews` on guest-1's booking | 404 | `BOOKING_NOT_FOUND` |
| `POST /api/auth/register {"role":"ADMIN"}` | 429 then blocked by `PUBLIC_REGISTER_ROLES` (`auth.mjs:26,251`) | — |

**Verdict.** **PASS.** Enumeration is avoided (404 rather than 403 on non-owned bookings). ADMIN cannot be
self-registered.

---

### C-11 · Token integrity

**What.** Whether the session token's role claim is trusted.
**Method.** Decoded a valid guest token, rewrote `roles` to `["ADMIN","SUPPORT","HOST"]`, re-encoded the
payload, kept the original signature, called `/api/admin/audit-log`. Also sent `Bearer garbage.sig`.
**Expected.** 401.
**Actual.** **401 `AUTH_REQUIRED`** for both.
**Verdict.** **PASS.** Signature is verified server-side; `sessionVersion` gives real revocation
(`auth.mjs:56-67`, `me.mjs` deletion path).

---

### C-12 · Payment-state consistency (server side)

**What.** Whether the real payment endpoints can be driven into an inconsistent state.
**Method.** Live sequence against booking `3e4bb954-…`.

| Step | Expected | Actual | Verdict |
|---|---|---|---|
| Wallet proof **before** contact info | reject | 403 `GUEST_CONTACT_INFO_REQUIRED` | PASS |
| Underpaying proof (`amountMinor: 1`) | reject | 400 `PAYMENT_AMOUNT_TOO_LOW` | PASS |
| Correct proof (4500 USD) | create `PENDING_ADMIN_REVIEW` | proof `b2af27fc-…`, `status: PENDING_ADMIN_REVIEW`, `reviewedById: null` | PASS |
| Replay the same `providerRef` | reject | 409 `PAYMENT_REFERENCE_DUPLICATE` | PASS |
| Booking status after proof | still `PAYMENT_PENDING` | still `PAYMENT_PENDING` | PASS (as designed) |

Reviewed and found sound (not exercised — Stripe forbidden): server-computed
`expectedTotalMinor` (`payments.mjs:66-78`), server-computed cancellation-protection premium
(`bookings.mjs:613-614`), origin allowlist on Stripe redirect URLs (`payments.mjs:12-19`), webhook
signature verification (`:377-384`), one-time `PAYMENT_PENDING → CONFIRMED/REQUESTED` claim and idempotent
ledger writes (`finance-ledger.mjs:192-230`, `:126-129`).
**Verdict.** **PASS.** The server-side money model is genuinely defended. The failure is that the UI does
not use it (C-05, C-06).

---

### C-13 · Irreversible actions

**What.** Governance of the destructive paths.
**Method.** Source review + the live 409 from C-04.
**Actual.**
- **Account closure** (`me.mjs:15-84`): guarded by non-zero wallet balance and active obligations;
  anonymise-and-retain rather than hard delete; wallet ledger, completed bookings and `admin_audit_logs`
  retained; `sessionVersion` bumped; an `ACCOUNT_SELF_DELETED` audit row is written inside the same
  transaction. **PASS** — well governed.
- **Retention purge** (`listing-document-retention.mjs:57-88`): deletes bytes, keeps the row and writes a
  `LISTING_DOCUMENT_RETENTION_PURGED` audit row. **PASS** in design — but see C-14.
- **Legal hold** correctly survives re-upload and blocks purge. **PASS**.
- **Dispute refund** is idempotency-keyed on the *subject*, so a booking can be refunded at most once even
  across concurrent adjudications (`disputes.mjs:95-119`). **PASS**.

---

### C-14 · Retention clock is never set for most documents

**What.** Whether uploaded compliance documents actually enter the retention policy.
**Method.** Uploaded a synthetic 1×1 PNG as `CITQ_CERTIFICATE` on my own listing, then queried
`listing_documents`.
**Expected.** Every document acquires a retention deadline.
**Actual.**
```
 type              | status              | expires_at | retention_delete_after
 CITQ_CERTIFICATE  | PENDING_REVIEW      | (null)     | (null)     ← mine
 CITQ_CERTIFICATE  | PENDING_REVIEW      | (null)     | (null)
 CITQ_CERTIFICATE  | ADMIN_REVIEWED_TEST | (null)     | (null)
 CITQ_CERTIFICATE  | PENDING_REVIEW      | (null)     | (null)
 CITQ_CERTIFICATE  | ADMIN_REVIEWED_TEST | 2027-05-17 | 2028-05-16
```
`listings.mjs:637-641` derives `expiresAt` solely from `listing.metadata.citqCertificateExpiresAt`. When
that is absent, both `expiresAt` and `retentionDeleteAfter` are `null` — and
`purgeExpiredListingDocuments` selects only `retentionDeleteAfter <= now`, while
`markExpiredListingDocuments` selects only `expiresAt <= now`. **4 of 5** stored compliance documents in
this database are therefore retained indefinitely and are outside every deletion path.
**Verdict.** **FAIL — MEDIUM.** The retention control exists but does not attach to most documents.

---

### C-15 · No scheduler — all housekeeping is opportunistic

**What.** Whether time-based obligations execute without a user request.
**Method.** Grep for cron/interval/job runner; call-site map of every lazy sweep.
**Actual.** No scheduler exists (confirmed in code and in `listing-lifecycle.mjs:37`,
`booking-lifecycle.mjs:7-8`, `listing-document-retention.mjs:43`, which say so explicitly).
`completeExpiredBookings` runs from `/api/me/overview`, `/api/host/*`, `/api/admin/*`;
`expireOldListings` from `/api/listings` and `/api/listings/:id`; `purgeExpiredListingDocuments` **only**
from the compliance dashboard read (`compliance.mjs:277`).
**Verdict.** **NOT IMPLEMENTED — HIGH.** A stay never completes, a listing never expires and a certificate
is never purged unless some human happens to open the right screen. Retention deletion — a legal
obligation — is gated on an admin visiting one page.

---

### C-16 · Audit history — coverage

**What.** Which business events leave evidence.
**Method.** Queried `admin_audit_logs` for every entity I created; enumerated all 46 `adminAuditLog.create`
call sites.
**Expected.** Financially or legally significant events are recorded.
**Actual.** **Zero** audit rows exist for any of: account creation (guest and host), listing creation,
listing-document upload, ID-document upload by the owner, booking creation, guest contact-detail change,
**payment-proof submission**.
```
select … from admin_audit_logs where entity_id in (<all 6 of my entity ids>);  →  (0 rows)
```
Audited events are essentially: admin decisions, host booking decisions, host availability edits, guest
cancel/dispute, disputes, payouts, compliance changes, account closure, staff *identity*-document views.
**Verdict.** **PARTIAL — MEDIUM.** Decisions are audited; **submissions and state creation are not.** A
guest's claim "I paid on date X with reference Y" has no platform-side audit record, only the
`payment_proofs` row itself.

---

### C-17 · Audit history — field integrity

**What.** Whether `admin_audit_logs.entity_type` is canonical.
**Method.** Read `reviewModel`/`updateReviewEntity` + grouped the live table.
**Actual.** `admin.mjs:700-712` writes the **raw path segment** supplied by the caller into
`entityType`. `reviewModel` accepts several aliases per model (`listing|listings`, `payment|payments`,
`iddocument|iddocuments`, any casing) but the alias, not the canonical name, is persisted. The live table
contains `listing` **and** `listings`; `iddocument`, `idDocuments` **and** `iddocuments`; `payments` and
`payment_proofs`.
**Verdict.** **FAIL — LOW/MEDIUM.** Audit records cannot be reliably queried by entity type; an actor can
choose which of several labels their own audit row carries. (The value is allowlist-constrained, so this is
a data-quality and forensic-reliability defect, not an injection.)

---

### C-18 · Financial-state separation — wallet ledger vs cached balance

**What.** Whether `wallets.cached_balance_minor` is reconcilable to `wallet_entries`.
**Method.** Read-only reconciliation query across all wallets; source review of every balance writer.
**Expected.** Cached balance = Σ(CREDIT+REFUND+RELEASE) − Σ(DEBIT).
**Actual.** Two wallets are out of balance:

| wallet | cached | ledger sum | drift |
|---|---|---|---|
| `7bd4d545…` (`demo-guest-…@example.com`) | 476 000 SYP | −24 000 | **+500 000** |
| `098bd2a8…` (`guest@sybnb.dev`) | 500 000 SYP | 0 (no entries at all) | **+500 000** |

Every *application* writer is ledger-backed (`finance-ledger.mjs:126-165`, `wallet.mjs:253-269`), so the
drift originates outside the API (seed/manual). The important finding is the **absence of a control**:
`cached_balance_minor` is what is spent against (`sr-payments.mjs:203,259,387,434`), what is displayed
(`WalletPage.tsx:135,248`), what gates account closure (`me.mjs:23`) and what feeds admin
platform-metrics (`admin.mjs:541,560) — and **no reconciliation, drift check or alert exists anywhere.**
**Verdict.** **FAIL — MEDIUM.** Spendable balance is authoritative but unverified against the ledger; the
current database already demonstrates 1 000 000 SYP of unbacked balance.

---

### C-19 · Cancellation records

**What.** Whether a cancellation produces a complete, truthful record.
**Method.** Source review of `bookings.mjs:36-208` (not executed — my only booking was `PAYMENT_PENDING`
and therefore uncancellable, which is itself C-02).
**Actual.** The path is strong: atomic status claim before any refund work; refund net of a
currency-correct flat late-cancel fee capped at the refund; commission reversed against the account that
actually received it (`originalAdminShareRecipient`); idempotency-keyed ledger writes; and a
`BOOKING_GUEST_CANCELLED` audit row that records the fee actually charged, whether it was waived by
protection or by the free-cancellation window. Frontend copy and server enforcement agree on the window:
`cancellationPolicy.ts:5` `STANDARD_FREE_CANCELLATION_DAYS_BEFORE_CHECKIN = 3` ==
`bookings.mjs:26` `FREE_CANCELLATION_DAYS_BEFORE_CHECKIN = 3`.
**Verdict.** **PASS (by inspection)** for `REQUESTED`/`CONFIRMED`; **BLOCKED** for `PAYMENT_PENDING`,
which has no cancellation record because it has no cancellation.

---

### C-20 · Support-intervention records

**What.** Whether support action is separated and evidenced.
**Method.** Source review of `disputes.mjs`, `admin.mjs`.
**Actual.** SUPPORT may **read** the review queue, dispute queue, SOS queue and identity documents;
only ADMIN may **decide** (`requireAuth(context, ['ADMIN'])` on `PATCH /api/admin/review-queue/:type/:id`,
`PATCH /api/admin/disputes/:id`, payout release). Adjudications write `DISPUTE_REFUNDED` /
`DISPUTE_REJECTED` audit rows plus `resolvedById`, `resolvedAt`, `resolutionNote` on the row.
**Gap.** SUPPORT's *reads* are audited for identity documents only (C-09), and there is **no
purpose/case-reference field** on any audit row — a limitation the threat model itself records honestly.
**Verdict.** **PASS** on decision authority and decision records; **PARTIAL** on read oversight.

---

### C-21 · Privacy boundaries in shared payloads

**What.** Whether counterparties leak PII to each other.
**Method.** Source review + live public listing detail.
**Actual.**
- `GET /api/bookings/:id` — host receives guest `{id, displayName}` only; proofs are projected to strip
  `proofAssetUrl`, `providerRef`, `adminNote`, `reviewedById` for a non-privileged viewer
  (`bookings.mjs:443-462`). **PASS.**
- `GET /api/payments/:id` — same projection (`payments.mjs:687-697`). **PASS.**
- `GET /api/host/overview` — guest email never included (`host.mjs:107-112`). **PASS.**
- `GET /api/listings/:id` (public, unauthenticated) returns `owner.idDocumentStatus` verbatim
  (`listings.mjs:349-353`). Live: `"owner": {…, "idDocumentStatus": null}`. Only `sellerVerified` is needed;
  the raw field can publish `PENDING_REVIEW` or **`REJECTED`** about a private person's identity check.
  **FAIL — LOW.**
- `GET /api/listings/:id/availability` is public and exposes exact occupancy including **unpaid**
  `PAYMENT_PENDING` ranges. Industry-normal for booked ranges; publishing unpaid holds is not.
  **Observation.**
- Rate-limit buckets store only a SHA-256 of the email (`auth.mjs:20-24`). **PASS.**

---

### C-22 · Public trip lookup (unauthenticated surface)

**What.** Whether the confirmation-number lookup can be walked.
**Method.** Live calls with a correct and an incorrect phone.
**Actual.** Correct ref + wrong phone → `404 BOOKING_LOOKUP_NOT_FOUND`. Correct pair → 200 with a
deliberately narrow projection (`confirmationNumber`, `status`, dates, listing titles, division,
`paymentStatus`). Rate-limited 20 / 15 min per IP.
**Verdict.** **PASS.** Two-factor (ref + phone), minimal projection, capped.

---

### C-23 · Lifecycle truthfulness — booking state machine

**What.** Whether the modelled states match reachable states.
**Actual.** `BookingStatus.DRAFT` is defined in the schema and in the Prisma default
(`Booking.status @default(REQUESTED)`), but `POST /api/bookings` always writes `PAYMENT_PENDING`
(`bookings.mjs:620`) — so both `DRAFT` and the schema default are dead. `REQUESTED` is reachable **only**
via `approvePaymentProof` when `instantBookEnabled` is false (`finance-ledger.mjs:214`); i.e. the entire
host accept/decline surface is reachable only *after* money has been taken. `PAYMENT_PENDING` has an
in-edge and exactly one out-edge (payment approval) — C-02.
**Verdict.** **PARTIAL — MEDIUM.** The declared state machine is wider than the implemented one; the
implemented one has an absorbing state.

---

### C-24 · Booking-input integrity

**What.** Date validation at booking creation.
**Method.** Read-only inspection of `bookings` created before my run + `bookings.mjs:472-480`.
**Actual.** The only checks are: parseable dates and `checkOut > checkIn`. There is **no** past-date
rejection and **no** maximum stay length. The database already contains, from the normal API,
`check_in 2020-01-01` (a fully past stay) and `check_in 2027-01-01 → check_out 2527-01-01`
(**a 500-year booking, `amount_minor` 273 931 500**) — both `PAYMENT_PENDING`, both holding inventory,
both unreleasable per C-02.
**Verdict.** **FAIL — HIGH.** A single request can permanently remove a listing from the market for five
centuries. (Rows observed, not created by me; the validation gap is confirmed directly in source.)

---

### C-25 · Upload controls

**What.** Server-side control of uploaded bytes.
**Actual.** MIME + magic-signature allowlists on both media and document paths; `randomUUID()` storage
keys; media keys bound to their owning `ListingMedia` row before serving (`listings.mjs:459-466`);
object-first / metadata-second / cleanup-third ordering with orphan deletion on DB failure
(`me.mjs:164-186`); draft media requires owner/staff. Uploads verified live: ID document and listing
document both stored and both retrievable, files present on disk under the temp storage dir.
**Verdict.** **PASS** for authorization and key handling. Content safety remains open by the project's own
admission (STG-11: signature validation ≠ malware scanning) — **NOT IMPLEMENTED**, honestly documented.

---

### C-26 · Development-only OTP echo

**What.** `POST /api/auth/email-code/send` returns the code.
**Actual.** Live: `{"ok":true,"emailSent":false,"devCode":"317994"}`. Gated on
`process.env.NODE_ENV === 'production'` only (`email-verification.mjs:69`). The same endpoint accepts
`purpose: 'password-reset'` for **any** address, and `POST /api/auth/password-reset` then resets that
account's password — including an ADMIN account — with no second factor.
**Verdict.** **PASS locally / OBSERVATION — HIGH for any non-production deployment.** Any environment that
is reachable but not `NODE_ENV=production` (staging, preview, a misconfigured container) hands out a
full account-takeover primitive for every account on it, admin included. Correct in this dev environment;
the *gating condition* is the risk.

---

## 4. Integrity determination per workflow

Seven criteria: **SoT** = single clear source of truth · **Audit** = complete audit evidence ·
**Recovery** = reversible or governed recovery · **Authority** = correct role authority ·
**No dead end** · **No permanent stuck state** · **No unauthorized exposure**.

| Workflow | SoT | Audit | Recovery | Authority | No dead end | No stuck state | No exposure | Determination |
|---|---|---|---|---|---|---|---|---|
| Booking creation → `PAYMENT_PENDING` | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | **BROKEN** (C-01/02/03/24) |
| Guest pays by card (Stripe) | ✅ | ⚠ partial | ✅ | ✅ | ✅ | ✅ | ✅ | **SOUND by inspection** (not exercised) |
| Guest pays by local wallet (UI) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | **FABRICATED / NON-FUNCTIONAL** (C-05/06) |
| Guest pays by local wallet (API) | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | **SOUND but unreachable from the UI** |
| Guest cancellation (`REQUESTED`/`CONFIRMED`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **SOUND** |
| Host accept/decline | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **SOUND** (but only reachable post-payment) |
| Host inventory visibility | ❌ | ⚠ | ❌ | ✅ | ❌ | ❌ | ✅ | **BROKEN** (C-03) |
| Admin review queue / decisions | ✅ | ✅ | ✅ | ✅ | ⚠ | ⚠ | ✅ | **SOUND**, but blind to `PAYMENT_PENDING` |
| Dispute → refund | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **SOUND** |
| Identity-document upload → review | ✅ | ✅ (views + decisions) | ✅ | ✅ | ✅ | ✅ | ✅ | **SOUND** |
| Listing/compliance-document upload → review | ✅ | ❌ (no read audit) | ⚠ | ✅ | ✅ | ✅ | ⚠ inline serve | **PARTIAL** (C-08/09/14) |
| Document retention / purge | ✅ | ✅ | ✅ | ✅ | ⚠ | ⚠ | ✅ | **PARTIAL** — no clock on most rows, no scheduler (C-14/15) |
| Wallet / ledger | ⚠ two sources | ✅ per entry | ✅ | ✅ | ✅ | ✅ | ✅ | **PARTIAL** — no reconciliation (C-18) |
| Account closure | ✅ | ✅ | n/a (governed) | ✅ | ❌ | ❌ | ✅ | **BROKEN by dependency** (C-04) |
| Public search / browse | ✅ | n/a | ✅ | ✅ | ⚠ | ✅ | ⚠ | **PARTIAL** — fabricated fallback (C-07) |
| Public trip lookup | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | **SOUND** |

---

## 5. Security and privacy observations

1. **Authorization is genuinely strong.** 15/15 negative tests denied; token forgery rejected; ADMIN not
   self-registerable; cross-tenant reads 403/404; no IDOR found on bookings, payments, media or documents.
2. **Server-side money handling is genuinely strong.** Amounts, fees and premiums are all server-computed;
   proof replay, underpayment, double-approval and double-refund are all blocked atomically. The problem is
   that the primary UI path does not call it.
3. **`devCode` gating** (C-26) is the single highest-leverage configuration risk: it is keyed only on
   `NODE_ENV === 'production'`.
4. **Inline serving of class B/C documents** (C-08) and **unaudited class-C staff reads** (C-09) are both
   asserted as CLOSED in a tracked security document.
5. **`owner.idDocumentStatus`** is published on the unauthenticated listing endpoint (C-21).
6. **Unpaid holds are published** as booked ranges to anonymous callers (C-01/C-21), which also gives an
   unauthenticated attacker a cheap denial-of-inventory primitive when combined with C-02 and C-24.
7. **No monitoring or alerting** exists; `recordStaffDocumentAccess` swallows its own write failures by
   design and there is nowhere to route the failure. Honestly documented, still a gap.
8. Global security headers are applied on every response and were verified live: `nosniff`,
   `x-frame-options: DENY`, `referrer-policy`, `permissions-policy`,
   `content-security-policy: default-src 'none'; frame-ancestors 'none'`. CORS omits the header entirely
   for a disallowed origin rather than echoing a value.

---

## 6. Documentation vs reality

| Tracked document | Claim | Reality | Verdict |
|---|---|---|---|
| `docs/security/STR_STORAGE_THREAT_MODEL.md:39` | STG-12 **CLOSED** — private documents served with `Content-Disposition: attachment` | 2 of ≥8 private-document routes; every class B route and every driver/Québec class C route serves inline | **Document overstates the control** |
| same, `:278` | mitigation required on **all class B and C** file responses | identity-document routes only | **Not implemented** |
| same, `:40` | STG-24 **CLOSED at the approved boundary** — staff reads emit `STAFF_DOCUMENT_ACCESSED` | one call site; class-C *driver* document reads unaudited | **Document overstates the boundary** |
| same, `:41-42` | STG-11, STG-14 **OPEN** | matches the code | **Accurate** |
| `docs/architecture/STR_MONEY_MODEL.md:59` | `booking.amountMinor` is the final all-inclusive total, set once | matches `bookings.mjs:601-603`, `payments.mjs:66-78`; my 3-night booking priced exactly 3 × 1500 | **Accurate** |
| `src/shared/booking/cancellationPolicy.ts:5` (guest-facing copy) | free cancellation until 3 days before check-in | server enforces the same 3 days | **Accurate** |
| `server/lib/listing-document-retention.mjs` header | "retain until one year after its own expiry, then queue for secure deletion" | 4 of 5 documents have no clock at all and are never queued | **Control does not attach** |
| `server/lib/booking-lifecycle.mjs:7-8`, `listing-lifecycle.mjs:37` | "there is no scheduler in this deployment" | true | **Accurate and honest** |
| `docs/product/SYBNB_FABRICATED_DATA_REMEDIATION_INVENTORY.md:24,28` | `FALLBACK_APPROVED_LISTINGS` and `createLocalFallbackPaymentProof` are **PROHIBITED** | both still live and reachable at runtime (C-05, C-07) | **Known, unremediated** |

---

## 7. Unresolved blockers

1. **No ADMIN/SUPPORT session.** ADMIN cannot be self-registered, and the only way to obtain one would have
   been `POST /api/auth/password-reset` on an existing admin — which increments `sessionVersion` and would
   have invalidated a parallel agent's live session. I judged that an unacceptable side effect and declined
   it. Consequently C-09 (staff read of a class B/C document produces no audit row), the admin
   `PAYMENT_PENDING` release attempt, and `GET /api/host/overview` hiding a real hold are established by
   exhaustive call-site analysis, route-guard reading and the complete `admin_audit_logs` table rather than
   by a live staff request. All three are *negative* claims, for which that evidence is dispositive.
2. **Stripe/card path not exercised** (explicitly forbidden). C-12's Stripe conclusions are by inspection.
3. **`POST /api/host/insights/generate` not exercised** (explicitly forbidden).
4. **Rate limiting.** `AUTH_REGISTER` is 5 / 15 min **per IP**, shared with three parallel agents on
   `127.0.0.1`; this cost ~13 minutes of wall-clock and prevented me from registering
   `e2e-ctl-guest@sybnb.test` (its verification code was consumed but the account was never created). It
   also means the observed 429s are an artefact of the shared IP, not a finding.
5. **Provenance of the wallet drift** in C-18 is outside the API; I could not determine which script wrote
   it without modifying or running seed code.

---

## 8. Explicit no-fix confirmation

**I changed nothing.** No source file, test, configuration file, dependency, database schema, migration or
tracked document was created, modified or deleted. No commit, push, branch, merge or deploy was made. The
only file I authored is this report, at the path I was instructed to write it to. `git status` at the end
of the run shows the tracked tree clean at baseline `6e8b8f2`; the only untracked paths present are
pre-existing or belong to other agents. The database was read with `SELECT` only; **no audit-log row was
deleted or altered.** All writes to the database were made *through the application's public API*, as
ordinary synthetic user activity, and are listed in §10.

---

## 9. Summary table

| ID | Check | Verdict | Severity |
|---|---|---|---|
| C-01 | `PAYMENT_PENDING` denies inventory immediately, publicly | Confirmed | — |
| C-02 | No actor and no scheduler can ever release the hold | **FAIL** | **CRITICAL** |
| C-03 | Hold invisible to host and to admin queue; host vs public availability disagree | **FAIL** | **HIGH** |
| C-04 | Stuck booking permanently blocks account closure | **FAIL** | **HIGH** |
| C-05 | Fabricated `APPROVED` payment + receipt, zero server calls | **FAIL** | **CRITICAL** |
| C-06 | Local-wallet payment is a silent no-op on real bookings; real endpoint has no caller | **FAIL** | **CRITICAL** |
| C-07 | Fabricated listings on any API failure; undisclosed on 3 surfaces | **FAIL** | **HIGH** |
| C-08 | Class B/C documents served inline; doc claims STG-12 CLOSED | **FAIL** | **MEDIUM** (control) / **HIGH** (doc) |
| C-09 | Staff reads of class B/C documents unaudited; doc claims STG-24 CLOSED | **FAIL** | **HIGH** |
| C-10 | Role separation / least privilege (15 negative tests) | **PASS** | — |
| C-11 | Token forgery and unsigned tokens rejected | **PASS** | — |
| C-12 | Server-side payment-state consistency (5 live cases) | **PASS** | — |
| C-13 | Irreversible actions governed (closure, purge, legal hold, refund) | **PASS** | — |
| C-14 | Retention clock null on 4 of 5 documents → never purged | **FAIL** | **MEDIUM** |
| C-15 | No scheduler; retention/expiry depend on someone opening a page | **NOT IMPLEMENTED** | **HIGH** |
| C-16 | No audit rows for account/listing/booking/proof creation | **PARTIAL** | **MEDIUM** |
| C-17 | `entity_type` written from the caller's path segment; non-canonical | **FAIL** | **LOW/MEDIUM** |
| C-18 | Cached wallet balance unreconciled; 1 000 000 SYP unbacked in DB | **FAIL** | **MEDIUM** |
| C-19 | Cancellation record complete and truthful | **PASS** (inspection) / **BLOCKED** for `PAYMENT_PENDING` | — |
| C-20 | Support may read, only admin may decide; decisions evidenced | **PASS** / **PARTIAL** on read oversight | — |
| C-21 | Privacy projections correct; `owner.idDocumentStatus` public | **PASS** / **FAIL (LOW)** | LOW |
| C-22 | Public trip lookup: two-factor, minimal, rate-limited | **PASS** | — |
| C-23 | `DRAFT` dead; `REQUESTED` only post-payment; absorbing state | **PARTIAL** | **MEDIUM** |
| C-24 | No past-date and no max-stay validation (500-year booking in DB) | **FAIL** | **HIGH** |
| C-25 | Upload authorization, key binding, write ordering | **PASS**; content safety **NOT IMPLEMENTED** | — |
| C-26 | `devCode` echoed whenever `NODE_ENV !== 'production'` | **PASS** locally / **OBSERVATION** | **HIGH** off-prod |

**Counts — 26 checks:** PASS **9** · FAIL **12** · PARTIAL **3** · NOT IMPLEMENTED **2** ·
BLOCKED **0 fully / 3 partially** (see §7).
**By severity of the 12 FAILs:** CRITICAL **3** · HIGH **5** · MEDIUM **3** · LOW **1**.

---

## 10. Synthetic fixtures left behind

All synthetic, all created through the public API, all still present. Nothing was deleted.

**Users** (`sybnb_v6_dev.users`)

| id | email | role | note |
|---|---|---|---|
| `6b1592b5-0106-42fa-9f23-6cd0c5108d08` | `guest-e2e-ctl-device-0001-aaaa@device.sybnb.local` | GUEST | display name set to `E2E Controller`; carries a **synthetic 1×1 PNG** as its "ID document" (`id_document_ref = 6a09d772-c111-4a0b-87c9-84ca7ae38104.png`, `idDocumentStatus = PENDING_REVIEW`) — **it will appear in the admin ID-review queue** |
| `420e1ed8-c675-4ab2-bff5-73151caa9169` | `guest-e2e-ctl-device-0002-bbbb@device.sybnb.local` | GUEST | no data |
| `e765417a-2f87-47ef-91f4-555000964170` | `e2e-ctl-host@sybnb.test` | HOST | password `CtlAudit!2026x` |

`e2e-ctl-guest@sybnb.test` was **never created** (registration blocked by the shared-IP rate limit); only a
consumed `email_verification_codes` row for that address exists.

**Booking / payment**

| entity | id | state |
|---|---|---|
| Booking | `3e4bb954-b1bd-457e-8d16-82843dd9050b` | `PAYMENT_PENDING`, listing `ca226318-3dda-4dea-b494-a005b77aad1b` (owner `c2-host-1784686644`), **2026-11-10 → 2026-11-13**, 4500 USD, contact `E2E Controller / +963900000001` |
| PaymentProof | `b2af27fc-4511-49fb-9c17-0916df006ba7` | `PENDING_ADMIN_REVIEW`, 4500 USD, ref `CTL-REF-0003` — **it will appear in the admin payment review queue** |

⚠ **This booking permanently holds 2026-11-10 → 2026-11-13 on listing `ca226318-…` and, per C-02, cannot be
released by any role.** It also appears in the *public* availability response for that listing. Clearing it
requires either a direct database write or the fix for SYB-002.

**Listing / document / objects**

| entity | id | state |
|---|---|---|
| Listing | `5f0d79fa-63fd-40f0-a9ad-02a8d658f698` | `DRAFT`, "Controller Audit Room", owner = ctl host, 100 USD, Damascus |
| ListingDocument | `ff7c68ca-9b92-4c06-a665-01a2a6a59581` | `CITQ_CERTIFICATE`, `PENDING_REVIEW`, v1, **no retention clock** (C-14) |
| Storage objects | 2 files under `/Users/mohamedalmashhour/.claude/jobs/e7a4d38c/tmp/e2e-objects/documents/` | one 1×1 PNG "ID document", one 1×1 PNG "CITQ certificate" — both synthetic, temp dir, no R2 |

**Rate-limit / verification side effects (self-clearing)**
`email_verification_codes` rows for `e2e-ctl-guest@sybnb.test` (guest-signup) and `e2e-ctl-host@sybnb.test`
(staff-login), both consumed. In-memory `AUTH_REGISTER` / `AUTH_EMAIL_CODE_SEND` buckets for `127.0.0.1`
were consumed and expire on their own.

**Browser state**
Chrome MCP tab `1084201281` holds `sessionStorage` keys `sybnb-v6-local-fallback-payment-proofs` and
`sybnb_v6_confirmed_payment` containing the fabricated proof `fallback-payment-1784782396018`
(the C-05 evidence). Clearing the tab removes it.

**Note on another agent's tab.** My first `navigate` call, made before I created my own tab, retargeted tab
`1084201248` (then on `#/host/stays`). I navigated it straight back to `#/host/stays` in the next call and
did all further work in tab `1084201281`. Nothing was submitted or clicked in that tab.

---

*End of Agent 4 (Controller / Auditor) report.*
