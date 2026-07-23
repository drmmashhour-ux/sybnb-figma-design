# AGENT 1 — Independent Product & UX Architecture Review

**Reviewer role:** Chief Product and UX Architect (independent pass)
**Repository baseline reviewed:** commit `8a4eba7` (`docs(storage): add architecture freeze review and validation baseline`) on branch `claude/intelligent-kilby-5ff258`
**Worktree:** `/Users/mohamedalmashhour/Documents/Codex/SYBNB_STR_FINAL_UPDATED_FOR_CLAUDE_2026_07_05_TEST_FIX/.claude/worktrees/intelligent-kilby-5ff258`
**Date:** 2026-07-22
**Mode:** Read-only. No source, test, config, or dependency file was modified. Nothing was installed, run, deployed, or committed. This document is the only file written.

---

## 1. Baseline & scope

Tracked tree was clean at `8a4eba7`. Untracked at review time: `.claude/`, `vite.uicheck.config.ts`, and five untracked planning documents under `docs/product/` (listed in §3). The untracked planning documents were read and are cited as **prior artifacts**, not as evidence of implementation.

**In scope (as assigned):** guest / host / admin / support journeys; listing creation, discovery, booking, availability, pricing, checkout; payment-state truthfulness; identity verification; media and document experience; messages and notifications; closed-beta boundaries; division isolation; empty / error / loading / restricted / recovery states; mobile and desktop consistency; accessibility; localization (AR RTL / EN / FR); operational usability; missing screens and broken workflow transitions.

**Out of scope:** coding style, unless it directly produces a product defect.

**Not read, per instruction:** `docs/reviews/final-independent-review/AGENT_2_*` and `AGENT_3_*`. Neither existed at review time (the directory was created by this review).

---

## 2. Method

1. Derived the complete route surface from `src/app/App.tsx` (the entire router — there is no other router).
2. Read the navigation shell, footer, and division registry in full.
3. Walked each journey in code from entry point to completion, following the actual call chain into `src/shared/api/platformApi.ts` and then into `server/routes/*.mjs` to test whether the UI's promise matches backend reality.
4. Used targeted `grep` to establish **absence** claims (a symbol declared but never consumed; a component exported but never imported; an endpoint with no caller). Absence claims below state the exact search performed.
5. Every finding is labelled **CONFIRMED FACT** (I read the cited line) or **INFERENCE** (reasoned consequence of confirmed facts). Where I could not determine something, it says so.
6. No browser, device, or emulator was used. No test was executed. See §8 for what that excludes.

**Two corrections to prior artifacts, established first, because they change what is still true.** The untracked `docs/product/SYBNB_FULL_PLATFORM_LAUNCH_READINESS_REVIEW.md` names ephemeral local-disk storage as blocker §16.1 and C5 ("Verified host") as implemented-but-uncommitted. Both are **superseded at this baseline**:

- **Storage is now durable object storage.** `server/lib/listing-media-storage.mjs:1-19` and `server/lib/id-document-storage.mjs:1-21` both import from `server/lib/object-storage.mjs` and write to Cloudflare R2 bucket classes, with header comments stating the local-filesystem path was the bug being fixed. §16.1 is **resolved at `8a4eba7`** (resolved *in code*; production behaviour remains unverified — see §8).
- **C5 is committed.** `src/modules/host/hostVerificationModel.ts:4-8` documents the removal of the client-side `hostDocumentsSent` flag; `grep -rn "hostDocumentsSent" src/` returns only that historical comment. Badge and trust score derive from server `idDocumentStatus` (`HostDashboardPage.tsx:329-331`).

I flag these because a stale blocker list distorts sequencing. The findings below are what remains.

---

## 3. Inspected inventory

**Documents read**
- `docs/product/STR_LAUNCH_ROADMAP_v1.1.md` (frozen roadmap — treated as the priority source of truth)
- `docs/product/SYBNB_STR_CLOSED_BETA_BOUNDARY.md` (untracked proposal)
- `docs/product/SYBNB_FABRICATED_DATA_REMEDIATION_INVENTORY.md` (untracked proposal)
- `docs/product/SYBNB_FULL_PLATFORM_LAUNCH_READINESS_REVIEW.md` (untracked prior review)

**Frontend read in full or in the regions cited**
`src/app/App.tsx`, `src/app/routes.ts`, `src/engines/navigation/divisions.ts`, `src/engines/search/countries.ts`, `src/engines/language/languageEngine.ts`, `src/shared/layout/AppShell.tsx`, `src/shared/layout/Footer.tsx`, `src/shared/api/platformApi.ts` (fallback regions), `src/modules/landing/LandingPage.tsx`, `src/modules/search/SearchPreviewPage.tsx`, `src/modules/search/SearchStates.tsx`, `src/modules/search/DateRangePicker.tsx`, `src/modules/search/UnifiedSearchBar.tsx`, `src/modules/search/LocationCascade.tsx`, `src/modules/listings/ListingDetailPage.tsx`, `src/modules/bookings/BookingReviewPage.tsx`, `src/modules/bookings/BookingDetailPage.tsx`, `src/modules/bookings/TripLookupPage.tsx`, `src/modules/host/HostDashboardPage.tsx`, `src/modules/host/HostEarningsPage.tsx`, `src/modules/host/hostVerificationModel.ts`, `src/modules/admin/AdminReviewPage.tsx`, `src/modules/account/GuestAccountPage.tsx`, `src/modules/dashboard/DashboardPage.tsx`, `src/modules/legal/LegalPlaceholderPage.tsx`, `src/modules/seller/sellerRoutes.ts`, `src/modules/seller/SellerListingWizard.tsx`, `src/modules/immocontact/ImmocontactPage.tsx`, `src/shared/theme/global.css`, `index.html`.

**Backend read in the regions cited**
`server/routes/bookings.mjs`, `server/routes/listings.mjs`, `server/routes/host.mjs`, `server/routes/admin.mjs`, `server/routes/messages.mjs`, `server/routes/me.mjs`, `server/lib/booking-lifecycle.mjs`, `server/lib/listing-media-storage.mjs`, `server/lib/id-document-storage.mjs`, `prisma/schema.prisma` (payout fields), `vercel.json`.

---

## 4. Findings

Each finding carries the eight mandated fields. Severity is judged against *product and UX integrity for the Syria-first STR launch*, per the roadmap's own framing.

---

