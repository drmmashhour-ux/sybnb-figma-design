# SYBNB — Full Platform Isolation and Real Launch Readiness Review

**Date:** 2026-07-22
**Scope:** Entire SYBNB platform (not STR-only)
**Branch reviewed:** `claude/intelligent-kilby-5ff258` (from `security/sybnb-v6-predeployment`)
**Mode:** Read-only review. No code changed, no navigation modified, no feature flags changed, nothing committed.

### Verification status of this document

Every claim below is traceable to a file and line, a command run against the local stack, or a browser
observation made during this review. Where something was **not** verified, it is labelled
**NOT VERIFIED** rather than assumed. This matters because the single largest finding in this report
(§16.1) is invisible to every test the project currently runs.

**What was actually exercised:** the local API (`server/index.mjs` on :3051) and Vite dev server against
the local development Postgres; the full automated suite (246 unit + 428 API + 21 security, all passing);
a real HOST account driven through the real partner sign-in gate, the real ID-document upload, and a
real ADMIN approval, observed in both AR and EN in Chrome.

**What was not exercised:** any deployed environment. There is no production or staging deployment
reachable from this session, so §9 (mobile), most of §8 (production conditions), payment capture against
live Stripe, real email delivery, and backup/restore are assessed from configuration and code, not from
observed production behaviour. **No statement in this report should be read as production verification.**

---

## 1. Executive summary

SYBNB is a substantially engineered platform with a genuinely strong server-side security posture, a
real and well-tested identity-verification pipeline, an honest payment-review model, and 695 passing
automated tests. It is much further along than a prototype.

It is also **not launchable today — in any configuration, including STR-only.**

The decisive finding is architectural, not cosmetic: **every uploaded file in the platform is written to
the local filesystem, while the deployment target is Vercel serverless.** Property photos, host ID
documents, and listing documents all go to `server/uploads/*` (`server/lib/listing-media-storage.mjs:7`,
`id-document-storage.mjs:7`, `listing-document-storage.mjs:7`), and `vercel.json` routes every `/api/*`
request into a serverless function (`api/index.mjs`) whose filesystem is ephemeral and per-instance. In
production, uploaded photos and ID documents will disappear on cold start and be invisible to any other
instance. This silently voids the two things the launch depends on most: **C2 (real property photos —
currently marked COMPLETE) and the entire identity-verification chain.** The production config validator
(`server/lib/env.mjs`) is rigorous about secrets, database, CORS, Redis, and mail — but has no concept of
object storage, so production will **boot successfully and then lose data**. No existing test can catch
this, because the whole suite runs on a real local disk.

Beyond that, the roadmap's own P0 set is largely open. Of 8 P0 items, only **C2** is recorded complete;
**C3** was implemented (commit `0681127`) but never recorded; **C5** was implemented in this working tree
and is **uncommitted**; and **H10, S2a, S4, S5, S1 remain open**. The entire P1 set — which contains
booking correctness (C4), the booking-first checkout (C1), admin confirmation on irreversible money
actions (C7), and host payout configuration (H3) — is open.

