# STR Launch Roadmap — Version 1.1 (FROZEN) + Operating Policy

**Status:** Official, frozen roadmap for the Syria-first STR launch.
**Supersedes:** v1.0.
**Rule:** Priorities and business rules do not change without the owner's explicit approval.

This document is the single source of truth. Every future working session should start here rather than
reconstructing decisions from conversation history.

---

## PART A — STR Launch Operating Policy (governance)

This roadmap (v1.1) is frozen. Do not change priorities unless the owner explicitly approves.

From this point until launch:

1. Work on **one** roadmap item only.
2. Never expand scope.
3. Never mix bounded contexts: **STR · SIR · SYBNB Ride · Quebec Edition · BNHub · LECIPM**. STR only, unless told otherwise.
4. **Before every implementation:**
   - **A.** Read-only audit.
   - **B.** Root-cause analysis.
   - **C.** Explain why this item is still a blocker.
   - **D.** Confirm no dependency from another roadmap item blocks it.
5. **Then:**
   - Write failing tests first.
   - Smallest safe implementation.
   - Run: TypeScript → Unit → API → Security → Production build.
6. **Stop.**
7. Present the implementation report.
8. Wait for approval.
9. Only after approval: **local checkpoint commit**.
10. Never push.
11. Never merge.
12. Never deploy.

### Product rule
Never implement something simply because it is technically possible. Always ask:
**"Does this improve the Syria-first customer experience?"** If not, postpone it.

### Truthfulness
Never fabricate: data, users, statistics, screenshots, reviews, financial values, or trust signals.
If something is simulated, clearly label it.

### Architecture
- Prefer removing complexity over adding features.
- Prefer clarity over automation.
- Prefer trust over visual effects.
- Prefer launch readiness over feature count.

### Decision authority
Claude may recommend, analyze, and critique. Claude must never change roadmap priorities or business
rules without the owner's approval.

### Current objective
Complete this roadmap one item at a time until the Syria-first launch is ready.

---

## PART B — Roadmap v1.1

**Conventions**
- **Effort** (indicative, not a commitment): **S** ≤2 days · **M** 3–5 days · **L** 1–2 weeks · **XL** 2+ weeks.
- **Owner** = accountable role: **PO** Product Owner · **UX** UX/UI Lead · **FE** Frontend · **BE** Backend · **PAY** Payments · **LEGAL** Compliance/Legal · **L10n** Content/Localization · **QA** QA · **OPS** DevOps.
- IDs trace to the STR Product & UX Launch Review (C/H/M = Critical/High/Medium; S = Syria-readiness; B = Business; L = Low/backlog).

### Version history
- **v1.1** — C1 moved P0→P1 and rewritten (booking-first, no registration wall). C6 replaced/renamed (free listings; revenue on successful booking; no pre-publication charge). New backlog item L6 (optional premium plans). P0 set unchanged (8 items), re-sequenced.
- **v1.0** — Initial roadmap from the STR Product & UX Launch Review.

### Completion status
- **C2 — COMPLETE.** Checkpoint commit `507d237e87dfdb652a5a06dbcad800a03a020a07`
  (`fix(str-listings): upload real photos in stays room flow`).
  - Real STAYS path verified end-to-end against the running backend: Accommodation → Room-Type
    Listing → sequential `ListingMedia` upload (`POST /api/listings/:id/media`) → accommodation
    submission; real image bytes reached the backend; media owner-protected while draft and publicly
    served (200 image/png) after approval; cover selection verified via live data + tests.
  - **Honest verification limits (not resolved by C2):** Arabic RTL manually verified, **English LTR
    not switched live** (TEST-001); failed-upload retry automated-test verified, **not manually
    re-triggered after the corrected integration** (TEST-002); the real image **render was not
    visually confirmed in the split-origin dev environment** and is **not production-verified**
    (DX-001). See `docs/engineering/TECHNICAL_DEBT_REGISTER.md`.
  - Priorities/scope of all other roadmap items are unchanged; no technical debt was promoted to P0.

---

### P0 — Must be fixed before ANY public Syria launch
*Integrity, trust, and "the product visibly works and is honest." Implementation order is 1→8.*

