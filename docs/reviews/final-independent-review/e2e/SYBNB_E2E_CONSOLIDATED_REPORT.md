# SYBNB — End-to-End Multi-Role Validation, Consolidated Report

**Baseline:** `6e8b8f2` · **Date:** 2026-07-23
**Environment:** local only — API `127.0.0.1:3051`, web `127.0.0.1:5180`, local Postgres. **No production, no staging, no remote host.**
**Agents:** Client/Guest · Host · Admin · Controller/Auditor — run in parallel, each blind to the others' reports.
**Coordinator:** Claude, consolidating only after all four finished.

> **No implementation was changed.** No source, test, configuration, dependency, schema, or documentation
> file was modified by any agent. Nothing was committed, pushed, merged, or deployed. No finding was
> closed. No remediation was started.

---

## 1. Totals

**167 workflows and checks exercised across four roles.**

| Outcome | Count |
|---|---|
| **PASS** | 95 |
| PASS with defect | 2 |
| **FAIL** | 39 |
| PARTIAL | 3 |
| **NOT IMPLEMENTED** | 18 |
| BLOCKED (environment) | 6 |
| Restricted (not attempted by instruction) | 3 |
| Observation only | 1 |
| **Total** | **167** |

| Agent | Exercised | PASS | FAIL | NOT IMPL. | Other |
|---|---|---|---|---|---|
| Client / Guest | 46 | 25 | 9 | 7 | 5 blocked |
| Host | 45 | 20 (+2 with defect) | 12 | 7 | 1 blocked, 3 restricted |
| Admin | 50 | 41 | 6 | 2 | 1 observation |
| Controller | 26 | 9 | 12 | 2 | 3 partial |

**Live request volume:** the admin agent alone issued 224 requests with **zero 5xx responses**, measuring
audit-row deltas immediately before and after every privileged call.

---

## 2. Failure classification

| Class | Count | Representative |
|---|---|---|
| Cross-role chain failures | 6 | Booking cannot progress past `PAYMENT_PENDING` to any role |
| Security failures | 4 | SUPPORT password-only staff token; 4 document routes inline; legal hold cleared by typo |
| Privacy failures | 3 | Driver CSV export unaudited; 4 of 5 staff document routes unaudited; retention clock null |
| State-integrity failures | 9 | Absorbing booking state; unbacked wallet balance; no creation audit rows |
| Financial-truth failures | 6 | Fabricated receipt; income overstated 177%; payout-ready shows guest gross |
| Audit failures | 5 | Zero creation events; `ipHash` null in 86/86 rows; cancellation reason dropped |
| External-dependency blockers | 6 | R2, Redis, email, SMS, Stripe, AI — all unexercised or unconfigured |

---

## 3. Cross-role agreement

Findings reached **independently** by two or more agents. This is the strongest signal in the package.

| Finding | Agents | Prior register |
|---|---|---|
| `PAYMENT_PENDING` is an absorbing state that permanently denies inventory | Client, Host, Controller | Confirms **SYB-002** |
| Payment confirmation and receipt fabricated with zero API calls | Client, Controller | Confirms **SYB-006** |
| The local/Sham-Cash payment path is a silent no-op on real bookings | Client, Controller | **Extends SYB-006** |
| STG-12 false — private documents render inline on 4 routes | Admin, Controller | Confirms **SYB-004** |
| STG-24 false — staff document reads unaudited on 4 routes | Admin, Controller | Confirms **SYB-005** |
| No payout write path; earnings terminate in an internal wallet | Host, Client | Confirms **SYB-011** |
| Past-dated and absurd-duration bookings accepted | Client, Host | **New** |
| No guest account surface — no sign-in, profile, or trips | Client, Controller | Confirms **SYB-010** |

---

## 4. Disagreements

**None of substance.** Where agents examined the same surface they agreed, including on the two false
documentation claims, which Admin and Controller established by different methods (response headers
versus call-site analysis plus the complete audit table).

One **scope difference** worth recording rather than resolving: the Controller declined to obtain an
admin token because the only available route was a password reset that would have invalidated a parallel
agent's session. Three of its checks therefore rest on exhaustive call-site analysis and the full audit
table rather than live requests. It declared this itself. The Admin agent covered those surfaces live,
and their conclusions match.

