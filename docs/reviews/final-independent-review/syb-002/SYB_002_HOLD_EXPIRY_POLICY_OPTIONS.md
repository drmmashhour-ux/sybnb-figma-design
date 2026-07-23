# SYB-002 — Hold Expiry Policy Options (by payment method)

**Baseline:** commit `32b2152` · **Date:** 2026-07-23 · **Status:** options for owner approval.
**No expiry duration is approved. No automatic expiry is authorized. This document decides nothing.**

> The owner required a *configurable policy matrix keyed on payment method*, not one universal window,
> and asked that every proposed value be returned for approval before any automatic expiry is built.
> Recommended values below are **starting points for discussion**, deliberately conservative on the side
> of not releasing a legitimate in-flight payment.

---

## 1. The fact that shapes everything: method is often unknown

A booking is created directly in `PAYMENT_PENDING` (`bookings.mjs:620`) **with no payment method stored
on it**. The method becomes known only when a `PaymentProof` row exists, via its `provider` string.
Observed providers: `stripe` (card), `syrian_local_wallet` (platform wallet), `wallet_topup_sham_cash`
(wallet top-up). A manual bank-transfer proof would be a further provider.

**In the current dev data, 4 of 6 stuck holds have no proof at all** — so their method is *unknown*. The
matrix must therefore treat **unknown / no-proof** as the default and most common bucket, not an edge
case. Two design responses (see state doc S-2):

- capture the guest's *intended* method into `metadata.hold` at checkout start, so even a no-proof hold
  has a method to key on; or
- apply the **unknown-method** row below to every no-proof hold.

Either way, the unknown row must be safe on its own.

---

## 2. Policy matrix — proposed, for approval

Each column is a value the owner sets or amends. "Window" = time from hold creation (or last extension)
until the hold becomes eligible for automatic release.

### 2.1 Card / immediate online payment (`stripe`)

| Attribute | Proposed value | Note |
|---|---|---|
| Hold window | **30 minutes** | Card capture is synchronous; a genuine attempt completes in minutes |
| Extension eligibility | No | An immediate method that has not completed in 30 min has abandoned |
| Max extension | — | n/a |
| Warning timing | 5 min before expiry | If a guest session is live |
| Expiry outcome | Governed release → `CANCELLED` (`AUTO_EXPIRED_HOLD`) | |
| Inventory release | Immediate on release | |
| Notification | "Your hold expired — dates released. Book again to retry." | Depends on SYB-003 (none exists) |
| Admin override | Yes — release early or extend | |
| Audit | Full release record (state doc §2.4) | |

### 2.2 Platform wallet payment (`syrian_local_wallet`)

| Attribute | Proposed value | Note |
|---|---|---|
| Hold window | **60 minutes** | Wallet debit is near-immediate but may involve a top-up step first |
| Extension eligibility | Once, if a wallet top-up is in progress | |
| Max extension | +60 minutes | |
| Warning timing | 10 min before expiry | |
| Expiry outcome | Governed release → `CANCELLED` | |
| Inventory release | Immediate on release | |
| Notification | As above | |
| Admin override | Yes | |
| Audit | Full | |
| **Guard** | **Never release while a proof is `PENDING_ADMIN_REVIEW`/`APPROVED`** | Dev holds 4 & 5 prove this is essential |

### 2.3 Manual payment proof (proof uploaded, awaiting admin)

| Attribute | Proposed value | Note |
|---|---|---|
| Hold window | **Not time-expired while a proof is under review** | The guest has done their part; the platform owes a review |
| Extension eligibility | n/a — governed by review, not a clock | |
| Max extension | — | |
| Warning timing | Escalate to admin queue at 24 h un-reviewed | Operational SLA, not guest-facing |
| Expiry outcome | **Admin decision (approve/reject), not auto-release** | |
| Inventory release | Only on admin **reject**, via governed release | |
| Notification | "Your payment proof is under review." | |
| Admin override | This *is* the admin path | |
| Audit | Existing proof-review audit + release audit on reject | |

This row is the reason the scheduler's eligibility predicate excludes any hold with an active proof.

### 2.4 Bank transfer / other delayed method

| Attribute | Proposed value | Note |
|---|---|---|
| Hold window | **72 hours** | Cross-border/manual bank settlement is genuinely slow — the owner's stated risk case |
| Extension eligibility | Yes, on evidence of an initiated transfer | |
| Max extension | +72 hours (one extension) | |
| Warning timing | 24 h and 6 h before expiry | |
| Expiry outcome | Governed release → `CANCELLED` | |
| Inventory release | Immediate on release | |
| Notification | Reminder + expiry notice | Depends on SYB-003 |
| Admin override | Yes | |
| Audit | Full | |

**This is the row the owner specifically flagged:** too short a window here would release a legitimate
in-flight bank transfer and cost the guest their dates mid-payment. 72 h is deliberately generous; the
value is the owner's to set.

### 2.5 Unknown / unavailable method (no proof) — the default row

| Attribute | Proposed value | Note |
|---|---|---|
| Hold window | **24 hours** | Balances "don't strand a slow payer" against "don't degrade inventory" |
| Extension eligibility | Auto-reclassify if a proof arrives → adopt that method's row | Method becomes known |
| Max extension | Governed by the adopted method | |
| Warning timing | 2 h before expiry, if a guest session exists | |
| Expiry outcome | Governed release → `CANCELLED` (`AUTO_EXPIRED_HOLD`) | |
| Inventory release | Immediate on release | |
| Past-dated fast-path | If `checkIn` has passed, eligible immediately | Catches dev hold #2 |
| Admin override | Yes | |
| Audit | Full | |

---

## 3. Cross-cutting policy questions for the owner

1. **Clock basis (ties to state doc S-2).** Window measured from `createdAt`, or from an `expiresAt`
   stamped at creation? Recommended: stamped `metadata.hold.expiresAt`, so the guest sees a fixed,
   honest deadline and later policy edits do not retroactively move existing holds.
2. **Method capture at checkout.** Should the intended method be written into `metadata.hold` at booking
   creation, so no-proof holds are not all "unknown"? Recommended: yes — it makes the matrix meaningful
   for the majority case.
3. **Notification coupling.** Every guest-facing warning/expiry notice depends on **SYB-003 (no
   notification mechanism exists)**. Until SYB-003 is resolved, expiry can still *release inventory and
   record state* but cannot *notify the guest*. Decision: proceed with silent-but-visible expiry (guest
   sees status on next visit) or gate automatic expiry on SYB-003? This is the substance of cross-cutting
   **X-1**.
4. **Extension authority.** Who may extend — only the system on evidence, or also an admin manually? The
   matrix assumes admin-always plus system-on-evidence.
5. **Policy versioning.** Each release records `policyVersion`. Confirm the versioning scheme (e.g.
   `hold-policy-v1`) so a later matrix change is auditable against which holds it governed.

## 4. What is explicitly NOT proposed here

- No value in this document is approved or implemented.
- No cron, no scheduler runtime, no schema change.
- No guest self-cancellation authority (separate decision).
- No cleanup of the six existing dev holds (separate authorization —
  `SYB_002_EXISTING_DEV_HOLD_INVENTORY.md`).
- The driver/Québec frozen modules are untouched and out of scope.

> **Return path:** the owner approves, amends, or rejects each row and each cross-cutting question. Only
> after the matrix **and** the state/scheduler design (`SYB_002_STATE_AND_SCHEDULER_DESIGN.md`) are
> approved does implementation of automatic expiry become authorized.
