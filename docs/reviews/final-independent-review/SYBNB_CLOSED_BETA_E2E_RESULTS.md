# SYBNB — Closed Beta End-to-End Validation Results

**Final HEAD:** `9c83344` · **Date:** 2026-07-23 · **Config:** STR-only closed beta.

> **Method note (honest scope).** This repository has no jsdom component runner and no running browser/
> deploy in this environment. The end-to-end flows below are validated at the **API/integration and
> unit level** — the 530 API (DB-backed) tests and 374 unit tests exercise the real route handlers, DB,
> and libraries end to end. Client rendering is validated by TypeScript + production build + source-level
> route/render guards. A **browser E2E** (Playwright) additionally requires a running stack; how to run it
> is in §6. Storage uses the **prior Validation Wave 1** result (commit `2b0d3d7`, 20/20) per instruction —
> not re-run.

---

## 1. Gate summary (all green)

| Gate | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ clean |
| Unit tests | ✅ **374** passed (30 files) |
| API / integration tests | ✅ **530** passed (70 files) |
| Security tests | ✅ **21** passed (4 files) |
| Production build | ✅ built |
| Storage (Validation Wave 1) | ✅ 20/20 — commit `2b0d3d7` (default/EEUR endpoint; caveat below) |

**Total automated coverage: 925 passing tests.**

## 2. Guest flow

| Behaviour | Coverage | Status |
|---|---|---|
| Search listings (STAYS) | `listing-*`, `jurisdiction-pricing-compliance` | ✅ |
| Choose / change / clear dates on the listing page | SYB-001 render guard + `DateRangePicker` utils | ✅ (client; browser E2E §6) |
| Blocked dates shown truthfully | availability API + picker `disabledDates` | ✅ |
| Price refresh on date change | server `stayQuote` reacts to `dateRange` | ✅ |
| Booking submission | `booking-*`, `str-checkout-fee-total` | ✅ |
| Payment-proof submission | `payments`, `str-checkout-fee-total` | ✅ |
| Pending-review state (not fabricated confirmation) | SYB-006 wallet path; proof `PENDING_ADMIN_REVIEW` | ✅ |
| Booking lookup (`/track`) | `booking-lookup` | ✅ |
| Payment approval / rejection / cancellation notifications | SYB-003 `transactional-notifications` | ✅ |
| Expired hold releases + notifies | SYB-002 `payment-hold-release` | ✅ |
| `/account` + `/dashboard` no longer mislead | SYB-010 guard | ✅ |

## 3. Host flow

| Behaviour | Coverage | Status |
|---|---|---|
| Listing access / reservation visibility | `host` overview tests | ✅ |
| `PAYMENT_PENDING` visible read-only + expected expiry | SYB-002 `payment-hold-release` (host overview) | ✅ |
| No host release/approve/cancel authority | SYB-002 (no host release route; 403/404) | ✅ |
| Payout destination registration (masked) | SYB-011 `host-payout` | ✅ |
| Payout status / disclosure | SYB-011 + runbook/disclosure docs | ✅ |
| Transactional emails (payout initiated/completed) | SYB-003 | ✅ |

## 4. Admin flow

| Behaviour | Coverage | Status |
|---|---|---|
| Payment-proof review | `review-queue-pagination`, `payments` | ✅ |
| Booking state transitions | `booking-*`, `cancellation-fee` | ✅ |
| Automatic + manual hold release | SYB-002 `payment-hold-release` | ✅ |
| Audit history | SYB-002/005/011 audit assertions | ✅ |
| Payout queue + completion recording | SYB-011 `host-payout` disbursement | ✅ |
| Notification audit | SYB-003 delivery records | ✅ |
| Division-gate behaviour | SYB-008 `division-isolation` | ✅ |
| Private-document access + audit | SYB-004/005 `private-document-*`, `staff-document-access-audit` | ✅ |

## 5. Security & storage

| Behaviour | Coverage | Status |
|---|---|---|
| Support OTP step-up | SYB-009 `support-staff-otp` | ✅ |
| Rate limit (checkout-guest) | SYB-007 `checkout-guest-rate-limit` | ✅ |
| Private-download enforcement | SYB-004 `private-document-forced-download` | ✅ |
| Staff-read audit | SYB-005 `staff-document-access-audit` | ✅ |
| Route + API division gates | SYB-008 `division-isolation` + `closed-beta-gate` | ✅ |
| Role restrictions / no frozen-module bypass | `authorization`, gate at dispatch (frozen internals untouched) | ✅ |
| Storage upload/download/durability/access/isolation/failure/cleanup | Validation Wave 1 `2b0d3d7` (20/20) | ✅ (see caveat) |

## 6. Browser E2E (requires a running stack — not run here)

To run the Playwright browser E2E against a local stack:
1. Start Postgres + set `DATABASE_URL`; `npm run db:test:push` for a clean schema.
2. `STORAGE_DRIVER=local npm run api:dev` (API on :3051) and `npm run dev` (Vite on an allowed origin, e.g. 5180).
3. `npm run test:browser`.
This exercises the SYB-001 date picker, SYB-008 Soon cards, SYB-010 guest surface, and the full booking→
proof→review journey in a real browser. It is the one layer this environment cannot execute.

## 7. Storage caveat (preserved honestly, per owner instruction)

- Validation Wave 1 passed **20/20** against the **default-jurisdiction** R2 endpoint with **Eastern
  Europe (EEUR)** placement — commit `2b0d3d7`. Storage behaviour, cross-instance **durability**, private
  **access control**, bucket **isolation**, failure handling, and **cleanup** all passed.
- A later **EU-endpoint pre-flight failed** because the buckets are not EU-jurisdiction buckets. **No
  objects were written during that failed EU pre-flight.**
- The current default/EEUR setup is an **owner-authorized temporary beta exception**. It is **not** EU-
  jurisdiction compliant. **Before public launch:** true EU-jurisdiction validation **or** a formal
  ADR-0010 revision is mandatory, and the **test token must be rotated**.

## 8. Result

All required automated gates pass (925 tests), covering the guest, host, admin, security, and storage
flows at the API/integration level, with client rendering validated by build + source guards. The one
layer not executed here is the browser E2E (§6), which needs a running stack. No frozen Ride/Québec
internals were modified; no schema migration was required.