Separately, the platform currently **presents all 8 divisions to the public as active**, including SYBNB
Ride. `src/engines/navigation/divisions.ts` marks every division `status: 'active'`, and
`LandingPage.tsx:206-230` renders all of them as clickable "Open" cards. SR is not isolated in any
meaningful sense: `/ride` is a plain public route (`App.tsx:165`), backed by 15+ live endpoints. SR is
also the *best-tested* subsystem in the repository (12 API test files vs STR's 10) — it should be
isolated and preserved, never deleted.

**Recommendation: D — Closed Beta Only, STR division only**, and only after the storage blocker is fixed.
A public STR launch (option B) is a realistic near-term target, but not until §16 is cleared.

---

## 2. Complete SYBNB division inventory

Route surface derived from `src/app/App.tsx` (the complete router) and `src/engines/navigation/divisions.ts`.

| # | Division / subsystem | Public route | Nav exposure | Backend | Data readiness | Tests | Classification |
|---|---|---|---|---|---|---|---|
| 1 | **STR / Stays** | `/stays`, `/search-preview`, `/listing/:id` | Top nav + landing card + primary CTA | Real (`listings.mjs`, `bookings.mjs`) | Real DB; sample data filtered out on stays entry | 10 API files | **Closed Beta Only** |
| 2 | **Real Estate Sales (Buy)** | `/buy` | Landing card, "Open" | Real (`division=BUY`) | No verified inventory | Shared only | **Must Be Removed from Public Navigation** |
| 3 | **Long-Term Rentals** | `/rentals` | Landing card, "Open" | Real (`division=RENTALS`) | No verified inventory | Shared only | **Must Be Removed from Public Navigation** |
| 4 | **New Construction** | `/new-construction` | Landing card, "Open" | Real (`division=NEW_CONSTRUCTION`) | Serves fabricated fallback (§11.1) | Shared only | **Must Be Removed from Public Navigation** |
| 5 | **Marketplace** | `/marketplace`, `/marketplace/sell` | Landing card, "Open" | Real (`division=MARKETPLACE`) | Free-listing path tested | 1 API file | **Must Be Removed from Public Navigation** |
| 6 | **Cars** | `/cars` | Landing card, "Open" | Real (`division=CARS`) | Serves fabricated fallback (§11.1) | Shared only | **Must Be Removed from Public Navigation** |
| 7 | **Host / Seller tools** | `/host*`, `/sell*`, `/advertising/*` | "Become a host" in top nav | Real (`host.mjs`, `sellers.mjs`) | Real | Multiple | **Closed Beta Only** (stays focus) |
| 8 | **Buyer tools** | via `/buy` inquiry flow | Landing card | Real (inquiry + docs) | Unverified | Minimal | **Internal Prototype** |
| 9 | **Renter tools** | via `/rentals` inquiry flow | Landing card | Real (inquiry + docs) | Unverified | Minimal | **Internal Prototype** |
| 10 | **Admin** | `/admin/review`, `/admin/disputes`, `/admin/reports`, `/finance`, `/operations` | Not in public nav | Real (`admin.mjs`, 75 KB) | Real + audit log | Several | **Launch Candidate** (internal) |
| 11 | **Messaging** | in booking/listing context | Contextual | Real (`messages.mjs`) | Gated to CONFIRMED/COMPLETED/DISPUTED | 1 API file | **Closed Beta Only** |
| 12 | **Payments & finance** | `/payment/*`, `/wallet`, `/finance` | Wallet in top nav | Real (`payments.mjs`, `wallet.mjs`, Stripe) | Manual proof review | 6+ API files | **Closed Beta Only** |
| 13 | **Auth & verification** | `/account/open`, staff gate, `/trust/*` | Contextual | Real (`auth.mjs`, `me.mjs`) | Real OTP + ID review | 8+ API files | **Launch Candidate** |
| 14 | **SYBNB Ride / SR** | `/ride`, `/ride-preview`, `/driver*` | **Landing card, "Open"** | Real (`sr-rides.mjs`, 32 KB, 15+ endpoints) | Real | **12 API files** | **Must Be Isolated** |
| 15 | **Shared platform services** | n/a | n/a | `server/lib/*` (57 modules) | Real | Broad | **Launch Candidate** |
| 16 | **Quebec / CITQ / CTQ** | embedded in shared UI | Leaks into shared components | Real (`quebec-*.mjs`, 4 Prisma models) | Frozen per owner directive | 3 API files | **Must Be Isolated** |
| 17 | **Intercity transport** | *none* | None | Admin-only | DB models only (`Garage`, `Route`, `Operator`, `ServiceTrip`, `SeatBooking`) | 1 schema test | **Hidden / Disabled** (already) |
| 18 | **Prototype / demo routes** | `/capsule-preview`, `/ai-brain`, `/competitors`, `/immocontact` | Not in nav; `/capsule-preview` + `/immocontact` ungated | Mixed | Prototype | None | **Must Be Removed from Public Navigation** |

**Navigation reality check.** The top navigation (`AppShell.tsx:67-88`) is already correctly STR-focused —
Stays, Become a host, Wallet, Settings, Book now. The exposure problem is entirely on the **landing page**,
which renders every division from `DIVISIONS` as an open card.

---

## 3. Recommended launch boundary

**Decision: D — Closed Beta Only (STR / Stays division only).**

Not option B (public STR-only) — yet. B is the right *next* target, but three things block it today:
uploaded photos and ID documents do not survive production (§16.1); the booking journey cannot enforce
availability (C4) and has no booking-first checkout (C1); and hosts cannot configure how they get paid (H3).
Launching publicly without those means taking real money for stays whose dates were never checked, from
guests whose hosts cannot be paid, with photos that vanish.

Not option A or C. No non-STR division has a demonstrated complete real-user journey, and several serve
fabricated inventory on API failure (§11.1).

Not option E. The platform is too mature for "no launch" to be the honest answer — a controlled closed
beta with invited hosts and guests is achievable once §16.1 is fixed, and is the fastest safe route to
real learning.

### Exclusions and their handling

| Excluded | Why | Hide / Disable / Isolate | Route still reachable? | Shared-system impact |
|---|---|---|---|---|
| Buy, Rentals, New Construction, Cars, Marketplace | No verified inventory; no demonstrated end-to-end journey; some serve fabricated fallback data | **Hide** from landing (`status: 'soon'`), keep API | Yes — direct hash URL still renders | Shares `listings.mjs`, division enum, search UI. Low risk if nav-hidden. |
| SYBNB Ride / SR | Complete separate business (drivers, dispatch, SOS, live location, tips, PIN). Launching it alongside STR doubles operational and legal surface | **Isolate** (see §5) | Yes — `/ride` is public today | Shares auth, wallet, ratings, disputes, rate limits |
| Quebec / CITQ / CTQ | Frozen by owner directive; wrong jurisdiction for a Syria-first launch | **Isolate** behind jurisdiction gating | Partially — leaks into shared UI components | Leaks into `SearchPreviewPage`, `UnifiedSearchBar`, `LocationCascade`, `ListingDetailPage` |
| `/capsule-preview`, `/ai-brain`, `/competitors`, `/immocontact` | Prototype/internal surfaces | **Disable** in production build | `/capsule-preview` and `/immocontact` are ungated | Minimal |
| Intercity transport | DB + admin only, never exposed | Already effectively hidden — **no action** | No | None |

---

## 4. Divisions approved for launch

**For the closed beta: STR / Stays only**, plus the shared services it requires — Auth & verification,
Admin, Messaging, Payments (manual-review mode), and Host tools scoped to `focus="stays"`.

Approved on the evidence that: the STAYS search path deliberately filters fabricated sample listings
(`SearchPreviewPage.tsx:198`); the identity-verification state machine is real and admin-gated
(verified live, §7); payment proofs always land in `PENDING_ADMIN_REVIEW` server-side with no
auto-approval path (`payments.mjs:213,519,622`); and the admin review queue with audit logging is real.

**Conditional on §16 being cleared first.** Nothing in §4 is approved while §16.1 stands.

## 5. Divisions approved only for closed beta

STR / Stays, Host tools (stays), Messaging, Payments, Wallet — all under invited-participant conditions
with explicitly communicated limitations, real support contact, and manual operator oversight of every
money movement.

## 6. Divisions that must be hidden or isolated

1. **SYBNB Ride / SR — must be isolated, never deleted.**
2. **Buy / Rentals / New Construction / Cars / Marketplace — hidden from public navigation.**
3. **Quebec / CITQ — isolated behind jurisdiction gating.**
4. **Prototype routes — disabled in production builds.**

---

## 7. Real user journey results

Personas exercised were limited to those relevant to the recommended boundary. **Guest, buyer, renter,
support-agent and investor journeys were NOT executed** in this review — recording that honestly rather
than inferring outcomes.

### Host journey — partially verified (live, AR + EN)

Executed against the real local stack with a real HOST account created through the actual
`/api/auth/register` + email-OTP flow:

| Step | Result |
|---|---|
| Partner sign-in gate (email → OTP → password) | **Works.** Real server-issued OTP; gate is genuine. |
| Host dashboard loads real overview | **Works.** |
| Identity verification — upload ID | **Works.** Real bytes stored (`idDocumentRef=4d0ea46c-….png`); status → `PENDING_REVIEW`. |
| Trust score does not move on submission | **Correct.** Held at 35%. |
| Admin approval → badge + score | **Works.** "Verified host", 35% → 55%. |
| AR RTL / EN LTR rendering of that panel | **Both correct.** No console errors. |

**Not executed:** host onboarding from zero, create accommodation, add room type, add real photos, add
amenities, submit → admin review → publish, reservation management. These are the steps most affected by
§16.1 and remain **NOT VERIFIED**.

### Admin journey — partially verified

Sign-in and the ID-document approve/reject decision path were exercised live and behaved correctly, with
the decision recorded in `admin_audit_logs`. Review of users, listings, media viewing, report handling and
booking/payment issue handling were **NOT executed**.

Known open gaps from the roadmap, confirmed present in code: **C7** — approve/reject, payout release/hold
and refund are still single-click with no confirmation dialog; **H8** — no decision context on
reports/disputes; **H9** — no user management directory.

### Guest / STR journey — NOT EXECUTED

The full landing → search → detail → dates → verification → booking → payment → confirmation → trips
journey was not run. Two roadmap blockers are confirmed present in code and would break it regardless:
**C4** (availability fetched but never rendered or enforced) and **C1** (no booking-first checkout with
in-checkout email verification).

---

## 8. Technical readiness

**Strengths (verified):**
- Production configuration validation fails closed on missing `AUTH_SECRET`, `PHONE_HASH_SECRET`,
  `DATABASE_URL`, `CORS_ORIGIN`, Upstash Redis credentials, and a configured mailer (`server/lib/env.mjs:29-84`).
- Rate limiting is distributed (Upstash Redis) in production with a documented in-memory dev fallback, and
  production refuses to boot on the fallback (`rate-limit-store.mjs`, `env.mjs:50-58`).
- One request-handling code path shared between local dev and Vercel (`api/index.mjs`), avoiding drift.
- Isolated test database with an enforcing guard (`server/lib/test-db-guard.mjs`).
- 695 automated tests passing: 246 unit / 428 API / 21 security.

**Gaps:**
- **File storage is local-disk on an ephemeral serverless target (§16.1).**
- **No observability.** No Sentry, no structured logging, no error aggregation. Only ad-hoc `console.error`.
- **No documented backup or restore procedure.** `docs/release/` contains change notes only.
- **No staging environment** was identified.
- Route gating in `App.tsx:228-243` is client-side only (reads `localStorage`). Server-side enforcement is
  real and per-endpoint, so this is a UX gate rather than a security boundary — acceptable, but it means
  every "hidden" route is still reachable and renders its shell.

## 9. Mobile readiness — NOT VERIFIED

Capacitor iOS and Android projects exist with a dedicated build (`vite.capacitor.config.ts`,
`npm run build:mobile`), and CSS uses responsive containers. **No phone, tablet, or emulator testing was
performed in this review.** Desktop Chrome at 948×1288 rendered correctly. Mobile readiness is unassessed.

## 10. Language readiness

- **Arabic RTL — verified.** Correct `dir="rtl"`, correct mirroring on the surfaces observed.
- **English LTR — verified** on the surfaces observed. (Note: `TEST-001` records that EN was never
  manually verified for the C2 photo uploader; that remains true.)
- **French — live and must be hidden.** The AR / EN / **FR** toggle was directly observed in the browser.
  Roadmap **S4** documents ~45 screens silently rendering English under FR. Confirmed open. A user can
  select a language that largely does not exist.

## 11. Trust and verification findings

### 11.1 Fabricated fallback inventory — critical

`src/shared/api/platformApi.ts:152-363` defines **14 hardcoded listings** owned by a fabricated user
literally named **"SYBNB Verified Provider"** (`PROTOTYPE_OWNER`, line 144-147), each carrying an invented
`trustScore` between 90 and 98, priced in USD, illustrated with division stock art presented as property
photography.

`fetchApprovedListings` returns these on **any** search failure (line 1185-1187, bare `catch`).

Mitigations that exist:
- Records are tagged `sybnbDataMode: 'sample'` and the UI shows "Sample data - database unavailable" /
  "بيانات تجريبية - قاعدة البيانات غير متصلة" (`SearchPreviewPage.tsx:27-28, 89-90, 238`).
- **The stays entry filters them out entirely** (`SearchPreviewPage.tsx:198`) — STR shows an honest empty
  state instead of fake inventory. This is a deliberate and correct prior fix.

Mitigations that do **not** exist:
- `/cars`, `/new-construction`, and `DivisionLivePage` **do display them**.
- They are clickable into a full detail page.
- They are **bookable**: `createPrototypeBooking` falls back to `createLocalFallbackBooking` for any
  `fallback-` listing id (line 2505-2507), producing a browser-only booking attributed to a
  **"SYBNB Demo Guest"** (line 2593).
- That booking can then receive a **client-side auto-APPROVED payment** —
  `createLocalFallbackPaymentProof` marks `stripe_test` and `syrian_local_wallet` as `APPROVED`
  immediately (line 1592-1598).

**Net effect:** with the database unavailable, a real visitor on a non-STR division can complete a
fabricated end-to-end booking and see an "approved" payment that never existed. The small "sample data"
label does not carry that weight.

### 11.2 "Verified host" — resolved this session, uncommitted

C5 was implemented in this working tree: the client-side `hostDocumentsSent` flag that added +20 to the
displayed trust score with nothing uploaded is gone; the panel performs a real upload; the badge and score
derive only from a server-confirmed `idDocumentStatus === 'APPROVED'`. Verified live end-to-end (§7).
**This work is uncommitted** and will be lost if the worktree is discarded.

Public badges on the listing detail (`ListingDetailPage.tsx:491,664`) and search cards
(`SearchPreviewPage.tsx:300`) were already correctly gated on the server value.

### 11.3 Fabricated admin figures — dead code, better than recorded

Roadmap **H10** lists `recentAdminUsers`, `todayStatBars`, and `activityItems` as live fake data. In fact
all three are **defined but never rendered** (`AdminReviewPage.tsx:113,115,178` — no other references).
The fabricated fallback inside `activityItems` includes an invented financial figure
("Payment received: 150,000 SYP"), but it is currently unreachable. H10 is therefore **dead-code cleanup,
not a live trust violation** — a smaller problem than the roadmap assumes, and it should still be deleted
with a reintroduction guard.

### 11.4 Other unsupported claims

| Claim | Status |
|---|---|
| "view cached results" in the search error state | **Unsupported** — no cache exists. Roadmap S2a, open. `SearchStates.tsx:28`. |
| Hardcoded FX rate | `SYP_PER_USD = 15000` (`src/shared/currency.ts:4`) — a stale constant presented as a real rate. Roadmap S1, open. |
| Stock art as property images | Present in the fallback listings (§11.1) and across non-STR divisions. Roadmap S3, open. |
| Fake reviews / testimonials / hosts / availability | **None found.** Reviews, bookings and availability are database-backed. |

## 12. Security readiness

Genuinely the strongest area of the platform.

**Verified working:** CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, and
`Permissions-Policy` set at both the app and Vercel edge; CORS correctly omits
`access-control-allow-origin` for disallowed origins rather than echoing a misleading value
(`server/index.mjs:191-204` — observed directly: a request from an unlisted origin received no grant
header); granular per-endpoint rate limits with explicit fail-open/fail-closed choices; passwords hashed;
ID documents stored under opaque keys outside the web root with owner/staff-only access, and cross-account
access returns 403/404 (tested); admin decisions recorded in an append-only audit log; dev OTP codes
production-gated.

**Gaps:** no monitoring or alerting; SR's 15+ endpoints are publicly reachable and expand the attack
surface for a launch that does not include SR; client-side-only route gating (see §8); no evidence of an
external penetration test.

## 13. Payment and finance readiness

**Sound:** every payment proof enters `PENDING_ADMIN_REVIEW` server-side — there is no server-side
auto-approval path. Stripe is real and correctly disabled when `STRIPE_SECRET_KEY` is absent
(`payments.mjs:38`). Wallet idempotency, gift integrity, card top-up fees and commission-hiding are all
covered by dedicated passing tests. The 13% commission and cancellation-fee logic are implemented and
described accurately in the legal pages.

**Blocking gaps:** hosts can see money owed but **cannot configure a payout method** (H3, open) — the
platform can take money it cannot pay out. Sham Cash reconciliation is **admin-typed into `localStorage`**
(C8, open) — device-local, no cross-device sync, unusable with more than one operator. Refunds credit the
SYBNB wallet rather than the original method and this is **not disclosed** (M6, open). Irreversible money
actions have **no confirmation step** (C7, open).

## 14. Admin and support readiness

Real and functional: review queue with pagination and division filters, ID-document review with file
viewing, payout hold/release, dispute and report handling, audit logging, role separation (SUPPORT can
view but not decide — tested).

Not ready: no user directory or suspend/ban (H9); no decision context on reports and disputes (H8); no
confirmation on destructive actions (C7); no documented support staffing, hours, or escalation path. The
support channels in the footer are a `mailto:` and a WhatsApp link — real, but not an operational support
function.

## 15. Legal and operational readiness

The Terms and Privacy pages are **substantive and unusually honest** — despite the component name
`LegalPlaceholderPage`, they are 269 lines describing the platform's *actual* behaviour (13% commission,
3-day free-cancellation window, $10 late-cancellation fee, 3% protection premium, manual payment review,
wallet-only refunds), with a header comment stating plainly that they mirror the real implementation and
are not a substitute for licensed legal review.

