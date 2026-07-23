# SYBNB — Static vs Runtime Traceability Matrix

**Baseline:** `6e8b8f2` · **Date:** 2026-07-23
**Static source:** `SYBNB_CONSOLIDATED_FINAL_REVIEW.md` — 52 findings (12 Critical, 17 High, 22 Medium, 8 Low).
**Runtime source:** `SYBNB_E2E_RUNTIME_FINDINGS_REGISTER.md` — 25 findings (9 Critical, 16 High).

> **Cross-reference only.** Nothing is merged. No static finding is renumbered, reprioritised, or closed.
> The original review package and the Owner Review Workbook are unmodified.

---

## Summary

| Category | Count |
|---|---|
| **A.** Static finding → confirmed at runtime | **7** |
| **B.** Static finding → extended by runtime | **1** |
| **C.** Runtime-only finding (no matching static finding) | **17** |
| **D.** Static finding not yet runtime-tested | **28** |
| **E.** Static finding runtime-tested and **not** reproduced | **0** |
| **F.** Discrepancy requiring clarification | **1** |

**Two observations worth stating plainly.**

**Runtime found more than it confirmed.** 17 of 25 runtime findings had no static counterpart — including
the single most consequential result of the entire programme (E2E-01, no listing can be published). Static
review of the same codebase did not surface it, because it is a *data-state* condition, not a code defect.

**Runtime contradicted no static finding.** Category E is empty. Every static finding that was runtime-tested
was reproduced. That is a meaningful validation of the static review's accuracy.

---

## A. Static → confirmed at runtime (7)

| Static | Runtime | What runtime added | Session 01 status |
|---|---|---|---|
| **SYB-002** `PAYMENT_PENDING` holds inventory | **E2E-02** | Proved absorbing by exhaustion across all four roles; unauthenticated guest blocked 2030–2035; four bookings already stuck | Not yet presented |
| **SYB-004** STG-12 partial | **E2E-06** | Exact route split with verbatim headers: 2 routes carry `content-disposition`, 4 do not | **Presented, undecided** |
| **SYB-005** STG-24 partial | **E2E-07** | Audit-row **deltas measured** at 0 on four routes, rather than inferred from call sites | Not yet presented |
| **SYB-006** Fabricated data | **E2E-03** | Network capture: **zero `/api/` requests** while a receipt rendered *Approved · 4,500 USD · INV-FALLBACK* | **ACCEPTED** with required sequencing |
| **SYB-009** SUPPORT step-up | **E2E-05** | Full exploitation chain executed with a password-only token | **ACCEPTED** |
| **SYB-010** No guest account surface | **E2E-13** | Confirmed dead code; every client is an anonymous device account | Not yet presented |
| **SYB-011** No payout path | **E2E-10** | 0/34 users have a payout method; 262,857 SYP released against `null` | Not yet presented |

## B. Static → extended by runtime (1)

| Static | Runtime | How it changed |
|---|---|---|
| **SYB-006** Fabricated data | **E2E-04** | Static recorded the local payment path as *fabricated*. Runtime shows it is **also non-functional** — no request, and the error state is overwritten by its own `finally`, so failure is invisible. **This materially strengthens the case for the owner's required sequencing**: removing the fabrication first would leave guests with no payment method *and* no error message |

## C. Runtime-only — no matching static finding (17)

| Runtime | Finding | Severity | Why static review missed it |
|---|---|---|---|
| **E2E-01** | No STR listing can be published | Critical | **Data-state condition**, not a code defect — every jurisdiction row is BLOCKED/PENDING. Only observable by attempting an approval |
| **E2E-08** | Mistyped field silently clears a legal hold | Critical | Requires sending a malformed payload and observing the state change |
| **E2E-09** | Host tax statement overstates income 177% | Critical | Requires creating payouts and refunds, then comparing the computed statement against ledger truth |
| **E2E-11** | Account closure permanently blocked | High | Emergent — requires a stuck booking or negative wallet to exist first |
| **E2E-12** | No date validation | High | Requires submitting extreme values |
| **E2E-14** | Driver CSV export unaudited | High | Requires measuring an audit delta around the export |
| **E2E-15** | Zero audit rows for creation events | High | Absence of rows is invisible without measuring |
| **E2E-16** | Wallet balance unbacked by ledger | High | Requires reconciling balances against entries |
| **E2E-17** | SYP fees added to USD, labelled USD | High | Requires rendering a card for a cross-currency listing |
| **E2E-18** | USD cancellation fee on a SYP booking | High | Requires executing a cancellation on a non-USD booking |
| **E2E-19** | "Views" analytics fabricated by formula | High | Requires comparing displayed metrics against source data |
| **E2E-20** | "Payout ready" shows guest gross | High | Requires a released payout and a dashboard comparison |
| **E2E-21** | Cancellation under-evidenced, reason dropped | High | Requires inspecting audit rows after a cascade |
| **E2E-22** | Listing editing absent, UI shows control | High | Requires attempting the edit |
| **E2E-23** | 4 of 5 documents have a null retention clock | High | Requires querying retention state across categories |
| **E2E-24** | USD round-up erases promotional pricing | High | Requires setting a promo price and re-reading it |
| **E2E-25** | `ipHash` null in 86/86 audit rows | High | Requires inspecting the populated audit table |

