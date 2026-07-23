# SYBNB — Runtime Findings Register

**Baseline:** `6e8b8f2` · **Date:** 2026-07-23
**Source:** four-role end-to-end validation against a local runtime (API `127.0.0.1:3051`, web `127.0.0.1:5180`, local Postgres).
**Status:** separate register. **Not merged into the Independent Review. No static finding renumbered, reprioritised, or closed.**

> **Cross-reference only.** Where a runtime finding corresponds to a static finding, the static finding
> **continues to govern** and its Session 01 decision status is unaffected. This register records what
> the runtime evidence adds.
>
> **All owner decision and notes fields are blank.**

**Count correction.** The E2E consolidated report states "19 of 25 significant E2E findings are new".
The accurate split, recounted for this register, is **17 wholly new · 1 extension of a static finding ·
7 runtime confirmations of static findings = 25**. The figure 19 was mine and was wrong; 17 is correct.

---

## Severity summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 9 | E2E-01 … E2E-09 |
| High | 16 | E2E-10 … E2E-25 |
| **Total** | **25** | |

| Relationship to static review | Count |
|---|---|
| Wholly new — no matching static finding | **17** |
| Extends an existing static finding | 1 |
| Confirms an existing static finding | 7 |

---

# Critical

## E2E-01 — No STR listing can be published in the shipped configuration
**Severity** Critical · **Workflow** Listing lifecycle → publication · **Roles** Host → Admin
**Runtime evidence.** Admin approval of a valid Syria STAYS listing returned `403 JURISDICTION_NOT_APPROVED`. Every `jurisdiction_compliance_profiles` row is BLOCKED (SY) or PENDING (CA/quebec); `assertJurisdictionApproved` fails closed.
**Reproduction.** Create a STAYS listing as HOST → add photo, document, pricing → submit → approve as ADMIN → 403. Host receives success responses at both create and submit; no warning at any point.
**Related static finding** None.
**Already known?** **No — wholly new.**
**Recommended wave** Wave 0 (chain blocker; nothing downstream is testable without it).
**Dependencies** Jurisdiction/compliance decision by the owner — not a purely technical fix.
**Owner decision:** ______  **Owner notes:** ______

## E2E-02 — `PAYMENT_PENDING` is an absorbing state
**Severity** Critical · **Workflow** Booking lifecycle · **Roles** Client, Host, Admin, Controller
**Runtime evidence.** Booking `3e4bb954-…` appeared in the *public* availability response immediately and denied a second guest with 409. Guest cancel → 400; dispute → 400; host decision requires `REQUESTED`/`CONFIRMED`; admin review queue never lists it; `completeExpiredBookings` handles `CONFIRMED` only; no scheduler exists. Four such bookings are stuck in the dev database.
**Reproduction.** Create any booking → observe `PAYMENT_PENDING` → attempt release from every role → all refused.
**Related static finding** **SYB-002.**
**Already known?** Yes — confirmed and strengthened. Runtime added: an unauthenticated device-guest blocked a listing for **2030–2035**.
**Recommended wave** Wave 1 (per existing roadmap item 1.2; depends on the scheduler, 1.1).
**Dependencies** Scheduler (SYB-021). Expiry window is an owner business rule.
**Owner decision:** ______  **Owner notes:** ______

## E2E-03 — Payment confirmation and receipt fabricated in the browser
**Severity** Critical · **Workflow** Payment · **Roles** Client
**Runtime evidence.** With network capture armed, clicking "Sham Cash" on `#/payment/local-wallet/fallback-booking-9001/4500/USD` produced **zero `/api/` requests**, yet the UI rendered "Payment confirmed / Booking confirmed" and a receipt: *Status Approved · Total paid 4,500 USD · Invoice INV-FALLBACK*.
**Reproduction.** Open the local-wallet payment route for a `fallback-` booking id → click the confirm control → observe no network activity and a rendered approval.
**Related static finding** **SYB-006.**
**Already known?** Yes — confirmed empirically for the first time.
**Recommended wave** Wave 0 (item 0.4), under the owner's required sequencing.
**Dependencies** The real endpoint must be wired first (see E2E-04).
**Owner decision:** ______  **Owner notes:** ______

