# SYBNB — End-to-End Blocker Register

**Baseline:** `6e8b8f2` · **Date:** 2026-07-23 · **Source:** the four role reports and the E2E consolidated report.

**Scope of this register:** items that **stop a workflow completing**, not every defect. Non-blocking
defects remain in the consolidated report and the four role reports; nothing is dropped.

**Blocker classes:**
- **CHAIN** — stops the cross-role end-to-end chain.
- **ENV** — blocked by the validation environment, not by the code.
- **SAFETY** — deliberately not exercised on instruction.
- **EVIDENCE** — the workflow runs but produces no trustworthy record.

---

## 1. Chain blockers — stop the end-to-end journey

| # | ID | Blocker | Where the chain stops | Agents | Can testing proceed without a fix? |
|---|---|---|---|---|---|
| **B-01** | E2E-01 | **No listing can be published.** All jurisdiction-compliance rows BLOCKED/PENDING; `assertJurisdictionApproved` fails closed; admin approval returns `403 JURISDICTION_NOT_APPROVED`. Host receives **no warning** at create or submit | Host → Admin (publication) | Host | Only via a manual database change — which the host agent did, disclosed, and restored |
| **B-02** | E2E-04 | **The local/Sham-Cash payment control is a silent no-op** on real bookings. No request issued; the `catch` sets an error the `finally` overwrites, so the user sees nothing at all. `submitPrototypeLocalWalletProof` has zero call sites | Guest → Admin (payment review) | Client, Controller | No — the only completable route is Stripe, which was out of scope |
| **B-03** | E2E-02 | **`PAYMENT_PENDING` is absorbing.** No role and no job can exit it: guest cancel 400, dispute 400, host decision needs `REQUESTED`/`CONFIRMED`, admin queue never lists it, `completeExpiredBookings` handles `CONFIRMED` only, no scheduler exists. Dates enter public availability immediately | Guest → Host → Admin (all downstream) | Client, Host, Controller | No — every attempt consumes inventory permanently |
| **B-04** | E2E-13 | **No guest account surface.** No sign-in, sign-up, sign-out, profile or trips list in the client UI; `GuestAccountPage` and guest `DashboardPage` are dead code. Every client is an anonymous device account | Guest (post-booking) | Client, Controller | Partially — `/#/track` is the only trip view |
| **B-05** | E2E-10 | **No payout path.** No endpoint writes `User.payoutMethod` (0/34 users have one); no withdrawal route exists; earnings terminate in an internal wallet | Host (settlement) | Host, Client | No — money cannot leave the platform |
| **B-06** | E2E-11 | **Account closure permanently blocked.** A stuck booking or a negative wallet returns `409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS` with no path to clear it | Guest/Host (exit) | Controller, Host | No — the state is unreachable and unresolvable |

## 2. Environment blockers — the code was not at fault

| # | Blocker | Effect on validation | Why |
|---|---|---|---|
| **B-07** | **Cloudflare R2 never connected** | Storage exercised on the local filesystem driver only. **The central claim of the frozen storage work — that uploads survive instance replacement — remains unproven** | Not authorized. Validation Wave 1 (cross-cutting X-3) is still undecided |
| **B-08** | **`STORAGE_DRIVER` absent from `.env`** | Every upload would have thrown `STORAGE_DRIVER_INVALID`, blocking all media and document workflows | Resolved by setting the variable **on the launch command only** — no configuration file modified. Disclosed in the matrix |
| **B-09** | Email provider unconfigured | **No notification workflow could be tested even in principle.** OTPs retrieved via inline `devCode` | Resend not configured locally |
| **B-10** | SMS provider unconfigured | Phone-OTP paths untested | Twilio not configured |
| **B-11** | Upstash Redis unconfigured | In-memory limiter used; fail-open behaviour under store failure not exercised at scale | Not configured locally |
| **B-12** | No scheduler exists in the deployment | Every time-driven transition is traffic-driven; expiry and retention cannot be tested because they cannot run | `vercel.json` has no `crons` |

## 3. Safety blockers — deliberately not exercised