| # | ID | Description | Business impact | Effort | Depends on | Owner | Recommendation |
|---|---|---|---|---|---|---|---|
| 1 | **C2** ✅ **COMPLETE** | Real property-photo upload (was a stub that marked slots "Added" with no file picker/bytes). | No photos = no bookings; a visual marketplace looks broken. | L | — | FE + BE | Real upload with preview, cover selection, count/size validation before publish. **Done — see Completion status below.** |
| 2 | **C3** | Photo gallery + amenities list on the listing detail (today: 1 image, no amenities shown). | The two questions every guest asks before booking are unanswerable. | M | C2 | FE + UX | Multi-image gallery + explicit amenities section. |
| 3 | **C5** | Remove fake "documents sent to admin" flag that feeds the trust score; stop showing "Verified host" without real ID processing. | Displaying verification that didn't happen is a trust/liability failure. | M | — | FE + BE | Real ID-upload step drives status; badge only when server-confirmed. |
| 4 | **H10** | Delete dead fabricated data still in the admin bundle (`recentAdminUsers`, `todayStatBars`, `activityItems`). | Any reappearance of fake figures destroys data-integrity credibility. | S | — | FE | Delete outright; add a guard against reintroduction. |
| 5 | **S2a** | Fix dishonest "view cached results" copy in the search error state (there is no cache). | Promising offline behavior that doesn't exist is an integrity gap. | S | — | L10n + FE | Correct the copy now (full offline layer is S2b, P2). |
| 6 | **S4** | Hide the phantom French toggle (~45 screens silently render English under FR). | Users can select a language that mostly doesn't exist — looks unfinished. | S | — | L10n + FE | Hide FR for the Syria launch; keep AR/EN. |
| 7 | **S5** | Gate out residual Canada/Quebec artifacts (live CITQ card, `fr-CA` locale, Quebec tax scaffolding) from the Syria experience. | Signals "repurposed Canada product," undermining a Syria-first pitch. | M | — | PO + FE | Feature-gate Quebec surfaces off the Syria market. |
| 8 | **S1** | SYP-first pricing credibility: stays browse/quote in USD only at a hardcoded stale `15000` rate, no SYP toggle. | First impression in a SYP-thinking market reads as foreign and untrustworthy. | M | — | PO + FE | Add a SYP browse toggle and a rate-freshness indicator; decide the FX-source policy. |

### P1 — Must be fixed before accepting REAL bookings
*Booking correctness, money-movement realness, operator safety, host supply.*

