# SYB-003 — Transactional Notification Design

**Baseline:** commit `32b2152` · **Date:** 2026-07-23 · **Status:** design for owner approval.
**No code, schema, or UI. Nothing implemented.**

> Authorized under Owner Decision Session 01 (SYB-003 ACCEPTED — Narrow Transactional Notification
> Strategy). Objective: inform users of important **already-completed** state changes. **Not** a
> notification platform. No centre, no feed, no preferences, no push, no multi-channel orchestration.
> Reuse the existing mailer; introduce no new notification infrastructure for the closed beta.

---

## 1. Core principle — notifications are strictly informational

**Every notification represents an authoritative event that has *already completed*.** A notification
must **never** create state, approve or reject an action, change a workflow, modify a booking, release
inventory, or release a payout. It is a read-only echo of committed state, emitted *after* the
authoritative transaction commits.

This principle resolves the interaction with prior decisions:
- **SYB-002** — inventory release is independent of notification delivery; a notification failure must
  never block inventory restoration. Notifications are emitted *after* release, best-effort.
- **SYB-011** — the manual payout process remains authoritative. A "payout completed" email **supports**
  the workflow but is **not** the payout record; the audit/ledger is.

## 2. What already exists (verified at `32b2152`)

| Fact | Location |
|---|---|
| Unified `deliver({ to, subject, text })` over **Resend or SMTP** | `mailer.mjs:142` |
| `isMailerConfigured()` / `requireMailer()` / `sanitizeEmailError()` | `mailer.mjs:24,30,44` |
| Existing transactional-style sender pattern (subject + text, AR/EN) | `sendHostInsightEmail` `mailer.mjs:152` |
| Emails today are **plain text** (subject + text), localized by language | `mailer.mjs:147,153` |
| Only callers today: verification codes, host insights | `email-verification.mjs`, `host-insights.mjs` |

**Design consequence:** transactional email is an **extension of the existing mailer**, not new
infrastructure. Templates follow the existing subject+text, AR/EN pattern.

## 3. The recipient constraint — a guest may have no email

**Verified and important.** Per SYB-010, a guest can be an anonymous device account; `bookings.mjs:403`
notes contact "stays on-platform" and the guest email may not be carried. So:

- **Hosts** are registered accounts with an email → reachable.
- **Guests** may have **no email address** → not reachable by email at all.

The design must **degrade gracefully**: when no email exists, the event is still recorded (delivery
status `NO_CHANNEL`), the authoritative state is unaffected, and the in-app state (e.g. `/track`) remains
the user's source of truth. This is a genuine dependency on **SYB-010** (Critical #12) — how much of the
guest side is reachable depends on whether the guest gets an account surface.

## 4. Event catalogue

Each event fires **after** its authoritative transaction commits. Recipient and reachability noted.

| Event | Authoritative trigger (verified) | Recipient(s) | Reachable? |
|---|---|---|---|
| Booking submitted | `booking.create status:'PAYMENT_PENDING'` (`bookings.mjs:620`) | guest, host | host yes; guest maybe |
| Payment proof received | proof → `PENDING_ADMIN_REVIEW` (`payments.mjs:213/519/622`) | guest | maybe |
| Payment approved | proof → `APPROVED` + booking → `REQUESTED`/`CONFIRMED` (`finance-ledger.mjs:195,214–222`) | guest, host | host yes; guest maybe |
| Payment rejected | proof → `REJECTED` | guest | maybe |
| Booking confirmed | booking → `CONFIRMED` (instant-book or host decision) | guest, host | — |
| Booking cancelled / reservation cancelled | booking → `CANCELLED` (`bookings.mjs:81` guest, `:170` host/admin) | the other party | — |
| Manual payout initiated | SYB-011 payout state `PAYOUT_INITIATED` | host | yes |
| Manual payout completed | SYB-011 payout state `PAYOUT_COMPLETED` | host | yes |
| Important account actions | e.g. account closed, role/step-up changes | account owner | yes |

Scope is **exactly** these transactional events. Anything resembling a feed, digest, or preference
centre is out of scope by owner decision.

## 5. Triggering authoritative workflow

- **Emit after commit, never inside the decision.** The notification call sits *after* the transaction
  that changes state has committed — outside its atomic boundary — so a mail failure cannot roll back or
  block the state change (SYB-002 principle).
- **One event → zero or more emails.** Each recipient is resolved independently; an unreachable recipient
  yields a `NO_CHANNEL` record, not an error that affects others.
- **Idempotency.** Each emit is keyed on `(eventType, entityId, recipientId, stateVersion)` so a retry or
  a re-run does not double-send. The authoritative state already moved; the notification just mirrors it.

## 6. Email templates

- **Format:** reuse the existing subject + plain-text pattern (`deliver`). Optional minimal HTML is a
  later enhancement, not required for the beta.
- **Per event:** a localized subject and body stating *what happened* and *the authoritative next step*
  (e.g. "Your payment was approved. Your booking is confirmed." + confirmation reference / `/track`
  link). Never a call to action that the notification itself performs.
