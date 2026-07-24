# SYBNB — Implementation Traceability Matrix

**Final HEAD:** `9c83344` · **Date:** 2026-07-23 · Chain: **finding → decision → design → implementation
→ tests → commit**. Every closed-beta finding is traced end to end.

---

| Finding | Decision (Session 01) | Design doc | Key implementation files | Test files (count) | Commit |
|---|---|---|---|---|---|
| **SYB-009** SUPPORT sign-in step-up | ACCEPTED, Wave 0 (narrow) | — | `server/routes/auth.mjs` | `test/api/support-staff-otp.test.mjs` (5) | `bc7bfff` |
| **SYB-007** checkout-guest unthrottled | ACCEPTED, Wave 0 (rule only) | — | `server/routes/auth.mjs` | `test/api/checkout-guest-rate-limit.test.mjs` (4) | `64c075b` |
| **SYB-018** production env template | ACCEPTED, Wave 0 | — | `.env.production.example` | `test/unit/env-production-config.test.mjs` (+template guard) | `fb0c135` |
| **SYB-006** fabricated data | ACCEPTED, Wave 0 (sequenced) | fabricated-data inventory | `platformApi.ts`, `SyrianLocalWalletPaymentPage.tsx`, `scripts/seed-demo-accounts.mjs` | `test/unit/fabricated-inventory-removed.test.mjs` (5), `test/api/demo-seed-production-gate.test.mjs` (3) | `9e768f8` |
| **SYB-004** STG-12 forced download | ACCEPTED, Wave 0 | threat model | `server/routes/{me,admin,listings,messages}.mjs`, `private-document-download.mjs` | `test/api/private-document-forced-download.test.mjs` (11) | `b65ab36` |
| **SYB-005** STG-24 staff audit | ACCEPTED, scoped | threat model | `server/routes/{admin,listings,messages}.mjs`, `document-access-audit.mjs` | `test/api/staff-document-access-audit.test.mjs` (13) | `32b2152` |
| **SYB-002** payment-hold release | ACCEPTED, sequenced (S-1 CANCELLED+metadata, S-2 sweep-time) | `syb-002/` (policy, state/scheduler, dev-hold inventory) | `server/lib/booking-hold-policy.mjs`, `booking-lifecycle.mjs`, `server/routes/{host,admin,me}.mjs` | `test/unit/booking-hold-policy.test.mjs` (14), `test/api/payment-hold-release.test.mjs` (14) | `e96eda0` |
| **SYB-001** listing date selection | ACCEPTED (CONFIRMED WITH CLARIFICATION) | `syb-001/` design | `src/modules/listings/ListingDetailPage.tsx`, `src/modules/bookings/BookingReviewPage.tsx` | `test/unit/listing-date-selection.test.mjs` (6) | `faa8fdb` |
| **SYB-008** STR-only isolation | ACCEPTED, 3-layer | division isolation plan | `server/lib/closed-beta-gate.mjs`, `server/index.mjs`, `listings.mjs`, `divisions.ts`, `App.tsx`, `ClosedBetaDivisionNotice.tsx` | `test/unit/closed-beta-gate.test.mjs` (9), `test/api/division-isolation.test.mjs` (6) | `9c52903`, `9c83344` |
| **SYB-011** manual host payouts | ACCEPTED, manual beta | `syb-011/` (registration, closure/payout-state) | `server/lib/host-payout.mjs`, `server/routes/{me,admin}.mjs` | `test/unit/host-payout.test.mjs` (9), `test/api/host-payout.test.mjs` (9) | `c1612c8` |
| **SYB-003** transactional notifications | ACCEPTED, narrow | `syb-003/` design | `server/lib/notifications.mjs`, `mailer.mjs`, `booking-lifecycle.mjs`, `admin.mjs` | `test/unit/notifications.test.mjs` (7), `test/api/transactional-notifications.test.mjs` (3) | `7a5b6e0` |
| **SYB-010** honest guest surface | ACCEPTED, minimal | — | `src/app/App.tsx`, `src/modules/beta/GuestBetaSurface.tsx` | `test/unit/guest-beta-surface.test.mjs` (4) | `823265c` |

## Cross-cutting

| Decision | Outcome | Evidence | Commit / doc |
|---|---|---|---|
| **X-1** managed operational beta | ACCEPT | runbook + participant disclosure | `a4d2d4c` |
| **X-2** strike-through correction standard | RATIFY | applied to SYB-004/005/030 | prior docs commits |
| **X-3** Validation Wave 1 (beta gate) | ACCEPT — PASSED 20/20 | `SYBNB_STORAGE_VALIDATION_WAVE_1_RESULTS.md` | `2b0d3d7` |
| **X-4** frozen storage accepted with gate | ACCEPT | frozen modules untouched throughout | — |

## Invariants held across the whole wave

- **Frozen modules untouched:** `server/routes/driver.mjs`, `server/routes/quebec-driver-onboarding.mjs` — not modified in any commit (SYB-008 gates them at the dispatcher, never internally).
- **No schema migration:** `prisma/schema.prisma` unchanged. SYB-002/011/003 use existing Json columns + `AdminAuditLog`.
- **Test-first:** each finding's failing regression tests were written and confirmed red before the fix.
- **925 automated tests pass** at HEAD `9c83344`; TypeScript clean; production build ✓.
