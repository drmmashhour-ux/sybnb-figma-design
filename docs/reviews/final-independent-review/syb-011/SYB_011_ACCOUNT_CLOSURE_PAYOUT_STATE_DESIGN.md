# SYB-011 — Account Closure & Payout-State Design

**Baseline:** commit `32b2152` · **Date:** 2026-07-23 · **Status:** design for owner approval.
**No code, schema, or behaviour change. Current closure behaviour is explicitly NOT modified.**

> Authorized under Owner Decision Session 01 (SYB-011). The owner directed: *"Do not modify the current
> closure behavior. Instead, prepare a separate design covering pending payout, payout initiated, payout
> completed, payout failed, disputed payout, abandoned account, retention, audit requirements."* This
> document is that design. It describes how a payout-state model *would* interact with closure; it changes
> nothing now.

---

## 1. Current closure behaviour (verified — and left unchanged)

`DELETE /api/me` (`me.mjs:16–75`):

1. **Guardrail 1 — wallet must be empty.** `wallets.some(w => w.cachedBalanceMinor !== 0)` → `409
   WALLET_NOT_EMPTY` "Withdraw or spend your balance before closing." (`me.mjs:23`).
2. **Guardrail 2 — no active bookings / in-flight rides** → `409 ACCOUNT_HAS_ACTIVE_OBLIGATIONS`
   (`me.mjs:36`).
3. **Anonymize-and-retain** in a transaction: PII scrubbed, `payoutMethod` nulled, `status: 'CLOSED'`,
   `deletedAt` set, `sessionVersion` bumped; **wallet ledger entries, completed bookings, and audit logs
   are KEPT** against the anonymized user id (`me.mjs:47–67`).

**The trap (E2E-11), stated plainly.** A host with *released* earnings has a non-zero
`cachedBalanceMinor` and **no withdrawal rail** (SYB-011). Guardrail 1 then makes the account
**unclosable** — the money can neither be withdrawn nor spent, and closure is refused. Today this is a
dead end. **This design does not fix it by editing closure; it defines the payout-state model that a
future, separately-authorized change would use to resolve it.**

---

## 2. Payout lifecycle states (design)

A manual payout needs an explicit lifecycle so "released" (an internal ledger credit) is distinguished
from "actually paid." Proposed states for a host payout obligation:

| State | Meaning | Wallet effect |
|---|---|---|
| **PENDING_PAYOUT** | Earnings released to the host wallet; awaiting manual disbursement | balance held, non-zero |
| **PAYOUT_INITIATED** | Staff have begun the manual disbursement (off-platform transfer started) | balance held; marked in-progress |
| **PAYOUT_COMPLETED** | Funds confirmed delivered to the registered destination | balance drawn down to zero for that amount |
| **PAYOUT_FAILED** | Disbursement attempted and failed (bad destination, bounce) | balance restored to PENDING_PAYOUT |
| **DISPUTED_PAYOUT** | Host contests receipt, or a reconciliation mismatch is raised | balance frozen pending resolution |

**Where this state lives (options, for approval):**
- **(a) `Booking.metadata` / a payout annotation** — reuses the existing `Json` columns, no schema
  change, consistent with the SYB-002 approach. Lightweight; weaker for querying "all pending payouts."
- **(b) A dedicated `Payout` model** — cleaner querying and reconciliation, but a **schema change**
  requiring separate owner approval (and it edges toward the deferred production rail).

**Recommendation for the beta:** **(a)** — annotate payout state without a schema change, since volume is
5–10 hosts and the production rail (which would justify a real `Payout` table) is deferred. Revisit (b)
when the production decision is made. → **owner decision P-1.**

---

## 3. Closure × payout-state interaction (design — not implemented)

How closure *should* behave once payout states exist. **Nothing here is applied now.**

| Account condition at closure | Proposed handling |
|---|---|
| No balance, no pending payout | Close as today (anonymize-and-retain). Unchanged. |
| **PENDING_PAYOUT balance** | Do **not** silently block forever (the E2E-11 trap). Options: (i) require the payout to complete first, with a visible "payout pending" status and a support path; (ii) allow closure with the obligation **retained** against the anonymized id and paid out afterward per retained destination. → **owner decision P-2.** |
| **PAYOUT_INITIATED** | Block closure until COMPLETED or FAILED — a disbursement is mid-flight and must resolve. |
| **PAYOUT_FAILED** | Surface to the host and support; closure blocked until re-attempted or the balance is otherwise resolved. |
| **DISPUTED_PAYOUT** | Block closure; a financial dispute must not be closed away. Ties to legal-hold/retention. |
| **Abandoned account** (host stops responding, balance stranded) | Retain the obligation and the ledger; define an escheatment/retention policy (below). Do not delete the financial record. |

**Key principle:** closure must never **destroy** an unpaid financial obligation, and must never **strand
a host with no path**. Between those, the owner chooses (P-2): pay-before-close vs close-with-retained-
obligation.

## 4. Abandoned accounts & retention

- **Financial retention is mandatory.** Wallet ledger entries, completed bookings, and audit logs are
  already retained against the anonymized id (`me.mjs` comment) — this must continue for any account with
  a payout history.
- **Abandoned-balance policy.** If a host abandons an account with a PENDING_PAYOUT balance, the platform
  needs a defined retention/escheatment period and an owner-approved end-state (continue attempting
  payout, hold indefinitely, or a jurisdiction-appropriate unclaimed-funds process). This is a
  **policy/legal decision**, flagged not solved here.
- **Retention clock.** Any payout record retained past closure needs a retention duration and a governed
  deletion point — consistent with the platform's other retention work (and distinct from the identity-
  document retention already implemented).

## 5. Audit requirements

Every payout-state transition records (reusing the `AdminAuditLog` pattern): actor (staff id or
'system'), role, timestamp, host/booking reference, prior state, resulting state, amount and currency,
and reason/reference for the manual disbursement. Raw destination details (account numbers) are **not**
written to the audit log — only the method *type* and a masked reference, mirroring the STG-24 boundary.
Manual disbursement is best-effort operationally but its **record is mandatory** — a payout that left no
audit row is indistinguishable from one that never happened.

## 6. Explicit non-goals

- **No change to current closure behaviour** — the owner's instruction. Everything in §3 is a *future*
  design contingent on separate authorization.
- No production payout rail, provider, KYC, AML, reconciliation engine, or tax reporting — all deferred.
- No reuse of the frozen Ride payout implementation.
- No schema change under the recommended annotation approach (P-1 = option a).

## 7. Open owner decisions

- **P-1** — payout-state storage: `metadata` annotation *(recommended for beta)* vs a dedicated `Payout`
  model (schema change).
- **P-2** — closure with a pending payout: pay-before-close vs close-with-retained-obligation.
- **Abandoned-balance / escheatment policy** — retention period and end-state (legal input).
- **Whether any of this is built for the beta**, or the manual process runs on staff records alone until
  the production rail decision, with closure left exactly as-is (and the E2E-11 trap simply avoided
  operationally by not releasing funds a host cannot receive).