- **No sensitive data:** no ID-document content, no payment credentials, no storage keys — consistent
  with the STG-24 / audit boundaries. A reference number and status only.
- **Truthfulness:** copy must match authoritative state exactly; never "payment received" before it is,
  never a timing the manual process cannot meet (SYB-006 principle, SYB-011 disclosure).

## 7. Delivery status model

A lightweight per-attempt status so "was the user told" is answerable:

| Status | Meaning |
|---|---|
| `QUEUED` | event captured, send pending |
| `SENT` | mailer accepted the message |
| `FAILED` | send attempted and failed (after retries) |
| `NO_CHANNEL` | recipient has no email (anonymous guest) — recorded, not an error |
| `SUPPRESSED` | intentionally not sent (e.g. duplicate/idempotency hit) |

**Storage (options, for approval):** (a) annotate via existing `metadata`/audit — no schema change,
consistent with SYB-002/SYB-011 recommendations; (b) a dedicated `NotificationLog` table — better
querying, but a schema change requiring separate approval. **Recommendation for the beta: (a).**
→ **owner decision N-1.**

## 8. Retry strategy

- **Bounded, best-effort.** A small number of retries with backoff on transient mailer errors, then
  `FAILED`. Retries must never block the request path — emission is out-of-band from the authoritative
  transaction.
- **No infinite queue, no dead-letter subsystem** — that is notification-platform scope, excluded.
- Because notifications are informational and the in-app state is authoritative, a `FAILED` email is a
  logged gap, not a workflow break — support can follow up manually (operational boundary).

## 9. Failure handling

- A mailer failure is caught, sanitized (`sanitizeEmailError`, no provider internals leaked), recorded as
  `FAILED`, and **never propagated** to the authoritative workflow.
- `isMailerConfigured() === false` (e.g. local/test) → events record `QUEUED`/`NO_CHANNEL` and no send is
  attempted; the platform still functions. This is why SYB-002's inventory release and SYB-011's payout
  are explicitly independent of delivery.
- Manual staff communication may supplement automated email (operational boundary) but never replaces the
  authoritative application state.

## 10. Audit strategy

- Each notification emission records an audit-style entry (reusing the `AdminAuditLog`/metadata pattern):
  event type, entity reference, recipient *reference* (not raw email in the log), resulting delivery
  status, timestamp. **Never** the message body's sensitive content, credentials, or storage keys —
  mirroring the STG-24 boundary.
- The audit answers "which events fired and what was their delivery outcome," which is the
  accountability the manual payment/payout model needs.

## 11. Localization

- AR/EN, matching the existing bilingual mailer (`sendHostInsightEmail` switches subject on language).
- Recipient language resolved from the account's language preference where available; sensible default
  otherwise. RTL correctness in body text.

## 12. Accessibility

- Plain-text emails are inherently screen-reader friendly; if minimal HTML is ever added, it must use
  semantic structure, sufficient contrast, and meaningful link text (never "click here").
- Any in-app surfacing of notification state (out of scope for the beta) would follow the app's a11y
  standards — noted only to mark the boundary.

## 13. Source-of-truth boundaries

| Concern | Authority | Notifications may | Notifications must NOT |
|---|---|---|---|
| Booking / payment state | **Server transaction** | mirror it after commit | create, approve, reject, or change it |
| Inventory | **Server (SYB-002)** | announce a release that happened | trigger or block a release |
| Payout | **Manual process + ledger (SYB-011)** | inform of initiated/completed | be the payout record of truth |
| Delivery outcome | **Delivery status model (§7)** | record SENT/FAILED/NO_CHANNEL | imply the user was informed when NO_CHANNEL/FAILED |
| Guest reachability | **Account/email presence (SYB-010)** | email when an address exists | fabricate a channel that isn't there |

## 14. Likely files to change (when implementation is later authorized)

**None edited now.** For visibility:

| File | Anticipated change |
|---|---|
| `server/lib/mailer.mjs` | add transactional send helpers (subject+text, AR/EN) alongside the existing ones |
| a new `server/lib/notifications.mjs` | event→recipient resolution, idempotency, delivery-status recording (no new *infrastructure*, just orchestration over the existing mailer) |
| `server/routes/bookings.mjs`, `finance-ledger.mjs`, `payments.mjs` | post-commit emit calls at the verified trigger points |
| audit/metadata | delivery-status records (N-1 = annotation, no schema change) |
| **`prisma/schema.prisma`** | **no change** under the recommended annotation approach |

## 15. Open owner decisions

- **N-1** — delivery-status storage: `metadata`/audit annotation *(recommended)* vs a `NotificationLog`
  table (schema change).
- **Guest reachability** — depends on **SYB-010**; how much of the guest side is emailable is bounded by
  whether the guest gets an account/email surface.
- **Retry count / backoff** — concrete values.
- **HTML templates** — plain-text only for the beta *(recommended)* vs minimal HTML.
- **Which events are in the first cut** — all of §4, or a minimal subset (e.g. payment approved/rejected,
  booking confirmed/cancelled) first.
