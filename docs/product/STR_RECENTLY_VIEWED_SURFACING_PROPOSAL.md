# Proposal — surface "Recently viewed" on the STR (stays) side

Status: **proposal only, not implemented.** The shared capsule
(`src/shared/recentlyViewed/`) already records STR stays views today; this
document proposes where and how to *display* them, mirroring the Synitres
landing strip. No code here — approve before implementing.

## Context (already shipped)

- `recordViewed(...)` already fires on the STR stays detail page
  (`src/modules/listings/ListingDetailPage.tsx`), so STAYS history is being
  captured now — it's simply not surfaced anywhere on the STR side yet.
- The Synitres landing renders `<RecentlyViewedStrip divisions={['BUY','RENTALS']} />`.
- The store is device-local, versioned, size-capped (15), and hardened
  (see `recentlyViewed.ts` retention-policy header + `test/unit/recently-viewed.test.ts`).

## 1. Where it would appear

Recommended surface: the **STR stays entry page** — `SearchPreviewPage`
(`/stays`, `src/modules/search/SearchPreviewPage.tsx`) — a "Recently viewed"
strip placed **below the search hero / above the results grid**, so a returning
guest sees it immediately but it never pushes live results off-screen.

Alternative surface: the main STR landing `LandingPage`
(`src/modules/landing/LandingPage.tsx`), below the hero. Pick one, not both, to
avoid the same strip appearing twice in one flow.

Placement rule: only one "Recently viewed" strip per screen, and never on a
detail page (the detail page already has its own "More stays nearby" strip).

## 2. STR vs Synitres histories — kept visually separate

They share **one** store but are shown through **division filters**, so each
surface only ever renders its own platform's history:

- Synitres landing: `divisions={['BUY','RENTALS']}` (already live).
- STR stays surface: `divisions={['STAYS']}` (proposed).

A guest who browsed both platforms sees only stays on the STR page and only
real-estate on the Synitres page — no cross-bleed, no mixed cards. This matches
the platform-isolation direction. (Covered by the "division isolation" unit test.)

## 3. Responsive behavior

`RecentlyViewedStrip` is already responsive and needs no change: a horizontal
flex row with `overflow-x: auto` and fixed 172px cards. On mobile it becomes a
swipeable rail; on desktop several cards sit inline. It inherits the host
page's width wrapper (as the Synitres landing does via its `recent` style), so
the STR surface would wrap it in a matching max-width/padding container.

## 4. Localization

- Heading is bilingual today: `شوهدت مؤخراً` / `Recently viewed`, chosen by
  `lang` (the app's `Lang` is `'ar' | 'en'` — there is no French UI locale).
- The section sets `dir` from `lang`, so the rail lays out correctly in RTL.
- Card titles come from the per-view snapshot (stored verbatim, Unicode-safe —
  Arabic/accented text round-trips; verified by a unit test), and prices render
  through `moneyText(priceMinor, currency, lang)`.

No new strings are required beyond what the component already ships.

## 5. Privacy and "clear recently viewed"

- The data is **device-local only** — no server, no account, no analytics, no
  cross-user assumptions (documented in the capsule's retention-policy header).
- `clearRecentlyViewed()` already exists in the capsule. The proposed UI change:
  add an optional small **"Clear" / "مسح"** text button beside the strip heading
  (a `showClear`/`onClear` prop on `RecentlyViewedStrip`) that calls
  `clearRecentlyViewed()` and hides the strip. Offering it on the STR surface
  (and optionally back-porting it to the Synitres strip) gives guests a one-tap
  way to wipe their local history. No confirmation modal needed — it's local and
  low-stakes, and re-viewing repopulates it.

## 6. Files that would change

- `src/modules/search/SearchPreviewPage.tsx` **(or)** `src/modules/landing/LandingPage.tsx`
  — import and render `<RecentlyViewedStrip lang={lang} divisions={['STAYS']} />`
  in a width-matched wrapper. (~5–10 lines, one surface.)
- `src/shared/recentlyViewed/RecentlyViewedStrip.tsx` — *optional*, only if we
  add the "Clear" affordance: a `showClear?: boolean` prop + a small button
  calling `clearRecentlyViewed()` and dropping local state to hide the strip.
- `test/unit/recently-viewed.test.ts` — already covers the data layer; if the
  "Clear" button is added, no new capsule test is needed (`clearRecentlyViewed`
  is already tested), but a light interaction test could be added if a React
  testing harness is introduced later.

No capsule data-model changes, no new files, no server work.

## Estimated size

Small: one surface edit for the display; a second small edit only if we include
the "Clear" control. No migrations, no schema change, no new dependencies.
