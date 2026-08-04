# AI Booking Assistant requirements traceability

Status: implementation complete for staging review; disabled by default; not deployed or authorized for production.

## Guest capabilities

| Requirement | Status | Implementation and evidence |
| --- | --- | --- |
| Floating desktop/mobile entry | Complete | Existing `src/shared/ai/AssistantWidget.tsx`; responsive and 320px browser coverage in `test/browser/smoke.spec.ts` |
| English, French, Arabic, RTL | Complete | Localized widget/server responses; Arabic `dir=rtl`; Chromium and WebKit language-direction tests |
| Collect destination, dates, guests, budget, property type, amenities | Complete | Fixed orchestration policy and validated `searchListings` arguments in `server/lib/assistant-tools.mjs` |
| Search only approved internal data | Complete | Fixed tool allowlist; approved STAYS query; no SQL or URL tool |
| Real property cards | Complete | Deterministic cards contain stored listing ID/title, verified price basis, checked availability, location summary, rating, image, and internal link |
| Explain amenities, rules, cancellation, fees, taxes from stored data only | Complete | `getListingDetails`; missing values return unavailable rather than inference |
| Compare up to three | Complete | Widget selection cap of three; server-grounded detail retrieval and deterministic summaries |
| Prepare booking draft with confirmation | Complete | Inert draft through actor-bound, expiring, one-time confirmation; no inventory or payment mutation |
| Human escalation | Complete | `createSupportHandoff` accepts only six fixed privacy-safe reason codes |
| Session context | Complete | Widget keeps bounded in-memory history; server redacts and caps the last 12 messages; no transcript table |

## Consequential-action controls

All actions use server-issued proposals bound to the actor, normalized payload hash, current fact hash, entity, and expiry. Acceptance is single-use and atomic. Material changes invalidate consent.

| Action | Confirmation coverage | Execution boundary |
| --- | --- | --- |
| Create booking draft | Implemented and browser/API tested | Creates only an inert summary; existing booking review remains authoritative |
| Send guest/host message | Implemented and API tested | Opens the existing authorized messaging flow; assistant does not send directly |
| Cancel booking | Implemented and API tested | Opens the existing booking flow; assistant does not cancel directly |
| Request refund | Implemented and API tested | Opens the existing support flow; assistant does not refund directly |
| Change dates | Implemented and API tested | Opens the existing booking flow; assistant does not mutate dates directly |
| Change guest count | Implemented and API tested | Opens the existing booking flow; assistant does not mutate guests directly |
| Initiate payment flow | Implemented and API tested | Opens the existing payment flow; no payment execution exists in this milestone |

Expiry, replay, duplicate acceptance, forged payload, cross-user access, non-guest access, changed price, changed dates/guests, availability/fact changes, and final draft-result races fail closed in `test/api/assistant-booking.test.mjs` and `test/unit/assistant-safety.test.mjs`.

## Safety and operations

| Control | Status and evidence |
| --- | --- |
| Server-only OpenAI key | Complete; server fetch only, `store:false`; built-client secret scan clean |
| Tool validation | Exact field allowlists, enums, UUID/date/integer bounds, approved listing visibility |
| Authentication/authorization | Required server auth; guest-scoped booking access; client always uses isolated guest credential |
| Cross-tenant denial | Booking queries include the authenticated guest ID; API denial tests pass |
| Rate limiting/abuse | Independent per-user ask/action limits using existing shared DB limiter; tests pass |
| Timeouts/retries | 12-second provider timeout and one transient retry; localized safe fallback afterward |
| Model output trust | Sensitive facts rendered from deterministic tool records; fabricated claims fall back safely |
| Logging/audit | Fixed lifecycle events; prompts, responses, free-form handoff text, payment data, and full PII excluded |
| Data minimization | Bounded session-only history; hashed confirmation payload/facts; expired/consumed confirmations purged by existing cron |
| Feature flags | Server and widget independently require explicit staging environment plus enablement flags |
| Deployment/rollback | `docs/deployment/AI_BOOKING_ASSISTANT_STAGING.md`; no deployment performed |

## Current verification

- Production build and TypeScript: passed.
- Prisma validation/generation: passed.
- Unit: 11 files, 110 tests passed.
- API: 83 files, 512 tests passed.
- Security: 3 files, 19 tests passed.
- Assistant browser: 6 passed across Chromium and WebKit.
- Full browser: 42 passed, 2 expected WebKit keyboard skips, 2 unrelated stale landing-heading assertions failed.
- Built-client sensitive-string scan: passed.

## Required staging/manual gates

- Apply the additive confirmation migration to staging through the existing migration workflow.
- Configure a staging-only OpenAI credential and run representative multilingual tool-selection, refusal, latency, and cost evaluations.
- Perform screen-reader, physical iOS/Android, slow-network, and abuse testing in staging.
- Review incomplete listing metadata; missing facts intentionally remain unavailable.
- Obtain explicit approval before any staging deployment, public enablement, production deployment, or production flag change.