### A1-01 — The guest cannot choose dates; fetched availability is computed and then discarded — CRITICAL

**Status:** CONFIRMED FACT.

**Evidence.**
- `src/modules/listings/ListingDetailPage.tsx:214-215` initialises `const [dateRange, setDateRange] = useState<DateRange>(bookingDraft.dateRange || loadSearchDatesDraft() || defaultStayDateRange())`.
- `grep -n "setDateRange" src/modules/listings/ListingDetailPage.tsx` returns **exactly one line — the declaration at :214**. The setter is never called anywhere in the file.
- `grep -n "DateRangePicker" src/modules/listings/ListingDetailPage.tsx` returns **only the import of `isValidDate, nightsBetween` at :22**. The listing detail page never renders a date picker.
- `defaultStayDateRange()` (`:775-778`) returns *tomorrow → tomorrow + 2 days*.
- `loadAvailability()` (`:268-283`) fetches real availability, expands `bookedRanges` into a day set, and calls `setDisabledDates(blocked)` at `:281`.
- `grep -n "disabledDates" src/modules/listings/ListingDetailPage.tsx` returns **only :217 (declaration) and :281 (setter)**. The computed blocked-date set is never read.
- `src/modules/search/DateRangePicker.tsx` *does* implement `disabledDates` enforcement (`:124-137`, `:188`) — the capability exists and is simply never wired.
- `BookingReviewPage.tsx` offers no date editing either; it reads dates from the sessionStorage draft (`:158`, `:393-401`).

**Consequence (INFERENCE from the above).** A guest arriving from a shared link, a division page, or any entry without a prior dated search is bound to an arbitrary "tomorrow to +2 nights" range with no affordance to change it on either the listing page or the checkout page. A real, quoted price is fetched and displayed for those dates (`:317-337`), so the guest is shown a concrete total for dates they never selected. The date-validity guard in `requestListing()` (`:364-371`) can never fire, because the default is always valid.

The server *does* protect data integrity: `server/routes/bookings.mjs:543-573` takes a transaction-scoped advisory lock and rejects overlapping bookings with `BOOKING_DATES_UNAVAILABLE` (409). So this is **not** a double-booking defect. It is a late-failure defect: the guest reaches the terms checkbox, accepts a legal agreement, presses "Confirm and send booking request", and only then can be told the dates are unavailable — with no way to pick different ones, because no picker exists.

**Severity:** Critical.
**Launch impact:** Blocks closed beta. This is roadmap **C4**, and the code is a state worse than C4's description ("availability is fetched but never rendered/enforced") — there is no date UI at all on the PDP.
**Narrow correction:** Render the existing `DateRangePicker` on `ListingDetailPage`, pass the already-computed `disabledDates`, and wire `setDateRange`. No new component is required.
**Required:** Code (frontend only).

---

### A1-02 — Abandoned `PAYMENT_PENDING` bookings hold a listing's dates forever, invisibly to the host, releasable by nobody — CRITICAL

**Status:** CONFIRMED FACT (mechanism); INFERENCE (operational consequence).

**Evidence.**
- Bookings are created with `status: 'PAYMENT_PENDING'` — `server/routes/bookings.mjs:620`.
- `PAYMENT_PENDING` **blocks** subsequent bookings: `bookings.mjs:553` (`status: { in: ['REQUESTED','PAYMENT_PENDING','CONFIRMED'] }` in the overlap guard).
- It **removes the listing from dated public search**: `server/routes/listings.mjs:400` (same status set, filtered out of results).
- It is **reported as booked** by the public availability endpoint: `listings.mjs:397-405`.
- It is **deliberately hidden from the host**: `server/routes/host.mjs:100-103` — `bookings: { where: { status: { not: 'PAYMENT_PENDING' } } }` in `GET /api/host/overview`.
- The **guest cannot cancel it**: `bookings.mjs:57-63` allows guest cancellation only for `['REQUESTED','CONFIRMED']`, otherwise `BOOKING_NOT_CANCELLABLE`.
- **No expiry exists.** `server/lib/booking-lifecycle.mjs:7-9` states: *"Called opportunistically from read paths (host/admin/guest overviews) instead of a cron job, since there is no scheduler in this deployment."* `completeExpiredBookings()` only advances bookings **past checkout** to completed. `vercel.json` declares no `crons` key.
- **No admin release path.** `grep -n "booking.update" server/routes/admin.mjs` yields `:202` (payout-release, guarded on `status: 'COMPLETED'`) and `:1571-1573` (payment-proof decision, which cancels on rejection). If the guest never submitted a payment proof, there is nothing for an admin to reject and no other action that changes booking status.

**Consequence.** Any guest who presses "Confirm and send booking request" and then abandons before paying silently freezes those nights on that listing, permanently. The host sees the nights vanish from availability with **no corresponding reservation in their dashboard** and no control to release them. Neither guest, host, nor admin has a supported path to clear it — only direct database access.

This interacts badly with the roadmap's own direction: **C1** deliberately removes the registration barrier so guests can *begin* booking without an account. Abandonment at the payment step is therefore the expected majority behaviour, not an edge case.

**Severity:** Critical.
**Launch impact:** Blocks closed beta. Real inventory becomes silently unbookable, and the failure is invisible to the operator.
**Narrow correction:** Choose one of (a) a short expiry on `PAYMENT_PENDING` (e.g. release after N minutes with no approved proof), applied opportunistically from the same read paths `completeExpiredBookings` already uses — no scheduler needed; or (b) an admin "release hold" action on `PAYMENT_PENDING` bookings, plus surfacing them in the host dashboard as a distinct "awaiting payment" state. (a) is smaller and self-healing; (b) alone leaves the operator doing manual work.
**Required:** Code (backend + a host-dashboard state), plus **owner input** on the hold duration.

---

### A1-03 — There is no notification mechanism of any kind — CRITICAL

**Status:** CONFIRMED FACT.

**Evidence.**
- `grep -rn "notification" src server --include="*.ts" --include="*.tsx" --include="*.mjs" -i` returns **exactly one hit** in the entire codebase: `src/modules/host/HostDashboardPage.tsx:502`, a button whose `aria-label` is "Notifications" and whose action is `window.location.hash = '/immocontact'`.
- Outbound email is exhaustively: `server/routes/auth.mjs:99` (`sendEmailVerificationCode`) and `server/lib/host-insights.mjs:4` (`sendHostInsightEmail`). `grep -rn "sendMail\|mailer\|sendEmail" server/routes server/lib` confirms no other sender.
- There is therefore **no email on**: booking request created, payment proof submitted, payment proof approved or rejected, booking confirmed, booking cancelled, dispute opened or resolved, ID document approved or rejected, listing approved or rejected.

