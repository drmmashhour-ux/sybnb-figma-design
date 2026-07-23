# SYB-002 — Existing Development Hold Inventory

**Baseline:** commit `32b2152` · **Date:** 2026-07-23 · **Source:** read-only enumeration of the local
development database (`postgresql://127.0.0.1:5432/sybnb_v6_dev`).

> **Read-only.** This inventory was produced by a `SELECT`-only query (`booking.findMany`) run through
> the application's Prisma client. No record was created, updated, or deleted. The query script was
> removed after use and is not committed. **No cleanup has been performed. No cleanup is authorized.**
> This document exists so the owner can authorize a cleanup action per record — a *separate* decision.

---

## 0. Headline — the count is 6, not 4

The E2E runtime register (E2E-02) recorded **"four such bookings are stuck in the dev database."** As of
this enumeration there are **6**, across **5** distinct listings. The register was accurate when written;
the number grew because two more holds were created during the multi-role E2E validation run on
2026-07-23. **This is the finding demonstrating itself** — the stuck population increases monotonically
with use and nothing removes entries. The correction is recorded here rather than by editing the frozen
E2E register.

---

## 1. The six holds

| # | Booking (short) | Listing | Dates | Amount | Age | Payment proof | Class |
|---|---|---|---|---|---|---|---|
| 1 | `9c19c0b5` | Mount Qasioun View Apartment (PAUSED) | 2026-07-23 → 07-26 | 135 USD | 4.9 d | **NONE** | Abandoned |
| 2 | `32f9db00` | Old Damascene Courtyard House (PAUSED) | 2026-07-19 → 07-21 | 10 USD | 4.7 d | **NONE** | Abandoned · **dates past** |
| 3 | `906b2ecc` | Search Verification Apartment (PAUSED) | 2026-07-25 → 07-27 | 90 USD | 4.7 d | **NONE** | Abandoned |
| 4 | `2f358790` | Search Verification Apartment (PAUSED) | 2026-08-01 → 08-03 | 90 USD | 4.6 d | `syrian_local_wallet` : **PENDING_ADMIN_REVIEW** | **Awaiting admin — NOT abandoned** |
| 5 | `3e4bb954` | *(listing title missing)* (APPROVED) | 2026-11-10 → 11-13 | 4 500 USD | 0.5 d | `syrian_local_wallet` : **PENDING_ADMIN_REVIEW** | **Awaiting admin — NOT abandoned** |
| 6 | `9a56a09b` | E2E ADMIN RENTALS listing (APPROVED) | 2026-09-01 → 09-04 | 250 000 SYP | 0.5 d | **NONE** | Abandoned |

Full UUIDs, guest ids and owner ids were captured by the query and are available on request; they are
abbreviated here to keep the document readable and to avoid scattering raw identifiers. Re-running the
read-only query reproduces them exactly.

## 2. The distinction that governs cleanup

**Two of the six are not abandoned holds at all.** Bookings **4** and **5** carry a
`syrian_local_wallet` proof in **`PENDING_ADMIN_REVIEW`** — the guest *did* pay and is waiting for an
administrator to approve the proof. Releasing those as "abandoned" would be **destroying a paid, in-flight
booking**. They belong in the admin payment-review queue, not in an expiry sweep. That the admin review
queue does not surface them is a separate defect (part of E2E-02's "admin review queue never lists it"),
but the correct action for these two is **review the proof**, not **release the hold**.

**Four are genuinely abandoned** (no proof ever submitted): **1, 2, 3, 6**. These are the true SYB-002
population.

**One of the four is already in the past.** Booking **2** (dates 2026-07-19 → 07-21) is for dates that
have elapsed. It occupies a historical range that blocks nothing bookable now, but the row still exists,
still reads `PAYMENT_PENDING`, and — via E2E-11 — still blocks its guest's account closure.

**Five of six sit on PAUSED or approved listings.** Four impacted listings are PAUSED, which *masks* the
degradation (a paused listing is not publicly bookable), but the holds remain and would bite the moment a
listing is unpaused.

## 3. Proposed cleanup action per record — for owner authorization only

**Nothing below is executed.** Each row proposes an action; the owner authorizes or amends per record.

| # | Booking | Proposed action | Rationale |
|---|---|---|---|
| 1 | `9c19c0b5` | Governed release (abandoned) | No proof, 4.9 d old |
| 2 | `32f9db00` | Governed release (abandoned, past-dated) | No proof; dates already elapsed |
| 3 | `906b2ecc` | Governed release (abandoned) | No proof, 4.7 d old |
| 4 | `2f358790` | **Route to admin payment review — do NOT release** | Paid proof `PENDING_ADMIN_REVIEW` |
| 5 | `3e4bb954` | **Route to admin payment review — do NOT release** | Paid proof `PENDING_ADMIN_REVIEW`, 4 500 USD |
| 6 | `9a56a09b` | Governed release (abandoned) | No proof |

**"Governed release"** means the same governed transition the remediation will build (see
`SYB_002_STATE_AND_SCHEDULER_DESIGN.md`) — not a raw `DELETE`, not a direct status write outside the
governed path. If the owner wants these cleared *before* the remediation exists, that is a manual
administrative action requiring its own explicit authorization and should still preserve history.

## 4. What this inventory implies for the design

1. **A no-proof hold has no payment method.** Four of six carry no proof, so the "payment method" the
   expiry policy keys on is **unknown** for them. The policy matrix must therefore treat *unknown /
   no-proof* as a first-class, and probably most common, case — not an edge case.
2. **Proof state is the abandonment signal, not age alone.** A hold with a `PENDING_ADMIN_REVIEW` proof
   must never be swept, regardless of age. The eligibility predicate is *"`PAYMENT_PENDING` **and** no
   proof in an active state"*, not *"`PAYMENT_PENDING` and old."*
3. **Past-dated holds need handling too.** Expiry keyed on hold age would eventually catch booking 2, but
   a check-in-date-passed rule would catch it sooner and is arguably more correct.

## 5. Method note

- Query: `booking.findMany({ where: { status: 'PAYMENT_PENDING' }, include listing + payments })`,
  ordered by `createdAt`. Read-only; no mutation methods called.
- DB confirmed local before connecting: host `127.0.0.1`, db `sybnb_v6_dev` — verified by parsing only
  the URL host, never printing credentials.
- The four abandoned holds correspond to the E2E register's "four"; the two `PENDING_ADMIN_REVIEW` holds
  are the newer arrivals that took the total to six. The register is not edited — this document carries
  the reconciliation.
