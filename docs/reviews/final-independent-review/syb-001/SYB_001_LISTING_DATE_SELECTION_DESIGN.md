# SYB-001 — Listing Date-Selection UX Design

**Baseline:** commit `32b2152` · **Date:** 2026-07-23 · **Status:** design for owner approval.
**No code, UI, API, or booking-flow change. Nothing implemented.**

> Authorized under Owner Decision Session 01 (SYB-001 ACCEPTED — UX design authorized, implementation
> deferred). This document specifies *what to build and why*; it writes no React and changes no file.
> Illustrative snippets are specification, not implementation.

---

## 1. Current flow (verified at `32b2152`)

```
Search bar ──picks dates──▶ saved to search draft
   │                         (UnifiedSearchBar.tsx:519 — the ONLY real calendar in the app)
   ▼
Listing page  ── seeds dateRange = bookingDraft.dateRange || loadSearchDatesDraft() || defaultStayDateRange()
   │            (ListingDetailPage.tsx:214)
   │            ├─ loadAvailability() runs once on mount → server truth → setDisabledDates(blocked)   [line 268-281]
   │            │     ...but disabledDates is NEVER read or rendered, and passed by ZERO callers app-wide
   │            ├─ stayQuote useEffect reacts to dateRange → server-computed price                    [line 317-329]
   │            └─ NO picker: 0 <input>, 0 type="date", 0 <DateRangePicker>, 0 setDateRange() calls
   ▼
Booking review ── if dates missing, instructs: "Choose check-in and check-out dates on the listing page first."
                  (BookingReviewPage.tsx:104 EN / :65 AR) — an action the listing page cannot perform
```

**The precise defect (owner-accepted clarification).** It is *not* that every booking is forced to
tomorrow+2. The listing page simply has **no governed mechanism** to select, modify, validate, or
visualize dates. Two server-authoritative capabilities are already present and wired to nothing:

