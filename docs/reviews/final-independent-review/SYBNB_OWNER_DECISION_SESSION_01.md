# SYBNB — Owner Decision Session 01

**Scope:** the 12 Critical findings and the 4 cross-cutting decisions.
**Baseline:** `8a4eba7` · **Review package:** commit `6e8b8f2` (frozen)
**Date:** 2026-07-23 · **Status:** for discussion · **uncommitted**

**Sources:** the three independent agent reports, `SYBNB_CONSOLIDATED_FINAL_REVIEW.md`,
`SYBNB_OWNER_DECISION_MATRIX.md`, `SYBNB_OWNER_REVIEW_WORKBOOK.md`.

**No new findings. No reprioritisation. No merging. No removal.** Severity, launch impact and
remediation-wave assignments are carried unchanged. Every owner decision field is blank.

**Complexity scale:** Trivial (minutes) · Low (hours) · Moderate (1–3 days) · High (1–2 weeks) ·
External (depends on a third party or counsel).

---

## Quick orientation

| Wave | Criticals | IDs |
|---|---|---|
| **Wave 0** — truth and safety blockers | 6 | SYB-009, SYB-007, SYB-018, SYB-006, SYB-004, SYB-005 |
| **Wave 1** — closed-beta blockers | 3 | SYB-002, SYB-001, SYB-008 |
| **Wave 2** — operational readiness | 3 | SYB-011, SYB-003, SYB-010 |

Three Criticals are **Trivial** (SYB-009, SYB-007, SYB-018). Together they close two Criticals and
unblock the only gate currently blocking *internal testing*.

**Four items carry the OWNER ATTENTION REQUIRED marker** — see §3.

---

# 1. Critical finding briefings

---

## SYB-009 — `SUPPORT` exempt from staff sign-in step-up

**Problem.** `STAFF_ROLES_REQUIRING_OTP` contains ADMIN, HOST, DRIVER and SELLER — not SUPPORT. A
support-only account therefore signs in with a password alone, with no email step-up. That same role can
read any user's identity document, upload a document onto any account, look up any user by email, read
the entire audit log, and export the driver registry. It is the role with the broadest
identity-document authority and the weakest sign-in.

**Evidence.** A3-01 · `server/routes/auth.mjs:37` · Confirmed fact, independently verified.

**Why Critical.** A single compromised or shared password yields read access to every identity document
on the platform, plus the ability to plant one. No other control compensates.

**Risks if deferred.** Unacceptable at any exposure level, including internal testing with real staff
accounts. The exposure exists the moment a SUPPORT account does.

**Risks of remediation.** Effectively none. SUPPORT accounts will require an email code at sign-in — an
operational change for staff, not a technical risk. Existing tests for other roles are unaffected.

**Dependencies.** None.

**Complexity.** **Trivial** — adding one string to a Set, plus a test.

**Recommended wave.** Wave 0, item 0.1.

**Recommended owner action:** **Accept.**

**Consequences.**
- *Accept:* the broadest-authority role gains the same step-up as every other staff role. Support staff need email access at sign-in.
- *Reject:* a password-only account retains full identity-document authority. This is the single cheapest Critical to close, so rejection would need a specific operational reason.
- *Defer:* the exposure persists unchanged; there is no partial mitigation.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## SYB-007 — `/api/auth/checkout-guest` unauthenticated and unthrottled

**Problem.** The route is unauthenticated and matches no rule in `RATE_LIMIT_RULES`. It mints real
`User` and `Wallet` rows and session tokens without limit, bypassing the 5-per-15-minutes cap that
applies to `/api/auth/register`. It is the feedstock for SYB-002.

**Evidence.** A2-C01 · `server/routes/auth.mjs:196`; rate rules in `server/index.mjs` · Confirmed fact, independently verified.

**Why Critical.** Alone it is an unbounded account factory. Combined with SYB-002 it allows an
unauthenticated actor to render the entire public inventory permanently unbookable at negligible cost.
This chain was not recorded in any prior artifact.

**Risks if deferred.** Unsafe from the moment the application is publicly reachable. Database growth,
token issuance and the inventory-denial chain all remain open.

**Risks of remediation.** Low. A limit set too tightly could throttle legitimate anonymous checkout
starts during a burst; the existing limiter already supports per-rule tuning, and the rule can be
adjusted without redeployment via the `RATE_LIMIT_*` overrides.

