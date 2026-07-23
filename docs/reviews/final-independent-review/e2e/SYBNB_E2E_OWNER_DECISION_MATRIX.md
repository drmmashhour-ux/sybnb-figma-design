# SYBNB — End-to-End Owner Decision Matrix

**Baseline:** `6e8b8f2` · **Date:** 2026-07-23 · **Source:** E2E consolidated report and blocker register.

> **No decision has been made on the owner's behalf.** Every decision field is blank.
> **No finding is closed. No remediation is authorized by this document.**
>
> **Relationship to the existing decision process:** Owner Decision Session 01 is mid-flight — 4 of 12
> Critical findings decided (SYB-009, SYB-007, SYB-018, SYB-006), with SYB-004 presented and open. This
> matrix does **not** replace that sequence. Where an E2E finding confirms an existing SYB finding, the
> existing finding governs and this matrix records only what the live evidence adds.

---

## 1. E2E findings that confirm an existing SYB finding

**No new decision is required for these** — they strengthen the evidence base for decisions already in
progress. Recorded so the confirmation is not lost.

| E2E ID | Confirms | Status in Session 01 | What live testing added |
|---|---|---|---|
| E2E-02 | **SYB-002** | Not yet presented | Proved absorbing by exhaustion; demonstrated an unauthenticated guest blocking 2030–2035 |
| E2E-03 | **SYB-006** | **ACCEPTED** with required sequencing | Network capture: zero `/api/` requests, receipt `INV-FALLBACK` rendered |
| E2E-05 | **SYB-009** | **ACCEPTED** | Password-only staff token used to read an ID document, export the driver registry, read the audit log |
| E2E-06 | **SYB-004** | **Presented, awaiting decision** | Exact route split confirmed with verbatim headers |
| E2E-07 | **SYB-005** | Not yet presented | Audit delta measured at 0 on four routes |
| E2E-10 | **SYB-011** | Not yet presented | 0/34 users have a payout method; 262,857 SYP released against `null` |
| E2E-13 | **SYB-010** | Not yet presented | Confirmed dead code; no client auth UI at all |

**E2E-04 materially extends SYB-006.** The fabricated path is not merely untrustworthy — the real path
is a **silent no-op**, so removing the fabrication without wiring the replacement would leave guests with
no payment method and no error message. This is exactly the risk your required sequencing guards
against, now confirmed empirically.

---

## 2. New findings requiring an owner decision

Nineteen findings are new. The nine below are Critical or carry irreversible consequences; the
remainder are listed in §3.

### E2E-01 — No STR listing can be published in the shipped configuration
**Severity:** Critical · **Class:** chain blocker (B-01) · **Agent:** Host
**Finding.** Every `jurisdiction_compliance_profiles` row is BLOCKED (SY) or PENDING (CA). `assertJurisdictionApproved` fails closed, so admin approval of a valid Syria STAYS listing returns `403 JURISDICTION_NOT_APPROVED`. **Nothing warns the host** — create and submit both return success.
**Why it matters.** The STR division proposed for launch cannot publish a single listing. A host completes photos, documents, ID verification and pricing on a listing the platform already knows can never go live. This blocks the chain before any other finding applies.
**Options.** (a) Seed Syria as APPROVED for the closed beta and warn the host at create/submit; (b) warn only, leaving publication blocked; (c) treat the fail-closed behaviour as correct and defer the beta; (d) accept.
**Accept (a):** listings can publish and the chain becomes testable. **Reject:** no listing goes live. **Defer:** the closed beta cannot open on STR.
**Owner decision required?** **Yes — this is a jurisdiction/compliance judgment, not a technical one.**
**Final owner decision:** ______  **Owner notes:** ______

### E2E-09 — Host tax statement overstates income by 177%, feeding Part XX
**Severity:** Critical · **Class:** truthfulness (B-23) · **Agent:** Host
**Finding.** `/api/host/statements` counts each `booking_payout` twice (HOLD + RELEASE) and reads `refundedMinor` only from Dispute rows, so a cancelled fully-refunded booking reports as full income. 830,000 SYP reported against 300,000 earned.
**Why it matters.** This is a compliance artifact, not a dashboard number. An overstated income figure feeding a tax statement is a reporting exposure.
**Options.** (a) Correct both defects and add regression tests; (b) suppress the statement until corrected; (c) accept.
**Accept:** hosts and any tax filing receive true figures. **Reject/Defer:** the platform produces incorrect compliance output.
**Owner decision required?** Yes — whether to suppress the statement in the interim.
**Final owner decision:** ______  **Owner notes:** ______

### E2E-08 — Mistyped field silently clears an active legal hold
**Severity:** Critical · **Class:** silent failure (B-30) · **Agent:** Admin
**Finding.** `{"legalHold":true}` (correct field: `hold`) returns **200 and clears an active legal hold**.
**Why it matters.** Legal hold is the control that prevents deletion of evidence under dispute or legal obligation. Silently clearing it defeats the retention governance the platform relies on — and the caller believes they *set* it.
**Options.** (a) Reject unknown fields and require the correct field; (b) reject unknown fields platform-wide; (c) accept.
**Accept (a):** holds cannot be cleared by accident. **Reject/Defer:** evidence under hold can be released by a typo.
**Owner decision required?** No — but scope (a vs b) is yours.
**Final owner decision:** ______  **Owner notes:** ______