| Already built | Where | Currently |
|---|---|---|
| Authoritative availability fetch + blocked-set expansion | `loadAvailability()` line 268–281 | computed into `disabledDates`, **never rendered** |
| Server-computed price for the selected range | `stayQuote` effect line 317–329 | **reacts to `dateRange`** — would refresh automatically if a picker changed it |
| A full date picker with `disabledDates` blocking + `Clear` | `DateRangePicker.tsx` (search bar's) | **never rendered on the listing page** |

So the price-refresh-on-change wiring and the availability truth already exist. The missing piece is a
governed picker on the listing page that writes `dateRange` and reads the already-computed blocked set.

## 2. Corrected flow

```
Search bar ──picks dates──▶ search draft (unchanged; still authoritative for the INITIAL context)
   ▼
Listing page
   ├─ seed dateRange from search draft (preserve) — unchanged
   ├─ render a governed DateRangePicker, fed the server-computed disabledDates
   ├─ user may: keep search dates · modify · clear
   ├─ on any change → setDateRange → (a) re-quote price, (b) re-validate against availability, (c) persist draft
   ├─ availability shown with a freshness indicator + refresh path (see §5)
   └─ "Continue" is enabled ONLY when a valid, available range is selected
   ▼
Booking review ── copy is consistent with capability; if it ever sends the user back, there is now a
                  real control to return to (see §8)
```

**Guiding principle (owner-stated):** the user must never be instructed to perform an action the
interface cannot perform. The review-page instruction and the listing-page capability are brought into
agreement — by adding the capability, and (§8) by making the copy conditional on it.

## 3. Search-to-listing handoff

| Concern | Design |
|---|---|
| Preserve search dates | Continue seeding `dateRange` from `loadSearchDatesDraft()` on mount (existing line 214). No change to the search module. |
| Modify on the listing page | The picker's `onChange` writes `dateRange` **and** updates the persisted booking draft, so a later return re-reads the user's real choice. |
| Clear dates | `DateRangePicker` already exposes a **Clear** control (`onChange({checkIn:'', checkOut:''})`, picker line 215). Cleared state shows the offer summary and disables Continue until re-selection. |
| Never silently ignore a change | Because the `stayQuote` effect already keys on `dateRange`, a changed selection *must* re-quote and re-validate; the UI must reflect the new range everywhere it shows dates (hero, price box, sticky bar). No path may display one range while pricing another. |

**Boundary:** search remains authoritative for the *initial* context; the listing page owns *subsequent*
modification. The two never disagree silently.

## 4. Listing date-selection UX

- **Entry point.** A date field/summary on the listing page (mirroring the search bar's `DateField`
  affordance) that opens the picker. When dates are pre-filled from search, it shows them; when cleared,
  it prompts selection.
- **The picker.** Reuse the existing `DateRangePicker` component. It already implements: two-month
  navigation, `disabledDates` blocking (lines 124–188), a blocked-range warning via `disabledHint`
  (line 173), Clear, and Done. Feeding it the `disabledDates` set already computed in `loadAvailability`
  is the core wiring.
- **Truthful blocked display.** Unavailable dates render visibly disabled and are unselectable; a range
  spanning a blocked date triggers the existing `blockedRangeWarning` + hint rather than silently
  truncating.
- **Selection → downstream.** On a valid range: price box shows the server `stayQuote`; nights count,
  sticky continue bar, and hero all reflect the same range; Continue enables.
- **Reuse over rebuild.** This is deliberately a *wiring* exercise, not a new component, which is what
  lowers the risk profile the finding flagged.

## 5. Availability-refresh strategy

**Current:** `loadAvailability()` fetches a 180-day window **once on mount** and never re-fetches; the
API response (`/api/listings/:id/availability`) returns `{ blockedDates, priceOverrides, bookedRanges,
offerNightsCount, cheapestOfferMinor }` with **no freshness timestamp**.

**Owner requirement:** never cache indefinitely; every displayed availability state must clearly indicate
freshness; never fabricate blocked dates.

**Design:**
1. **Add a server freshness field.** Extend the availability response with `generatedAt` (ISO8601). This
   is a small, additive API change (specified here, not implemented) so the client can show "availability
   as of HH:MM."
2. **Re-fetch triggers.** Re-fetch availability (a) when the picker is opened, and (b) before the user
   reaches Continue, so a stale mount-time snapshot cannot carry a since-booked date into checkout.
3. **Freshness indicator.** Display the `generatedAt` time near the picker; if older than a threshold
   (config, e.g. a few minutes) show a subtle "refreshing…" state on re-fetch.
4. **Authoritative-server boundary.** The client only ever *displays* the server's blocked set; it never
   infers, extrapolates, or fabricates blocked dates. The late-binding server overlap check
   (`bookings.mjs:553`) remains the final authority — the picker reduces late 409s but is not a
   substitute for the server guard (this is where **E2E-12**'s server-side validation belongs).

## 6. Pricing-refresh strategy

**Current:** the `stayQuote` effect (line 317–329) already re-quotes whenever `dateRange` changes, and
`displayedTotalMinor` (line 241) falls back to a nightly estimate only when no quote exists.

**Design:** this wiring is kept and is exactly what makes date-change consistent — no new pricing path is
needed. Requirements:
- On date change: clear the prior quote (`setStayQuote(null)`) and show a loading state until the new
  quote resolves, so a price for the *old* range is never shown against the *new* range.
- Never display a total that does not correspond to the currently selected range.
- The fallback nightly estimate is used only in the no-dates state and must be labelled as an estimate,
  not a booked total.

## 7. Accessibility considerations

Current `DateRangePicker` uses real `<button>` elements (keyboard-focusable, click/enter-activated) but
has **no calendar-grid semantics** — no `role="grid"`/`gridcell`, no `aria-label` on day cells, no arrow-
key navigation, no `aria-disabled` on blocked days.

**Design requirements for the listing-page integration:**
- Day cells expose an accessible name (full date) and `aria-disabled` / disabled state for blocked days.
- The picker is reachable and operable by keyboard; focus is trapped while open and returns to the
  trigger on close.
- Selection state and blocked-range warnings are announced (e.g. `aria-live` on the hint).
- Colour is never the sole signal for "blocked" — pair with a disabled affordance/pattern.
- RTL (AR) and LTR (EN) both correct: month navigation direction, day ordering, and the hint text.

These are enhancements to the shared component; because it is shared with the search bar, changes must be
verified in both surfaces.

## 8. Mobile considerations

- The picker must be usable at small widths: full-width or bottom-sheet presentation rather than a
  desktop popover; tap targets sized for touch; two-month scroll rather than side-by-side where width is
  constrained.
- The sticky price/continue bar must not obscure the picker; opening the picker should not cause layout
  jump that loses the user's place.
- Verify on the app's actual breakpoints; no horizontal page scroll introduced.

## 9. Stale-data handling

- **Mount snapshot is treated as potentially stale** — see §5 re-fetch triggers.
- If a re-fetch shows a previously-selected date is now blocked, the UI must surface this (invalidate the
  selection, show the hint) rather than proceed — the guest learns *before* checkout, not via a late 409.
- The freshness timestamp makes staleness visible rather than hidden.
- Availability is never persisted to `localStorage` as a long-lived cache; the offline-map cache is a
  separate concern and is not extended to availability.

## 10. Error handling

| Failure | Behaviour |
|---|---|
| Availability fetch fails | Do **not** fabricate an empty (all-available) set. Show an availability-unavailable state and disable Continue rather than let the guest select blindly. |
| Quote fetch fails | Show a price-unavailable state; do not display a stale or estimated total as if authoritative; block Continue. |
| Deep-linked / search-seeded dates are invalid or in the past | Validate on mount; if invalid, clear and prompt selection (ties to **E2E-12**, the server-side guard). |
| Selected range becomes blocked on re-fetch | Invalidate, warn, require reselection (see §9). |
| Non-APPROVED listing | Availability endpoint already refuses non-APPROVED listings (S8 IDOR guard, `listings.mjs:386`); the page must handle that response without fabricating availability. |

## 11. Source-of-truth boundaries

| Concern | Authority | Listing page may | Listing page must NOT |
|---|---|---|---|
| Initial dates | **Search** (search draft) | preserve, modify, clear | silently ignore a change |
| Availability | **Server** (`/availability`) | display, indicate freshness, re-fetch | infer, fabricate, or cache indefinitely |
| Price | **Server** (`stayQuote`) | display for the current range | show a price for a different range |
| Overlap enforcement | **Server** (`bookings.mjs:553`) | reduce late failures via the picker | treat the client picker as the guard |
| Review-page copy | **Interface capability** | — | instruct an action the UI cannot perform |

## 12. Relationship to other findings

- **E2E-12 (server accepts past/invalid dates)** is the server half; this design is the client half. The
  §5/§10 validation points are where E2E-12's server-side guard integrates. Recommended: scope both
  together so neither half ships alone.
- **A1-16 (fragile checkout draft, Medium)** is downstream; persisting the modified range to the booking
  draft (§3) is where it is addressed.
- **Frozen modules** (Ride/Québec) are untouched and out of scope.

## 13. Likely files to change (when implementation is later authorized)

**None edited now.** For visibility only:

| File | Anticipated change |
|---|---|
| `src/modules/listings/ListingDetailPage.tsx` | render the picker; wire `setDateRange`; consume existing `disabledDates`; re-fetch/freshness; date-change loading states |
| `src/modules/search/DateRangePicker.tsx` | a11y grid semantics, mobile presentation (shared component — verify in search too) |
| `src/modules/bookings/BookingReviewPage.tsx` | make the "choose dates" copy consistent with capability |
| `server/routes/listings.mjs` | additive `generatedAt` on the availability response; server-side date validation (with E2E-12) |
| API client (`fetchListingAvailability` / quote) | carry `generatedAt` through |

## 14. Open owner decisions before implementation

- Whether **E2E-12** (server-side date validation) is scoped into the same implementation *(recommended)*.
- Availability freshness threshold and re-fetch cadence (config values).
- Whether the date-selection entry is inline or a modal/bottom-sheet on mobile.
- Accessibility scope: minimum (operable + labelled) vs full grid semantics with arrow-key navigation.
- Fixed-date-listing alternative (from the decision package) is **not** assumed here — this design is the
  full governed-selection option the owner accepted.
