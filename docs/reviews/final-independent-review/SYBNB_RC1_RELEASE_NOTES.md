# SYBNB — Release Candidate 1 (RC1) Release Notes

**Final HEAD:** `72a54e7` · **Date:** 2026-07-24 · **Mode:** Release Candidate (no new features).
**Scope:** STR (Daily Stays) managed closed beta only.

> RC1 is the closed-beta platform after the full implementation wave plus browser end-to-end execution.
> One real defect was found during browser E2E and fixed; no features were added.

---

## 1. Release candidate scope

- **In scope:** the STR closed-beta platform — guest search → listing → governed date selection →
  booking → manual payment-proof → booking lookup; host reservation + read-only pending-hold + payout
  registration; admin payment review + manual hold release + payout queue; transactional email;
  STR-only division isolation; private-document protection + audit.
- **Not in scope (gated / deferred):** Ride, Québec, Rentals, Buy, Cars, Marketplace, New Construction,
  Sell (all shown "Soon"); a full guest account subsystem; an automated payout rail; a notification
  centre; a scheduler.

## 2. Fixed defects (from browser E2E)

| # | Defect | Fix | Commit | Evidence |
|---|---|---|---|---|
| D1 | **Guest stuck on a stale session token.** A guest whose stored device-session token was rejected (401/403) could never book or submit a payment proof again — `ensurePrototypeGuestSession` reused the dead token with no recovery. | Added `forceNew` + a `withGuestSession` wrapper that clears the stale session and retries once on an auth error, applied to the booking and payment-proof write paths. | `72a54e7` | Browser network trace: `POST /api/bookings` 401 → `checkout-guest` 200 → `POST /api/bookings` 201, then the full journey completes. |

**Not defects (verified as correct behaviour):**
- The blank landing on first load was a **stale Vite dev dep-optimizer cache** (cleared with `--force`);
  the production build and 925 automated tests were always clean.
- Admin approval of a Sham Cash proof returns `409 SHAM_CASH_RECONCILIATION_REQUIRED` — a **fraud-
  prevention control** (staff must reconcile the Sham Cash balance before approving), not a bug.

## 3. Browser E2E — what was executed

**Guest (full journey in a real browser) ✅:** landing → Stays search (8 live DB results) → open listing
→ **governed date selection on the listing page** (SYB-001; price recomputed live to 3,000 USD / 2
nights) → booking review (dates carried through) → confirm booking (**D1 fixed here**) → contact details
→ Sham Cash payment → **real payment proof submitted** (`POST /api/payments/local-wallet-proof` 201) with
the **truthful "Payment proof submitted — under review"** state (SYB-006; no fabricated "Approved") →
booking lookup at `/track` showing "Pending SYBNB review".

**Host ✅ (validated against the real browser-created booking):** the pending hold appears in the host
overview as **read-only** with `isPaymentPendingHold=true` and a computed `holdExpiresAt` (SYB-002); the
host has no release/approve control. The host dashboard's auth gate was confirmed in-browser
("Authentication required" without a staff session).

**Admin ✅ (validated against the real proof/booking):** the payment proof appears in the review queue;
**manual hold release** works (`POST /api/admin/bookings/:id/release-hold` → CANCELLED,
`ADMIN_RELEASED_ABANDONED_HOLD`, audited); the payout queue is reachable; proof approval is correctly
gated by the reconciliation control.

**Method note:** the guest journey ran fully through the browser UI. Host/admin were exercised against
the **real booking created in the browser** using staff tokens (the browser staff-OTP sign-in UI was not
scripted); the underlying host/admin behaviour is additionally covered by the 530 API tests.

## 4. Known limitations

- **Manual operation:** payment review, payouts, and much support are by hand; no guaranteed automation.
- **No full guest account:** guests use `/track` + email + support (SYB-010).
- **STR only:** other divisions are gated (SYB-008).
- **No scheduler:** hold expiry runs opportunistically on traffic, not on a cron (SYB-002).
- **Email best-effort:** notification failure never blocks a workflow; `NO_CHANNEL` for anonymous guests.
- **Frozen Ride/Québec storage** remains on ephemeral disk (accepted while frozen; unfreeze gated).

## 5. Storage caveat (preserved honestly — do not minimize)

Validation Wave 1 passed **20/20** against the **default-jurisdiction** R2 endpoint with **Eastern Europe
(EEUR)** placement (commit `2b0d3d7`): upload/download/durability (cross-instance)/access-control/
isolation/failure/cleanup all passed. A later **EU-endpoint pre-flight failed** because the buckets are
**not EU-jurisdiction** buckets; **no objects were written** during that failed pre-flight. This is an
**owner-authorized temporary beta exception** — it is **not EU-jurisdiction compliant**. Before public
launch: **true EU-jurisdiction validation or a formal ADR-0010 revision is mandatory.**

## 6. Owner checklist (before opening the closed beta)

- [ ] **Rotate the exposed R2 test token** — its secret was pasted into chat during setup. *(Owner
      action in the Cloudflare dashboard; then update `.env.local`. This cannot be done from code.)*
- [ ] Fill the operational placeholders in `SYBNB_CLOSED_BETA_OPERATIONS_RUNBOOK.md` (ops owner, backup,
      support channel/hours, SLA, payout schedule) and send `SYBNB_CLOSED_BETA_PARTICIPANT_DISCLOSURE.md`.
- [ ] Configure the mailer (Resend/SMTP) so transactional emails actually send.
- [ ] Decide the pre-launch storage path (EU-jurisdiction buckets **or** ADR-0010 revision).
- [ ] Optionally clean the synthetic dev bookings created during E2E (unauthorized to modify dev records
      here; they are harmless synthetic data in `sybnb_v6_dev`).
- [ ] Review the RC1 commit range `d463262..72a54e7`; run the gates and, on a stack, the browser E2E.

## 7. Verdict

925 + 3 automated tests pass (tsc clean, build ✓); the full guest journey works in the browser; the one
defect found was fixed and re-verified; host/admin behaviour validated against real data. Subject to the
owner checklist above (notably the storage caveat and token rotation, which are pre-**public**-launch
items, not beta blockers):

# SYBNB RC1 READY FOR OWNER ACCEPTANCE