**Dependencies.** None for the rule itself. Redesigning anonymous checkout (option b) is larger and
independent.

**Complexity.** **Trivial** for the rule. Moderate for a redesign.

**Recommended wave.** Wave 0, item 0.2.

**Recommended owner action:** **Accept** the rule now; treat the redesign as a separate later decision.

**Consequences.**
- *Accept (rule):* the account factory is bounded and half the inventory-denial chain is broken.
- *Accept (rule + redesign):* also removes the anonymous-account pattern, at materially higher cost and scope.
- *Reject:* unlimited account minting persists.
- *Defer:* acceptable only while the application is unreachable publicly.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## SYB-018 — Production template omits every required storage and Redis variable

**Problem.** `.env.production.example` contains none of the seven `STORAGE_*` variables and neither
`UPSTASH_*` variable that `validateProductionConfig()` requires at boot. A deployment configured from
the documented template refuses to start. This is the only Critical that blocks **internal testing**
rather than only launch.

**Evidence.** A2-C03 · `.env.production.example`; `server/lib/env.mjs` · Confirmed fact, independently verified.

**Why Critical.** The documented path to a working deployment does not produce one. Anyone following the
template hits a boot failure with no indication that the template is at fault.

**Risks if deferred.** Internal testing and staging remain blocked. Every subsequent verification step
that needs a running deployment inherits the block.

**Risks of remediation.** None — variable **names** with placeholder values only. No real credential is
written. Confirming the template covers every key `validateProductionConfig()` requires is mechanical.

**Dependencies.** None. Pairs naturally with A2-M06 (`STORAGE_DRIVER` absent from every env template),
which is Medium and not part of this session.

**Complexity.** **Trivial** — documentation only.

**Recommended wave.** Wave 0, item 0.3.

**Recommended owner action:** **Accept.**

**Consequences.**
- *Accept:* the documented template produces a bootable deployment; the internal-testing gate opens.
- *Reject:* no defensible reason identified — the fix carries no risk and no real values.
- *Defer:* internal testing stays blocked, which delays every gate behind it.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## SYB-006 — Fabricated data reaches real users **⚠ OWNER ATTENTION REQUIRED**

**Problem.** Three independent paths. `confirmWalletPayment()` mints an `APPROVED` payment proof and a
receipt entirely in the browser, with no server call. `fetchApprovedListings` returns 14 fabricated
listings owned by "SYBNB Verified Provider" on *any* API error. The demo seed publishes a real,
instant-bookable public listing and three accounts marked ID-verified with no documents.

**Evidence.** A2-C05, A2-C06, A2-C07, A3-12 · `src/shared/api/platformApi.ts`, `scripts/seed-demo-accounts.mjs` · Confirmed fact.

**Why Critical.** A browser can fabricate a payment approval. This is the most serious truthfulness
defect in the review and directly contradicts the platform's own stated rule against fabricating
financial values or trust signals.

**Risks if deferred.** A user can be shown an approved payment that never happened, and fabricated
inventory on any transient API failure. Both are visible to real beta participants.

**Risks of remediation.** **This is the one Critical with a genuine regression risk.** The real endpoint
`submitPrototypeLocalWalletProof` currently has **zero callers**, despite four API test files covering
it. Deleting the fabricated path without wiring the real one first would remove wallet payment
entirely. Sequence matters.

**Dependencies.** Wire the real endpoint **before** deleting the fabricated path.

**Complexity.** **Moderate** — deletions are simple; wiring and verifying the real wallet path is the work.

**Recommended wave.** Wave 0, item 0.4.

**Recommended owner action:** **Accept**, with the wiring done first.

**Consequences.**
- *Accept:* users only ever see server-confirmed state.
- *Accept (dev-only gate instead):* leaves a payment-fabrication path one build flag away from production — a standing security and truthfulness posture, which is why the full deletion is recommended.
- *Reject:* incompatible with the platform's truthfulness rule.
- *Defer:* every beta participant is exposed to fabricated payment confirmation.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## SYB-004 — STG-12 recorded CLOSED; forced download on 2 of 9 routes **⚠ OWNER ATTENTION REQUIRED**

**Problem.** `privateDocumentDownloadHeaders()` has exactly two call sites against nine
private-document serve routes. Four private-document paths still render inline in the browser,
including thread attachments uploaded by an arbitrary counterparty. The control is recorded as
**CLOSED** in `docs/security/STR_STORAGE_THREAT_MODEL.md` and in `ADR-0010`, both committed.