**Consequence (INFERENCE).** The launch payment model is *manual admin review* — `docs/product/SYBNB_STR_CLOSED_BETA_BOUNDARY.md` §2.6, and `server/routes/payments.mjs` places every proof in `PENDING_ADMIN_REVIEW`. That model has an inherent asynchronous wait of unknown duration. With no notification substrate:
- A **host** has no mechanism by which they learn a booking exists. They must poll `/host`.
- A **guest** who submits payment proof has no mechanism by which they learn it was approved or rejected. They must re-open `/booking/:id` or `/track`.
- An **admin** has no mechanism by which they learn a proof is waiting. They must poll `/admin/review`.

The roadmap places notifications in **P3 / L2** ("Messaging polish: unread badges, timestamps, search, notifications") — treating them as polish on an existing system. There is no existing system. This is a substrate gap, not polish, and I regard the roadmap classification as materially wrong.

Secondary defect in the same evidence: the one "Notifications" affordance points at `/immocontact`, which is a message-thread inbox (`ImmocontactPage.tsx:1-30`), and which the closed-beta boundary (§3, "Prototype routes") classifies as a surface to disable in production.

**Severity:** Critical.
**Launch impact:** Blocks closed beta. A manual-review money flow with zero asynchronous signalling is not operable even at 5–10 hosts / 20–30 guests (the size suggested in the boundary document's B5).
**Narrow correction:** Minimum viable set, reusing the already-configured Resend mailer: transactional email to the host on booking created, and to the guest on payment-proof decision and booking confirmation. Defer in-app notification centres entirely.
**Required:** Code (backend), plus **owner input** on which events warrant an email at beta scale.

---

### A1-04 — The guest has no account surface: the account page is orphaned and `/account` silently renders the landing page — CRITICAL

**Status:** CONFIRMED FACT.

**Evidence.**
- `src/modules/account/GuestAccountPage.tsx:142` exports `GuestAccountPage`. `grep -rn "GuestAccountPage" src/` returns only that definition and two comment references in `src/shared/capsules/AccountGateCapsule.tsx:17,20`. **It is never imported by `App.tsx` or any router.** It is unreachable.
- `src/modules/dashboard/DashboardPage.tsx:140` exports `DashboardPage`. `grep -rn "DashboardPage" src/` shows `App.tsx` imports only `HostDashboardPage` and `DriverDashboardPage`. **`DashboardPage` is also unreachable.**
- `src/app/App.tsx:102-103`: `path === '/dashboard' || path === '/account' ? <LandingPage lang={lang} />`. Both routes render the marketing landing page with no message.
- `src/app/App.tsx:87,100-101`: `/account/open` renders `ListingDetailPage` when an id segment is present, and `SearchPreviewPage` otherwise. It never renders an account screen.
- `grep -rn "myTrips|My Trips|myBookings|/api/bookings/mine" src/ server/` returns **nothing**. There is no guest bookings list, client or server.

**Consequence (INFERENCE).** The `SYBNB_STR_CLOSED_BETA_BOUNDARY.md` §2.1 lists `/account/open` as "Guest account entry". At this baseline that route is a listing/search page. Combined with A1-03, the guest's entire post-booking relationship with the platform depends on either (a) retaining the `/booking/:id` URL in browser history, or (b) `/track` with a confirmation number **and** the phone number given at the pre-payment contact gate (`bookings.mjs:297-333`). A guest who confirms a booking and closes the tab before reaching the contact gate has no supported way to find their booking again — no list, no email, no lookup key.

Roadmap **H1** ("Guest My Trips list") is filed under **P2 — can be fixed during Beta**. Given A1-03, I do not think that sequencing survives contact with a real guest.

**Severity:** Critical.
**Launch impact:** Blocks closed beta — the guest journey has no completion state and no recovery path once the tab is closed.
**Narrow correction:** Route `/account` to the existing (already-written) `GuestAccountPage` rather than the landing page, and add a minimal authenticated bookings list. Do not build a new account architecture; a substantial component already exists unused.
**Required:** Code (frontend routing + one list endpoint), plus **governance** — decide whether H1 stays P2 given A1-03.

---

### A1-05 — The closed-beta boundary is documented but not executed: all eight divisions ship as public and open — CRITICAL

**Status:** CONFIRMED FACT.

**Evidence.**
- `src/engines/navigation/divisions.ts:26-293`: all eight `Division` entries carry `status: 'active'`. `grep` for `'soon'` in that file matches only the `DivisionStatus` type definition at `:11`.
- `src/modules/landing/LandingPage.tsx:206-233`: the grid maps every entry of `DIVISIONS`; `const disabled = division.status === 'soon'` is therefore always `false`, so every card renders enabled with the label "Open" / "افتح" (`:229`).
- `src/app/App.tsx:165-182` routes `/ride`, `/rentals`, `/buy`, `/cars`, `/marketplace`, `/marketplace/sell`, `/new-construction` as plain public routes with no gate.
- The fabricated-inventory mechanism is intact: `src/shared/api/platformApi.ts:144-146` defines `PROTOTYPE_OWNER` with `displayName: 'SYBNB Verified Provider'`; `:152+` defines `FALLBACK_APPROVED_LISTINGS`. The stays entry filters these out (`SearchPreviewPage.tsx:198`, gated on `isStaysEntry`) — the other divisions do not.
- Prototype routes `/capsule-preview` and `/immocontact` are ungated (`App.tsx:129-132`).

**Assessment.** `SYBNB_STR_CLOSED_BETA_BOUNDARY.md` is explicit that it is *"Planning only. No navigation changed, no routes gated, no flags added, no code modified."* I confirm that is accurate: none of the three enforcement layers (L1 nav, L2 route, L3 API) exist at this baseline. I record this as a finding rather than merely echoing the document because it is the single largest gap between the launch decision the documents describe and the product a user would actually receive, and because it is a prerequisite for the STR-only framing that the rest of the roadmap assumes.

I do not restate the fabricated-data inventory in detail; `SYBNB_FABRICATED_DATA_REMEDIATION_INVENTORY.md` items 1–7 are accurate against this baseline and I independently confirmed items 1–3 (locations above).

**Severity:** Critical.
**Launch impact:** Blocks closed beta and blocks public production.
**Narrow correction:** Execute the boundary document's L1 (`status: 'soon'`) and L2 (route gate) as written. Owner decisions B1–B4 in that document must be answered first.
**Required:** Code + **owner input** (decisions B1, B2, B4 are unanswered).

---

### A1-06 — The search error and empty states have no working recovery action — HIGH

**Status:** CONFIRMED FACT.

**Evidence.**
- `src/modules/search/SearchStates.tsx:50-53` renders three buttons — "Reset", "Show all Syria", "Try again" — and all three call the **same** `onReset` prop.
- `src/modules/search/SearchPreviewPage.tsx:283`: `onReset={() => setLastSearch(null)}`.
- `grep -n "lastSearch" src/modules/search/SearchPreviewPage.tsx` returns `:25`/`:87` (copy strings), `:172` (state declaration), and `:334-335` (rendering a "Last search" label). **`lastSearch` is display-only.** It is never read by `runLiveSearch` and never triggers a fetch.

**Consequence.** In the error state, "Try again" does not retry — it clears a text label. The user's only actual recovery is a full page reload or re-submitting the search bar manually. The roadmap (**H6**) describes this as "Reset = Show-all = Retry today"; the reality is narrower and worse — none of the three performs its named action.

Related defect in the same component: the **loading** state also renders all three action buttons (`SearchStates.tsx:47-54` is unconditional), offering "Try again" while a request is in flight. And the card carries no `role="status"` / `aria-live`, so a screen-reader user is not informed when loading transitions to error.

**Severity:** High.
**Launch impact:** Blocks closed beta. Syria-first implies unreliable connectivity; the error state is the state users will meet most, and it is inert.
**Narrow correction:** Give `SearchStateCard` three distinct handlers (`onRetry` re-invoking `runLiveSearch(lastSearch)`, `onReset` clearing filters and re-running, `onShowAll` re-running with cleared location). Suppress the action row in the `loading` state. Add `role="status"`.
**Required:** Code (frontend only).

---

### A1-07 — Hosts can see money owed but there is no payout-method write path anywhere in the product — HIGH

**Status:** CONFIRMED FACT.

**Evidence.**
- `prisma/schema.prisma:151` — `payoutMethod Json? @map("payout_method")` on the user model (`:297` is the separate SR `driver_profiles` column).
- The admin console **reads** it: `server/routes/admin.mjs:135` selects `owner: { select: { …, payoutMethod: true } }` and `:165` surfaces it as `hostPayoutMethod`.
- `grep -rn "payoutMethod|bankAccount|iban|shamCashNumber" src/` returns **zero frontend hits**. There is no host-facing UI.
- `grep -n "payoutMethod" server/routes/me.mjs server/routes/host.mjs` returns only `me.mjs:55` and `:72`, both of which **set it to `null`** (account-deletion / driver-deactivation paths). There is no PATCH that writes a host payout method.
- Meanwhile `src/modules/host/HostEarningsPage.tsx:125-148` presents a per-booking "Payout status" pill cycling `PENDING_HOLD → ELIGIBLE → RELEASED`.

**Consequence (INFERENCE).** A host is shown a payout progressing to "RELEASED" against a destination that no code path ever allowed them to specify. The operator's admin row will read `hostPayoutMethod: null` for every host. The platform can accept guest money it has no recorded way to pay out. This is roadmap **H3**, and the schema-plus-admin-read-without-any-write shape is worth recording because it makes the gap look implemented from the operator's side.

**Severity:** High.
**Launch impact:** Blocks closed beta for **real** money. Does not block internal testing.
**Narrow correction:** One host-facing payout-method form writing `User.payoutMethod`, plus suppressing or relabelling the "RELEASED" pill until a method exists.
**Required:** Code (frontend + one endpoint), plus **owner input** on which payout rails to capture (Sham Cash handle, bank, other).

---

### A1-08 — No confirmation step on any irreversible admin money or moderation action — HIGH

**Status:** CONFIRMED FACT.

**Evidence.** `grep -rn "window.confirm|confirm\(|ConfirmDialog|areYouSure" src/modules/admin/AdminReviewPage.tsx src/modules/disputes/AdminDisputesPage.tsx` returns **zero matches**. `AdminReviewPage.tsx` is 2400+ lines and contains listing approve/reject, payment-proof approve/reject, and payout release paths; none is preceded by a confirmation.

Corroborating server-side irreversibility: `server/routes/admin.mjs:1571-1573` — a payment-proof decision sets the booking to `CONFIRMED` or `CANCELLED` in the same transaction; `:198-215` releases a payout against a `COMPLETED` booking.

**Consequence.** A single mis-click confirms or cancels a real booking, or releases real money, with no undo and no summary of what is about to happen.

**Severity:** High.
**Launch impact:** Blocks closed beta. This is roadmap **C7**, effort **S**.
**Narrow correction:** One reusable confirm dialog showing the key figures (amount, currency, guest, listing, dates) for the three irreversible actions. No workflow redesign.
**Required:** Code (frontend only).

---

### A1-09 — The Privacy Policy's phone-handling claim is contradicted by the booking contact flow — HIGH

**Status:** CONFIRMED FACT.

**Evidence.**
- `src/modules/legal/LegalPlaceholderPage.tsx:156` states, as published policy: *"a phone number (we store only a one-way cryptographic hash of your phone number, never the number itself)"*.
- `server/routes/bookings.mjs:325-333` writes the pre-payment contact details into `booking.metadata` as `guestContactPhone` — **plaintext**, no hashing.
- `server/routes/bookings.mjs:361-363` confirms plaintext storage by reading it back for comparison: `String(row.metadata?.guestContactPhone || '').replace(/[\s()-]/g, '')` compared against the caller's normalised input.

**Assessment.** The claim is accurate for the *account* phone field (`User.phoneHash`) but is written as an unqualified statement about "your phone number", and the STR booking path — the primary flow for the launch — stores the number in clear text. Under the roadmap's own Truthfulness rule ("Never fabricate… trust signals"), a published privacy claim that the shipped code contradicts is the most damaging class of inaccuracy, because it is the statement a user is invited to rely on.

I am **not** asserting a legal conclusion; I am asserting a code/document contradiction.

**Severity:** High.
**Launch impact:** Blocks closed beta (a beta participant agreement will incorporate this policy).
**Narrow correction:** Either qualify the sentence to describe both cases honestly, or hash/encrypt `guestContactPhone` and change the lookup to match on the derived value. The copy fix is smaller and can ship immediately; the storage change is the stronger answer.
**Required:** Documentation (copy) **or** code, plus **owner/LEGAL input** on which.

---

### A1-10 — The French toggle is exposed platform-wide while two of sixty-eight module screens have French copy — HIGH

**Status:** CONFIRMED FACT.

**Evidence.**
- `src/shared/layout/AppShell.tsx:62-64` renders an FR button unconditionally, in the same visual group as AR and EN, on every non-admin, non-seller-tunnel screen.
- `src/engines/language/languageEngine.ts:1-6` defines `Lang = 'ar' | 'en' | 'fr'` and documents that `fr` is deliberately opt-in per copy record.
- `grep -rc "fr: {" src/modules/*/*.tsx` (non-zero results only) returns **two files**: `src/modules/bookings/BookingReviewPage.tsx` and `src/modules/sr/SrRidePage.tsx`. Against 68 module `.tsx` files.
- The near-universal fallback pattern is `T[lang === 'ar' ? 'ar' : 'en']` — e.g. `Footer.tsx:37`, `SearchStates.tsx:36`, `TripLookupPage.tsx:59`, `DateRangePicker.tsx:110`. Selecting FR silently yields English.

**Note on method:** the `"fr: {"` pattern is a heuristic and may miss a differently-formatted record; the fallback-pattern evidence is the stronger signal and is consistent with it. Roadmap **S4** independently estimates ~45 screens.

**Consequence.** A user can select a third language that essentially does not exist. The one guest-facing screen that *does* have French is the booking review — which is also the screen carrying Québec tax rows (A1-15), reinforcing the "repurposed Canada product" impression that S4/S5 exist to remove.

**Severity:** High.
**Launch impact:** Blocks closed beta. Roadmap **S4**, effort **S**.
**Narrow correction:** Remove the FR button from `AppShell.tsx:62-64`. Leave `Lang` and existing FR records untouched so nothing is lost.
**Required:** Code (three lines), plus **owner confirmation** that FR is deferred rather than dropped.

---

### A1-11 — Host dashboard header buttons lead to the wrong places, one into an admin gate — HIGH

**Status:** CONFIRMED FACT.

**Evidence.** `src/modules/host/HostDashboardPage.tsx:502-503`:
- The button labelled `aria-label="Notifications" / "التنبيهات"` navigates to `/immocontact` — a message-thread inbox, not notifications, and a route the closed-beta boundary classifies as a prototype to disable in production.
- The button labelled `aria-label="Settings" / "الإعدادات"` navigates to `/status`.
- `src/app/App.tsx:215-222`: `getStaffRequiredRole` returns `'ADMIN'` for any path starting with `/status`.
- `src/app/App.tsx:94-95`: when the required role is not held, the app renders `StaffAccessPage`.

**Consequence (INFERENCE).** A signed-in host clicking "Settings" on their own dashboard is presented with an **admin** sign-in gate. This is a restricted-state defect reached from a primary affordance in the host's main screen. The correct destination almost certainly exists — `/settings` is routed at `App.tsx:139-140` and is ungated.

**Severity:** High.
**Launch impact:** Blocks closed beta for the host journey (hosts are the scarcer, higher-touch side of the marketplace).
**Narrow correction:** Point the gear button at `/settings`. Either remove the "Notifications" button until A1-03 is addressed, or relabel it "Messages" to match its actual destination.
**Required:** Code (two lines).

---

### A1-12 — Guest count is collected in the search bar and never sent to the API — HIGH

**Status:** CONFIRMED FACT.

**Evidence.** `src/modules/search/SearchPreviewPage.tsx:417-436` (`toListingSearchFilters`) maps `country`, `governorate`, `city`, `area`, `propertyType`, `roomType`, `bedType`, `bedrooms`, `bathrooms`, `amenities`, `checkIn`, `checkOut`, `sort`, and a price band. **There is no `guests` field.** `grep -n "guests" src/modules/search/SearchPreviewPage.tsx` returns only copy strings at `:103` and `:108` describing the feature to the user.

**Consequence.** The interface tells the guest to "Choose dates, guests, room type…" and then ignores occupancy, returning stays that cannot accommodate the party. In a market with low tolerance for wasted trips and a manual-review booking pipeline, each such mismatch costs an operator intervention.

**Severity:** High.
**Launch impact:** Blocks closed beta. Roadmap **H6**, effort **S**.
**Narrow correction:** Add `guests` to `ListingSearchFilters` and to the server-side listing query.
**Required:** Code (frontend + backend query).

---

### A1-13 — Server error messages reach Arabic users in English, at the point of failure — MEDIUM

**Status:** CONFIRMED FACT.

**Evidence.** Error strings are authored in English on the server and surfaced verbatim by the client:
- `server/routes/bookings.mjs:568` — `'These dates are no longer available for this listing.'`
- `server/routes/bookings.mjs:58` — `'Only requested or confirmed bookings can be cancelled by the guest.'`
- `server/routes/messages.mjs:38` — `'Messaging opens once the booking is confirmed.'`
- Client surfacing: `BookingReviewPage.tsx:234` — `setMessage(error instanceof Error ? error.message : t.error)`; `ListingDetailPage.tsx:358` — same pattern.

`TripLookupPage.tsx:82-83` shows the correct pattern already exists in the codebase: it switches on `error.code` (`BOOKING_LOOKUP_NOT_FOUND`) and renders localised copy. Most call sites do not do this, and `grep -rn "BOOKING_DATES_UNAVAILABLE" src/` returns **nothing** — the most important booking failure has no client-side localisation at all.

**Severity:** Medium.
**Launch impact:** Does not block internal testing; degrades closed beta materially for the Arabic-first audience, since these strings appear precisely when the user is confused.
**Narrow correction:** Map the handful of guest-facing error `code`s to AR/EN copy at the client call sites, following the `TripLookupPage` pattern. Server messages can stay English as operator diagnostics.
**Required:** Code (frontend), plus **L10n** copy.

---

### A1-14 — No support path exists inside the listing-creation tunnel or the admin console — MEDIUM

**Status:** CONFIRMED FACT.

**Evidence.**
- `src/shared/layout/AppShell.tsx:114` renders the `Footer` only when `!isAdvertisingTunnel && !isAdminControlRoom`, where `isAdvertisingTunnel = path.startsWith('/sell') || path.startsWith('/advertising')` and `isAdminControlRoom = path.startsWith('/admin')` (`:17-18`).
- The top navigation is suppressed on the same condition (`:41`).
- `grep -rn "SUPPORT_EMAIL|contactChannels" src/` shows support channels surfaced only in `Footer.tsx:44-47`, `LegalPlaceholderPage.tsx:204`, `GuestAccountPage.tsx:412` (unreachable — see A1-04), and `ReferralPanel.tsx`.

**Consequence.** The multi-step host listing-creation flow (`/sell/*`, `SellerListingWizard.tsx`) — the longest, highest-abandonment flow in the product, and the one where a first-time host is most likely to get stuck — has no contact link, no footer, and no top navigation. Support is reachable only by abandoning the flow via the "Home" button in the flow-step nav.

**Severity:** Medium.
**Launch impact:** Does not block internal testing; a real friction cost at closed beta, where host supply is the scarce resource.
**Narrow correction:** Render a minimal support line (the existing `SUPPORT_EMAIL` / WhatsApp links) inside the seller tunnel.
**Required:** Code (frontend only).

---

### A1-15 — Québec/Canada artifacts remain in the Syria-first STR guest path — MEDIUM

**Status:** CONFIRMED FACT (presence); INFERENCE (user-visible impact is conditional).

**Evidence.**
- **Country selector.** `src/engines/search/countries.ts:12-15` exposes `SY` and `CA`. `src/modules/search/LocationCascade.tsx:111,123-127` renders a country row and a Canada choice; `UnifiedSearchBar.tsx:331` computes `isCanada` for stays. A Syria-first guest is offered Canada in stays search.
- **Checkout tax rows.** `src/modules/bookings/BookingReviewPage.tsx:86-88` defines "Québec lodging tax (3.5%, estimated)", "Federal GST (5%, estimated)", "Québec QST (9.975%, estimated)", rendered at `:306-327` when `stayBreakdown.taxSource` is truthy.
- **Conditionality.** `server/routes/listings.mjs:149` sets `taxSource: quebecTaxes?.source || null`. **INFERENCE:** for a Syrian listing this resolves to `null`, so the Québec rows should not render for Syria-market bookings. I did not execute this path to confirm.
- **Listing creation.** `src/modules/seller/SellerListingWizard.tsx:227-228,365-376,481-501` implements CITQ registration capture, a locked 3.5% lodging-tax field, and Québec insurance slots, gated on `isQuebecStr`.
- **Locale.** `src/shared/i18n/display.ts:174` maps `fr → 'fr-CA'`.

**Assessment.** I want to be precise: the tax rows appear **conditional** and probably do not render for Syrian listings. The country selector, however, is **unconditional** — a guest browsing Syrian stays is shown Canada as a destination. That is the concrete, confirmed leak.

**Severity:** Medium.
**Launch impact:** Does not block internal testing; undermines the Syria-first positioning at closed beta. Roadmap **S5**.
**Narrow correction:** Gate the country row off for the Syria market (`LocationCascade`'s `allowCanada` prop already exists as the seam — pass `false`). Leave the Québec code intact and frozen, per the architecture-boundary directive.
**Required:** Code (frontend), plus **owner confirmation** that Canada is out of the launch market.

---

### A1-16 — The checkout draft is fragile and its recovery message is written but never displayed — MEDIUM

**Status:** CONFIRMED FACT.

**Evidence.**
- `BookingReviewPage.tsx:393-401` reads the booking draft from `sessionStorage`.
- `:166-172`: if the dates are missing or invalid, the effect performs `window.location.hash = '/listing/' + listingId` and returns — a **silent** redirect with no explanation.
- `grep -rn "datesMissing" src/` returns **only the three copy definitions** (`:65` AR, `:104` EN, `:143` FR). The string "Choose check-in and check-out dates on the listing page first." is never rendered.

**Consequence.** Opening the checkout URL in a new tab, after a session-storage clear, or on a different device bounces the user back to the listing with no message — and, per A1-01, with no date picker to act on. The correct copy was written and never wired.

**Severity:** Medium (it compounds A1-01, which is the root cause).
**Launch impact:** Blocks closed beta only as part of A1-01.
**Narrow correction:** Pass the reason through the redirect and render `t.datesMissing` on the listing page. Fix alongside A1-01.
**Required:** Code (frontend only).

---

### A1-17 — The global flow-step navigation offers "Next" actions that are no-ops or non-sequitur jumps — MEDIUM

**Status:** CONFIRMED FACT.

**Evidence.** `src/shared/layout/AppShell.tsx:93-110` renders a persistent Back / Home / Next bar on every non-landing, non-admin route, driven by `getRouteContext`:
- `:137-143` — for `/rentals`, `nextPath: '/rentals'`. "Next" navigates to the page already displayed.
- `:129-135` — for `/search-preview`, `nextPath: '/stays'`. "Next" is a jump to a different division's search, not a step forward.
- `:253-259` — for `/wallet`, `nextPath: '/'`. "Next" is Home, duplicating the adjacent Home button.
- `:309-347` — the admin chain wires `/admin → /operations → /ai-brain → /competitors → /status` as a linear "Next" sequence across unrelated consoles. (Rendered only if an admin reaches these outside `/admin*`, since `showFlowNav` excludes `/admin*` — `:20`.)
- `goNext` (`:25-28`) returns early on an empty `nextPath`, but `:102-108` still renders the button whenever `nextPath` is truthy — so the `/rentals` self-navigation and the `/wallet` Home-duplicate do render.

Related dead code: `readGuestReturnPath` (`:365-372`) is defined and never called.

**Consequence.** A globally persistent control implies a wizard-like sequence the product does not have. "Next" sometimes does nothing visible, sometimes teleports across divisions.

**Severity:** Medium.
**Launch impact:** Does not block launch; erodes navigational trust.
**Narrow correction:** Set `nextPath: ''` wherever the next step is not a genuine forward step in the same flow (`/rentals`, `/wallet`, `/search-preview`), so the placeholder renders instead of a button.
**Required:** Code (frontend only).

---

### A1-18 — The search error state promises cached results that do not exist — MEDIUM

**Status:** CONFIRMED FACT.

**Evidence.** `src/modules/search/SearchStates.tsx:28` (EN): *"Connection is unstable. Try again or view cached results."* `:17` (AR): *"…حاول مرة أخرى أو اعرض النتائج المحفوظة."* No caching layer exists (roadmap **S2b** is the unstarted work to build one), and no button in the component performs a cached read — all three call `onReset` (A1-06).

**Severity:** Medium.
**Launch impact:** Does not block internal testing; an integrity gap at closed beta. Roadmap **S2a**, effort **S**, copy-only.
**Narrow correction:** Delete the "or view cached results" clause from both strings.
**Required:** Documentation/copy (**L10n**) + a two-line code change.

---

### A1-19 — Loading and error states are not announced to assistive technology — LOW

**Status:** CONFIRMED FACT.

**Evidence.** `grep -rn "aria-live|role=\"status\"|role=\"alert\"" src/modules src/shared` shows `role="alert"` used correctly in about ten form-error sites (`OpenDisputeForm.tsx:85`, `HostTaxProfilePage.tsx:372`, `ListingPhotoUploader.tsx:192,199`, others), but:
- `SearchStates.tsx` (the loading/empty/error card) has no live-region role.
- `App.tsx:245-253` (`RouteLoading`, the global lazy-route fallback) has none.
- `BookingReviewPage.tsx:248-249` renders loading and error panels with none.

Positives confirmed in the same pass: a skip link (`AppShell.tsx:33-35`) with a `:focus` style (`global.css:98`); `dir` correctly driven by language on the shell (`AppShell.tsx:32`) and per page; `@media (prefers-reduced-motion: reduce)` blocks (`global.css:65`, `:4461`); numerous `min-height: 44px` touch targets; 85 `aria-label` and 29 `role=` usages across modules. Accessibility has clearly been attended to; live regions are the systematic gap. A separate, narrower gap: `global.css` defines `:focus-visible` for exactly one component (`:8949`, the listing gallery thumbnails), and many pages style buttons through inline `CSSProperties` objects that no stylesheet rule can reach — so keyboard focus visibility on those controls is **unverified** (I did not run a browser).

**Severity:** Low.
**Launch impact:** Does not block launch.
**Narrow correction:** Add `role="status"` to `SearchStateCard` and `RouteLoading`.
**Required:** Code (frontend only).

---

### A1-20 — No PWA manifest or app icon — LOW

**Status:** CONFIRMED FACT. `grep -n "viewport|theme-color|manifest" index.html` returns a correct viewport meta (`:5`) and `theme-color` (`:6`), and **no manifest link**. This is roadmap **S6**, which also covers iOS `safe-area-inset` handling; `grep -n "safe-area" src/shared/theme/global.css` returned no matches in the sampled output, but I did not exhaustively verify safe-area handling and the roadmap already flags it as requiring an on-device pass.

**Severity:** Low. **Launch impact:** Does not block launch. **Correction:** Per roadmap S6. **Required:** Code + a live-device pass.

---

## 5. Journey-by-journey assessment

Assessed against the seven mandated criteria. **Y** = present and functional; **P** = present but defective; **N** = absent.

| Journey | Entry point | Source of truth | Truthful state | Recovery path | Support path | Completion state | Navigation continuity | Blocking findings |
|---|---|---|---|---|---|---|---|---|
| **Guest — discover** | Y (`/`, `/stays`, top nav) | Y (server search) | P — sample data filtered on stays only (A1-05) | **N** (A1-06) | Y (footer) | Y (results) | Y | A1-06, A1-12 |
| **Guest — listing detail** | Y (`/listing/:id`) | Y (server) | P — price shown for dates never chosen | **N** — no date UI (A1-01) | Y (footer) | Y (→ review) | Y | **A1-01** |
| **Guest — checkout / booking** | Y (`/booking/review/:id`) | P — `sessionStorage` draft | Y (server-computed quote, honest fees) | **N** — silent redirect, unused copy (A1-16) | Y (footer) | Y (→ `/booking/:id`) | P | **A1-01**, A1-13, A1-16 |
| **Guest — payment** | Y (from booking detail) | Y (server; all proofs `PENDING_ADMIN_REVIEW`) | Y — no client auto-approval on the real path | P — no signal on decision (A1-03) | Y (footer) | P — split across banner/timeline/receipt (roadmap M1) | Y | **A1-03** |
| **Guest — post-booking / account** | **N** — `/account` renders landing (A1-04) | N — no trips list | n/a | P — `/track` only, needs phone | Y (footer) | **N** | **N** | **A1-04**, **A1-03** |
| **Guest — cancel / dispute** | Y (`BookingCancelDispute`) | Y (server) | Y (policy matches legal page) | Y | Y | Y | Y | roadmap M6 (undisclosed wallet-only refund) |
| **Host — onboarding** | P — two doors (`/become-host` vs `/host`; roadmap H4) | Y | Y | Y | **N** (A1-14) | Y | P | A1-14 |
| **Host — listing creation** | Y (`/sell/*`) | Y (server; real media upload) | Y (C2/C3 complete) | Y (retry in uploader) | **N** (A1-14) | Y (→ admin review) | P — no nav/footer | A1-14 |
| **Host — identity verification** | Y (dashboard panel) | Y (server `idDocumentStatus`) | Y — C5 committed, badge server-gated | Y | N | Y | Y | none |
| **Host — reservations** | Y (`/host`) | P — `PAYMENT_PENDING` hidden (A1-02) | **N** — dates blocked with no visible reason | **N** — cannot release (A1-02) | N | Y | P — broken header buttons (A1-11) | **A1-02**, **A1-03**, A1-11 |
| **Host — earnings / payout** | Y (`/host/earnings`) | Y (server ledger) | P — "RELEASED" with no destination (A1-07) | N | N | P | Y | **A1-07** |
| **Admin — review queue** | Y (`/admin/review`, staff gate) | Y (server + audit log) | Y | **N** — no undo, no confirm (A1-08) | n/a | Y | P — no footer/nav (A1-14) | **A1-08** |
| **Admin — disputes / reports** | Y | Y | Y | N (A1-08) | n/a | Y | P | A1-08; roadmap H8 (no decision context) |
| **Admin — user management** | **N** — no directory | n/a | n/a | n/a | n/a | n/a | n/a | roadmap H9 |
| **Support** | P — `mailto:` + WhatsApp in footer only | **N** — no ticket/case record | n/a | n/a | n/a | **N** | P — absent in seller tunnel & admin (A1-14) | A1-14; no support tooling exists |
| **Messaging** | P — booking-scoped only | Y (server) | Y (gate is honest) | Y | Y | Y | Y | roadmap H5 (no pre-booking channel) |
| **Notifications** | **N** — does not exist | **N** | n/a | n/a | n/a | **N** | n/a | **A1-03** |

**Cross-cutting.** Localization: AR/EN structurally sound (`dir` driven throughout); FR exposed at 2/68 screens (A1-10); server errors English-only (A1-13). Mobile/desktop consistency: responsive primitives and 44px targets are present in `global.css`; **no device verification was performed** — unassessed. Accessibility: good baseline, live regions missing (A1-19).

---

## 6. Summary counts

**By severity**

| Severity | Count | IDs |
|---|---|---|
| Critical | 5 | A1-01, A1-02, A1-03, A1-04, A1-05 |
| High | 7 | A1-06, A1-07, A1-08, A1-09, A1-10, A1-11, A1-12 |
| Medium | 6 | A1-13, A1-14, A1-15, A1-16, A1-17, A1-18 |
| Low | 2 | A1-19, A1-20 |
| **Total** | **20** | |

**By launch impact**

| Impact | Count | IDs |
|---|---|---|
| Blocks internal testing | 0 | — |
| Blocks closed beta | 13 | A1-01, A1-02, A1-03, A1-04, A1-05, A1-06, A1-07, A1-08, A1-09, A1-10, A1-11, A1-12, A1-16 |
| Blocks public production (and not already above) | 1 | A1-05 also blocks public production |
| Does not block launch | 6 | A1-13*, A1-14*, A1-15*, A1-17, A1-19, A1-20 |

\* A1-13, A1-14 and A1-15 do not *block* but materially degrade the closed-beta experience; all three are small fixes.

**By what is required**

| Requirement | IDs |
|---|---|
| Code only | A1-01, A1-06, A1-08, A1-11, A1-12, A1-13, A1-14, A1-16, A1-17, A1-19 |
| Code + owner input | A1-02, A1-03, A1-05, A1-07, A1-10, A1-15 |
| Code + governance | A1-04 |
| Documentation/copy or code (owner choice) | A1-09, A1-18 |
| Code + infrastructure / device pass | A1-20 |

**Roadmap reconciliation.** Four findings are not represented in the frozen roadmap v1.1 and I recommend they be raised to the owner for triage: **A1-02** (PAYMENT_PENDING availability hold — no roadmap ID), **A1-04** (orphaned `GuestAccountPage` and `/account` → landing — H1 covers only the trips list), **A1-09** (privacy-policy contradiction), **A1-11** (broken host header navigation). **A1-03** is represented only as P3 / L2 "polish", which I assess as a misclassification of a missing substrate. Per the operating policy in Part A of the roadmap, I am recommending and not changing priorities.

---

## 7. What I confirm is working well

Recording this because a findings list read alone is misleading about the state of the product.

- **Payment truthfulness on the real path is sound.** Every proof enters `PENDING_ADMIN_REVIEW` server-side; the cancellation-protection premium is server-computed and cannot be forged from the request body (`bookings.mjs:613-615`, with the reasoning documented in-line).
- **Concurrency correctness is unusually careful.** The booking overlap guard uses a transaction-scoped advisory lock (`bookings.mjs:543-573`); guest cancel and admin payout release both claim rows on an expected status inside their transaction (`bookings.mjs:79-89`, `admin.mjs:198-215`).
- **The identity-verification chain is honest.** Badge and trust score derive solely from server `idDocumentStatus` (`hostVerificationModel.ts`, `ListingDetailPage.tsx:491`, `SearchPreviewPage.tsx:300`).
- **Storage is now durable**, and the migration preserved the authorization model rather than reworking it (`listing-media-storage.mjs:11-19`).
- **The legal pages are substantive and self-aware** — `LegalPlaceholderPage.tsx:13-14` states plainly that no registered company name exists, rather than inventing one. (Roadmap **B1** remains open; I confirm the absence and add nothing to it.)
- **Checkout is architecturally correct**: reservation creation is isolated on its own route next to the agreement checkbox, with the reasoning documented at `BookingReviewPage.tsx:21-26`.

---

## 8. Explicit limitations of this review

1. **No execution.** No test suite, dev server, build, browser, device, or emulator was used, per instruction. Every finding is derived from reading code. Nothing here is production verification.
2. **Absence claims rest on `grep`.** Where I assert something does not exist (A1-03 notifications, A1-04 orphaned components, A1-07 payout write path, A1-12 guest filter), the exact search is stated. A dynamically constructed identifier or an unconventional spelling would evade these searches. I judge that unlikely given the codebase's consistent naming, but it is not proven.
3. **Runtime conditionality unverified.** A1-15's claim that Québec tax rows do not render for Syrian listings is an inference from `listings.mjs:149`; I did not execute the quote path.
4. **Mobile and cross-device consistency is unassessed**, not assessed-and-passed. Responsive CSS primitives exist; whether they render correctly is unknown.
5. **Visual craft is unassessed** — spacing, contrast ratios, font rendering, tap ergonomics, animation feel. A code-grounded review cannot rate these. This matches the roadmap's own Part C caveat.
6. **Focus-visible coverage is unverified** for the many controls styled via inline `CSSProperties` (noted in A1-19).
7. **Not exhaustive.** I did not review in depth: the SR/ride, driver, marketplace, rentals, buy, or new-construction journeys (out of the STR launch boundary and frozen per the architecture directive); the wallet and gift flows; the seller advertising payment tunnel; Quebec/SIR/CTQ internals. Absence of findings for those areas is absence of review, not a clean bill.
8. **Independence.** `AGENT_2_*` and `AGENT_3_*` were not read (neither existed). Conclusions here may overlap or conflict with theirs; conflicts should be reconciled rather than assumed resolved in either direction.
9. **Prior artifacts.** The five untracked `docs/product/` planning documents were read and cited. Two of their claims are superseded at this baseline (§2). I verified the specific claims I relied on and did not accept the remainder as evidence of implementation.
10. **No legal, tax, or security conclusion is offered.** A1-09 asserts a code/document contradiction, not a compliance determination.

---

*End of AGENT 1 report. Baseline `8a4eba7`. No code, test, config, or dependency file was modified in producing this review.*
