# SYB-002 — State Model and Scheduler Design

**Baseline:** commit `32b2152` · **Date:** 2026-07-23 · **Status:** design for owner approval. **No
implementation. No cron. No schema change.**

> This document answers three questions the owner posed: (1) does a governed terminal state already
> exist, or is a state-model change required; (2) how the scheduler must behave; (3) how host, admin and
> guest surfaces change. It proposes; it does not decide.

---

## 1. State governance — the smallest change

### 1.1 The existing state model (verified)

`enum BookingStatus { DRAFT · REQUESTED · PAYMENT_PENDING · CONFIRMED · CANCELLED · COMPLETED · DISPUTED }`
(`prisma/schema.prisma`). Availability is occupied by exactly `['REQUESTED', 'PAYMENT_PENDING',
'CONFIRMED']` (`bookings.mjs:553`). **`CANCELLED` already releases inventory** — it is outside the
occupying set, so a booking moved to `CANCELLED` frees its dates with no availability-code change.

The `Booking` model already has a **`metadata Json @default("{}")`** column. It is currently unused for
booking lifecycle annotation.

### 1.2 The question: is `CANCELLED` an adequate terminal state?

**Yes for inventory; not by itself for governance.** `CANCELLED` frees dates correctly, but it is
overloaded — guest cancellations and refunded cancellations already land there. If an expired hold and a
guest cancellation are indistinguishable, the record cannot answer *why* the dates were released, which
violates the owner's four required distinctions:

> `PAYMENT_PENDING ≠ Payment received` · `Expired hold ≠ Guest misconduct` ·
> `Released inventory ≠ Booking deleted` · `Admin release ≠ Refund`

### 1.3 Recommended approach — reuse `CANCELLED`, discriminate in `metadata` (NO schema change)

Move an abandoned/expired hold to **`CANCELLED`** and record the governance in the existing `metadata`
column:

```jsonc
// booking.metadata after a governed release — illustrative shape, for approval
{
  "release": {
    "kind": "AUTO_EXPIRED_HOLD" | "ADMIN_RELEASED_ABANDONED_HOLD",
    "priorStatus": "PAYMENT_PENDING",
    "reason": "<policy id or admin-entered reason>",
    "policyVersion": "<matrix version, e.g. hold-policy-v1>",
    "releasedAt": "<ISO8601>",
    "releasedBy": "<admin user id | 'scheduler'>"
  }
}
```

**Why this is the smallest change:**
- No new enum value → **no Prisma migration, no `schema.prisma` edit** (both explicitly restricted).
- `CANCELLED` already frees inventory → **no availability-code change**.
- `metadata` already exists → the discriminator, reason, prior state and policy version are all captured
  without structural change.
- Refund logic keys off payment/refund state, not off `CANCELLED` alone, so **admin release stays
  distinct from refund** (no refund is issued on a no-proof hold — there is nothing to refund).

### 1.4 The alternative, and why it is NOT recommended now

Add a dedicated `EXPIRED` value to `BookingStatus`. Cleaner semantically, but it **requires a schema
migration and touches every exhaustive `switch`/status filter in the codebase** (availability, host view,
lifecycle, analytics). That is a larger blast radius, it needs the schema-change approval the owner
withheld, and it can always be done later by promoting the `metadata.release.kind` discriminator into a
first-class state. **Recommendation: ship the metadata approach; revisit `EXPIRED` only if reporting
needs a first-class state.**

> **Owner decision required (S-1):** reuse `CANCELLED` + `metadata` discriminator *(recommended)*, or add
> an `EXPIRED` enum value *(schema change, separate approval)*.

### 1.5 Where the expiry clock lives

There is **no `holdExpiresAt` field** on `Booking`, and the expiry window depends on payment method
(§policy doc), which is not known until a proof exists. Two options:

- **(a) Compute at sweep time.** The scheduler derives `expiresAt = createdAt + window(method)` on each
  run. No stored field. Simplest, but the window for a no-proof hold is always the *unknown-method*
  window, and changing the policy retroactively changes when existing holds expire.
- **(b) Stamp at creation into `metadata`.** Write `metadata.hold.expiresAt` and
  `metadata.hold.policyVersion` when the booking is created (a `metadata` write, no schema change). The
  expiry is then explicit, auditable, guest-visible, and immune to later policy edits.

**Recommendation: (b).** It makes the guest-facing expiry honest and the sweep trivial (`where
metadata.hold.expiresAt < now`). The window is still re-derivable if a proof later declares a method.

> **Owner decision required (S-2):** compute-at-sweep vs stamp-at-creation *(recommended)*.

---

## 2. Scheduler design (SYB-021, pulled forward)

**No cron is created by this document.** `vercel.json` has **0** `crons`; it stays that way until the
policy matrix and this design are approved.

### 2.1 Eligibility predicate — proof-state aware

The sweep selects a hold **only if all hold:**

```
status == 'PAYMENT_PENDING'
AND no PaymentProof for this booking is in an ACTIVE state
    (ACTIVE = PENDING_PROOF | PENDING_ADMIN_REVIEW | APPROVED)
AND metadata.hold.expiresAt < now        // (option b) — or computed window (option a)
AND (optionally) checkIn has passed       // past-dated fast-path, see inventory doc booking #2
```