| # | Blocker | Why | Consequence |
|---|---|---|---|
| **B-13** | **Stripe / card payment** | A live test key is configured; connecting to a payment provider was not authorized | The only completable payment route is untested |
| **B-14** | **`POST /api/host/insights/generate`** | Spends Anthropic credits | AI insight path untested |
| **B-15** | Admin token acquisition by the Controller | The only route was a password reset that would have invalidated a parallel agent's session | Three controller checks rest on call-site analysis plus the full audit table rather than live requests — declared by the agent, and independently covered live by the Admin agent |

## 4. Evidence blockers — the workflow runs but leaves no trustworthy record

| # | ID | Blocker | Consequence |
|---|---|---|---|
| **B-16** | E2E-15 | **Zero audit rows for booking, proof, listing or account creation.** Audit begins only at decision time | Creation cannot be reconstructed or attributed after the fact |
| **B-17** | E2E-07 | **Staff document reads audited on 1 of 5 routes.** Driver, Québec, listing and thread document reads leave no trace | "Who accessed what" is unanswerable for four of five categories |
| **B-18** | E2E-14 | **Driver CSV export unaudited** — the widest PII egress on the platform | A bulk PII extraction leaves no record |
| **B-19** | E2E-25 | `AdminAuditLog.ipHash` null in **86 of 86** rows | Origin attribution absent from every audit row |
| **B-20** | E2E-21 | Admin cancellation writes one audit row for a three-record cascade and **drops the stated reason** | Financial intervention is under-evidenced |
| **B-21** | E2E-16 | 1,000,000 SYP wallet balance unbacked by ledger, **no reconciliation control anywhere** | Financial state cannot be independently verified |

## 5. Truthfulness blockers — the system reports something untrue

Recorded separately because they are not workflow stoppages; they are worse — the workflow *appears* to succeed.

| # | ID | What is reported | What is true |
|---|---|---|---|
| **B-22** | E2E-03 | "Payment confirmed", receipt *Status Approved · 4,500 USD · Invoice INV-FALLBACK* | **Zero `/api/` requests issued.** Nothing was paid or recorded |
| **B-23** | E2E-09 | Host income 830,000 SYP, feeding the **Part XX compliance statement** | 300,000 SYP actually earned — a 177% overstatement |
| **B-24** | E2E-06 | Threat model records STG-12 **CLOSED** | 4 private-document routes serve inline with no `content-disposition` |
| **B-25** | E2E-07 | Threat model records STG-24 **CLOSED** | Staff document auditing covers 1 of 5 routes |
| **B-26** | E2E-20 | Dashboard "Payout ready" | Shows guest gross; displayed 0 while 262,857 SYP had been released |
| **B-27** | E2E-19 | Host "Views" analytics | Fabricated by formula, not measured |
| **B-28** | E2E-17 | "Tax 5,250 USD · Before booking 5,260 USD" | SYP fees added to a USD-converted price and labelled USD |
| **B-29** | E2E-22 | UI presents a listing edit control | Listing editing does not exist |

## 6. Silent-failure blockers — dangerous because nothing surfaces

| # | ID | Blocker |
|---|---|---|
| **B-30** | E2E-08 | A mistyped `{"legalHold":true}` (correct field `hold`) returns **200 and silently clears an active legal hold** |
| **B-31** | E2E-01 | Listing create and submit both return success on a listing the platform already knows can never publish |
| **B-32** | E2E-04 | The payment control's error state is overwritten by its own `finally` block, so failure is invisible |
| **B-33** | E2E-12 | Past-dated, no-date, 500-year and $273 M bookings accepted without validation, via API **and** UI |

---

## 7. Summary

| Class | Count |
|---|---|
| Chain blockers | 6 |
| Environment blockers | 6 |
| Safety blockers (by instruction) | 3 |
| Evidence blockers | 6 |
| Truthfulness blockers | 8 |
| Silent-failure blockers | 4 |
| **Total registered** | **33** |

**Minimum set to make the end-to-end chain testable at all:** B-01, B-02, B-03. Without those three, no
complete Client → Host → Admin → Controller journey can run in the shipped configuration.

**Blockers that a fix cannot resolve, only a decision can:** B-07 (R2 connection — cross-cutting X-3),
B-13 and B-14 (external providers), B-15 (already mitigated by Admin-agent coverage).

**Nothing in this register is authorized for remediation.** No finding is closed. All items remain open
pending owner decision.