**Pattern:** every runtime-only finding required either *executing a workflow*, *measuring an absence*, or
*comparing displayed output against underlying truth*. None was reachable by reading code alone.

## D. Static findings not yet runtime-tested (28)

Not contradicted — simply **not exercised** in this validation. Their static status stands unchanged.

### Critical (5 of 12 untested)

| Static | Why untested |
|---|---|
| **SYB-001** No date picker on the listing page | **See category F** — a partial runtime observation conflicts; requires clarification |
| **SYB-003** No notification mechanism | Email provider unconfigured — **untestable in principle** in this environment (blocker B-09) |
| **SYB-007** `checkout-guest` unrate-limited | **Partially observed** — the client agent noted identities were unlimited, but no dedicated rate-limit test was run |
| **SYB-008** All 8 divisions ship active | Not exercised; a navigation/config condition |
| **SYB-018** Production template omits required variables | **Not runtime-testable** — a static file defect. Confirmed indirectly: the local run required `STORAGE_DRIVER` to be supplied externally (blocker B-08) |

### High (11 of 17 untested)

SYB-012 (Ride/Québec ephemeral storage) · SYB-013 (no observability) · **SYB-014 (S3 driver never executed — remains unproven; R2 was not connected, blocker B-07)** · SYB-015 (no storage backfill) · SYB-016 (published privacy claims contradicted) · SYB-017 (demo seed) · SYB-020 (no ID hold; replacement destroys evidence) · SYB-021 (no scheduler — *indirectly confirmed*: E2E-02 established that no scheduler exists) · SYB-022 (D-2 fail-open) · SYB-023 (Prisma generate absent from build) · SYB-031 (email retained in audit payloads).

### Medium and Low (12 untested)

A1-13…A1-18 · A2-M02, M03, M05, M07…M10 · A2-L01…L04 · A3-14, A3-15 · SYB-030. None was in scope for role-based E2E validation.

**Notable:** **SYB-014 is the one static finding this validation was expected to resolve and could not.** The
storage subsystem's central claim — that uploads survive instance replacement — remains unproven, because
connecting to R2 was not authorized. Cross-cutting decision **X-3 / XE-3** governs.

## E. Static findings runtime-tested and NOT reproduced (0)

**None.** Every static finding exercised at runtime was reproduced. No static finding was contradicted,
weakened, or shown to be a false positive.

## F. Discrepancy requiring clarification (1)

| Static | Runtime observation | Nature of the discrepancy |
|---|---|---|
| **SYB-001** — "the listing page renders no date picker; `setDateRange` is never called and `disabledDates` is never read" | The client agent reported past-dated bookings created **"through the real UI (calendar lets you pick 1 July when today is 23 July)"**, implying a date control exists somewhere in the flow | **Not a contradiction, but not resolved either.** The most likely reading is that the calendar observed was the **search bar**, not the listing page, and that SYB-001 remains accurate for the listing detail page. **This has not been verified**, and the two statements should not be reconciled by assumption. A targeted check of which surface rendered that calendar would settle it |

**Recorded rather than resolved**, in keeping with the rule that minority and conflicting observations are
not silently discarded.

---

## Cross-cutting traceability

| Cross-cutting decision | Runtime bearing |
|---|---|
| **X-1** Beta before or after notifications/payouts | Runtime confirms both absent (E2E-10, blocker B-09) |
| **X-2** Correction in place vs errata | Runtime confirms both false claims (E2E-06, E2E-07), making the correction method more pressing |
| **X-3 / XE-3** Execute Validation Wave 1 | **Unchanged and now more consequential** — SYB-014 could not be resolved without it |
| **X-4** Accept Ride/Québec storage risk | Runtime confirms those routes also lack forced download and auditing (E2E-06, E2E-07) |
| **XE-5** Keep registers separate | **This document is the mechanism** by which they stay separate yet traceable |

---

## Method and limitations

- Traceability was established by mapping each runtime finding to the static register by **subject and evidence**, not by keyword.
- Categories A and B were verified by reading both findings; category C by confirming no static finding covers the subject.
- Category D lists static findings **not exercised** — this is not evidence they are resolved.
- **The 52 static findings retain their original IDs, severities, and Session 01 decision status.** Nothing here alters them.
- One count correction is carried from the runtime register: the E2E consolidated report's "19 of 25 new" should read **17 wholly new, 1 extension, 7 confirmations**.