**Gaps:** no registered company legal name or address anywhere (B1, open) — a money-handling platform with
no verifiable legal identity. The terms explicitly cover **SYBNB Ride and the Marketplace**, divisions this
review recommends excluding, so they will misdescribe the launched product. Tax and invoice readiness for
Syria is **NOT VERIFIED** (the implemented tax machinery is Quebec/Canada-oriented). No operational
staffing, capacity, or incident-response plan was found.

---

## 16. Critical blockers

**16.1 — Ephemeral file storage on a serverless deployment target.**
~~All uploads write to local disk (`listing-media-storage.mjs:7`, `id-document-storage.mjs:7`,
`listing-document-storage.mjs:7`) while `vercel.json` routes `/api/*` to a serverless function. Photos and
ID documents will be lost. Voids C2 and the entire verification chain in production. No test detects it;
`env.mjs` does not check for object storage. **Fix before anything else.** (Vercel Blob is the native fit.)~~

> **CORRECTION — 2026-07-23 (registered as SYB-030; corrected under cross-cutting decision X-2, ratified
> strike-through-plus-dated-note standard).** The struck-through claim above is **stale as written** and
> is retained rather than deleted so the record shows what was believed and when. Since it was written,
> the **STR storage modules were migrated to governed object storage** (Cloudflare R2, EU jurisdiction)
> across Phases 1–3 under **ADR-0010**: `id-document-storage.mjs`, `listing-document-storage.mjs`,
> `listing-media-storage.mjs`/media, and `thread-document-storage.mjs` now use `putObject`, with
> fail-closed production validation added to `env.mjs`. The blanket "all uploads write to local disk" and
> the three specific `:7` line references are therefore no longer accurate for the STR paths.
>
> **The defect is not fully closed.** Two modules — `driver-document-storage.mjs` (Ride) and
> `quebec-document-storage.mjs` (Québec) — **still write to ephemeral local disk** (`server/uploads/*`,
> `writeFile`) because they sit behind the Ride restriction and the Québec freeze. This residual is
> registered as **SYB-012** and formally accepted under cross-cutting decision **X-4**, with an enforced
> gate: **no unfreeze of Ride or Québec until its document storage is migrated to governed object storage
> and owner approval is granted.**
>
> **Verification status.** The migrated STR path's central claim — that uploads survive instance
> replacement — remains **unproven against the real backend** (the S3 driver has never executed against
> R2; the test suite pins the local driver). Registered as **SYB-014**; its proof is authorized under
> cross-cutting decision **X-3** (Validation Wave 1) as a **beta gate**.
>
> This correction supersedes the stale §16.1 wherever it is referenced elsewhere in this document
> (executive summary, §4, §5, §8). Those in-body references are not individually struck through; this
> note is the authoritative correction for all of them.

