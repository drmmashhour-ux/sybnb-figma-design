# SYBNB — Owner Review Workbook

**Baseline:** `8a4eba7` · **Review package:** commit `6e8b8f2`, branch `review/sybnb-final-independent-review`
**Date:** 2026-07-23 · **Status:** **OWNER DECISION SESSION 01 COMPLETE — 12/12 Critical + 4/4 cross-cutting decided. CLOSED-BETA IMPLEMENTATION COMPLETE (final HEAD `9c83344`).**

### Implementation status (2026-07-23) — closed-beta wave

| Finding | Status | Commit |
|---|---|---|
| SYB-009 SUPPORT OTP | **IMPLEMENTED** | `bc7bfff` |
| SYB-007 checkout-guest rate limit | **IMPLEMENTED** | `64c075b` |
| SYB-018 production env template | **IMPLEMENTED** | `fb0c135` |
| SYB-006 fabricated data removed | **IMPLEMENTED** | `9e768f8` |
| SYB-004 forced download (6/9) | **IMPLEMENTED** | `b65ab36` |
| SYB-005 staff-read audit (5/8) | **IMPLEMENTED** | `32b2152` |
| SYB-002 payment-hold release | **IMPLEMENTED** | `e96eda0` |
| SYB-001 listing date selection | **IMPLEMENTED** | `faa8fdb` |
| SYB-008 STR-only isolation | **IMPLEMENTED** | `9c52903` |
| SYB-011 manual host payouts | **IMPLEMENTED** | `c1612c8` |
| SYB-003 transactional notifications | **IMPLEMENTED** | `7a5b6e0` |
| SYB-010 honest guest surface | **IMPLEMENTED** | `823265c` |
| X-3 Validation Wave 1 (default/EEUR) | **PASSED 20/20** | `2b0d3d7` |

**Verdict:** READY FOR OWNER CLOSED-BETA REVIEW (see `SYBNB_FINAL_IMPLEMENTATION_REPORT.md`). Storage
proven against the **default/EEUR** endpoint — formal EU-jurisdiction validation or an ADR-0010 revision
remains a **public-launch** requirement, and the test token must be rotated. 925 automated tests pass;
nothing pushed/merged/deployed.

**Derived solely from the completed review package.** No finding has been re-prioritised, re-severitised,
merged, split, or dropped. Severity and launch impact are carried verbatim from the consolidated review
and the source agent reports. **No decision has been made on your behalf** — every "Final owner decision"
and "Owner notes" field is blank and stays blank until you fill it.

**Working order:** Critical → High → Medium → Low. Within each tier, findings appear in consolidated-ID
order, not in an order I have chosen for you.

**Legend — Impact:** ● blocks · ○ does not block · ◐ conditional.
**Evidence:** `CR` = `SYBNB_CONSOLIDATED_FINAL_REVIEW.md` · `A1/A2/A3` = source agent report.
**Type:** F ✓ = confirmed fact, additionally verified during consolidation · F = confirmed by source agent · I = inference.

---

# 1. Critical findings

Twelve. All twelve block closed beta. **Two are missing subsystems rather than defects** (SYB-003, SYB-010) — build-it, not fix-it.

---

### SYB-001 — No date selection on the listing page
**Summary.** The listing page renders no date picker. `setDateRange` is declared and never called; availability *is* fetched and expanded into a `disabledDates` set which is then never read. Guests are locked to a hardcoded "tomorrow + 2 nights" default and shown a real price for dates they never chose.
**Evidence.** `CR` SYB-001 · A1-01, A2-C04 · `src/modules/listings/ListingDetailPage.tsx:214, :281` · Type **F ✓**
**Why it matters.** This is the core booking journey. The server rejects overlaps correctly, so the failure surfaces late — after the guest believes they have booked.
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Render an availability-aware picker; enforce `disabledDates` before quote and before continue.
**Alternatives.** (a) as recommended · (b) ship read-only fixed-date listings · (c) defer.
**Dependencies.** None. Roadmap item C4.

**Final owner decision:** **ACCEPTED — verdict CONFIRMED WITH CLARIFICATION. UX redesign authorized; implementation deferred.** *(Owner Decision Session 01, 2026-07-23.)*

**Clarification (now part of the permanent record).**
> The defect is **not** that every booking is forced to tomorrow+2. The real flow is: search → optional search-calendar selection → listing page → booking review. The listing page has **no governed mechanism** to select, modify, validate, or visualize dates, yet the review page instructs the user to change dates there. That contradiction is the core defect. Dates reach the listing page pre-filled from the search bar via `loadSearchDatesDraft()`; the hardcoded default applies only when no search/booking draft exists. Verified at `32b2152`: 0 pickers, 0 `setDateRange()` calls; availability is fetched and expanded into `disabledDates` (`loadAvailability` line 268–281) but never read, and `disabledDates=` is passed by zero callers app-wide.

**Approved remediation objective.** Restore a truthful booking journey — the user must never be instructed to perform an action the interface cannot perform.

**Approved UX principles (owner-stated).** The listing page must support governed date selection that: uses authoritative availability; displays unavailable dates truthfully; preserves search-selected dates; permits governed modification; updates pricing and availability consistently; remains accessible and mobile-friendly; never fabricates availability.

**Boundaries (owner-stated).**
> - **Search** remains authoritative for the initial context; the listing page may preserve, modify, or clear dates but must **not** silently ignore a change.
> - **Server** remains authoritative for availability; the listing page must never infer, cache indefinitely, or fabricate blocked dates, and every displayed availability state must indicate freshness.
> - **Booking Review** copy must remain consistent with actual interface capability — never instruct impossible actions.

**Planning artifact produced 2026-07-23 (design only, nothing implemented).**
> `docs/reviews/final-independent-review/syb-001/SYB_001_LISTING_DATE_SELECTION_DESIGN.md` — current flow, corrected flow, search→listing handoff, date-selection UX, availability-refresh strategy, pricing-refresh strategy, accessibility, mobile, stale-data handling, error handling, source-of-truth boundaries.

**Key design findings.**
> - **This is largely a wiring exercise.** Server-authoritative availability *and* server-computed pricing already exist and react to `dateRange`; the shared `DateRangePicker` already implements `disabledDates` blocking and Clear. What is missing is rendering the picker on the listing page and consuming the already-computed blocked set. This lowers the risk profile below "new component."
> - **Availability freshness is a gap.** `loadAvailability()` fetches a 180-day window once on mount and never re-fetches; the API returns no `generatedAt`. Design recommends an additive server `generatedAt` field, re-fetch on picker-open and before Continue, and a visible freshness indicator.
> - **E2E-12 (server accepts past/invalid dates) is the server half of this client-side finding** and should likely be scoped into the same implementation; fixing either half alone leaves the other open.

**Implementation deferred.** No code, UI, booking-flow, React, or API change was made. Open before build: whether E2E-12 is scoped in, freshness threshold/cadence, mobile presentation (inline vs bottom-sheet), and accessibility scope (operable+labelled vs full grid semantics).

### SYB-002 — `PAYMENT_PENDING` bookings hold inventory permanently
**Summary.** Bookings are created `PAYMENT_PENDING` and occupy availability. They never expire (no scheduler exists), the guest cannot cancel them, the host cannot see them, and no admin release action exists.
**Evidence.** `CR` SYB-002 · A1-02, A2-C02 · `server/routes/bookings.mjs:553`, `host.mjs:100-103`, `booking-lifecycle.mjs:7-9`; `vercel.json` has no `crons` · Type **F ✓**
**Why it matters.** Every abandoned checkout removes a listing's dates permanently and invisibly. Inventory degrades monotonically from first use.
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Expiry window + guest cancel + host visibility + admin release.
**Alternatives.** (a) as recommended · (b) admin release only · (c) make pending bookings non-blocking for availability.
**Dependencies.** Requires the scheduler (SYB-021). **Requires a business rule from you: the expiry window.**

