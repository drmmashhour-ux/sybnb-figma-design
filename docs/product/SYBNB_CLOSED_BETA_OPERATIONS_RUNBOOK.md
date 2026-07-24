# SYBNB — Closed Beta Operations Runbook

**Status:** managed closed beta (STR / Daily Stays only) · **Date:** 2026-07-23 · **Baseline:** post-Wave 0
+ design-gated implementation. This runbook governs the human operation of the closed beta. It contains
**no secrets and no private staff data** — fill the `<placeholders>` in a private operational copy.

> The closed beta is deliberately **manually operated** (owner cross-cutting decision X-1). Automation is
> minimal by design; the processes below are what make that safe.

---

## 1. Roles

| Role | Owner | Notes |
|---|---|---|
| **Operations owner** | `<name / handle>` | Accountable for daily operation and escalations. |
| **Backup operator** | `<name / handle>` | Covers when the operations owner is unavailable. |
| **Support channel** | `<published channel — e.g. WhatsApp/email address>` | The single channel disclosed to participants. |
| **Support hours** | `<e.g. Sun–Thu, 09:00–18:00 Damascus time>` | Disclosed to participants; outside these hours responses are best-effort. |
| **Response SLA** | `<e.g. within 1 business day>` | The commitment disclosed to participants. |

## 2. Payment-proof review process (guest → confirmed)

The payment model is manual: a guest submits a proof, staff review it.

1. Guest submits a Sham-Cash / bank proof → booking stays `PAYMENT_PENDING`, a `PaymentProof` is created
   `PENDING_ADMIN_REVIEW`. The guest receives a "payment proof received" email (best-effort).
2. Review the proof in the admin review queue (`/api/admin/review-queue`). Verify the amount matches the
   full booking total and the reference is real.
3. **Approve** → the booking advances to `REQUESTED`/`CONFIRMED`; the guest receives a "payment approved"
   email. **Reject** → record the rejection; the guest receives a "payment not approved" email.
4. **Never** approve a proof whose amount is below the amount due (the server enforces this; do not work
   around it).

## 3. Booking exception process

- **Stuck / disputed booking:** inspect via admin; do not hand-edit the database. Use the governed admin
  actions only.
- **Wrong dates / guest error:** the guest re-books; cancel the erroneous hold via the abandoned-hold
  process if unpaid.
- **A booking a guest cannot see:** direct them to **booking lookup (`/track`)** with their confirmation
  number + phone — the official guest self-service flow.

## 4. Abandoned-hold review process (SYB-002)

- Abandoned `PAYMENT_PENDING` holds (no proof, past their method window) are released to `CANCELLED`
  automatically by the opportunistic sweep on host/admin/guest reads, restoring inventory. The guest
  receives an "unpaid hold expired" email (best-effort).
- **A hold with a proof under review is NEVER auto-released** — review the proof instead.
- **Manual release:** if a hold must be cleared by hand, use `POST /api/admin/bookings/:id/release-hold`
  with a **required reason**. This is audited. Do not release a hold that has a proof under review (the
  system refuses it).
- Expiry windows are configurable per payment method via `HOLD_EXPIRY_<METHOD>_MINUTES`; the defaults are
  card 30m, wallet 60m, bank transfer 72h, unknown 24h.

## 5. Manual payout process (SYB-011) & schedule

1. After a stay completes and the payout hold elapses, an admin **releases** the payout — an internal
   wallet credit (money owed). This is **not** money sent.
2. Read the host's registered payout destination (admin payout reminder). If none, ask the host to
   register one (`/api/me/payout-method`).
3. Send the funds **manually, off-platform** (Sham Cash / bank), per the disclosed schedule.
4. Record each step via `POST /api/admin/payouts/:id/disburse`: `INITIATED` when you start, `COMPLETED`
   with a **payout reference + reconciliation note** when done, `FAILED`/`DISPUTED` as needed. The host
   receives initiated/completed emails (best-effort).
5. **Never mark `COMPLETED` before the funds are actually sent** — the record requires a reference.
- **Payout schedule:** `<e.g. weekly, every Sunday>` — disclosed to hosts.

## 6. Support processes

- **Guest support:** booking questions → verify via `/track`; payment questions → check the proof state;
  escalate financial disputes to the operations owner.
- **Host support:** listing/reservation questions → host overview (pending holds are visible read-only);
  payout questions → the payout process above.

## 7. Incident escalation

1. Operator detects/receives an incident → assess severity.
2. Financial, data-exposure, or security incidents → **escalate to the operations owner immediately**.
3. Record the incident, actions, and outcome. Do not take destructive database actions without owner
   sign-off.

## 8. Storage incident process

- Storage is Cloudflare R2 (validated — see the storage caveat below). If uploads fail, the app returns a
  truthful `STORAGE_UNAVAILABLE` (no fabricated success) — inform the affected user and retry later.
- **Never** point the app at a production bucket during the beta, and **never** put production/customer
  data in the test buckets.
- **Storage jurisdiction caveat (must be preserved honestly):** Validation Wave 1 passed 20/20 against
  the **default-jurisdiction** R2 endpoint with an **Eastern Europe (EEUR)** placement — **not** the
  formal EU jurisdiction. This is an owner-authorized temporary beta exception. **Before public launch:**
  create true EU-jurisdiction buckets and re-validate, **or** formally revise ADR-0010 through governance.
  **The test token must be rotated before any production use.**

## 9. Notification failure process

- Transactional emails are **best-effort** and never block a workflow. A failure is recorded with a
  delivery status (`SENT`/`FAILED`/`NO_CHANNEL`/`SUPPRESSED`).
- `NO_CHANNEL` = the guest has no email (anonymous device account) — expected; follow up via `/track` or
  the support channel.
- If many `FAILED` deliveries appear, check the mailer configuration; meanwhile support the affected
  users manually. Inventory release, payment state, and payouts are unaffected by email failure.

## 10. Known limitations (operate around these)

- **Manual everything:** payment review, payouts, and much support are by hand. There is **no guaranteed
  automation**.
- **No full guest account:** guests use `/track` + email + support, not a dashboard.
- **STR only:** all other divisions are gated (Soon).
- **Storage jurisdiction:** default/EEUR, not formal EU (see §8).
- **No scheduler:** time-driven actions (hold expiry) run opportunistically on traffic, not on a cron.

## 11. Daily checklist

- [ ] Review the payment-proof queue; approve/reject with care.
- [ ] Check for stuck `PAYMENT_PENDING` holds; confirm the sweep is releasing abandoned ones.
- [ ] Process due payouts; record disbursements with references.
- [ ] Scan the support channel; meet the response SLA.
- [ ] Skim notification-delivery failures; follow up any `FAILED` manually.
- [ ] Note any incident and its resolution.

## 12. Launch-day checklist

- [ ] Operations owner + backup operator named and available.
- [ ] Support channel published; hours + SLA disclosed to participants.
- [ ] Participant disclosure (`SYBNB_CLOSED_BETA_PARTICIPANT_DISCLOSURE.md`) sent and acknowledged.
- [ ] STR-only isolation verified (gated divisions show Soon; gated APIs refuse).
- [ ] Payment-proof review path exercised end to end with a test booking.
- [ ] Abandoned-hold release verified on a test hold.
- [ ] A test manual payout recorded end to end (INITIATED → COMPLETED with reference).
- [ ] Transactional email verified deliverable (or the manual-follow-up fallback confirmed if not).
- [ ] Storage caveat acknowledged internally; test token rotation scheduled before any production use.