**Evidence.** A3-02 · `server/routes/me.mjs:212`, `admin.mjs:402` · Confirmed fact, independently verified during consolidation.

**Why Critical.** A committed security document overstates a control. The control was completed for the
identity-document path and recorded as closed generally. Documentation that overstates a security
property is more damaging than a known gap, because it stops anyone looking.

**Risks if deferred.** A hostile document renders inline in an authenticated session on four paths. More
importantly, the security record remains wrong, and every future reader inherits the error.

**Risks of remediation.** Low technically — the helper exists and is proven on two routes. **The
governance question is the real decision:** correcting a committed security document sets a precedent
for how error gets recorded (see X-2).

**Dependencies.** Touching driver and Québec routes requires an explicit unfreeze. If not granted, the
fix scopes to unfrozen routes and the remainder stays recorded as open.

**Complexity.** **Low** for unfrozen routes. Correction of documents is separate and depends on X-2.

**Recommended wave.** Wave 0, item 0.5.

**Recommended owner action:** **Accept** — apply to reachable routes and correct the record.

**Consequences.**
- *Accept:* the control matches its documented claim.
- *Reject / documents-only:* the code gap persists but the record becomes truthful — a defensible interim position if the unfreeze is withheld.
- *Defer:* the security record stays wrong, which is the more serious half.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## SYB-005 — STG-24 recorded CLOSED; staff audit on 1 of 9 routes **⚠ OWNER ATTENTION REQUIRED**

**Problem.** `recordStaffDocumentAccess()` has exactly one call site. Staff reads of driver, Québec,
listing and thread documents leave no trace. `AdminAuditLog.ipHash` is declared in the schema and never
written. The control is recorded **CLOSED** in the same two committed documents as SYB-004.

**Evidence.** A3-03 · `server/routes/admin.mjs:393` · Confirmed fact, independently verified.

**Why Critical.** Same class as SYB-004. Auditing that covers one of nine paths, recorded as covering
all of them, provides false assurance about staff access to sensitive documents.

**Risks if deferred.** Staff can read most categories of private document with no record. If a privacy
question is ever raised about who accessed what, the answer will not exist.

**Risks of remediation.** Low technically. One consideration already recorded in the threat model:
`AdminAuditLog` is a *decision* log, and adding high-volume *view* events may distort it. Whether views
belong there or in a separate access log is an implementation choice worth making deliberately.

**Dependencies.** As SYB-004 — unfreeze for driver and Québec routes; X-2 for the document correction.

**Complexity.** **Low** for the call sites. Moderate if a separate access-log table is preferred.

**Recommended wave.** Wave 0, item 0.5 (paired with SYB-004).

**Recommended owner action:** **Accept.**

**Consequences.**
- *Accept:* staff access to private documents becomes traceable across categories.
- *Reject / documents-only:* the audit boundary stays narrow but honestly recorded.
- *Defer:* untraceable staff access continues while documentation says otherwise.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## SYB-002 — `PAYMENT_PENDING` bookings hold inventory permanently **⚠ OWNER ATTENTION REQUIRED**

**Problem.** Bookings are created `PAYMENT_PENDING` and immediately occupy availability, both in the
overlap check and in public availability. They never expire — there is no scheduler anywhere in the
deployment. The guest cannot cancel them, the host cannot see them (they are explicitly filtered out of
the host view), and no admin release action exists.

**Evidence.** A1-02, A2-C02 · `server/routes/bookings.mjs:553`, `host.mjs:100-103`,
`server/lib/booking-lifecycle.mjs:7-9`; `vercel.json` contains no `crons` · Confirmed fact, independently verified.

**Why Critical.** Every abandoned checkout permanently removes a listing's dates, invisibly to everyone
who could act on it. Inventory degrades monotonically from first real use, with no recovery path.

**Risks if deferred.** Listings silently become unbookable. Hosts will report "nobody is booking" with no
diagnosable cause. Combined with SYB-007 this is also the denial-of-inventory attack.

**Risks of remediation.** **An expiry window that is too short could release holds on legitimate
in-flight checkouts** — a guest who is genuinely completing a manual bank transfer would lose their
dates. This is why the window is a business decision rather than a technical default.

**Dependencies.** **Requires the scheduler (SYB-021, a High finding — not in this session).** A Critical
depending on a non-Critical is the most important sequencing fact in this pack.