### E2E-11 — Account closure permanently blocked
**Severity:** High · **Class:** chain blocker (B-06) · **Agents:** Controller, Host
**Finding.** A stuck booking or a negative wallet returns `409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS` with no path to clear it.
**Why it matters.** A user who cannot close their account has no exit. Combined with E2E-02 and E2E-18, an ordinary abandoned checkout can produce this state.
**Options.** (a) Admin resolution path for stuck obligations; (b) exclude `PAYMENT_PENDING` and de-minimis negative balances from the check; (c) accept.
**Owner decision required?** Yes — this touches data-subject rights; consider with counsel.
**Final owner decision:** ______  **Owner notes:** ______

### E2E-12 — No date validation
**Severity:** High · **Class:** silent failure (B-33) · **Agents:** Client, Host
**Finding.** Past-dated, no-date, 500-year and $273 M bookings accepted via API **and** through the real UI.
**Options.** (a) Server-side validation plus UI constraints; (b) server-side only; (c) accept.
**Owner decision required?** No — but maximum stay length is a business rule you should set.
**Final owner decision:** ______  **Owner notes:** ______

### E2E-16 — Wallet balance unbacked by ledger, no reconciliation control
**Severity:** High · **Class:** evidence (B-21) · **Agent:** Controller
**Finding.** 1,000,000 SYP of balance with no corresponding ledger entries, and no reconciliation control anywhere.
**Why it matters.** Financial state cannot be independently verified. Whether this originates from seed data or a real defect must be determined before any conclusion is drawn.
**Options.** (a) Investigate origin, then add a reconciliation control; (b) investigate only; (c) accept.
**Owner decision required?** Yes — this is a financial-controls decision.
**Final owner decision:** ______  **Owner notes:** ______

### E2E-14 — Driver CSV export unaudited
**Severity:** High · **Class:** evidence (B-18) · **Agent:** Admin
**Finding.** The widest PII egress on the platform — names, emails, plates — writes no audit row.
**Options.** (a) Audit the export; (b) audit and restrict the role; (c) accept.
**Owner decision required?** No.
**Final owner decision:** ______  **Owner notes:** ______

### E2E-15 — Zero audit rows for creation events
**Severity:** High · **Class:** evidence (B-16) · **Agent:** Controller
**Finding.** Booking, proof, listing and account creation write no audit rows; auditing begins only at decision time.
**Options.** (a) Audit creation across all four; (b) audit financial creations only; (c) accept.
**Owner decision required?** Yes — scope, and whether this belongs in `AdminAuditLog` or a separate event log.
**Final owner decision:** ______  **Owner notes:** ______

### E2E-18 — Host cancellation fee hard-coded USD applied to a SYP booking
**Severity:** High · **Class:** financial truth · **Agent:** Host
**Finding.** A `10` minor-unit USD fee ($0.10) applied to a SYP booking produced a −10 USD wallet, which then blocks account closure via E2E-11.
**Options.** (a) Currency-aware fee; (b) block cancellation fees on non-USD bookings until corrected; (c) accept.
**Owner decision required?** Yes — the fee policy per currency is a business rule.
**Final owner decision:** ______  **Owner notes:** ______

---

## 3. Remaining new findings

Recorded for completeness; none is closed.

| ID | Finding | Severity | Owner decision needed? |
|---|---|---|---|
| E2E-17 | SYP fees added to USD price, labelled USD | High | No — defect |
| E2E-19 | Host "Views" analytics fabricated by formula | High | Yes — remove or measure |
| E2E-20 | "Payout ready" shows guest gross | High | No — defect |
| E2E-21 | Cancellation: 1 audit row for 3-record cascade; reason dropped | High | No — defect |
| E2E-22 | Listing editing absent while UI shows an edit control | High | Yes — build or remove |
| E2E-23 | 4 of 5 compliance documents have a null retention clock | High | Yes — retention policy |
| E2E-24 | USD $5 round-up erases host promotional pricing | High | Yes — pricing rule |
| E2E-25 | `ipHash` null in 86/86 audit rows | Medium | No — defect |

---

## 4. Cross-cutting decisions arising from this validation

| # | Decision | Why it is yours | Decision | Notes |
|---|---|---|---|---|
| **XE-1** | Does the closed beta require E2E-01 resolved, or is a seeded jurisdiction acceptable for a controlled beta? | Compliance judgment with legal implications | ______ | ______ |
| **XE-2** | Should the Part XX / host tax statement be suppressed until E2E-09 is corrected? | Producing incorrect compliance output is a reporting exposure | ______ | ______ |
| **XE-3** | Does Validation Wave 1 (R2 connection) now execute, given storage durability remains unproven (B-07)? | Already open as cross-cutting **X-3** in Session 01 | ______ | ______ |
| **XE-4** | Should the stuck `PAYMENT_PENDING` bookings left in the dev database be cleared, and how? | They are genuinely unreleasable; clearing needs a direct database action | ______ | ______ |
| **XE-5** | Do the 19 new E2E findings enter the existing 52-finding register, or remain a separate E2E register? | Determines whether Session 01 is re-scoped mid-flight | ______ | ______ |

**XE-5 is the sequencing decision.** Session 01 is 4 of 12 Critical decisions in. Folding 19 new findings
into it now would re-scope a process already underway; keeping them separate risks two registers drifting
apart. **Recommendation: keep them separate for now, and reconcile after Session 01 completes** — but the
choice is yours, and it should be made before the next Critical is decided.

---

**Nothing in this document authorizes remediation.** No finding is closed. No decision has been made.
