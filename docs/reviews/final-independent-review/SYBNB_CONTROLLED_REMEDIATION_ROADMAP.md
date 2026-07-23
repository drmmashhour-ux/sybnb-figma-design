# SYBNB — Controlled Remediation Roadmap

**Baseline:** `8a4eba7` · **Source:** `SYBNB_CONSOLIDATED_FINAL_REVIEW.md`
**Status:** Proposal. **No remediation implemented.** Nothing here is authorized by this document.

**Governing rules for every wave:** one item at a time · audit → test-first → smallest safe change →
run all gates → stop and report → await approval · **never expand scope** · never mix bounded contexts
(STR · SIR · Ride · Québec · Platform) · never modify a frozen system without an explicit unfreeze.

**Standing gate for every item:** TypeScript → unit → API → security → production build, all green, with
the baseline totals (301 / 462 / 21) as the floor.

---

## Wave 0 — Critical truth and safety blockers

*Rationale: each is small, independent, and closes a hole that is unsafe at any exposure level. Two are
one-line changes. Order within the wave is by risk-per-effort.*

### 0.1 — SYB-009 · SUPPORT staff sign-in step-up
**Scope:** add `SUPPORT` to `STAFF_ROLES_REQUIRING_OTP`. Nothing else.
**Files:** `server/routes/auth.mjs` (one Set literal) · a new or extended auth test.
**Tests:** SUPPORT registration and sign-in require the email code; ADMIN/HOST/DRIVER/SELLER unchanged; GUEST unchanged.
**Dependencies:** none. **Stop:** after gates. **Checkpoint:** yes. **Gate:** closed beta, public production.

### 0.2 — SYB-007 · Rate-limit `/api/auth/checkout-guest`
**Scope:** add one rule to `RATE_LIMIT_RULES`. Do **not** redesign anonymous checkout in this item.
**Files:** `server/index.mjs` · a rate-limit test.
**Tests:** limit enforced; 429 shape correct; window resets; unrelated routes unaffected.
**Dependencies:** none. **Stop:** after gates. **Checkpoint:** yes. **Gate:** closed beta, public production.

### 0.3 — SYB-018 · Production env template
**Scope:** add the 7 `STORAGE_*` and 2 `UPSTASH_*` variable **names** with placeholder values.
**Files:** `.env.production.example` only. **No real values.**
**Tests:** none required; verify by asserting the template covers every key `validateProductionConfig()` requires.
**Dependencies:** none. **Stop:** after verification. **Checkpoint:** with 0.4. **Gate:** internal testing.

### 0.4 — SYB-006 · Remove fabricated data paths
**Scope:** delete `confirmWalletPayment`'s client-side approval, `FALLBACK_APPROVED_LISTINGS` and its
`fetchApprovedListings` fallback, `createLocalFallbackBooking`, `createLocalFallbackPaymentProof`, and
`PROTOTYPE_OWNER`. Gate `seed-demo-accounts.mjs` to refuse under `NODE_ENV=production`.
**Files:** `src/shared/api/platformApi.ts` · `scripts/seed-demo-accounts.mjs` · affected tests.
**Tests:** a failed search yields an honest empty/error state and zero listings; a failed booking surfaces an error and creates nothing; the seed refuses in production; no fabricated identifier survives in `dist/`.
**Dependencies:** confirm `submitPrototypeLocalWalletProof` is wired before deleting the fabricated path — **the real endpoint currently has zero callers**, so removal without wiring would remove wallet payment entirely.
**Stop:** after gates **and** a manual AR/EN check of the wallet payment path. **Checkpoint:** yes. **Gate:** closed beta, public production.

### 0.5 — SYB-004 + SYB-005 · Complete STG-12 and STG-24, correct the record
**Scope:** apply `privateDocumentDownloadHeaders()` to the remaining private-document serve routes and
`recordStaffDocumentAccess()` to the remaining staff read paths. Then correct
`docs/security/STR_STORAGE_THREAT_MODEL.md` and `ADR-0010` — **by appended errata, not silent edit**,
subject to owner decision X-2.
**Files:** `server/routes/listings.mjs`, `messages.mjs`, `driver.mjs`, `quebec-driver-onboarding.mjs`, `admin.mjs` · the two documents.
**Tests:** every private-document route returns `attachment` with a sanitised filename; every staff read emits an audit event; media behaviour unchanged.
**Dependencies:** **touching driver and Québec routes requires an explicit unfreeze** (owner decision). If not granted, scope to the unfrozen routes and record the remainder as still open.
**Stop:** after gates. **Checkpoint:** yes. **Gate:** closed beta, public production.

---

## Wave 1 — Closed-beta blockers

### 1.1 — SYB-021 · Scheduler substrate
**Scope:** introduce a scheduled-execution mechanism. Nothing that consumes it.
**Files:** `vercel.json` (`crons`) · one new handler under `api/`.
**Tests:** handler is idempotent, authorized, and safe to run concurrently.
**Dependencies:** none. **Blocks:** 1.2 and SYB-032. **Checkpoint:** yes. **Gate:** closed beta.