**Complexity.** **High** — lifecycle changes across bookings, host and admin surfaces, plus the scheduler.

**Recommended wave.** Wave 1, item 1.2 (after 1.1, the scheduler).

**Recommended owner action:** **Accept**, and set the expiry window.

**Consequences.**
- *Accept:* abandoned checkouts release inventory; hosts see pending holds; admins can intervene.
- *Reject:* inventory degradation is permanent and undiagnosable.
- *Defer:* tolerable only while no real bookings exist.

**Final owner decision:** ________________  **Owner notes (expiry window):** ________________

---

## SYB-001 — No date selection on the listing page

**Problem.** The listing page renders no date picker at all. `setDateRange` is declared and never
called. Availability *is* fetched and expanded into a `disabledDates` set, which is then never read.
Guests are locked to a hardcoded "tomorrow + 2 nights" default and shown a real price for dates they
never chose. `BookingReviewPage` instructs guests to "choose dates on the listing page first," which is
impossible.

**Evidence.** A1-01, A2-C04 · `src/modules/listings/ListingDetailPage.tsx:214, :281` · Confirmed fact, independently verified.

**Why Critical.** This is the core booking journey of the division proposed for launch. The server
enforces overlaps correctly, so the failure surfaces *late* — after the guest believes they have chosen
and priced a stay.

**Risks if deferred.** The closed beta cannot meaningfully test booking. Guests transact on dates they
did not select.

**Risks of remediation.** Moderate. This is real product work — picker, enforcement before quote and
before continue, deep-link validation, AR/EN correctness. The pure date logic is unit-testable, which
limits regression risk.

**Dependencies.** None technically. A1-16 (fragile checkout draft, Medium) is downstream of it.

**Complexity.** **Moderate to High** — product and UX work, not a config change.

**Recommended wave.** Wave 1, item 1.3.

**Recommended owner action:** **Accept.**

**Consequences.**
- *Accept:* guests choose real, available dates; late-failure rejections stop.
- *Accept (fixed-date listings):* a smaller alternative that changes the product proposition.
- *Reject:* the booking journey remains fundamentally broken.
- *Defer:* the closed beta cannot open on the STR division.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## SYB-008 — All 8 divisions ship active

**Problem.** Every division remains `status: 'active'` in `divisions.ts` and renders as an open,
clickable card on the landing page — including SYBNB Ride, Cars, Marketplace, Buy, Rentals and New
Construction. The closed-beta boundary is documented and owner-approved but has never been executed.

**Evidence.** A1-05, A2-H08 · `src/engines/navigation/divisions.ts` · Confirmed fact.

**Why Critical.** The platform presents eight businesses when it can operate one. Beta participants
would encounter seven non-functional divisions, several of which serve fabricated inventory on API
failure (SYB-006).

**Risks if deferred.** Beta participants judge the platform on divisions it cannot run. Operational,
legal and support surface all expand for no benefit.

**Risks of remediation.** Low. The isolation plan is already approved and the mechanism is a status
value plus route and API gates. The one care point: SR's 12 API test files must still pass with the flag
forced on in the test environment, so isolation does not silently rot the subsystem.

**Dependencies.** The approved isolation plan. Execution only — no new design.

**Complexity.** **Moderate** — three layers (navigation, route, API), plus verification.

**Recommended wave.** Wave 1, item 1.4.

**Recommended owner action:** **Accept.**

**Consequences.**
- *Accept:* the product presents the one division it can operate.
- *Accept (navigation only):* weaker — direct hash URLs and APIs remain reachable.
- *Reject:* the launch boundary decision is documented but not real.
- *Defer:* incompatible with opening a closed beta.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## SYB-011 — No payout write path and no withdrawal rail **⚠ OWNER ATTENTION REQUIRED**

**Problem.** `User.payoutMethod` is read by the admin console but has no write path anywhere in the
product. No withdrawal endpoint exists. "RELEASED" is an internal ledger credit, not money leaving the
platform, and account closure requires a zero balance.

**Evidence.** A1-07, A2-H01 · `src/modules/host/HostEarningsPage.tsx` · Confirmed fact.

**Why Critical.** The platform takes a 13% commission on confirmed bookings with no mechanism for funds
to reach a host. Hosts can see money owed and cannot receive it.

**Risks if deferred.** Accepting real bookings creates an obligation the platform cannot discharge. This
is a commercial and trust exposure, not only a product gap.