---

## 5. Master E2E finding register

**Type:** ✅ = verified live during this validation · 📄 = established by code/DB analysis.
**Prior:** whether the finding was already in the 52-finding review register.

### Critical

| ID | Finding | Agents | Type | Prior |
|---|---|---|---|---|
| **E2E-01** | **No STR listing can be published in the shipped configuration.** Every `jurisdiction_compliance_profiles` row is BLOCKED (SY) or PENDING (CA); `assertJurisdictionApproved` fails closed, so admin approval of a valid Syria STAYS listing returns `403 JURISDICTION_NOT_APPROVED`. **Nothing warns the host** — create and submit both return success, so a host completes photos, documents, ID verification and pricing on a listing that can never go live | Host | ✅ | **NEW** |
| **E2E-02** | `PAYMENT_PENDING` is an absorbing state. Verified by exhaustion: guest cancel 400, dispute 400, host decision requires `REQUESTED`/`CONFIRMED`, admin queue never lists it, `completeExpiredBookings` touches `CONFIRMED` only, no scheduler exists. Dates enter public availability immediately and are never released. An unauthenticated device-guest blocked a listing for 2030–2035 | Client, Host, Controller | ✅ | SYB-002 |
| **E2E-03** | Payment confirmation and receipt fabricated entirely in the browser. Network capture recorded **zero `/api/` requests** while the UI rendered "Payment confirmed" and a receipt reading *Status Approved · Total paid 4,500 USD · Invoice INV-FALLBACK* | Client, Controller | ✅ | SYB-006 |
| **E2E-04** | On a **real** booking the same control issues no request and shows **no error** — the `catch` sets an error state which the `finally` immediately overwrites. `submitPrototypeLocalWalletProof` has zero call sites. This is how an ordinary guest reaches E2E-02 | Client, Controller | ✅ | Extends SYB-006 |
| **E2E-05** | SUPPORT signs in with password alone (`200` + staff token) while ADMIN correctly gets `403 STAFF_OTP_REQUIRED`. With that token: read a guest's identity document, export the full driver registry, read the audit log, reset a verified user's identity | Admin | ✅ | SYB-009 |
| **E2E-06** | STG-12 recorded CLOSED is false. `content-disposition: attachment` present on the two identity routes only; driver-documents, listing-documents, driver self-documents and listing-documents-by-listing return none | Admin, Controller | ✅ | SYB-004 |
| **E2E-07** | STG-24 recorded CLOSED is false. `STAFF_DOCUMENT_ACCESSED` written on identity reads only; all four other staff document routes measured **delta 0** | Admin, Controller | ✅ | SYB-005 |
| **E2E-08** | A mistyped `{"legalHold":true}` (correct field is `hold`) returns **200 and silently clears an active legal hold** | Admin | ✅ | **NEW** |
| **E2E-09** | Host tax statement overstates income by **177%**. `/api/host/statements` counts each `booking_payout` twice (HOLD + RELEASE) and reads `refundedMinor` only from Dispute rows, so a cancelled fully-refunded booking reports as full income. 830,000 SYP reported against 300,000 earned. **This feeds the Part XX compliance statement** | Host | ✅ | **NEW** |

### High