## E2E-04 — The local payment control is a silent no-op on real bookings
**Severity** Critical · **Workflow** Payment · **Roles** Client
**Runtime evidence.** On a real booking the same control issues no request and displays **no error**: the `catch` sets an error state which the `finally` immediately overwrites with `idle`. `submitPrototypeLocalWalletProof` — the only wrapper for the working server endpoint — has **zero call sites**. Database confirmed `payments: 0`.
**Reproduction.** Create a real booking → open the local-wallet payment route → click confirm → nothing happens, no message, no record.
**Related static finding** **Extends SYB-006.**
**Already known?** **Partially.** The static review recorded the path as *fabricated*; runtime shows it is also *non-functional*. This is the mechanism by which an ordinary guest reaches E2E-02.
**Recommended wave** Wave 0 (item 0.4) — **step 1 of the owner's sequence: implement and validate the real path before removing anything.**
**Dependencies** Blocks the safe execution of E2E-03's remediation.
**Owner decision:** ______  **Owner notes:** ______

## E2E-05 — SUPPORT signs in with password alone
**Severity** Critical · **Workflow** Staff authentication · **Roles** Support, Admin
**Runtime evidence.** `POST /api/auth/login` with email + password → **200 + staff token** for SUPPORT; ADMIN correctly → `403 STAFF_OTP_REQUIRED`. With that token: read a guest's identity document, exported the entire driver registry (names, emails, plates), read the platform audit log, reset a verified user's identity.
**Reproduction.** Create a SUPPORT user → log in with password only → use the returned token against admin document and export routes.
**Related static finding** **SYB-009.**
**Already known?** Yes — **already ACCEPTED for Wave 0 in Session 01.** Runtime demonstrated the full exploitation path.
**Recommended wave** Wave 0 (item 0.1) — decision already taken.
**Dependencies** None.
**Owner decision:** ______  **Owner notes:** ______

## E2E-06 — STG-12 recorded CLOSED is false
**Severity** Critical · **Workflow** Private-document download · **Roles** Admin, Support, Host
**Runtime evidence.** `content-disposition: attachment` present on `/api/admin/id-document/:id/file` and `/api/me/id-document/file` only. `/api/admin/driver-documents/:id/file`, `/api/admin/listing-documents/:id/file`, `/api/driver/documents/:id/file` and `/api/listings/:l/documents/:d/file` return **no `content-disposition`** — verbatim headers captured.
**Reproduction.** Request each private-document route with an authorized token and compare response headers.
**Related static finding** **SYB-004.**
**Already known?** Yes — **currently presented and awaiting decision in Session 01.** Runtime supplied the exact route split.
**Recommended wave** Wave 0 (item 0.5).
**Dependencies** Driver and Québec routes require an unfreeze. Document correction depends on cross-cutting **X-2**.
**Owner decision:** ______  **Owner notes:** ______

## E2E-07 — STG-24 recorded CLOSED is false
**Severity** Critical · **Workflow** Staff document access auditing · **Roles** Admin, Support
**Runtime evidence.** Audit-row deltas measured immediately before/after each call: identity-document reads wrote `STAFF_DOCUMENT_ACCESSED` (+1, `actorRoles` recorded); all four other staff document routes measured **delta 0**. Refused and 404 attempts also delta 0. Every `STAFF_DOCUMENT_ACCESSED` row is `identity`/`users`.
**Reproduction.** Count `AdminAuditLog` rows → perform a staff read on each document route → recount.
**Related static finding** **SYB-005.**
**Already known?** Yes — confirmed with measured deltas rather than call-site inference.
**Recommended wave** Wave 0 (item 0.5, paired with E2E-06).
**Dependencies** As E2E-06.
**Owner decision:** ______  **Owner notes:** ______

## E2E-08 — A mistyped field silently clears an active legal hold
**Severity** Critical · **Workflow** Retention / legal hold · **Roles** Admin
**Runtime evidence.** `PATCH` with `{"legalHold":true}` — the correct field is `hold` — returned **200** and **cleared** an active legal hold. The caller believes they set it.
**Reproduction.** Place a legal hold on a listing document → send the mistyped payload → observe 200 and the hold cleared.
**Related static finding** None.
**Already known?** **No — wholly new.**
**Recommended wave** Wave 0 (silent failure affecting evidence retention).
**Dependencies** None. Scope decision: reject unknown fields on this route, or platform-wide.
**Owner decision:** ______  **Owner notes:** ______