**Risks of remediation.** **Highest external dependency of any item in this session.** A real payout
rail involves a payment provider, KYC, and money-movement obligations. The manual alternative creates a
standing operational commitment to named staff and a documented process.

**Dependencies.** **Requires a payout-rail decision from you.** Roadmap item H3.

**Complexity.** **High to External.**

**Recommended wave.** Wave 2, item 2.4.

**Recommended owner action:** **Accept** the manual documented process for the beta, with written
disclosure to hosts; treat the built rail as a separate pre-public decision.

**Consequences.**
- *Accept (built rail):* hosts are paid through the product. Largest scope in this session.
- *Accept (manual + disclosure):* hosts are paid, slowly and by hand, and know that in advance. Viable at 5–10 hosts.
- *Reject:* the platform takes commission with no payout mechanism.
- *Defer:* tenable only if no real bookings are accepted.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## SYB-003 — No notification mechanism of any kind

**Problem.** A platform-wide search returns one hit for "notification", a mislabelled button. Outbound
email exists only for verification codes and host insights. The payment model is manual admin review,
so state changes happen asynchronously and out of the user's sight — and nothing tells anyone that
anything happened.

**Evidence.** A1-03 · Confirmed fact. *Minority finding — raised by one agent, retained at Critical in consolidation (`CR` §3.3).*

**Why Critical.** A platform whose payment model is "submit proof and wait for a human" cannot tell a
guest their payment was approved, a host that a booking arrived, or anyone that a review decision was
made. This is a missing subsystem, not a defect.

**Risks if deferred.** Participants must poll the site to discover state changes. At beta scale this is
survivable with manual outreach; it does not scale past it.

**Risks of remediation.** Moderate. The Resend mailer is already configured and production-validated, so
transactional email is an extension rather than new infrastructure. Scope creep toward a full
notification centre is the real risk.

**Dependencies.** None technically. **Scope is your decision.**

**Complexity.** **High** for a general subsystem; **Moderate** if scoped to booking and payment state changes only.

**Recommended wave.** Wave 2, item 2.5.

**Recommended owner action:** **Accept**, scoped narrowly to transactional email.

**Consequences.**
- *Accept (narrow):* participants learn when their booking or payment changes state.
- *Accept (full centre):* significantly larger; not required for a beta.
- *Accept (manual WhatsApp operation):* legitimate at 20–30 guests, but only with named staff and stated hours, and it must be disclosed.
- *Reject / defer:* the beta is operated entirely by manual outreach.

**Final owner decision:** ________________  **Owner notes (scope):** ________________

---

## SYB-010 — Guest has no account surface

**Problem.** `GuestAccountPage` and `DashboardPage` are exported and never imported. `/account` and
`/dashboard` silently render the landing page. No trips or bookings list exists anywhere for a guest.

**Evidence.** A1-04 · Confirmed fact.

**Why Critical.** Two routes present themselves as destinations and are dead ends. A guest who books has
no way inside the product to find that booking. This is a missing subsystem, not a defect.

**Risks if deferred.** Guests rely entirely on the booking-lookup link and email. Support load rises,
and "is my booking confirmed?" has no self-service answer.

**Risks of remediation.** Low to moderate depending on scope. Wiring the orphaned pages risks exposing
surfaces that were never finished — they are unimported for a reason worth checking before enabling.

**Dependencies.** **Scope is your decision.** Roadmap item H1 covers the trips list.

**Complexity.** **Low** to remove the dead routes; **Moderate to High** to build a real account surface.

**Recommended wave.** Wave 2, item 2.6.

**Recommended owner action:** **Accept** the minimal option for the beta — remove the dead routes and
rely on the booking-lookup link — and treat the full surface as a pre-public decision.

**Consequences.**
- *Accept (full surface):* guests can find their bookings in-product. Largest option.
- *Accept (remove dead routes):* honest and small; no route pretends to be a destination.
- *Reject:* two routes continue to silently render the wrong page.
- *Defer:* the dead ends remain visible to beta participants.

**Final owner decision:** ________________  **Owner notes (scope):** ________________

---

# 2. Cross-cutting decisions

---

## X-1 — Does the closed beta open before or after SYB-003 and SYB-011?

**Problem.** Two Critical findings are missing subsystems: notifications (SYB-003) and a payout rail
(SYB-011). Both have viable manual alternatives at beta scale. Whether the beta waits for them, or opens
with documented manual operation, determines the shape of everything in Wave 2.