**16.2 — Full platform exposed as active.** All 8 divisions render as open cards on the landing page,
including SR. `divisions.ts` (all `status: 'active'`), `LandingPage.tsx:206-230`.

**16.3 — Fabricated inventory bookable with auto-approved payment** on non-STR divisions when the DB is
unavailable (§11.1).

**16.4 — Booking correctness.** Availability is fetched but never rendered or enforced (C4); no
booking-first checkout with in-checkout email verification (C1).

**16.5 — Hosts cannot be paid.** No payout-method configuration (H3).

**16.6 — No observability and no backup/restore.** A money-handling platform cannot operate blind.

**16.7 — No legal entity** on the legal pages (B1); terms describe divisions that will not launch.

## 17. High-priority issues

- **C7** — no confirmation on approve/reject, payout release/hold, refund.
- **C8** — Sham Cash reconciliation in `localStorage`.
- **S4** — French toggle live across ~45 unimplemented screens (observed).
- **S5** — Quebec/CITQ artifacts leak into shared UI (14+ frontend files).
- **S1** — hardcoded `SYP_PER_USD = 15000`; USD-only browsing in a SYP market.
- **H8 / H9** — admins decide blind; no user management.
- **C5 uncommitted** — real work at risk of loss.
- **C3 unrecorded** — implemented in `0681127` but roadmap still lists it open; the roadmap is drifting
  from reality, which undermines its role as source of truth.