| ID | Description | Business impact | Effort | Depends on | Owner | Recommendation |
|---|---|---|---|---|---|---|
| **C1** *(rewritten, moved from P0)* | **Frictionless booking-first flow with in-checkout email verification and post-confirmation account creation.** No account required to *begin* booking. Flow: Search → Choose property → Select dates → Continue → Enter email → **Verify via Resend** → Payment → Confirmation → **auto-create guest account from the verified email** → **My Trips**. Verification is wired into checkout, not a registration gate. | Removes the registration barrier (higher conversion) while still capturing a verified email (trust + account). Gives the hardened Resend verification its live entry point. | M | C4 (enables H1) | PO + FE + BE | Verify email inline during checkout; auto-provision the account on confirmation (magic-link/set-password on first return); surface My Trips. Objective: low friction, high trust, no unnecessary registration barriers. |
| **C4** | Date selection on the listing page (availability is fetched but never rendered/enforced; deep-linked guests stuck on default dates). | Wrong-date bookings → cancellations/disputes/refunds. | M | — | FE | Availability-aware date picker before "Continue to review." |
| **C6** *(replaced/renamed: "Free listing publication; revenue on successful booking")* | **Remove the mandatory pre-publication plan-payment gate.** New model: Host creates listing → Admin reviews → **published free of charge** → platform earns revenue **only after a successful booking** (existing 13% commission) → premium plans optional, later (L6). | Removes a host-activation barrier and a fake/blocking payment step; aligns revenue with successful outcomes; grows supply. | S | — | PO + FE (BE confirm commission capture) | Delete the pre-publish payment gate; publish free after admin approval; rely on the existing post-booking commission. **No pre-publication charge.** |
| **C7** | Confirmation step before every destructive/financial admin action (approve/reject, release/hold payout, refund — single-click, no undo today). | One mis-click moves real money or wrongly moderates a listing. | S | — | FE + UX | Confirm dialog showing key figures for each irreversible action. |
| **C8** | Move Sham Cash reconciliation server-side (today admin-typed, stored in `localStorage`, no cross-device sync, no feed). | Manual device-local matching breaks with multiple operators/volume. | L | — | BE + PAY | Server-side reconciliation state; pursue a real Sham Cash feed (tracked backend gap). |
| **H3** | Host payout-method / Sham Cash setup (hosts see money owed but can't configure payout). | "I can see it but can't get paid" kills host trust at the key moment. | M | — | FE + PAY | Payout-method setup + hold-window explanation. |
| **H4** | Reconcile the two divergent host-onboarding doors (`/sell/account` vs `/host`) into one path (free-publish under the C6 model). | Onboarding confusion suppresses host supply. | M | C6 | PO + FE | One canonical host-onboarding flow. |
| **H5** | Allow limited pre-booking guest→host/support messaging (in-app messaging is locked until confirmed+paid). | Blocks pre-payment questions a low-trust market needs, suppressing bookings. | M | — | PO + FE | A gated pre-booking inquiry channel. |
| **H6** | Make search empty/error actions functional (Reset = Show-all = Retry today) and pass guest count into filtering. | Non-functional buttons erode trust; ignored guest count returns wrong results. | S | — | FE | Wire each action; include occupancy in the query. |
| **H7** | Server-validated staff sessions with expiry; ensure demo/test OTP codes can never render in production. | Weak session posture on a money-moving admin console. | M | — | BE + FE | Enforce server-side session validity; prod-gate demo code display. |
| **H8** | Give admins decision context on reports/disputes (link to content, amount paid, max refundable, evidence). | Operators currently decide refunds/moderation effectively blind. | M | — | FE + BE | Surface underlying content and financial context in-row. |
| **H9** | Basic user management (directory, search, status, suspend/ban). | Can't handle abuse or account issues under real users. | L | — | BE + FE | Minimal operable user directory for launch. |
| **M1** | One clear booking-confirmation state (today split across wallet banner, timeline, receipt). | "Is my booking confirmed?" ambiguity → support load, lost confidence. | S | — | UX + FE | Single canonical confirmation surface/state. |
| **M6** | Prominently disclose that refunds credit the SYBNB wallet, not the original method. | Silent wallet-only refunds read as a trap in a cash market. | S | — | L10n + LEGAL | Clear disclosure at booking and cancellation. |
| **S3** | Responsive/real photos everywhere: real images for CARS/NEW-CONSTRUCTION/MARKETPLACE (stock art today), consistent lazy-load, `srcSet`/dimensions. | Heavy, inconsistent images hurt a mobile-first slow-internet market; buyers never see the real item. | M | C2 | FE | Real images + responsive delivery across divisions. |
| **B1** | Add registered company legal name/address to legal pages (only "SYBNB" appears today). | Money-handling platform lacks a verifiable legal identity — credibility/compliance gap. | S | LEGAL input | LEGAL + L10n | Insert real legal entity details. |

### P2 — Can be fixed during Beta
*Retention, host reputation, richer operations, mobile polish.*

| ID | Description | Business impact | Effort | Depends on | Owner | Recommendation |
|---|---|---|---|---|---|---|
| **H1** | Guest "My Trips / My Bookings" list. | Retention & self-service. | M | C1 | FE | Authenticated trips list once accounts are wired. |
| **H2** | Host reviews inbox: rating summary + ability to respond. | Reputation/quality loop; host trust. | M | — | FE + BE | Host-side ratings view and response affordance. |
| **M2** | Align the cancellation screen (light theme) with the app's dark theme. | Jarring inconsistency at a high-anxiety moment. | S | — | UX + FE | Theme the cancellation flow to match. |
| **M3** | Occupancy + special-requests inputs on the booking review step. | Guest expectations and host prep. | S | — | FE | Add guest count + notes to review. |
| **M4** | Show date/guest/night context on host reservation cards. | Host confirms with more than name+status+price. | S | — | FE | Enrich the reservation card. |
| **M5** | Inline smart-pricing hint at setup (AI insight is post-publish only). | Better first-listing pricing. | M | — | FE + BE | Surface a pricing suggestion in the wizard. |
| **M8** | Remove the duplicated amenities panel in the wizard; add a search bar to the landing page. | Fewer clicks, less redundancy. | S | — | UX + FE | De-dup + landing search entry. |
| **S2b** | Full offline/PWA layer (service worker + basic cache) for intermittent connectivity. | Repeat visits re-download; poor experience on Syrian networks. | L | — | FE + OPS | Add a PWA/caching layer. |
| **S6** | iOS `safe-area-inset` handling + favicon/PWA manifest/app icon. | Notch overlap on native; unset install/app-icon branding. | M | live-device pass | FE + UX | Requires on-device verification to finalize. |

### P3 — Post-launch improvements
*Nice-to-have polish; no launch dependency.*

| ID | Description | Business impact | Effort | Depends on | Owner | Recommendation |
|---|---|---|---|---|---|---|
| **L1** | "Become a host" social proof / testimonials / earnings estimator. | Higher host-signup conversion. | M | — | PO + UX | Add after core host flow is real. |
| **L2** | Messaging polish: unread badges, timestamps, search, notifications. | Communication quality. | M | — | FE | Iterative enhancements. |
| **L3** | Calendar bulk multi-select + multi-month view + min-night rules. | Host efficiency. | M | — | FE | Post-launch calendar upgrade. |
| **L4** | Show rating/review count on search result cards. | Guest scanning confidence. | S | H2 | FE | Add once reviews mature. |
| **L5** | Interaction/asset polish: prev/next arrow pattern, SVG logos, `decoding=async`/blur-up. | Perceived quality on hi-DPI/slow links. | S | — | UX + FE | Batch visual polish. |
| **B2** | Add a `tel:` phone-call support channel. | Some users prefer calling. | S | — | PO | Optional, market-dependent. |
| **L6** *(new in v1.1)* | Optional **premium listing plans** (host upsell). | Incremental host revenue after the free-listing base is proven. | M | C6 model live | PO + FE + PAY | Post-launch only; an optional upgrade, never a publish gate. |

---

## PART C — Cross-cutting notes

- **Foundational unlocks:** C2 → C3/S3 (photos gate the visual purchase); C1 → H1 (accounts gate trips). Do C2 first.
- **Integrity cluster (cheap, do early):** H10, S2a, S4 — all S-effort credibility wins.
- **Booking-flow unlock:** C1 (P1) depends on C4 and unlocks H1; the hardened Resend verification is consumed at checkout, not a registration wall.
- **Money-realness gate (v1.1):** C8 (server-side Sham Cash reconciliation) + H3 (host payout method) must be reliable before real bookings. **Hosts are not charged** — the pre-publication payment gate is removed (C6); guest-side payment uses the existing Stripe/Sham Cash paths plus C8.
- **External dependencies (start now, non-code):** LEGAL entity details (B1); FX-source decision (S1); operational Resend/DNS — `RESEND_API_KEY`, `EMAIL_FROM`, verified `sybnb.app` domain, SPF/DKIM/DMARC (owned by PO/LEGAL/OPS). No PAY-infrastructure prerequisite for host publishing.
- **Requires live device/browser pass to finalize:** S6 and the visual-craft layer (spacing, contrast, font rendering, tap ergonomics) that a code-grounded review cannot rate.

---

## PART D — Prior committed work (context)

The Resend email-verification hardening is already committed locally on branch
`claude/intelligent-kilby-5ff258` (`fix(str-auth): harden Resend email verification`) and documented in
`docs/architecture/STR_EMAIL_VERIFICATION.md`. It provides the verification mechanism that C1 (P1) wires
into the checkout flow.