**Evidence.** SYB-003, SYB-011 · matrix X-1.

**Why it matters.** It decides whether the closed beta is a *product* test or an *operations* test. Both
are legitimate; they answer different questions.

**Risks if deferred.** Wave 2 cannot be sequenced, and beta participant expectations cannot be set.

**Risks of either choice.** Opening with manual operation commits named staff to real response times and
requires honest disclosure to participants. Waiting delays all real-world learning.

**Dependencies.** Determines the scope decisions inside SYB-003 and SYB-011.

**Complexity.** Decision only.

**Recommended action:** **Accept** manual operation for the beta, with written disclosure, provided
staffing and hours are named first.

**Consequences.** *Open before:* faster learning, higher operational load, requires disclosure.
*Open after:* a more complete product, materially later, with the risk that unvalidated assumptions
accumulate.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## X-2 — Correction in place, or appended errata? **⚠ OWNER ATTENTION REQUIRED**

**Problem.** Two committed security documents overstate a control (SYB-004, SYB-005), and one committed
review document is stale (SYB-030). How that gets corrected sets a governance precedent.

**Evidence.** SYB-004, SYB-005, SYB-030 · matrix X-2.

**Why it matters.** In-place correction produces clean documents but erases the fact that an error was
made and for how long it stood. Appended errata preserves the audit trail at the cost of readability.
This programme has been unusually disciplined about not rewriting history; the choice should be
deliberate rather than incidental.

**Risks if deferred.** SYB-004 and SYB-005 cannot be fully closed, because part of each is a document
correction.

**Risks of either choice.** In-place editing loses the record of the error. Errata accumulates and future
readers may read only the body.

**Dependencies.** Blocks the documentation half of SYB-004 and SYB-005.

**Complexity.** Decision only; execution is Trivial either way.

**Recommended action:** **Accept** appended errata, consistent with how supersessions have been handled
throughout this programme.

**Consequences.** *In place:* clean documents, lost history. *Errata:* preserved history, longer documents.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## X-3 — Does Validation Wave 1 execute now? **⚠ OWNER ATTENTION REQUIRED**

**Problem.** SYB-014 (High) records that the S3 storage driver has never executed and is unproven
against R2. The approved validation plan exists and is frozen. Executing it requires the **first
Cloudflare connection in this programme** and the first synthetic objects written to a real bucket.

**Evidence.** SYB-014 · `STORAGE_VALIDATION_WAVE_1_PLAN.md` · matrix X-3.

**Why it matters.** The central claim of the storage work — that uploads now survive instance
replacement — is untested against the real backend. Every storage assurance rests on it.

**Risks if deferred.** The closed beta would open on storage that has never been exercised against R2.
The local driver cannot reproduce the defect being fixed.

**Risks of execution.** Low and bounded: synthetic data only, test buckets only, test credentials only.
The plan requires a separate manually-invoked harness outside Vitest and CI, because the test suite
structurally refuses the `s3` driver. Induced-failure testing briefly points configuration at invalid
endpoints — no staging or production value is involved.

**Dependencies.** Owner authorisation. Harness design was to be reviewed before any connection.

**Complexity.** Moderate — harness build plus execution and reporting.

**Recommended action:** **Accept**, after the harness design review already contemplated.

**Consequences.** *Execute:* the storage claim is proven or disproven. *Defer:* SYB-014 continues to block
closed beta.

**Final owner decision:** ________________  **Owner notes:** ________________

---

## X-4 — Is SYB-012 formally accepted while Ride and Québec stay frozen?

**Problem.** `driver-document-storage.mjs` and `quebec-document-storage.mjs` still write to ephemeral
local disk — the original defect, unfixed. They are out of scope under the Ride restriction and the
Québec freeze, so the defect is contained only by those systems being frozen.

**Evidence.** SYB-012 (High) · A2-H06, A3-07 · matrix X-4.

**Why it matters.** Containment by freeze is not a control — it is a circumstance. If either system is
unfrozen without migrating first, driver licences and vehicle registrations are silently lost. Formally
accepting the risk with a named trigger converts an invisible dependency into a recorded one.

**Risks if deferred.** The dependency remains undocumented, and an unfreeze decision could be taken by
someone unaware of it.

**Risks of acceptance.** None directly — acceptance records reality. The risk is treating acceptance as
resolution.

**Dependencies.** Ties to any future Ride or Québec unfreeze decision.