## 18. Medium-priority issues

- **S2a** — dishonest "view cached results" copy.
- **H10** — dead fabricated admin constants; delete with a guard (§11.3).
- **H5** — no pre-booking guest↔host messaging (`messages.mjs:13,37`).
- **H6** — search empty/error actions are interchangeable; guest count ignored.
- **M1** — booking confirmation split across three surfaces.
- **M6** — wallet-only refunds undisclosed.
- **S3** — stock art instead of real images outside STAYS.
- **H4** — two divergent host-onboarding doors (`/sell/account` vs `/host`).

## 19. Non-blocking technical debt

Per `docs/engineering/TECHNICAL_DEBT_REGISTER.md`: **DX-001** (split-origin dev media rendering; note its
"not blocking" rationale assumes same-origin production, which is correct, but production rendering
remains unverified), **TEST-001** (EN LTR manual verification of the C2 uploader), **TEST-002** (failed-upload
retry not manually re-triggered). Additionally: intercity transport models carry schema weight with no
product; `LegalPlaceholderPage` is misleadingly named for substantive content; `/capsule-preview` and
`/immocontact` are ungated prototype routes.

---

## 20. Exact launch checklist (closed beta, STR only)

**Engineering**
1. Migrate all three storage modules to durable object storage (Vercel Blob); add an `env.mjs` production
   check so a misconfigured deployment refuses to boot.