### 1.2 — SYB-002 · `PAYMENT_PENDING` lifecycle
**Scope:** expiry (window per owner decision), guest cancel, host visibility, admin release.
**Files:** `server/lib/booking-lifecycle.mjs` · `server/routes/bookings.mjs`, `host.mjs`, `admin.mjs` · host dashboard.
**Tests:** expired pending booking releases dates; guest can cancel; host sees pending holds; admin can release; a confirmed booking is never released.
**Dependencies:** **1.1 first.** **Owner input:** expiry window. **Checkpoint:** yes. **Gate:** closed beta, public production.

### 1.3 — SYB-001 · Availability-aware date selection
**Scope:** render a date picker on the listing page; enforce `disabledDates` before quote and before continue. **Do not** redesign the booking flow.
**Files:** `src/modules/listings/ListingDetailPage.tsx` · `BookingReviewPage.tsx` · unit tests for the pure date logic.
**Tests:** blocked dates unselectable; quote refuses a blocked range; deep-linked dates validated; AR/EN correct.
**Dependencies:** none. **Checkpoint:** yes. **Gate:** closed beta, public production.

### 1.4 — SYB-008 · Division isolation
**Scope:** execute the approved plan — `status: 'soon'`, route gate, server denial for SR.
**Files:** `src/engines/navigation/divisions.ts` · `src/app/App.tsx` · `server/index.mjs` (SR denial).
**Tests:** hidden divisions unreachable by route; SR API denied pre-auth; STR unaffected; SR's 12 test files still pass with the flag forced on.
**Dependencies:** the approved isolation plan. **Checkpoint:** yes. **Gate:** closed beta.

### 1.5 — Small closed-beta corrections
SYB-024 (wire search retry) · SYB-027 (hide FR) · SYB-028 (pass guest count) · SYB-029 (fix host button targets) · SYB-026 (admin confirmation dialogs) · SYB-016 (reconcile published privacy claims with code) · SYB-017 (suppress demo listing from search).
**Each is an independent item with its own checkpoint.** Group only for planning.
**Gate:** closed beta.

### 1.6 — SYB-014 · Validation Wave 1 execution
**Scope:** execute the approved plan in `STORAGE_VALIDATION_WAVE_1_PLAN.md`.
**Dependencies:** **owner authorization for the first Cloudflare connection** (decision X-3).
**Stop:** after the report. **Gate:** closed beta.

---

## Wave 2 — Operational readiness

- **2.1 SYB-013** — error aggregation and the storage signals (STG-22). *Unblocks meaningful alerting for 2.2.*
- **2.2** — audit-failure and rate-limit-store-failure alert routing. **Depends on 2.1.**
- **2.3 SYB-025** — request-body cap and limits on unrated upload routes.
- **2.4 SYB-011** — payout capture and withdrawal path, or the documented manual process. **Owner input required.**
- **2.5 SYB-003** — minimum transactional notifications. **Owner scope decision required.**
- **2.6 SYB-010** — guest account surface, per the scope the owner selects.
- **2.7** — backup and restore procedure, then **rehearse a restore**.
- **2.8** — exercise credential rotation once.

**Gate:** closed beta (2.3, 2.4, 2.5) · public production (remainder).

---

## Wave 3 — Infrastructure and external verification

- **3.1 SYB-023** — Prisma generate in the Vercel build, `@prisma/client` dependency placement, binary target. **Blocks internal testing.**
- **3.2 D-6** — Neon region. **Irreversible once created — decide before 3.3.**
- **3.3 D-1** — Vercel runtime region. Reversible; follows 3.2.
- **3.4** — provision staging; repeat storage verification there.
- **3.5 EV-01…EV-07** — provider eligibility, sanctions, privacy regime, Canadian obligations, EU-storage obligations, cross-border admin access. **Long external lead time — start in parallel with Wave 0, not after Wave 3.**
- **3.6 B1** — registered legal entity on the legal pages.

**Gate:** public production.

---

## Wave 4 — Production hardening

- **4.1 SYB-020 / D-7** — identity-document holds and retention. **Deletion is irreversible; decide the policy in Wave 1 even if implementation lands here.**
- **4.2 SYB-012** — migrate Ride and Québec document storage. **Requires unfreeze.**
- **4.3 STG-11** — malware scanning / deep parsing decision.
- **4.4 STG-14** — orphan reconciliation, informed by measured orphan rate.
- **4.5 SYB-031** — redact retained audit payloads.
- **4.6 SYB-032** — retention scheduling for the four unpolicied document types.
- **4.7 SYB-015** — storage backfill audit.
- **4.8** — remaining Medium/Low findings from all three agents.
- **4.9 A2-M07** — extend the test architecture to detect client-side fabrication and dead-state defects. *This is the finding that would have caught three of the Criticals; worth doing before the next wave of feature work rather than last.*

**Gate:** public production.

---

## Sequencing notes

**Start now, in parallel with everything:** EV-01…EV-07 (3.5) and the D-6 region decision (3.2). Both
have long external lead times and neither depends on any code change.

**Two irreversible decisions gate later work:** the Neon region (3.2) and identity-document retention
(4.1). Both foreclose options permanently and should be decided earlier than they are implemented.

**One dependency inversion worth respecting:** 2.1 (observability) unblocks 2.2 (alerting), and both
make every other wave's failures visible. Deferring observability makes every subsequent item harder to
verify in production.

**Do not batch Wave 0.** Each item is independently checkpointable, and 0.4 in particular carries a real
regression risk (removing wallet payment entirely if the real endpoint is not wired first).