## E2E-09 — Host tax statement overstates income by 177%
**Severity** Critical · **Workflow** Host earnings → Part XX compliance statement · **Roles** Host
**Runtime evidence.** `/api/host/statements` iterates every `booking_payout` wallet entry, counting a released payout twice (HOLD + RELEASE); `refundedMinor` reads only from Dispute rows, so a cancelled fully-refunded booking reports as full income. Measured: **830,000 SYP reported against 300,000 actually earned.**
**Reproduction.** Create a confirmed booking → release payout → cancel and refund another → request the host statement.
**Related static finding** None.
**Already known?** **No — wholly new.**
**Recommended wave** Wave 1 (compliance output; consider suspending the statement in the interim).
**Dependencies** Owner decision on whether to suppress the statement until corrected (**XE-2**).
**Owner decision:** ______  **Owner notes:** ______

---

# High

## E2E-10 — No payout write path; earnings terminate in an internal wallet
**Severity** High · **Workflow** Host settlement · **Roles** Host, Admin
**Runtime evidence.** No endpoint writes `User.payoutMethod`; **0/34 users** have one; `src/` never references it. Admin payout row read `hostPayoutMethod: null` and released **262,857 SYP** anyway. No withdrawal route exists.
**Reproduction.** Search the codebase for a `payoutMethod` writer; query users; release a payout as admin.
**Related static finding** **SYB-011.** **Already known?** Yes — confirmed and quantified.
**Recommended wave** Wave 2 (item 2.4). **Dependencies** Owner payout-rail decision.
**Owner decision:** ______  **Owner notes:** ______

## E2E-11 — Account closure permanently blocked
**Severity** High · **Workflow** Account lifecycle · **Roles** Client, Host
**Runtime evidence.** `DELETE /api/me` → `409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS`, unresolvable: the blocking booking is stuck in `PAYMENT_PENDING` (E2E-02) or the wallet is negative (E2E-18).
**Reproduction.** Create a booking → leave it `PAYMENT_PENDING` → attempt account deletion.
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 1. **Dependencies** E2E-02 and E2E-18; data-subject-rights implications.
**Owner decision:** ______  **Owner notes:** ______

## E2E-12 — No date validation
**Severity** High · **Workflow** Booking creation · **Roles** Client, Host
**Runtime evidence.** Past-dated, no-date, 500-year and **$273 M** bookings accepted via API **and** through the real UI calendar (a calendar permitted 1 July when the current date was 23 July).
**Reproduction.** Submit bookings with past, absent and extreme date ranges.
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 1. **Dependencies** Maximum stay length is an owner business rule.
**Owner decision:** ______  **Owner notes:** ______

## E2E-13 — No guest account surface
**Severity** High · **Workflow** Client account · **Roles** Client
**Runtime evidence.** `GuestAccountPage` and guest `DashboardPage` are dead code; no sign-in, sign-up, sign-out, profile or trips list anywhere in the client UI. Every client is an anonymous device account. `/#/track` is the only trip view.
**Related static finding** **SYB-010.** **Already known?** Yes — confirmed.
**Recommended wave** Wave 2 (item 2.6). **Dependencies** Owner scope decision.
**Owner decision:** ______  **Owner notes:** ______

## E2E-14 — Driver CSV export unaudited
**Severity** High · **Workflow** Admin data export · **Roles** Admin, Support
**Runtime evidence.** The export returns names, emails and plates — the widest PII egress on the platform — and writes **no audit row** (delta 0).
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 1. **Dependencies** None.
**Owner decision:** ______  **Owner notes:** ______

## E2E-15 — Zero audit rows for creation events
**Severity** High · **Workflow** Audit coverage · **Roles** All
**Runtime evidence.** Booking, payment-proof, listing and account **creation** produce no `AdminAuditLog` rows. Auditing begins only at decision time.
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 2. **Dependencies** Owner decision on scope and on whether creation events belong in `AdminAuditLog` or a separate event log.
**Owner decision:** ______  **Owner notes:** ______

## E2E-16 — Wallet balance unbacked by ledger
**Severity** High · **Workflow** Financial integrity · **Roles** Controller
**Runtime evidence.** **1,000,000 SYP** of wallet balance with no corresponding ledger entries, and no reconciliation control anywhere in the platform.
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 1 (investigate origin first — seed data or defect is undetermined).
**Dependencies** Financial-controls decision.
**Owner decision:** ______  **Owner notes:** ______