| ID | Finding | Agents | Type | Prior |
|---|---|---|---|---|
| **E2E-10** | No endpoint writes `User.payoutMethod`; 0/34 users have one; `src/` never references it. Admin released 262,857 SYP against `hostPayoutMethod: null`. No withdrawal route exists | Host, Client | ✅ | SYB-011 |
| **E2E-11** | A stuck booking or negative wallet permanently blocks account closure — `DELETE /api/me` → `409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS`, with no path to clear it | Controller, Host | ✅ | **NEW** |
| **E2E-12** | No date validation. Past-dated, no-date, 500-year and $273 M bookings accepted via API **and** through the real UI calendar | Client, Host | ✅ | **NEW** |
| **E2E-13** | `GuestAccountPage` and guest `DashboardPage` are dead code. No sign-in, sign-up, sign-out, profile or trips list anywhere in the client UI; every client is an anonymous device account | Client | ✅ | SYB-010 |
| **E2E-14** | The driver CSV export — names, emails, plates, the widest PII egress on the platform — writes no audit row | Admin | ✅ | **NEW** |
| **E2E-15** | Zero audit rows for booking, proof, listing or account **creation**. Audit begins only at decision time | Controller | ✅ | **NEW** |
| **E2E-16** | 1,000,000 SYP of wallet balance unbacked by any ledger entry, with no reconciliation control anywhere | Controller | ✅ | **NEW** |
| **E2E-17** | Search cards add SYP fees to a USD-converted price and label the sum USD — a Montreal listing showed "Tax 5,250 USD · Before booking 5,260 USD" | Client | ✅ | **NEW** |
| **E2E-18** | Host cancellation fee is hard-coded USD (`10` minor = $0.10) applied to a SYP booking, producing a −10 USD wallet that then blocks closure via E2E-11 | Host | ✅ | **NEW** |
| **E2E-19** | Host "Views" analytics are fabricated by formula, not measured | Host | ✅ | **NEW** |
| **E2E-20** | Dashboard "Payout ready" displays guest gross of confirmed bookings — showed 0 while 262,857 SYP had been released | Host | ✅ | **NEW** |
| **E2E-21** | Admin booking cancellation emits one audit row for a three-record cascade and **drops the admin's stated reason** | Admin | ✅ | **NEW** |
| **E2E-22** | Listing editing does not exist, while the UI presents an edit control | Host | ✅ | **NEW** |
| **E2E-23** | 4 of 5 compliance documents carry a null retention clock | Controller | ✅ | **NEW** |
| **E2E-24** | A USD $5 round-up erases host promotional pricing | Host | ✅ | **NEW** |
| **E2E-25** | `AdminAuditLog.ipHash` is null in **86 of 86** rows | Admin | ✅ | **NEW** |

**19 of 25 significant E2E findings are new** — not present in the 52-finding static review register.

---

## 6. What held up

Recorded with the same weight as the failures, because it is equally load-bearing:

- **Authorization is genuinely strong.** 15/15 controller negative tests denied; 56× 403 and 22× 401 in the admin run; no IDOR found; token forgery rejected; cross-tenant access refused.
- **Server-side money model is well defended** — amount tampering, replay, underpayment and double-approval all repelled.
- **Decisions are TOCTOU-guarded**; failed actions left zero partial writes; admin reads were byte-identical no-ops.
- **Session control works** — logout revoked all tokens; suspending a driver instantly killed their session.
- **Upload defences hold** — MIME/signature sniffing, size limits and PII projection all behaved.
- **Zero 5xx across 224 admin requests.**

**The recurring pattern:** the server contracts are sound and the primary UI does not use them.

---

## 7. Readiness by section

| Section | Classification |
|---|---|
| Public landing, search, filters, listing detail | **END-TO-END VERIFIED** |
| Authentication and session control | **END-TO-END VERIFIED** |
| Authorization and role separation | **END-TO-END VERIFIED** |
| Media and document upload (local driver) | **PARTIALLY VERIFIED** — durability against R2 unproven |
| Identity-document submission and review | **PARTIALLY VERIFIED** — works; audit and download controls incomplete |
| Listing creation and submission | **PARTIALLY VERIFIED** — creation works, publication cannot |
| **Listing publication** | **FAILED** — fails closed platform-wide (E2E-01) |
| Availability and date selection | **FAILED** — no picker; no validation |
| Booking creation | **PARTIALLY VERIFIED** — creates, then traps |
| **Booking lifecycle** | **FAILED** — absorbing state, no release |
| **Payment (local/Sham Cash)** | **FAILED** — non-functional and fabricated |
| Payment (card) | **NOT SAFE TO TEST** — external provider |
| Cancellation and refunds | **FAILED** — unreachable from `PAYMENT_PENDING` |
| Guest account, trips, profile | **NOT IMPLEMENTED** |
| Host earnings and payouts | **FAILED** — no payout path; figures misstated |
| Host tax/compliance statement | **FAILED** — overstates income |
| Admin review and decisions | **END-TO-END VERIFIED** (blocked downstream by E2E-01) |
| Admin audit and access controls | **PARTIALLY VERIFIED** — 1 of 5 document routes audited |
| Notifications | **NOT IMPLEMENTED** |
| Messaging | **PARTIALLY VERIFIED** — post-confirmation only |
| Support operations | **NOT IMPLEMENTED** |
| Storage durability (R2) | **BLOCKED BY ENVIRONMENT** |