**Complexity.** Decision only. The migration itself is Low — those modules are structurally identical to
the four already migrated.

**Recommended action:** **Accept** as a recorded risk, with an explicit gate: *no unfreeze of Ride or
Québec without migrating its document storage first.*

**Consequences.** *Accept with gate:* the dependency is visible and enforced at the decision point.
*Migrate now:* removes the risk, at the cost of touching frozen systems.
*Leave unrecorded:* an unfreeze could silently reintroduce data loss.

**Final owner decision:** ________________  **Owner notes:** ________________

---

# 3. Decision readiness check — OWNER ATTENTION REQUIRED

Findings in this session that permanently change data, infrastructure or security posture, or that are
not easily reversed:

| ID | Why it needs attention | Nature |
|---|---|---|
| **SYB-002** | An expiry window set too short would **release holds on legitimate in-flight checkouts**. Once released, the hold is gone. The window is a business rule with a real-money consequence | Data / business rule |
| **SYB-004** | Correcting a committed security document is a **permanent change to the security record**, and sets a governance precedent (X-2) | Security posture / record |
| **SYB-005** | As SYB-004 | Security posture / record |
| **SYB-006** | Deleting the fabricated path **without wiring the real endpoint first removes wallet payment entirely**. Sequence-sensitive, and user-visible if wrong | Functional regression |
| **SYB-011** | A payout-rail choice creates **standing commitments to hosts** — commercial and possibly regulatory. Difficult to reverse once hosts are onboarded on a stated basis | Commercial / external |
| **X-2** | Sets the **permanent precedent** for how error is recorded in this programme | Governance |
| **X-3** | The **first Cloudflare connection** and first real objects written. Changes the infrastructure posture from "never connected" to "in use" | Infrastructure |

**Outside this session but worth flagging in the same breath:** **SYB-020 / D-7** (High) is the single
most irreversible item in the whole package — identity documents are destroyed on replacement, and
deleted documents cannot be recovered. Deferring it is itself a decision that forecloses options
permanently. It is not part of Session 01 and is listed here only so it is not lost between sessions.

---

# 4. Sequencing and dependency graph

Dependencies among the 12 Criticals, as recorded. **No wave assignments changed and no roadmap redesign.**

```
INDEPENDENT — can start immediately, no prerequisites
  SYB-009  SUPPORT step-up            [Trivial]
  SYB-007  checkout-guest rate limit  [Trivial]
  SYB-018  production env template    [Trivial]  ──► unblocks INTERNAL TESTING gate
  SYB-001  date selection             [Moderate–High]
  SYB-008  division isolation         [Moderate]

SEQUENCED — has a prerequisite
  SYB-021 (HIGH, scheduler) ──► SYB-002  PAYMENT_PENDING lifecycle
     └─ a Critical depends on a non-Critical. SYB-002 cannot start until the
        scheduler exists, and SYB-021 is not in this session.

  wire submitPrototypeLocalWalletProof ──► SYB-006  remove fabricated data
     └─ internal prerequisite; deleting first removes wallet payment.

  X-2 (correction method) ──► SYB-004 ─┐
                             SYB-005 ─┴─► also gated by the Ride/Québec
                                          unfreeze decision for 4 of 9 routes.

SCOPE-GATED — blocked on an owner scope decision, not on code
  X-1 ──► SYB-003  notifications   (narrow / full / manual)
  X-1 ──► SYB-011  payout rail     (built / manual+disclosure)
       ──► SYB-010  guest account  (full surface / remove dead routes)

ATTACK CHAIN — either fix breaks it; both are recommended
  SYB-007 ──┬──► unauthenticated permanent denial of inventory
  SYB-002 ──┘
```

**Three observations, offered without changing anything:**

1. **The three Trivial items are unblocked and independent.** SYB-009, SYB-007 and SYB-018 have no
   prerequisites, and SYB-018 is the only item gating the internal-testing tier.
2. **SYB-002 is the most constrained Critical.** It depends on a High finding outside this session
   (SYB-021, the scheduler). Deciding SYB-002 without also directing SYB-021 leaves it unstartable.
3. **Three Criticals are waiting on scope, not engineering.** SYB-003, SYB-010 and SYB-011 each have a
   viable small option and a large one. X-1 governs two of them, so deciding X-1 early resolves the most
   downstream ambiguity.

---

**Nothing in this document is authorized, decided, or implemented.** It is a decision aid for Session 01.

# OWNER DECISION SESSION 01 READY