**Final owner decision:** **ACCEPTED — SEQUENCED REMEDIATION AUTHORIZED. Planning and policy design authorized; implementation NOT yet authorized.** *(Owner Decision Session 01, 2026-07-23.)*

**Required outcome (owner-specified).**
> Every `PAYMENT_PENDING` booking must eventually reach one governed outcome: (1) payment proof approved → `REQUESTED`/`CONFIRMED`; (2) admin manual release → governed released state; (3) automatic expiry under an approved policy → inventory restored. No abandoned hold may remain indefinitely. The verified forward transition on approved proof does **not** resolve the abandoned-hold defect.

**Dependencies (owner-recorded).**
> - **SYB-021 scheduler** — pulled forward as a required dependency of this programme.
> - **Owner-approved payment-method expiry policy** — no window value is approved yet.
> - **Confirmation of the governed terminal state** — see S-1 below.
> - **Separate authorization for development-data cleanup** — the six existing dev holds.

**Phasing (owner-specified).** Phase A: host visibility (read-only) + admin manual release. Phase B: payment-method-aware expiry policy matrix (returned for approval before build). Phase C: scheduler (SYB-021) — no cron until policy + execution design approved.

**Planning artifacts produced 2026-07-23 (design only, nothing implemented).**
> - `docs/reviews/final-independent-review/syb-002/SYB_002_HOLD_EXPIRY_POLICY_OPTIONS.md`
> - `docs/reviews/final-independent-review/syb-002/SYB_002_STATE_AND_SCHEDULER_DESIGN.md`
> - `docs/reviews/final-independent-review/syb-002/SYB_002_EXISTING_DEV_HOLD_INVENTORY.md`