## 8. Readiness by role

| Role | Classification | Basis |
|---|---|---|
| Client / Guest | **FAILED** | Can book; cannot pay, cancel, or track |
| Host | **FAILED** | Cannot publish; cannot be paid; income misstated |
| Admin | **PARTIALLY VERIFIED** | Controls work; audit and download coverage incomplete; blocked downstream |
| Controller / Auditor | **PARTIALLY VERIFIED** | Authorization auditable; lifecycle, financial and creation evidence absent |

## 9. Readiness by end-to-end scenario

| Scenario | Classification |
|---|---|
| 1 — Normal booking | **FAILED** — cannot reach confirmation |
| 2 — Guest checkout | **FAILED** — permanent inventory denial demonstrated |
| 3 — Booking cancellation | **FAILED** — no cancellation path from the created state |
| 4 — Listing lifecycle | **FAILED** — publication impossible (E2E-01) |
| 5 — Identity-document workflow | **PARTIALLY VERIFIED** — works; access controls incomplete |
| 6 — Support intervention | **FAILED** — SUPPORT step-up absent; no support workflow exists |
| 7 — Failure and recovery | **PARTIALLY VERIFIED** — fails safely at the API; the UI hides failure and offers no recovery |

---

## 10. Overall conclusion

# NOT READY

**Defined precisely, and not a launch judgment** — closed-beta and production readiness are outside this
document's scope and are not assessed here.

**NOT READY means:** the end-to-end chain *Client → Host → Admin → Controller* **cannot complete in the
shipped configuration**. Three independent breaks each stop it on their own:

1. **No listing can be published** (E2E-01) — the chain cannot start without a manual database change.
2. **No payment can complete** through the intended local method (E2E-04) — and the alternative fabricates its result (E2E-03).
3. **Bookings enter a state nothing can exit** (E2E-02) — so inventory is consumed permanently by the attempt.

Everything the host agent reached beyond step 1 required a **disclosed, restored temporary jurisdiction
flip**, and is marked as such. That is a workaround, not evidence that the shipped path works.

**This is not "nothing works."** 95 of 167 workflows passed, and the security and authorization layers
performed well under deliberate attack. The failure is concentrated in the primary user journeys and in
the truthfulness of what the UI reports back — not in the platform's foundations.

---

## 11. Limitations

- **Local environment only.** No production, staging, or deployed instance was touched.
- **R2 never connected** — storage durability, the central claim of the frozen storage work, remains unproven.
- **Stripe and AI endpoints deliberately not exercised**, so card payment and host insights are untested.
- **Email and SMS unconfigured** — no notification path could be tested even in principle.
- One **disclosed environment intervention** (jurisdiction flip, restored) was required to reach host workflows beyond listing submission.
- The Controller declined an admin token to avoid invalidating a parallel agent's session; three of its checks rest on analysis rather than live requests, and it said so.
- Agent coverage was uneven by design; a finding's absence here is not evidence of its absence in the code.

## 12. Synthetic fixtures left behind

All in the **local dev database only**. Nothing in production; no real data at any point.

- Synthetic `@sybnb.test` users across all four roles.
- **One unreleasable `PAYMENT_PENDING` booking** holding 2026-11-10→13 — genuinely stuck by E2E-02.
- Three further stuck `PAYMENT_PENDING` bookings pre-existing or created during testing.
- One `PENDING_ADMIN_REVIEW` payment proof and one `PENDING_REVIEW` identity document — both will appear in admin queues.
- One DRAFT listing plus one CITQ document; two synthetic PNGs in the temp storage directory.
- Admin harness scripts preserved outside the repository at `$CLAUDE_JOB_DIR/tmp/e2e-harness/`.

**No audit rows were deleted by any agent.**