The **proof-state guard is not optional** — the dev inventory shows two holds with
`PENDING_ADMIN_REVIEW` proofs that must never be swept. This predicate is what separates SYB-002
(abandoned holds) from a paid booking awaiting admin review.

### 2.2 Idempotent, concurrency-safe transition

Reuse the atomic claim pattern already proven in this codebase (`finance-ledger.mjs:220`,
`bookings.mjs:80`): a conditional `updateMany` that matches **zero rows** if anything else moved first.

```js
// illustrative — the claim is the safety mechanism, not the data write
const claim = await tx.booking.updateMany({
  where: { id, status: 'PAYMENT_PENDING' },   // still pending, and only pending
  data: { status: 'CANCELLED', metadata: { ...release annotation... } },
})
if (claim.count !== 1) return { skipped: true }  // someone else won the race — do nothing
```

This makes the release **atomic and idempotent**: a second scheduler run, a retry, or a concurrent
payment-proof approval that fired microseconds earlier all result in `count !== 1`, and the sweep does
nothing rather than double-releasing or clobbering a now-`REQUESTED` booking.

### 2.3 The five states the release must NOT touch (owner requirement)

| Must not release when… | How the guard prevents it |
|---|---|
| payment proof already approved | booking is no longer `PAYMENT_PENDING` → `where` matches 0 rows |
| payment processing reached authoritative success | same — status already advanced |
| another transition completed first | atomic `updateMany` count check |
| hold extended under approved policy | `metadata.hold.expiresAt` was pushed out → not yet eligible |
| booking no longer `PAYMENT_PENDING` | the `where status` clause |

### 2.4 Execution record (auditable)

Each sweep run records, per released hold, an `AdminAuditLog` row using the existing model (no new
table): actor `= 'scheduler'`, action e.g. `BOOKING_HOLD_EXPIRED`, `entityType 'bookings'`, entityId,
`after = { priorStatus, reason, policyVersion, expiresAt }`. Plus a per-run summary
(count scanned / released / skipped) for operability. This mirrors the STG-24 audit boundary just built.

> **Open dependency:** there is no scheduler runtime at all. Whether expiry runs as a Vercel Cron, an
> external trigger, or is folded into request-driven sweeps is part of SYB-021 and is **not approved
> here.** This document designs the *transition*; the *trigger* awaits owner approval alongside the
> policy matrix.

---

## 3. Surface changes (design only)

### 3.1 Host — `host.mjs:100-103` (visibility, read-only)

Today: `status: { not: 'PAYMENT_PENDING' }` **filters holds out entirely**. Change: include
`PAYMENT_PENDING`, labelled as an unpaid/pending hold, showing creation time and (option b) expiry.
**Read-only** — no host approve, no host delete, no host release, unless an existing policy already
grants host cancellation. Never expose payment credentials, proof evidence, or fraud signals.

### 3.2 Admin — new governed release action

An authorized `ADMIN`/`SUPPORT` action that: inspects the hold and safe payment-state; releases an
*eligible* abandoned hold (same atomic guard as §2.2) with a **required governed reason**; and shows
prior release/expiry events. Records actor, role, timestamp, booking reference, prior state, resulting
state, reason, policy version. **Admins must not be able to release the two `PENDING_ADMIN_REVIEW`
holds as abandoned** — the action's eligibility check enforces the proof-state guard, so the UI offers
"review proof," not "release," for those.

### 3.3 Guest — honest status, no misconduct framing

Guest sees: payment-pending status, expiry information, the required next action, and — after expiry —
that the hold expired and a **new booking attempt is required**. Framed as an expired hold, **never** as
payment failure, cancellation, or account penalty. Whether a guest may *voluntarily* release their own
unpaid hold is explicitly **out of scope** and a separate decision — no guest cancellation authority is
added here.

---

## 4. Likely files to change (when implementation is later authorized)

**None are edited now.** Listed so the blast radius is visible up front.

| File | Anticipated change |
|---|---|
| `server/routes/bookings.mjs` | stamp `metadata.hold` at creation (option b); guest-visible hold fields |
| `server/routes/host.mjs` | stop filtering `PAYMENT_PENDING`; expose read-only hold fields |
| `server/routes/admin.mjs` | new governed release action + audit |
| `server/lib/booking-lifecycle.mjs` | expiry sweep function (eligibility + atomic release + audit) |
| `server/lib/document-access-audit.mjs` *(or a sibling)* | reuse audit-write pattern for release events |
| `vercel.json` | **only if** a Vercel Cron trigger is approved — deferred with SYB-021 |
| **`prisma/schema.prisma`** | **no change** under the recommended metadata approach |

## 5. Unresolved owner decisions carried out of this document

- **S-1** — `CANCELLED` + `metadata` *(recommended)* vs new `EXPIRED` state (schema change).
- **S-2** — stamp expiry at creation *(recommended)* vs compute at sweep.
- **SYB-021 trigger** — Vercel Cron vs external vs request-driven; not approved here.
- **Policy matrix** — every window/extension/notification value: see
  `SYB_002_HOLD_EXPIRY_POLICY_OPTIONS.md`; none approved.
- **Past-dated fast-path** — whether check-in-passed is its own eligibility rule (inventory booking #2).
- **Dev-data cleanup** — the six existing holds: separate authorization (inventory doc §3).