**Key findings from planning (feeding the owner's approval decisions).**
> - **State model — smallest change is NO schema change.** `CANCELLED` already releases inventory (outside the occupying triad `REQUESTED/PAYMENT_PENDING/CONFIRMED`); `Booking.metadata` (Json) already exists to carry the release discriminator, reason, prior state and policy version. Recommended over adding an `EXPIRED` enum value, which would require a migration and the withheld schema-change approval. → **owner decision S-1**.
> - **Expiry clock** — recommend stamping `metadata.hold.expiresAt` at creation vs computing at sweep. → **owner decision S-2**.
> - **Eligibility must be proof-state aware, not age-only.** A hold with a `PENDING_ADMIN_REVIEW`/`APPROVED` proof must never be swept — it is a paid booking awaiting review, not an abandoned hold.
> - **Dev-hold count is 6, not 4.** The E2E register recorded four; live read-only enumeration found **six** across five listings (two arrived during E2E validation — the finding demonstrating itself). Of the six, **four are genuinely abandoned (no proof); two carry `syrian_local_wallet` proofs in `PENDING_ADMIN_REVIEW` and must be routed to admin review, not released.** The frozen E2E register is not edited; the reconciliation lives in the inventory doc.
> - **Notification coupling** — every guest-facing expiry warning depends on **SYB-003** (no notification mechanism exists); this is cross-cutting **X-1**.

**Open owner decisions before implementation.** S-1 (terminal state), S-2 (expiry clock), the full policy matrix (all window/extension/notification values), the SYB-021 trigger mechanism (Vercel Cron vs external vs request-driven), the past-dated fast-path rule, and separate authorization for cleaning the six dev holds.

**Do not mark REMEDIATED until:** host visibility exists · admin recovery exists · approved automatic expiry operates · inventory is restored safely · all tests and validation gates pass. **None of these is done** — this decision authorized planning only. No code, schema, cron, or dev-record change was made.

**Approved design decisions (Owner Decision Session 01, 2026-07-23) — planning package accepted.**
> - **S-1 — State model.** APPROVED: reuse the existing `CANCELLED` booking state with governed `metadata`. **No new booking lifecycle enum.** Metadata must distinguish (a) user cancellation, (b) administrative release, (c) abandoned payment-hold expiry.
> - **S-2 — Eligibility clock.** APPROVED: **timestamp-based eligibility evaluated at scheduler execution — do NOT persist an expiry timestamp.** Eligibility computed from creation timestamp + payment status + payment-proof status + current policy version. *(This supersedes the planning doc's recommended "stamp `metadata.hold.expiresAt` at creation"; expiry is now computed at sweep, and the eligibility predicate remains proof-state aware.)*
> - **Policy matrix.** APPROVED as payment-method-specific categories. **No hardcoded durations — all windows remain configurable.** No specific duration value is approved.
> - **Host visibility.** APPROVED, read-only: hosts may see `PAYMENT_PENDING`, hold creation time, payment-pending label, expiry information, current status. Hosts may **not** release holds, approve payments, or modify holds.
> - **Administrator release.** APPROVED, requiring: confirmation · reason · actor · role · timestamp · booking reference · prior state · resulting state · policy version.
> - **Notifications.** Inventory release must **not** depend on notifications; notification failure must never prevent inventory restoration; delivery is best-effort and separately auditable. *(Resolves X-1 for this finding: expiry proceeds without SYB-003; notification is decoupled.)*
> - **Development data.** Do **not** modify the dev database; do **not** release any booking. Retain the four abandoned holds and the two `PENDING_ADMIN_REVIEW` bookings. Await explicit owner cleanup authorization later.
>
> Implementation remains **NOT authorized**. Still open before build: the concrete configurable duration values per method, the SYB-021 trigger mechanism (Vercel Cron vs external vs request-driven), and the past-dated fast-path rule.

### SYB-003 — No notification mechanism of any kind
**Summary.** A platform-wide grep returns one hit, a mislabelled button. Outbound email is limited to verification codes and host insights. The payment model is manual admin review with no asynchronous signalling to anyone.
**Evidence.** `CR` SYB-003 · A1-03 · Type **F**
**Why it matters.** Participants cannot learn that their booking or payment changed state. This is a missing subsystem, not a defect. *(Minority finding — raised by one agent; retained at Critical in consolidation, see `CR` §3.3.)*
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Minimum viable transactional email for booking and payment state changes.
**Alternatives.** (a) as recommended · (b) full notification centre · (c) operate the beta manually via WhatsApp with named staff and stated hours.
**Dependencies.** Uses the already-configured Resend mailer. **Scope is your decision.**

**Final owner decision:** **ACCEPTED — Narrow Transactional Notification Strategy approved. Implementation deferred; design document authorized and produced.** *(Owner Decision Session 01, 2026-07-23.)*

**Objective (owner-specified).** Inform users of important **already-completed** state changes. **NOT** a notification platform.

**Approved scope.** Transactional notifications only: booking submitted/confirmed/cancelled · payment proof received/approved/rejected · reservation cancelled · manual payout initiated/completed · important account actions. **Excluded:** notification centre · activity feed · preferences · push framework · multi-channel orchestration.

**Technology boundary.** Reuse the existing mailer; introduce **no** new notification infrastructure for the beta. The verification-email capability may be extended for transactional events.

**Operational boundary.** Manual staff communication may supplement automated email but must **never replace authoritative application state**.

**Notification principles (owner-specified).** Every notification represents an already-completed authoritative event. Notifications must **never** create state, approve/reject actions, change workflow, modify bookings, release inventory, or release payouts — informational only.

**Confirms prior decisions.**
> - **SYB-002** — inventory release remains independent of notification delivery; notification failure must never block inventory restoration.
> - **SYB-011** — manual payout remains valid; transactional emails may support it but are **not** the authoritative payout record.

**Planning artifact produced 2026-07-23 (design only, nothing implemented).**
> `docs/reviews/final-independent-review/syb-003/SYB_003_TRANSACTIONAL_NOTIFICATION_DESIGN.md` — event catalogue, triggering authoritative workflow, templates, retry strategy, failure handling, audit strategy, delivery-status model, localization, accessibility, source-of-truth boundaries.

**Key design findings.**
> - **Extension, not new infrastructure.** The mailer already unifies Resend + SMTP behind `deliver({to,subject,text})` (`mailer.mjs:142`) with an existing transactional-style sender (`sendHostInsightEmail`); transactional email follows the same subject+text, AR/EN pattern.
> - **Recipient constraint (verified).** A guest may be an anonymous device account with **no email** (SYB-010); the design degrades gracefully with a `NO_CHANNEL` delivery status and never fabricates a channel. Guest-side reachability is genuinely bounded by SYB-010.
> - **Emit after commit, outside the transaction**, keyed for idempotency — so a mail failure cannot roll back or block the authoritative state change (SYB-002 principle).
> - **Recommended beta storage (N-1):** annotate delivery status via `metadata`/audit — no schema change — rather than a `NotificationLog` table.

**Open owner decisions before implementation.** N-1 (delivery-status storage) · guest reachability (bounded by SYB-010) · retry count/backoff · plain-text vs minimal HTML · which events ship in the first cut.

**Implementation deferred.** No code, schema, UI, notification centre, or push was created.

### SYB-004 — STG-12 recorded CLOSED; forced download on 2 of 9 routes
**Summary.** `privateDocumentDownloadHeaders()` has exactly two call sites against nine private-document serve routes. Four private-document paths still render inline, including thread attachments uploaded by an arbitrary counterparty.
**Evidence.** `CR` SYB-004 · A3-02 · `server/routes/me.mjs:212`, `admin.mjs:402` · Type **F ✓**
**Why it matters.** A committed security document overstates a control. The control was completed for identity documents and recorded as closed generally.
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Apply to the remaining routes; correct the committed documents.
**Alternatives.** (a) as recommended · (b) correct the documents only and re-scope the finding · (c) accept.
**Dependencies.** Touching driver and Québec routes requires an explicit unfreeze. **Correction method is decision X-2.**

**Final owner decision:** **ACCEPTED — approved for Wave 0 remediation. REMEDIATED.** *(Owner Decision Session 01, 2026-07-23.)*

**Scope of the approval.**
> Two independent parts, both delivered:
> 1. **Documentation** — correct the security record to reflect the implemented state, distinguishing fully protected routes, protected identity-document paths, remaining unprotected private-document routes, and frozen routes outside scope. Do not overstate implementation status.
> 2. **Code** — apply the existing `privateDocumentDownloadHeaders` helper to the currently unfrozen routes only: `admin.mjs` (2 routes), `listings.mjs`, `messages.mjs`.
>
> Required: reuse the existing helper · do not redesign document delivery · do not modify authorization logic · do not change storage architecture · do not modify Québec/Ride modules · add regression tests covering every unfrozen route in scope · clearly document the intentionally deferred routes.

**Result.** Forced-download coverage increased from **2 of 9** to **6 of 9** private-document routes.

| Route | File | Status |
|---|---|---|
| `GET /api/me/id-document/file` | `me.mjs` | Protected — identity path (2026-07-22) |
| `GET /api/admin/id-document/:userId/file` | `admin.mjs` | Protected — identity path (2026-07-22) |
| `GET /api/listings/:id/documents/:docId/file` | `listings.mjs` | Protected — SYB-004 (2026-07-23) |
| `GET /api/listings/:id/thread/documents/:docId/file` | `messages.mjs` | Protected — SYB-004 (2026-07-23) |
| `GET /api/admin/listing-documents/:docId/file` | `admin.mjs` | Protected — SYB-004 (2026-07-23) |
| `GET /api/admin/driver-documents/:docId/file` | `admin.mjs` | Protected — SYB-004 (2026-07-23) |

**Remaining routes — 3, frozen Québec/Ride.**

| Route | File | Boundary |
|---|---|---|
| driver document file | `server/routes/driver.mjs:314` | Ride |
| Québec onboarding document file | `server/routes/quebec-driver-onboarding.mjs:195` | Québec |
| Québec onboarding document file | `server/routes/quebec-driver-onboarding.mjs:441` | Québec |

**Status of remaining routes.** **Intentionally deferred.** They still render inline and remain an OPEN part of STG-12. No boundary unfreeze was authorized.

**Requirement before any work on the remaining routes.** A **separate Architecture Change Request and explicit owner approval**. This decision authorizes no work on frozen modules.

**Validation.** TypeScript (`tsc --noEmit`) · unit (301) · API (473 across 62 files) · security (21) · production build — **all gates passed**. Regression coverage: `test/api/private-document-forced-download.test.mjs`, 11 tests across all four in-scope routes, written test-first and confirmed failing before the fix.

**Documents corrected.** `docs/security/STR_STORAGE_THREAT_MODEL.md` and `docs/architecture/ADR/ADR-0010-PERSISTENT_OBJECT_STORAGE.md`. The inaccurate claims are struck through rather than deleted, with dated correction notes, so the record shows what was believed and when.

**Consolidation notes (no other finding changed).**
> - `GET /api/admin/driver-documents/:id/file` is an **admin-surface** handler over driver-domain data. It was remediated because it lives in `server/routes/admin.mjs`, a Platform/Admin module; the Ride module's own route (`driver.mjs`) was not touched. The boundary was treated as the *file*, not the data domain.
> - The helper's category allowlist has no `driver` entry and the helper is frozen, so that route serves the generic `sybnb-document.pdf` filename. The protection is the `attachment` disposition, not the label.
> - **STG-24 carries the identical overstatement in the same two documents and was deliberately NOT corrected here.** It is tracked as **SYB-005**, which remains **undecided**. Both corrected documents state this explicitly so it cannot be lost.
> - Cross-cutting decision **X-2** (correction in place vs errata) remains open in general; this finding was corrected in place with dated supersession notes on the owner's instruction, which does not settle X-2 for other documents.

### SYB-005 — STG-24 recorded CLOSED; staff audit on 1 of 9 routes
**Summary.** `recordStaffDocumentAccess()` has exactly one call site. Staff reads of driver, Québec, listing and thread documents leave no trace. `AdminAuditLog.ipHash` is declared and never written.
**Evidence.** `CR` SYB-005 · A3-03 · `server/routes/admin.mjs:393` · Type **F ✓**
**Why it matters.** Same class as SYB-004 — documentation asserts an audit boundary the code does not implement for most paths.
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Apply to the remaining staff read paths; correct the committed documents.
**Alternatives.** (a) as recommended · (b) correct documents only · (c) accept.
**Dependencies.** As SYB-004.

**Final owner decision:** **ACCEPTED — SCOPED REMEDIATION AUTHORIZED. Remediation and validation complete 2026-07-23.** *(Owner Decision Session 01, 2026-07-23.)*

**Scope of the approval.**
> Scoped accept. Add staff document-access auditing to the four **unfrozen** staff-reachable routes, reusing the existing `recordStaffDocumentAccess()` mechanism and the existing `AdminAuditLog` model. Correct the overstated STG-24 documentation. **No Québec/Ride unfreeze.** No audit-architecture redesign, no schema change, no `ipHash` work, no new access-log table.

**Actor boundary (owner-specified).**
> Emit `STAFF_DOCUMENT_ACCESSED` only when the actor acts in an authorized **staff** capacity. Ordinary host, participant, owner and self-service reads are **not** staff access, even on a route that supports multiple actor types. Authorization behaviour preserved unchanged.

**Result.** Staff-read audit coverage increased from **1 of 8** to **5 of 8** staff-reachable routes.

| Route | File | Actor rule | Status |
|---|---|---|---|
| `GET /api/admin/id-document/:userId/file` | `admin.mjs` | staff-only | Audited (2026-07-22) |
| `GET /api/admin/driver-documents/:docId/file` | `admin.mjs` | staff-only | Audited — SYB-005 (2026-07-23) |
| `GET /api/admin/listing-documents/:docId/file` | `admin.mjs` | staff-only | Audited — SYB-005 (2026-07-23) |
| `GET /api/listings/:id/documents/:docId/file` | `listings.mjs` | `isStaff && !isOwner` | Audited — SYB-005 (2026-07-23) |
| `GET /api/listings/:id/thread/documents/:docId/file` | `messages.mjs` | `isStaff && !isParticipant` | Audited — SYB-005 (2026-07-23) |
| `GET /api/me/id-document/file` | `me.mjs` | self-service | Excluded by design (not staff-reachable) |

**Remaining routes — 3, frozen Québec/Ride, intentionally deferred.** Staff reads leave no trace.

| Route | File | Boundary |
|---|---|---|
| driver document file | `server/routes/driver.mjs:314` | Ride |
| Québec onboarding document file | `server/routes/quebec-driver-onboarding.mjs:195` | Québec |
| Québec vehicle document file | `server/routes/quebec-driver-onboarding.mjs:441` | Québec |

**Requirement before any work on the remaining routes.** A **separate Architecture Change Request, explicit owner approval, and an explicit boundary unfreeze.**

**Explicit open items preserved (none resolved by this remediation).**
> - **Three frozen Ride/Québec routes** — OPEN; require an Architecture Change Request.
> - **`AdminAuditLog.ipHash`** — OPEN as a separate security/auditability item. Declared at `prisma/schema.prisma:1057`, no writer anywhere in `server/`. Deferred by owner decision: it affects every audit event, needs a privacy-preserving hashing policy plus trusted-proxy/salt/rotation/retention/test decisions, and a document-access-only writer would create inconsistent audit semantics. **No schema change and no request-origin change authorized.**
> - **Purpose / case-reference field** — OPEN; schema decision deferred.
> - **Audit-failure alert routing** — OPEN; non-blocking by design, depends on STG-22.
> - **Long-term audit storage architecture** (`AdminAuditLog` vs a dedicated document-access log) — OPEN; recorded as a separate architecture decision for later owner review. The existing mechanism is reused here so coverage improves without redesign.

**Excluded by owner decision.** The driver CSV export (**E2E-14**) is **not** part of SYB-005; it remains in the separate runtime register and requires its own owner decision.

**Validation.** TypeScript (`tsc --noEmit`) · unit (301) · API (486 across 63 files, +13) · security (21) · production build — **all gates passed**. Regression coverage: `test/api/staff-document-access-audit.test.mjs`, 13 tests — authorized staff emits the event with the correct document and actor reference; denied access emits no successful-access event; ordinary non-staff and staff-self reads emit nothing; authorization behaviour unchanged; all four unfrozen routes covered; frozen routes neither modified nor asserted as remediated.

**Documents corrected.** `docs/security/STR_STORAGE_THREAT_MODEL.md` (STG-24 status row struck through, dedicated *STG-24 — corrected implementation status* subsection, deep-dive entry annotated, requirement #9 marked partial) and `docs/architecture/ADR/ADR-0010-PERSISTENT_OBJECT_STORAGE.md` (the earlier "undecided" note updated to PARTIALLY REMEDIATED). STG-24 is **not** recorded as fully closed anywhere.

### SYB-006 — Fabricated data reaches real users
**Summary.** Three independent paths: `confirmWalletPayment()` mints an `APPROVED` proof and receipt entirely in the browser with no server call; `fetchApprovedListings` returns 14 fabricated listings owned by "SYBNB Verified Provider" on any API error; the demo seed publishes a real, instant-bookable listing.
**Evidence.** `CR` SYB-006 · A2-C05, A2-C06, A2-C07, A3-12 · `src/shared/api/platformApi.ts`, `scripts/seed-demo-accounts.mjs` · Type **F**
**Why it matters.** A browser can fabricate a payment approval. This is the most serious truthfulness defect in the review and contradicts the platform's own stated rule.
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Delete the browser-side fabrication and fallback inventory; gate the seed against production.
**Alternatives.** (a) as recommended · (b) gate to development builds · (c) accept.
**Dependencies.** **The real endpoint `submitPrototypeLocalWalletProof` currently has zero callers** — it must be wired before the fabricated path is removed, or wallet payment disappears entirely.

**Final owner decision:** **ACCEPTED — approved for Wave 0 remediation, conditional on preserving functional behaviour.** *(Owner Decision Session 01, 2026-07-23.)*

**Owner notes.**
> This approval is conditional on preserving functional behaviour.
>
> **Required sequence — non-negotiable ordering:**
> 1. Implement and validate the real server-backed wallet payment path.
> 2. Verify automated tests for the real workflow.
> 3. Confirm the real workflow is fully operational.
> 4. **Only then** remove the fabricated browser-only confirmation path.
>
> **Do not remove the existing behaviour before the replacement has been validated.**
>
> - Do not expose fabricated payment approvals to users.
> - Do not expose fabricated receipts.
> - Do not expose fabricated financial state.
>
> **Objective:** every payment confirmation and receipt shown to users originates from authoritative
> server state.
>
> This approval does **NOT** authorize redesigning the wallet architecture.
> This approval does **NOT** authorize broader payment-system redesign.
>
> This decision authorizes only the remediation described in the review package, using the required
> sequencing above.

**Consolidation notes (no finding changed).**
> - The owner-mandated sequence resolves the regression risk this finding carried: the review recorded
>   that `submitPrototypeLocalWalletProof` has **zero callers** despite four API test files covering the
>   endpoint, so a delete-first approach would have removed wallet payment entirely. Steps 1–3 must
>   therefore complete and be evidenced before step 4 begins.
> - SYB-006 spans **three** independent fabricated-data paths. The sequencing above governs the
>   **wallet-payment path** specifically. The other two — fabricated fallback inventory on any API error,
>   and the demo seed publishing a live bookable listing — carry no equivalent replacement dependency and
>   are covered by the same approval, gated to production for the seed.
> - Step 4 is the only irreversible step; steps 1–3 are additive.

**Status:** decision recorded. **Implementation not started** — remediation begins only after all 12
Critical findings and all 4 cross-cutting decisions have owner decisions.

### SYB-007 — `/api/auth/checkout-guest` unauthenticated and unthrottled
**Summary.** The route is unauthenticated and matches no rule in `RATE_LIMIT_RULES`, minting unlimited real `User` + `Wallet` rows and session tokens, bypassing the 5-per-15-minutes registration cap.
**Evidence.** `CR` SYB-007 · A2-C01 · `server/routes/auth.mjs:196`; `server/index.mjs` rate rules · Type **F ✓**
**Why it matters.** Alone it is an account factory. Combined with SYB-002 it lets an unauthenticated actor render the entire public inventory permanently unbookable at negligible cost. **This chain was not recorded in any prior artifact.**
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Add a rate-limit rule now; reconsider anonymous account minting before public launch.
**Alternatives.** (a) rule only · (b) rule + redesign anonymous checkout · (c) accept.
**Dependencies.** None. One rule closes the immediate hole.

**Final owner decision:** **ACCEPTED — option (a), rule only. Approved for Wave 0 remediation.** *(Owner Decision Session 01, 2026-07-23.)*

**Owner notes.**
> Scope of this approval is intentionally limited.
>
> Approve adding an authentication rate-limit rule to the existing `/api/auth/checkout-guest`
> endpoint to prevent unauthenticated, unbounded account/session creation.
>
> **This approval does NOT authorize redesigning the guest checkout architecture.** The anonymous
> checkout user experience, account model, wallet model, booking model, and registration flow remain
> outside the scope of this decision and will be evaluated separately after Wave 0.
>
> **Implementation requirements (authorized scope):**
> - Add the missing rate-limit protection.
> - Add automated test coverage.
> - Preserve existing endpoint behaviour except for rate limiting.
> - **Do not redesign guest checkout.**
> - **Do not modify booking, wallet, or registration architecture.**
>
> This decision authorizes only the scoped remediation described in the review package.

**Consolidation note (no finding changed).** Option (b) — redesigning anonymous account minting — is
explicitly **not** authorized and is deferred to a separate post-Wave-0 evaluation. SYB-007 is one half
of the inventory-denial chain; the other half, **SYB-002**, remains undecided and is unaffected by this
approval.

**Status:** decision recorded. **Implementation not started** — remediation begins only after all 12
Critical findings and all 4 cross-cutting decisions have owner decisions.

### SYB-008 — All 8 divisions ship active
**Summary.** Every division remains `status: 'active'` and renders as an open card. The closed-beta boundary is documented and approved but unexecuted.
**Evidence.** `CR` SYB-008 · A1-05, A2-H08 · `src/engines/navigation/divisions.ts` · Type **F**
**Why it matters.** The platform advertises eight businesses when it can operate one.
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Execute the already-approved isolation plan.
**Alternatives.** (a) execute as approved · (b) hide navigation only · (c) accept.
**Dependencies.** The approved isolation plan. Execution only.

**Final owner decision:** **ACCEPTED — full three-layer isolation model approved (execution of the previously approved Division Isolation Plan, not a redesign). Implementation deferred.** *(Owner Decision Session 01, 2026-07-23.)*

**Approved isolation layers (owner-specified).**
> - **Layer 1 — Navigation.** STR (`stays`) remains `active`; all other divisions display **Soon / قريباً** with non-clickable cards. *(Mechanism already exists: `DivisionStatus = 'active' | 'soon'` and `LandingPage.tsx:208` already renders `'soon'` as a disabled card — a status flip, no new navigation code.)*
> - **Layer 2 — Route protection.** Prevent direct navigation into gated divisions (e.g. a direct `#/ride` hash URL); the user receives a governed closed-beta response instead.
> - **Layer 3 — API protection.** **Required and authoritative.** The API is the enforcement layer of record; navigation alone is insufficient because a bypassed SPA still reaches division endpoints. Verified at `32b2152`: no route or API gate keyed on division status exists today.

**Ride (SR).** Existing SR test infrastructure (12 API test files) may remain available **only** within the approved development/test environment. Ride must **not** be exposed in the closed beta; **Ride internals must not be modified**. The gate forcing SR available in test must keep those 12 files passing.

**Frozen modules.** Isolation applies **only** at navigation, routing, and API entry — never inside frozen module internals.

**Implementation deferred.** No code, schema, or config change was made. Execution of an already-approved plan; no new design required before build.

### SYB-009 — `SUPPORT` exempt from staff sign-in step-up
**Summary.** `STAFF_ROLES_REQUIRING_OTP` contains ADMIN, HOST, DRIVER, SELLER — not SUPPORT. A support-only account signs in with password alone, yet can read any user's identity document, upload one onto any account, look up any user by email, read the audit log, and export the driver registry.
**Evidence.** `CR` SYB-009 · A3-01 · `server/routes/auth.mjs:37` · Type **F ✓**
**Why it matters.** The role with the broadest identity-document authority has the weakest sign-in.
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Add `SUPPORT` to the set.
**Alternatives.** (a) as recommended · (b) reduce SUPPORT authority instead · (c) accept.
**Dependencies.** None. A one-token change — the cheapest Critical in this review.

**Final owner decision:** **ACCEPTED — approved for Wave 0 remediation.** *(Owner Decision Session 01, 2026-07-23.)*

**Owner notes.**
> The SUPPORT role has privileged access to highly sensitive identity-document functionality and
> administrative operations. Requiring the same email-based step-up authentication as the other
> privileged roles (ADMIN, HOST, DRIVER, SELLER) aligns authentication requirements with the
> sensitivity of the role.
>
> This change is operationally low risk, has no stated dependencies, and is presented as a minimal
> code change with associated test coverage.
>
> **Implementation requirements (authorized scope):**
> - Add `SUPPORT` to the `STAFF_ROLES_REQUIRING_OTP` set.
> - Add automated test coverage.
> - **Do not broaden the scope of this change.**
> - **No additional authentication changes are authorized under this decision.**
>
> This approval authorizes only the scoped remediation described in the review package.

**Status:** decision recorded. **Implementation not started** — remediation begins only after all 12
Critical findings and all 4 cross-cutting decisions have owner decisions.

### SYB-010 — Guest has no account surface
**Summary.** `GuestAccountPage` and `DashboardPage` are exported and never imported; `/account` and `/dashboard` silently render the landing page. No trips list exists.
**Evidence.** `CR` SYB-010 · A1-04 · Type **F**
**Why it matters.** Two routes present themselves as destinations and are dead ends. A guest has no way to find their booking. Missing subsystem, not a defect.
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Define scope before closed beta.
**Alternatives.** (a) wire the orphaned pages and add a trips list · (b) remove the dead routes and rely on the booking-lookup link · (c) defer.
**Dependencies.** **Scope is your decision.**

**Final owner decision:** **ACCEPTED — Honest Closed Beta Guest Surface approved (option b). Implementation deferred.** *(Owner Decision Session 01, 2026-07-23.)*

**Closed beta (owner-specified).** Do **not** build a full guest account subsystem; do **not** expose unfinished guest account pages. The official guest self-service entry point remains **booking lookup (`/track`)**, supported by transactional email (SYB-003) and manual support.

**Dead routes.** `/account` and `/dashboard` must **not** silently render the marketing landing page (verified at `32b2152`: `App.tsx:102-103` renders `<LandingPage>` for both). Replace with a governed closed-beta response, or remove those routes from the beta. Users must never be presented with misleading navigation.

**Public launch (deferred to a separate owner decision).** Authenticated guest accounts · guest dashboard · trip history · booking management · saved payment methods · profile management · notification centre · guest preferences · loyalty.

**Relationship to prior decisions.**
> - **SYB-002** — payment holds remain authoritative without a guest dashboard.
> - **SYB-003** — transactional emails remain the primary communication mechanism (and bound guest reachability, since an anonymous guest may have no email).
> - **SYB-011** — manual payout communication remains valid.
> - **SYB-008** — closed beta remains limited to the approved STR scope.

**Verified.** `GuestAccountPage` (imported by 0 files) and the guest `DashboardPage` (App.tsx imports only Host/Driver dashboards) are orphaned dead code; `/track` (`App.tsx:157` → `TripLookupPage`, confirmation + phone) is the only guest booking view. Wiring the orphaned pages risks exposing unfinished surfaces — the approved minimal option avoids touching them.

**Implementation deferred.** No code, routing, UI, schema, or API change was made.

### SYB-011 — No payout write path and no withdrawal rail
**Summary.** `User.payoutMethod` is read by admin but has no write path anywhere. No withdrawal endpoint exists. "RELEASED" is an internal ledger credit; account closure requires a zero balance.
**Evidence.** `CR` SYB-011 · A1-07, A2-H01 · `src/modules/host/HostEarningsPage.tsx` · Type **F**
**Why it matters.** The platform takes a 13% commission with no mechanism for money to leave it.
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Resolve before accepting real bookings.
**Alternatives.** (a) payout capture + withdrawal path · (b) manual off-platform payout with a documented process and written disclosure to beta hosts · (c) defer.
**Dependencies.** **Requires a payout-rail decision from you.** Roadmap item H3.

**Final owner decision:** **ACCEPTED — Manual Beta Payout Strategy approved. Implementation deferred; two design documents authorized and produced.** *(Owner Decision Session 01, 2026-07-23.)*

**Closed beta (owner-specified).** Manual host payouts approved. Hosts must receive **written disclosure before onboarding**, stating: payouts are performed manually · expected payout timing · approved payout methods · review requirements · support process.

**Host payout registration.** Planning approved — design a governed workflow for a host to register a payout destination. **Planning does not authorize implementation.**

**Public launch.** Production payout infrastructure remains **deferred**. A future separate owner decision governs payment provider · KYC · AML · payout rails · reconciliation · tax reporting · compliance.

**Account closure.** **Do not modify current closure behaviour.** Instead a separate design covers payout states: pending · initiated · completed · failed · disputed · abandoned account · retention · audit.

**Ride boundary.** Do **not** reuse the frozen Ride payout implementation; Ride remains independently frozen.

**Planning artifacts produced 2026-07-23 (design only, nothing implemented).**
> - `docs/reviews/final-independent-review/syb-011/SYB_011_HOST_PAYOUT_REGISTRATION_DESIGN.md` — manual-payout disclosure spec + governed registration workflow (write path to the existing `User.payoutMethod` `Json?` column; no schema change anticipated; no money rail).
> - `docs/reviews/final-independent-review/syb-011/SYB_011_ACCOUNT_CLOSURE_PAYOUT_STATE_DESIGN.md` — payout lifecycle states and how they *would* interact with closure; current closure behaviour left unchanged.

**Key design findings.**
> - **`User.payoutMethod` already exists as `Json?`** with a documented shape (`{ type: 'sham_cash', phone, receiverName }`), surfaced only to admin payout reminders. Registration is a governed write path to an existing column — **no schema change anticipated**.
> - **The E2E-11 trap is real and left as-is by instruction.** A host with *released* earnings has a non-zero `cachedBalanceMinor` and no withdrawal rail, so closure guardrail 1 (`me.mjs:23`, `WALLET_NOT_EMPTY`) makes the account unclosable. The closure design defines the payout-state model a *future* authorized change would use to resolve it; it changes nothing now.
> - **Recommended beta storage (P-1):** annotate payout state without a schema change (like SYB-002), rather than a dedicated `Payout` table.

**Open owner decisions before implementation.** Approved payout-method set · payout SLA figure · disclosure copy/version · whether registration ships in the beta or is collected manually · P-1 (state storage) · P-2 (closure with pending payout: pay-before-close vs close-with-retained-obligation) · abandoned-balance/escheatment policy (legal input).

**Implementation deferred.** No code, schema, API, UI, or payout rail was created.

### SYB-018 — Production template omits every required storage and Redis variable
**Summary.** `.env.production.example` contains none of the seven `STORAGE_*` variables and neither `UPSTASH_*` variable that `validateProductionConfig()` requires. A deployment built from the documented template cannot boot.
**Evidence.** `CR` SYB-018 · A2-C03 · `.env.production.example`; `server/lib/env.mjs` · Type **F ✓**
**Why it matters.** The only blocker in this review that stops **internal testing**, not just launch. Zero-risk to fix.
**Internal testing** ● · **Closed beta** ● · **Production** ●
**Recommended decision.** Add the variable names with placeholder values.
**Alternatives.** (a) as recommended · (b) accept.
**Dependencies.** None. Documentation only — no real values.

**Final owner decision:** **ACCEPTED — approved for Wave 0 remediation.** *(Owner Decision Session 01, 2026-07-23.)*

**Owner notes.**
> Recorded as ACCEPTED. Scope and owner notes preserved exactly as given.
>
> **Authorized scope:** documentation only — `.env.production.example`.
>
> **Explicitly excluded from this decision:**
> - **A2-M06** (Medium finding — `STORAGE_DRIVER` absent from every committed env template).
> - **`STORAGE_DRIVER`.**
>
> **Do not modify:** the Consolidated Review · the Decision Matrix · the Remediation Roadmap · the
> Decision Session document · source code · tests · runtime validation · infrastructure.
>
> Do not begin remediation. Do not commit, push, merge, or deploy.

**✅ SCOPE CONFLICT RESOLVED — owner clarification, 2026-07-23 (supersedes the exclusion below).**
> **`STORAGE_DRIVER` is now INCLUDED in the scope of SYB-018.** The approved scope is **every variable
> required by `validateProductionConfig()`** for `.env.production.example`.
>
> **This inclusion applies ONLY to the production template.** It does **not** authorize changes to:
> `.env.example` · `.env.test.example` · developer templates · **A2-M06** · runtime validation logic ·
> storage architecture · Redis architecture.
>
> **Only placeholder values are authorized.**
>
> This clarification supersedes the earlier exclusion of `STORAGE_DRIVER` recorded below. The
> conflict is closed; SYB-018 is fully scoped and no longer partially open.

**⚠ SCOPE CONFLICT AS ORIGINALLY RAISED (superseded above — retained for the record, not deleted).**
> `STORAGE_DRIVER` is **one of the seven production-required storage variables** this finding is about,
> not a separate concern. `validateStorageConfig()` calls `resolveStorageDriver(env)` as its **first**
> action (`server/lib/object-storage.mjs:73`), and that function throws when `STORAGE_DRIVER` is absent
> (`:58-65`). Production additionally requires the value to be exactly `s3` (`:86-90`).
>
> **Consequence as scoped:** adding the other variables while excluding `STORAGE_DRIVER` leaves
> `.env.production.example` still incomplete, and a deployment built from it still refuses to boot —
> failing on `STORAGE_DRIVER` instead of on `STORAGE_S3_ENDPOINT`. The finding's stated purpose (a
> documented template that produces a bootable deployment) would not be achieved.
>
> **Distinction from A2-M06.** A2-M06 concerns the *developer* templates — `.env.example` and
> `.env.test.example` (both currently contain 0 `STORAGE_*` lines). SYB-018 concerns
> `.env.production.example`. Excluding A2-M06 from this decision is coherent and is respected;
> excluding `STORAGE_DRIVER` from the production template is what conflicts.
>
> **Options for the owner:** (i) include `STORAGE_DRIVER` in `.env.production.example` only, keeping
> A2-M06 and the developer templates out of scope; (ii) keep the exclusion as recorded and accept that
> SYB-018 remains partially open; (iii) re-scope.
>
> **No resolution assumed.** Remediation has not begun and will not begin on this item until clarified.

**Status:** decision recorded with an open scope question. **Implementation not started.**

---

# 2. High findings

Seventeen.

| ID | Short title | Summary & why it matters | Evidence | IT | CB | PP | Recommended | Alternatives | Dependencies | Decision | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **SYB-012** | Ride/Québec storage still ephemeral | `driver-document-storage.mjs` and `quebec-document-storage.mjs` retain a local `STORAGE_DIR`; no content validation. Driver licences and vehicle registrations would be silently lost in production. Contained only by the freeze | A2-H06, A3-07 · **F ✓** | ○ | ◐ | ● | Migrate on unfreeze, or formally accept | (a) migrate now (b) accept while frozen (c) block routes | Requires unfreeze | ______ | ______ |
| **SYB-013** | No observability (STG-22) | One `console.error`; no correlation, structure, aggregation or alerting. Several other mitigations assume someone notices | A2-H05, A3-13 · **F** | ○ | ○ | ● | Error aggregation + storage signals | (a) full (b) aggregation only (c) defer | None | ______ | ______ |
| **SYB-014** | S3 driver has never executed | Unreachable from every test; unproven against R2. The central claim of the storage work is untested | A2-H02 · **F ✓** | ○ | ● | ● | Execute Validation Wave 1 | (a) execute (b) defer | **Requires authorising the first Cloudflare connection** | ______ | ______ |
| **SYB-015** | Storage migration has no backfill | Every pre-migration object is now unreachable through the new path | A2-H03 · **F** | ○ | ◐ | ● | Audit whether any real pre-migration object exists, then decide | (a) audit + backfill (b) confirm none exist | None | ______ | ______ |
| **SYB-016** | Published privacy/security claims contradicted by code | Privacy Policy claims phones are hash-only while `booking.metadata.guestContactPhone` is plaintext; `contracts.mjs:40` publishes "tokens never stored in localStorage" while `platformApi.ts:592` stores them there | A1-09, A3-06, A3-11 · **F** | ○ | ● | ● | Correct the claims **and** the code | (a) claims (b) code (c) both | None | ______ | ______ |
| **SYB-017** | Demo seed creates verified accounts and a live listing | Creates an `APPROVED`, instant-bookable public listing and three `idDocumentStatus:'APPROVED'` accounts with no documents. `isDemo` is declared in the schema and read by no code. `.env.production.example` instructs running it at deploy | A2-C07, A3-12 · **F** | ○ | ● | ● | Refuse under production; suppress from search | (a) as recommended (b) delete the seed | None | ______ | ______ |
| **SYB-020** | ID documents have no hold; replacement destroys evidence | Replacement and self-deletion destroy prior evidence unconditionally; a rejected document can be overwritten immediately. Legal hold exists for `ListingDocument` only. This is D-7 **plus** an unrecorded fraud-hold gap | A3-05 · **F** | ○ | ● | ● | Decide D-7 policy now; implement holds before public | (a) implement holds (b) decide policy only (c) defer | **Deletion is irreversible — deferral forecloses options permanently** | ______ | ______ |
| **SYB-021** | No scheduler; time transitions are traffic-driven | Every time-driven transition depends on incoming traffic. `vercel.json` has no `crons` | A2-M01, A3-09 · **F ✓** | ○ | ● | ● | Introduce a scheduled-execution mechanism | (a) Vercel cron (b) external trigger (c) defer | **Blocks SYB-002 and SYB-032** | ______ | ______ |
| **SYB-022** | D-2 fail-closed not implemented; routes unrated | Approved decision D-2 requires private document routes to be fail-closed; `index.mjs:68` sets `failMode: 'open'`. Four upload routes match no rate-limit rule at all | A3-04 · **F ✓** | ○ | ● | ● | Implement the approved decision | (a) implement (b) revise D-2 | None | ______ | ______ |
| **SYB-023** | Prisma generate absent from Vercel build | `@prisma/client` is a devDependency; no runtime binary target declared; generation missing from the build | A2-H04 · **F** | ● | ● | ● | Add generate + binary target; move the dependency | (a) as recommended (b) accept | None | ______ | ______ |
| **SYB-024** | Search recovery actions inert | Reset, Show-all and Retry all only clear a display label; nothing retries | A1-06 · **F** | ○ | ● | ● | Wire each action | (a) wire (b) remove the buttons | None. Roadmap H6 | ______ | ______ |
| **SYB-025** | No request-body cap; uploads exceed serverless limits | `readJson` has no cap; upload payloads are sized above the serverless request-body limit | A2-H07, A3-10 · **F** | ○ | ● | ● | Body cap + limits on unrated routes | (a) cap + limits (b) cap only | None | ______ | ______ |
| **SYB-026** | No confirmation on irreversible admin actions | Approve/reject, payout release/hold and refund are single-click with no undo | A1-08 · **F** | ○ | ● | ● | Confirmation dialogs showing key figures | (a) dialogs (b) accept | None. Roadmap C7 | ______ | ______ |
| **SYB-027** | FR exposed; 2 of 68 screens localized | The French toggle is offered platform-wide while almost every screen silently renders English | A1-10 · **F** | ○ | ● | ● | Hide FR for the Syria launch | (a) hide (b) complete FR | None. Roadmap S4 | ______ | ______ |
| **SYB-028** | Guest count never sent to the API | Occupancy is collected in the search bar and dropped before the query | A1-12 · **F** | ○ | ● | ● | Pass occupancy into filtering | (a) pass it (b) remove the control | None. Roadmap H6 | ______ | ______ |
| **SYB-029** | Host buttons route wrongly, one into an ADMIN gate | Host dashboard header controls lead to incorrect destinations; "Settings" routes into an ADMIN gate | A1-11 · **F** | ○ | ● | ● | Correct the targets | (a) correct (b) remove | None | ______ | ______ |
| **SYB-031** | Account deletion leaves email in audit payloads | Deletion nulls `email` on the user row, but `ID_DOCUMENT_SAFE_SELECT` writes email and storage key into retained `AdminAuditLog.after` | A3-08 · **F** | ○ | ○ | ● | Redact retained audit payloads | (a) redact (b) accept | None | ______ | ______ |

---

# 3. Medium findings

Twenty-two, carried verbatim. None blocks internal testing.

| ID | Short title | Why it matters | Evidence | CB | PP | Recommended | Decision | Notes |
|---|---|---|---|---|---|---|---|---|
| **A1-13** | Server errors reach Arabic users in English | Appear exactly when the user is confused | A1 · F | ● | ○ | Localize server error surfacing | ______ | ______ |
| **A1-14** | No support path in listing-creation or admin | Host supply is the scarce resource at beta | A1 · F | ● | ○ | Add a support entry point | ______ | ______ |
| **A1-15** | Québec/Canada artifacts in the Syria-first path | Undermines Syria-first positioning. Roadmap S5 | A1 · F | ● | ○ | Gate Québec surfaces off the Syria market | ______ | ______ |
| **A1-16** | Checkout draft fragile; recovery message never displayed | Compounds SYB-001 | A1 · F | ◐ | ○ | Fix with SYB-001 | ______ | ______ |
| **A1-17** | Flow-step "Next" actions are no-ops or non-sequiturs | Erodes navigational trust | A1 · F | ○ | ○ | Correct or remove | ______ | ______ |
| **A1-18** | Search error promises cached results that do not exist | Integrity gap. Roadmap S2a, copy-only | A1 · F | ● | ○ | Correct the copy | ______ | ______ |
| **A2-M01** | Time-driven transitions are traffic-driven | Root of SYB-021 | A2 · F | ● | ○ | See SYB-021 | ______ | ______ |
| **A2-M02** | Two divergent API contract registries, both stale | Served one covers under half the surface | A2 · F | ○ | ○ | Consolidate or retire | ______ | ______ |
| **A2-M03** | Three independent CSP definitions, one contradicting the split-API design | Configuration drift | A2 · F | ○ | ○ | Reconcile | ______ | ______ |
| **A2-M04** | No region pinning; production template leaves DB region unfilled | Ties to D-1/D-6 | A2 · F | ● | ○ | Decide D-6 then D-1 | ______ | ______ |
| **A2-M05** | Failed object deletion after account closure makes the object permanently undeletable | Privacy residue | A2 · F | ○ | ○ | Reconciliation path | ______ | ______ |
| **A2-M06** | `STORAGE_DRIVER` absent from every committed env template | A fresh developer's uploads fail closed | A2 · F | ○ | ○ | Add to templates (with SYB-018) | ______ | ______ |
| **A2-M07** | Test architecture cannot detect the defect class behind three Criticals | **Would have caught SYB-001, SYB-006** | A2 · F | ○ | ○ | Extend test architecture | ______ | ______ |
| **A2-M08** | Public availability endpoint accepts an unbounded date range | Cost and load | A2 · F | ○ | ○ | Bound the range | ______ | ______ |
| **A2-M09** | `https://localhost` permanently trusted as a CORS origin, including production | Capacitor requirement; still a standing grant | A2 · F | ○ | ○ | Review the necessity | ______ | ______ |
| **A2-M10** | Charged amount carried in a client-side route parameter | Server authority must be confirmed | A2 · F | ○ | ○ | Verify server-side derivation | ______ | ______ |
| **A3-09** | Retention deletion has no scheduler; 4 of 5 document types have no policy | Depends on SYB-021 | A3 · F | ○ | ● | Policy + scheduling | ______ | ______ |
| **A3-10** | No request-body size cap | Consolidated into SYB-025 | A3 · F | ● | ● | See SYB-025 | ______ | ______ |
| **A3-11** | Privacy notice omits processors, transfers, AI processing, ID retention; simultaneously "DRAFT" and dated | Consolidated into SYB-016 | A3 · F | ● | ○ | See SYB-016 | ______ | ______ |
| **A3-12** | `isDemo` read by no code; seed documented for production | Consolidated into SYB-017 | A3 · F | ● | ● | See SYB-017 | ______ | ______ |
| **A3-13** | Audit-write and rate-limit-store failures swallowed to `console.error` | Consolidated into SYB-013 | A3 · F | ○ | ● | See SYB-013 | ______ | ______ |
| **SYB-030** | `§16.1` of the launch readiness review is stale | Names ephemeral storage as an open blocker; resolved for the four migrated modules | A1, CR §3.1 · F ✓ | ○ | ○ | Correct or supersede (decision X-2) | ______ | ______ |

---

# 4. Low findings

Eight. None blocks any gate.

| ID | Short title | Why it matters | Evidence | Recommended | Decision | Notes |
|---|---|---|---|---|---|---|
| **A1-19** | Loading and error states not announced to assistive technology | Accessibility | A1 · F | Add live-region announcements | ______ | ______ |
| **A1-20** | No PWA manifest or app icon | Roadmap S6 | A1 · F | Add manifest + icon | ______ | ______ |
| **A2-L01** | Demo seed uses the naive main-module guard already fixed in `server/index.mjs` | Consistency | A2 · F | Align the guard | ______ | ______ |
| **A2-L02** | Unreachable special-offer panel on the listing page | Dead UI | A2 · F | Remove or wire | ______ | ______ |
| **A2-L03** | CI does not run on the active development branch | Regressions land unchecked on the working branch | A2 · F | Add the branch to CI triggers | ______ | ______ |
| **A2-L04** | Live-format third-party credentials in the untracked worktree `.env` | Untracked and gitignored; rotation is cheap | A2 · F | Review and rotate if real | ______ | ______ |
| **A3-14** | 90-day session TTL, default scrypt cost, unvalidated Host header | Record and decide | A3 · F | Review parameters | ______ | ______ |
| **A3-15** | Audit log readable by the roles it audits; no append-only guarantee | Governance decision | A3 · F | Restrict read access or add integrity | ______ | ______ |

---

# 5. Cross-cutting decisions

Four decisions that are not attached to a single finding.

| # | Decision | Why it is yours | Decision | Notes |
|---|---|---|---|---|
| **X-1** | Does the closed beta open before or after SYB-003 (notifications) and SYB-011 (payouts)? | Determines whether the beta is manually operated | **ACCEPT — open as a managed operational beta** | See X-1 detail below |
| **X-2** | Do committed documents get corrected in place, or by appended errata? | Sets the governance precedent for how error is recorded (affects SYB-004, SYB-005, SYB-030) | **RATIFY — strike-through + dated correction is the standard** | See X-2 detail below |
| **X-3** | Does Validation Wave 1 execute now, given SYB-014 blocks closed beta? | Requires authorising the first Cloudflare connection | **ACCEPT — execute before the beta opens; success is a beta gate** | See X-3 detail below |
| **X-4** | Is SYB-012 formally accepted while Ride and Québec stay frozen? | Converts a live defect into a recorded accepted risk with a named trigger | **ACCEPT — accepted while frozen, with an enforced unfreeze gate** | See X-4 detail below |

*(All four decided in Owner Decision Session 01, 2026-07-23.)*

### X-1 — ACCEPT: Closed Beta opens as a managed operational beta
**Required before the first participant:** named operations owner · published support channel · response hours · response SLA · manual payout schedule · beta participant disclosure · known limitations. This confirms the manual-operation posture implied by SYB-003 (narrow transactional email + manual support), SYB-011 (manual payout + written disclosure), SYB-010 (booking-lookup + manual support), and SYB-008 (STR-only scope).

### X-2 — RATIFY: strike-through + dated correction is the programme correction standard
Strike-through of the inaccurate text **plus** a dated correction note (preserving what was believed and when) is the ratified method. The existing corrections in **SYB-004** and **SYB-005** (threat model + ADR-0010) are **ratified as-is**. The same method has now been **applied to SYB-030** — the stale §16.1 of `docs/product/SYBNB_FULL_PLATFORM_LAUNCH_READINESS_REVIEW.md` (2026-07-23). **Existing corrected documents are NOT to be converted into separate errata.**

### X-3 — ACCEPT: Validation Wave 1 must execute before the closed beta opens
**Requirements:** synthetic data only · test credentials · test bucket · isolated validation harness · **no production data · no production buckets**. **Successful validation is a beta gate.** Verified state at `32b2152`: the S3 driver has never executed against R2 — the suite pins `STORAGE_DRIVER = 'local'` (`setup.env.mjs:25`) and `object-storage.mjs` refuses `s3` under `NODE_ENV=test`; plan at `docs/product/STORAGE_VALIDATION_WAVE_1_PLAN.md`. Resolves the SYB-014 block only on success.

### X-4 — ACCEPT: Ride and Québec remain frozen; local document storage accepted only while frozen
**Formal governance rule:** *No Ride or Québec unfreeze is permitted until its document storage is migrated to governed object storage and owner approval is granted.* Verified: `driver-document-storage.mjs` and `quebec-document-storage.mjs` still `writeFile` to `server/uploads/*` (ephemeral). Registered as SYB-012; contained by freeze, not by a control — the gate makes the dependency explicit and enforced at any future unfreeze decision.

---

# 6. Notes for working through this

**Counts.** 12 Critical · 17 High · 22 Medium · 8 Low. One finding (SYB-018) blocks internal testing; twelve block closed beta.

**Cheapest high-value decisions.** SYB-009 is a one-token change. SYB-007 is one rate-limit rule. SYB-018 is documentation only. Together they close two Criticals and unblock the internal-testing gate.

**Decisions that foreclose options.** SYB-020 (identity-document retention) and the Neon region within A2-M04 are **irreversible** — deferring them is itself a decision, because deleted documents cannot be recovered and a Neon region cannot be changed after project creation.

**One dependency worth respecting.** SYB-021 (scheduler) blocks SYB-002 and A3-09. SYB-013 (observability) makes every other item's failures visible.

**One sequencing note.** SYB-006 carries a regression risk: the real wallet-payment endpoint has zero callers today, so removing the fabricated path without wiring it first would remove wallet payment entirely.

**Nothing in this workbook is authorized.** It is a decision aid. Remediation begins only when you say so, item by item.