2. Re-verify C2 photo upload and C5 ID upload end-to-end **on the deployed environment**, not locally.
3. Set every non-STR division to `status: 'soon'` in `divisions.ts`; confirm the landing page renders them
   as non-clickable.
4. Isolate SR (§21 plan) behind a flag, default off.
5. Remove or gate the fabricated fallback path — at minimum make sample listings non-clickable and
   non-bookable, and delete `createLocalFallbackBooking` / `createLocalFallbackPaymentProof`.
6. Hide the FR toggle (S4).
7. Gate Quebec/CITQ surfaces off the Syria market (S5).
8. Commit C5; update the roadmap to record C3 and C5.
9. Add error monitoring and a documented backup/restore procedure; rehearse a restore.
10. Stand up a staging environment.

**Product**
11. Implement C4 (availability-aware date selection) and C1 (booking-first checkout).
12. Implement H3 (host payout configuration).
13. Add C7 confirmation dialogs on all irreversible money/moderation actions.
14. Correct S2a copy; add the M6 refund disclosure.

**Legal / operational**
15. Insert registered legal entity details (B1).
16. Revise Terms/Privacy to describe only the launched divisions.
17. Confirm Syria tax and invoice obligations with counsel.
18. Define support staffing, hours, escalation, and beta participant agreements.