## E2E-17 — SYP fees added to a USD price and labelled USD
**Severity** High · **Workflow** Search / pricing display · **Roles** Client
**Runtime evidence.** A Montreal listing card displayed "Tax 5,250 USD · Before booking 5,260 USD" — SYP fee amounts added to a USD-converted price and labelled USD.
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 1. **Dependencies** Relates to the frozen `SYP_PER_USD` constant (static S1).
**Owner decision:** ______  **Owner notes:** ______

## E2E-18 — Cancellation fee hard-coded USD applied to a SYP booking
**Severity** High · **Workflow** Cancellation / wallet · **Roles** Host
**Runtime evidence.** A `10` minor-unit USD fee ($0.10) applied to a SYP booking produced a **−10 USD wallet**, which then blocks account closure via E2E-11.
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 1. **Dependencies** Per-currency fee policy is an owner business rule.
**Owner decision:** ______  **Owner notes:** ______

## E2E-19 — Host "Views" analytics fabricated by formula
**Severity** High · **Workflow** Host analytics · **Roles** Host
**Runtime evidence.** View counts are computed by formula from other data, not measured.
**Related static finding** None (adjacent to the static fabricated-data theme). **Already known?** **No — wholly new.**
**Recommended wave** Wave 1. **Dependencies** Owner decision: remove the metric or measure it.
**Owner decision:** ______  **Owner notes:** ______

## E2E-20 — "Payout ready" displays guest gross
**Severity** High · **Workflow** Host earnings display · **Roles** Host
**Runtime evidence.** The dashboard showed **0** while **262,857 SYP** had in fact been released; the field renders guest gross of confirmed bookings, not host payout.
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 1. **Dependencies** None.
**Owner decision:** ______  **Owner notes:** ______

## E2E-21 — Admin cancellation under-evidenced
**Severity** High · **Workflow** Admin booking intervention · **Roles** Admin
**Runtime evidence.** One audit row written for a three-record cascade, and the admin's stated reason is **dropped**.
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 2. **Dependencies** None.
**Owner decision:** ______  **Owner notes:** ______

## E2E-22 — Listing editing absent while the UI presents an edit control
**Severity** High · **Workflow** Listing management · **Roles** Host
**Runtime evidence.** No edit endpoint or flow exists; the host UI shows an edit affordance.
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 1. **Dependencies** Owner decision: build editing or remove the control.
**Owner decision:** ______  **Owner notes:** ______

## E2E-23 — Four of five compliance documents have a null retention clock
**Severity** High · **Workflow** Document retention · **Roles** Controller
**Runtime evidence.** Only one of five private-document categories carries a populated retention clock.
**Related static finding** Adjacent to static **A3-09**. **Already known?** **No — wholly new as a runtime measurement.**
**Recommended wave** Wave 4. **Dependencies** Retention policy decision; scheduler (SYB-021).
**Owner decision:** ______  **Owner notes:** ______

## E2E-24 — USD $5 round-up erases host promotional pricing
**Severity** High · **Workflow** Pricing / promotions · **Roles** Host, Client
**Runtime evidence.** A USD rounding step overwrites host-set promotional prices.
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 1. **Dependencies** Pricing rule is an owner business decision.
**Owner decision:** ______  **Owner notes:** ______

## E2E-25 — `ipHash` null in every audit row
**Severity** High (recorded Medium by the source agent; retained at the register's higher classification for visibility — **not a reprioritisation of any static finding**) · **Workflow** Audit evidence · **Roles** All
**Runtime evidence.** `AdminAuditLog.ipHash` is null in **86 of 86** rows; the column is declared and never written.
**Related static finding** None. **Already known?** **No — wholly new.**
**Recommended wave** Wave 2. **Dependencies** None.
**Owner decision:** ______  **Owner notes:** ______

---

## Register notes

- **No static finding is closed, renumbered, reprioritised, or merged** by this register.
- Session 01 decisions already taken (SYB-009, SYB-007, SYB-018, SYB-006) are **unaffected**; the runtime
  evidence for E2E-05 and E2E-03 supports decisions already made rather than reopening them.
- **E2E-06 corresponds to SYB-004, which is currently presented and undecided in Session 01.** This
  register does not pre-empt that decision.
- Recommended waves reference the **existing frozen roadmap** and propose no changes to it.
