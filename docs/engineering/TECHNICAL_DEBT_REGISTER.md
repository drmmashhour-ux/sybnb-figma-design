# STR Technical Debt Register

Tracks known debt and deferred items surfaced during STR launch work. Entries here are **not** silent
P0 promotions — they are recorded so they are not forgotten, and are only escalated by explicit owner
decision. Source of truth for priorities remains `docs/product/STR_LAUNCH_ROADMAP_v1.1.md`.

Fields: ID · Area · Description · Evidence/source · Priority · Launch blocking? · Related roadmap item ·
Proposed resolution · Status.

---

## DX-001 — Split-origin local media rendering
- **Area:** Local development (DX)
- **Description:** During split-origin local development (frontend on Vite :5173, API on :3051), a
  listing's relative `/api/.../media/file/...` image URL resolves against the Vite origin, which
  returns the SPA `index.html` (HTTP 200, `text/html`) instead of the image bytes. The listing hero's
  `onError` handler then swaps to the division stock image, so real covers do not render in dev.
- **Evidence/source:** C2 manual browser verification — confirmed Vite served the media URL as
  `text/html`; `selectCoverUrl` and the API were verified correct (real bytes served 200 image/png
  from the API origin).
- **Priority:** Low
- **Launch blocking?** No — a local-dev artifact. In production the frontend and API are same-origin
  (`VITE_API_BASE_URL` empty), so `/api/...` resolves and the real cover loads. **Production rendering
  was not visually verified.**
- **Related roadmap item:** C2 (verification), adjacent to S3 (responsive/real images)
- **Proposed resolution:** Add a Vite dev proxy for `/api` (or a configurable API/media origin) so
  split-origin dev renders real media; separate local-dev-config task.
- **Status:** Open (deferred — do not fix now)

## TEST-001 — English LTR manual verification (C2 uploader)
- **Area:** QA / verification
- **Description:** The C2 photo-upload flow was verified live in Arabic (RTL). The full English (LTR)
  browser walkthrough was not manually completed.
- **Evidence/source:** C2 implementation + browser-verification reports; EN copy-key parity and the
  component's `dir` binding are unit-tested.
- **Priority:** Low
- **Launch blocking?** No
- **Related roadmap item:** C2
- **Proposed resolution:** Manual EN walkthrough of the photo-upload flow (picker/preview/remove/cover
  + submit) at the next browser-verification pass.
- **Status:** Open (do not reopen C2)

## TEST-002 — Live failed-upload retry verification (C2)
- **Area:** QA / verification
- **Description:** Failed-upload retry (stop-on-failure, retry-only-failed, batch preserved) is
  automated-test verified but was not manually re-triggered in the browser after the final STAYS
  (accommodation/room-type) integration.
- **Evidence/source:** C2 unit tests (`uploadPhotosSequentially`); C2 browser-verification report.
- **Priority:** Low
- **Launch blocking?** No
- **Related roadmap item:** C2
- **Proposed resolution:** Manual failure-injection (e.g., temporarily fail one `/media` call) + retry
  walkthrough at the next browser-verification pass.
- **Status:** Open

## PROD-001 — Seller-document submission guard
- **Area:** Product / listing wizard (host onboarding)
- **Description:** A pre-existing (pre-C2) guard blocks STAYS submission until "seller documents /
  ownership proof" are provided. That mechanism captures file **names** only (the deferred, simulated
  upload), not real document bytes.
- **Evidence/source:** Encountered while driving the C2 browser verification (submit blocked with
  "ارفع مستندات البائع أو إثبات الملكية…").
- **Priority:** Medium (product decision)
- **Launch blocking?** To be decided (part of host-onboarding trust completeness; overlaps C5 themes).
- **Related roadmap item:** Not a current roadmap ID (host onboarding / C5-adjacent)
- **Proposed resolution:** Decide real vs. simulated document handling; if real, reuse the C2 uploader
  pattern; add as a roadmap item if it must ship for launch.
- **Status:** Open (untracked in roadmap — do not modify now)

## PROD-002 — Amenity offer-proof fake slots
- **Area:** Product / listing wizard
- **Description:** Guest "offer-proof" photos (e.g., Wi-Fi, kitchen) use a placeholder slot mechanism
  that marks a slot "Added" without uploading real bytes — the same class of simulated flow C2 was
  explicitly scoped to exclude.
- **Evidence/source:** C2 browser testing; STR Product & UX Launch Review (Phase 1, host journey).
- **Priority:** Medium
- **Launch blocking?** No (explicitly deferred out of C2 scope)
- **Related roadmap item:** C2 deferred list / future
- **Proposed resolution:** Either wire real offer-proof photo upload (reuse the C2 uploader) or remove
  the offer-proof requirement; propose as a future roadmap item.
- **Status:** Open (do not modify now)

## PROD-003 — Shared accommodation-level gallery
- **Area:** Product / STR data model
- **Description:** C2 intentionally stores photos **per Room-Type Listing** (each manages its own
  `ListingMedia`; no shared galleries, no cross-room synchronization). An accommodation-wide shared
  photo gallery is future scope.
- **Evidence/source:** C2 multi-room integration decision (owner-approved).
- **Priority:** Low
- **Launch blocking?** No
- **Related roadmap item:** Future (post-C3)
- **Proposed resolution:** If desired, introduce shared accommodation photos as a new roadmap item
  after C3 — not a change to C2's per-room model.
- **Status:** Open (future scope — do not implement now)