**Verification**
19. Execute all in-scope personas end-to-end on staging, AR and EN.
20. Test on real phones and tablets.
21. Test slow connections, failed requests, empty/no-photo/broken-media states, unauthorized access, expired sessions.
22. Confirm real email delivery through Resend in production.

## 21. Rollback plan requirements

Before any deployment, the following must exist and be **rehearsed**, not merely written:

1. **Tagged, redeployable last-known-good build** and a one-command revert (Vercel instant rollback).
2. **Database migration reversibility** — every Prisma migration in the release must have a tested down path
   or a documented forward fix.
3. **Verified restore from backup**, with a stated RPO/RTO. Currently neither backups nor targets exist.
4. **Blob storage rollback semantics** once §16.1 is fixed — what happens to files written by a build that
   is then rolled back.
5. **Feature-flag kill switches** for SR, non-STR divisions, and payment capture — flippable without a deploy.
6. **Financial reconciliation procedure** for in-flight bookings and payments at rollback time. This is the
   hardest requirement and is entirely absent today.
7. **Incident communication plan** for beta participants.
8. **Rollback decision authority** — named person, explicit triggers.

## 22. Scores

Scored against *real launch readiness*, not effort or code volume.

| Dimension | Score | Basis |
|---|---|---|
| **Product readiness** | **42 / 100** | STR journey incomplete: no availability enforcement, no booking-first checkout, no host payout. 5 of 8 P0 open. Non-STR divisions have no demonstrated journey. |
| **Engineering readiness** | **52 / 100** | Strong server architecture, 695 passing tests, rigorous prod config validation — offset by a storage design incompatible with the deployment target, no observability, no backup, no staging. |
| **Security readiness** | **72 / 100** | Genuinely strong: prod validation, distributed rate limiting, headers/CSP, correct CORS, audit logging, tested authorization. Deductions for no monitoring, unnecessary SR exposure, no external audit. |
| **Operational readiness** | **28 / 100** | No monitoring, no backup/restore, no staging, no documented support or staffing, device-local money reconciliation, admins deciding without context. |
| **Legal readiness** | **38 / 100** | Substantive, honest Terms/Privacy — but no legal entity, terms covering unlaunched divisions, unverified Syria tax/invoice position. |
| **Overall launch readiness** | **44 / 100** | Weighted toward the blockers that gate real users and real money. |

