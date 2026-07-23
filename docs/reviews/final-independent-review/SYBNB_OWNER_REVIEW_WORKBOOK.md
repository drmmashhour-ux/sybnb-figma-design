# SYBNB — Owner Review Workbook

**Baseline:** `8a4eba7` · **Review package:** commit `6e8b8f2`, branch `review/sybnb-final-independent-review`
**Date:** 2026-07-23 · **Status:** awaiting owner decisions

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
**Final owner decision:** ________________  **Owner notes:** ________________

### SYB-002 — `PAYMENT_PENDING` bookings hold inventory permanently
**Summary.** Bookings are created `PAYMENT_PENDING` and occupy availability. They never expire (no scheduler exists), the guest cannot cancel them, the host cannot see them, and no admin release action exists.
**Evidence.** `CR` SYB-002 · A1-02, A2-C02 · `server/routes/bookings.mjs:553`, `host.mjs:100-103`, `booking-lifecycle.mjs:7-9`; `vercel.json` has no `crons` · Type **F ✓**
**Why it matters.** Every abandoned checkout removes a listing's dates permanently and invisibly. Inventory degrades monotonically from first use.
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Expiry window + guest cancel + host visibility + admin release.
**Alternatives.** (a) as recommended · (b) admin release only · (c) make pending bookings non-blocking for availability.
**Dependencies.** Requires the scheduler (SYB-021). **Requires a business rule from you: the expiry window.**
**Final owner decision:** ________________  **Owner notes:** ________________

### SYB-003 — No notification mechanism of any kind
**Summary.** A platform-wide grep returns one hit, a mislabelled button. Outbound email is limited to verification codes and host insights. The payment model is manual admin review with no asynchronous signalling to anyone.
**Evidence.** `CR` SYB-003 · A1-03 · Type **F**
**Why it matters.** Participants cannot learn that their booking or payment changed state. This is a missing subsystem, not a defect. *(Minority finding — raised by one agent; retained at Critical in consolidation, see `CR` §3.3.)*
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Minimum viable transactional email for booking and payment state changes.
**Alternatives.** (a) as recommended · (b) full notification centre · (c) operate the beta manually via WhatsApp with named staff and stated hours.
**Dependencies.** Uses the already-configured Resend mailer. **Scope is your decision.**
**Final owner decision:** ________________  **Owner notes:** ________________

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
**Final owner decision:** ________________  **Owner notes:** ________________

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
**Final owner decision:** ________________  **Owner notes:** ________________

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
**Final owner decision:** ________________  **Owner notes:** ________________

### SYB-011 — No payout write path and no withdrawal rail
**Summary.** `User.payoutMethod` is read by admin but has no write path anywhere. No withdrawal endpoint exists. "RELEASED" is an internal ledger credit; account closure requires a zero balance.
**Evidence.** `CR` SYB-011 · A1-07, A2-H01 · `src/modules/host/HostEarningsPage.tsx` · Type **F**
**Why it matters.** The platform takes a 13% commission with no mechanism for money to leave it.
**Internal testing** ○ · **Closed beta** ● · **Production** ●
**Recommended decision.** Resolve before accepting real bookings.
**Alternatives.** (a) payout capture + withdrawal path · (b) manual off-platform payout with a documented process and written disclosure to beta hosts · (c) defer.
**Dependencies.** **Requires a payout-rail decision from you.** Roadmap item H3.
**Final owner decision:** ________________  **Owner notes:** ________________

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
| **X-1** | Does the closed beta open before or after SYB-003 (notifications) and SYB-011 (payouts)? | Determines whether the beta is manually operated | ______ | ______ |
| **X-2** | Do committed documents get corrected in place, or by appended errata? | Sets the governance precedent for how error is recorded (affects SYB-004, SYB-005, SYB-030) | ______ | ______ |
| **X-3** | Does Validation Wave 1 execute now, given SYB-014 blocks closed beta? | Requires authorising the first Cloudflare connection | ______ | ______ |
| **X-4** | Is SYB-012 formally accepted while Ride and Québec stay frozen? | Converts a live defect into a recorded accepted risk with a named trigger | ______ | ______ |

---

# 6. Notes for working through this

**Counts.** 12 Critical · 17 High · 22 Medium · 8 Low. One finding (SYB-018) blocks internal testing; twelve block closed beta.

**Cheapest high-value decisions.** SYB-009 is a one-token change. SYB-007 is one rate-limit rule. SYB-018 is documentation only. Together they close two Criticals and unblock the internal-testing gate.

**Decisions that foreclose options.** SYB-020 (identity-document retention) and the Neon region within A2-M04 are **irreversible** — deferring them is itself a decision, because deleted documents cannot be recovered and a Neon region cannot be changed after project creation.

**One dependency worth respecting.** SYB-021 (scheduler) blocks SYB-002 and A3-09. SYB-013 (observability) makes every other item's failures visible.

**One sequencing note.** SYB-006 carries a regression risk: the real wallet-payment endpoint has zero callers today, so removing the fabricated path without wiring it first would remove wallet payment entirely.

**Nothing in this workbook is authorized.** It is a decision aid. Remediation begins only when you say so, item by item.
