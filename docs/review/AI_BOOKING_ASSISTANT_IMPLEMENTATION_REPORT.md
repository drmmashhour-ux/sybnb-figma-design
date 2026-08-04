# AI Booking Assistant implementation report

Status: implemented for staging validation; disabled by default; not deployed.

## Completed

- Extended the existing assistant route and floating widget; no duplicate service was created.
- Added a server-enforced staging-only flag and server-only OpenAI Responses API integration.
- Added approved `searchListings`, `getListingDetails`, `checkAvailability`, `calculateBookingTotal`, `createBookingDraft`, `getBookingStatus`, and `createSupportHandoff` tools.
- Reused approved STAYS listing visibility, availability overlap rules, stay pricing, authentication, per-user rate limiting, Prisma access, and immutable admin audit records.
- Added English, French, and Arabic assistant copy, correct Arabic RTL, responsive layout, keyboard-operable controls, accessible dialog naming, live response announcements, property cards, selection and comparison up to three, and inert booking-draft confirmation.
- Kept reservation, payment, refund, cancellation, and message execution outside the tool allowlist. Existing application screens retain final confirmation authority.
- Added prompt redaction, bounded session-only history, no provider storage, provider timeout/retry, safe fallback responses, tool-round/result limits, and plain-text treatment of model output.
- Added a deterministic narrative boundary: sensitive listing and booking facts are summarized from approved tool records, while a tool-free model response that claims a price, availability, rating, fee, tax, policy, host fact, or completed consequential action is discarded in favor of a safe localized template.
- Added actor-bound, ten-minute, one-time confirmation proposals for booking drafts, messaging, cancellation, refund requests, date changes, guest-count changes, and payment-flow initiation. Exact payload and current fact hashes invalidate consent after any material change; atomic consumption blocks duplicates and replay.
- Added informed-confirmation summaries generated only from deterministic server facts. The guest sees the exact dates, guest count, verified total, and currency before accepting; a final result comparison fails closed on a last-moment price or material-data race.
- Kept all non-draft mutations in existing SYBNB flows. Confirmation returns only the appropriate existing navigation target and never sends a message, changes a booking, cancels, refunds, or charges directly.
- Added deterministic lifecycle audits for requests, fact retrieval, tool proposal, confirmation request/accept/reject, execution handoff, blocked attempts, and safe fallback without storing prompts, message bodies, refund reasons, secrets, or payment data.
- Extended the existing fail-closed maintenance cron to purge consumed or expired assistant confirmation rows after a bounded 24-hour default retention window; no new scheduler or transcript store was added.
- Added localized fail-safe handling for provider timeouts, rate limits, outages, malformed/unsafe output, and audit-write failures. Upstream error text is never returned or logged; only fixed failure categories are audited.
- Restricted human-support handoffs to six fixed server-approved reason codes. Free-form model text containing personal or payment data fails validation before database or audit access.
- Enforced least-privilege browser authentication: all guest-site assistant requests use only the isolated guest session, never a simultaneously stored admin, host, or seller token.
- Added client-side staging defense in depth: the widget requires both its enablement flag and an explicit `VITE_SYBNB_DEPLOY_ENV=staging` marker, while the existing server staging gate remains authoritative.

## Verification

- TypeScript and production build: passed.
- Production-style Vite build: passed.
- Prisma schema validation: passed.
- Full unit regression: 11 files, 110 tests passed, including server/client staging gates, malicious-model fabricated-price/availability, privacy-safe handoff validation, unapproved-tool denial during audit outages, provider-failure leakage prevention, last-moment material-change, and bounded-retention coverage.
- Current full API regression: 83 files, 512 tests passed in one clean isolated-database run after all assistant hardening checkpoints.
- Full security regression: 3 files, 19 tests passed.
- Final assistant database/API suite: 12 passed, covering authentication, request validation, localized provider failure, fixed-code support handoff, minimized audit events, cross-user and non-guest denial, server-verified confirmation, expiry, replay, forged payloads, material price changes, all consequential proposal types, lifecycle audit events, sensitive-log exclusion, retention cleanup, verified pricing, and independent request/action rate limits.
- Assistant browser coverage: 6 passed across Chromium and WebKit, covering RTL/French switching, 320px mobile fit, the separate propose/confirm draft flow, and proof that a coexisting privileged staff token is never sent to assistant endpoints.
- The least-privilege client delta passed TypeScript, the full production build (including public assets), and all 6 assistant browser checks.
- Current full browser regression: 42 passed, 2 expected WebKit keyboard skips, and 2 unrelated pre-existing landing-heading assertions failed because the current page heading changed from `منصة سوريا الكاملة` to `تشعر أنك في المكان الصحيح`. All 6 assistant browser checks passed across both engines.
- Current built-client scan found no `OPENAI_API_KEY`, placeholder/test provider secrets, privileged staff-token fixture, or payment-number fixture strings.

## Accessibility and mobile validation

The floating control has an accessible name and 48px target. The panel is a named dialog, language buttons expose pressed state, results are announced through a polite live region, form controls are labelled, and all actions use native buttons/links/inputs. Panel width and dynamic viewport height are bounded for 320px mobile screens. Automated browser checks cover RTL direction, French LTR switching, visibility, and horizontal fit. Manual screen-reader and real-device Safari/Android validation remain staging release gates.

## Remaining risks and blockers

- A live OpenAI staging credential and representative eval set are needed to measure tool-selection quality, latency, refusal quality, and cost; automated tests do not call an external provider.
- Stored listing metadata is not uniform. Missing amenities, rules, fees, taxes, policies, ratings, or images intentionally render as unavailable rather than being inferred.
- Booking drafts are deliberately inert because the current schema has no draft status. Final creation continues through the existing transactional booking route. Other confirmed actions currently open their existing product flow rather than completing the mutation inside the assistant.
- The global application language engine remains Arabic/English. French is scoped to the assistant milestone and does not translate unrelated SYBNB pages.
- Manual assistive-technology, small-device, slow-network, and staging abuse testing are still required before internal rollout.
- Production enablement, deployment, payment execution, automated messaging, cancellation, and refunds remain explicitly unauthorized.