## 23. Final decision

# NO GO — for full SYBNB, and for any public launch today.
# GO — Closed Beta Only (STR / Stays), conditional on §16.1 being fixed first.

**Reasoning.** The platform's foundations — security, testing discipline, honest payment review, real
verification — are strong enough that a controlled closed beta is a reasonable next step, and stronger
than most products at this stage. But three facts make a public launch indefensible right now: uploaded
photos and identity documents **will not survive production**; the booking flow **cannot enforce the dates
it takes money for**; and hosts **cannot configure how they get paid**. Any one of those alone would
justify holding.

The most important structural correction is smaller than it looks: the platform is presenting **eight
businesses** to the public when it is ready to operate **one**. Hiding seven divisions and isolating SR is
low-risk, reversible, and immediately reduces operational, legal, and trust surface — without deleting a
single line of the substantial work behind them.

**Owner decisions required — nothing below has been actioned:**

1. Approve the launch boundary: **D (closed beta, STR only)** — or select A / B / C / E.
2. Approve the SR isolation approach (feature flag + route gate + nav removal, code preserved) before any
   isolation work begins.
3. Approve setting non-STR divisions to `status: 'soon'`.
4. Approve promoting the storage blocker (§16.1) to **P0 position 1**, ahead of the remaining roadmap items.
5. Decide whether the C5 work in this worktree should be committed.
6. Confirm whether SR, Marketplace and Quebec should remain described in the Terms.
