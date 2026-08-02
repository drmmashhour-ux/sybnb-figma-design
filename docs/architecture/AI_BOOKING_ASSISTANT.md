# AI Booking Assistant architecture and threat model

Status: staging-only, disabled by default. Production enablement and deployment are not authorized.

## Architecture

The existing `POST /api/assistant/ask` route and `AssistantWidget` remain the only assistant entry points. The authenticated route orchestrates the OpenAI Responses API on the server and exposes only named application tools. Tools call Prisma through the existing database package and reuse current listing visibility, availability, pricing, booking, authentication, rate-limit, and audit conventions. The browser receives typed display records, never provider credentials or raw model tool arguments.

The guest-site widget always authenticates assistant search and action requests with the isolated guest session. A simultaneously stored host, seller, or administrator credential is never selected for assistant traffic; the server independently enforces guest authorization for consequential proposals.

Conversation history is session-memory only in the widget and is bounded before submission. The server stores no transcript. Audit events contain actor, action, entity identifiers, tool names, and outcome categories; they exclude prompts, responses, email, phone, payment data, message bodies, and provider credentials.

Consequential actions use the existing assistant route namespace with a two-step server protocol: propose, then confirm. A proposal is bound to the authenticated actor, approved action, normalized payload hash, current server-fact hash, entity, and a ten-minute expiry. The proposal response includes a deterministic, non-sensitive summary of the exact dates, guests, verified total, availability, or current booking state being confirmed. Confirmation atomically consumes the proposal, recalculates facts, and fails closed on expiry, replay, actor mismatch, payload changes, or changed availability/pricing/booking state. A final draft-result comparison also blocks a change occurring after the recheck but before draft preparation. Raw messages and refund reasons are never stored. Booking drafts remain inert. Messaging, cancellation, refund, booking changes, and payment are handed to existing product flows after confirmation; the assistant does not duplicate or execute those mutations.

## Trust boundaries and threats

| Threat | Control |
| --- | --- |
| Prompt injection or arbitrary SQL/URL execution | Fixed system policy, fixed function allowlist, strict schemas, server validators, no SQL or URL tool |
| Fabricated listing facts or totals | Client cards and sensitive narrative summaries are built deterministically from tool results; tool-free model claims about prices, availability, ratings, fees, taxes, policies, hosts, or completed actions fail to a safe template; unknown stored fields are omitted; totals use the existing pricing engine |
| Cross-user access/IDOR | Authentication is mandatory; booking status is scoped to `guestId`; unpublished listings are never returned; no host private fields are selected |
| Privileged browser credential leakage | Widget uses only the guest session even when staff/seller sessions coexist; consequential routes independently require the `GUEST` role |
| Consequential action without consent or replay | Actor-bound, expiring, one-time confirmation records; exact payload and fact hashes; atomic claim; existing mutation flows remain authoritative |
| Secret or personal-data exposure | `OPENAI_API_KEY` is server-only; prompts contain pseudonymous actor role and bounded criteria; prompt/log redaction removes common email, phone, bearer-token, and card patterns |
| Cost/abuse amplification | Existing per-user `ASSISTANT_ASK` limiter, bounded history/tool rounds/results, provider timeout, one retry for transient failures, request/body limits |
| Provider timeout/outage or malformed response | Localized deterministic fallback, fixed-category audit event, no upstream error disclosure; already retrieved tool facts may be returned deterministically; audit-write failure cannot break the fallback |
| Feature accidentally enabled in production | Server requires `AI_BOOKING_ASSISTANT_ENABLED=1` plus `SYBNB_DEPLOY_ENV=staging`; widget independently requires its enablement flag plus `VITE_SYBNB_DEPLOY_ENV=staging`; server startup fails for any non-staging enablement |
| Model output rendered as code/markup | Output is treated as untrusted plain text; structured UI uses server-owned tool records and React escaping |
| Stale or changed material facts | Confirmation rechecks and hashes availability, dates, guests, pricing breakdown, fees, currency, status, and update time; mismatches invalidate consent |

## Data minimization

Only the last bounded session messages, locale, role, and non-sensitive search criteria are sent to the model. Listing tool results contain public listing fields. Host IDs, guest IDs, emails, phones, payment proof data, internal notes, and cross-tenant records are excluded.

Confirmation rows store identifiers and SHA-256 hashes, not action payloads. Audit events use fixed action/result categories and identifiers; they do not store raw prompts, responses, message bodies, refund reasons, secrets, or payment data.

Human-support handoffs accept only fixed reason codes (`MISSING_LISTING_DATA`, `CONFLICTING_DATA`, `SENSITIVE_REQUEST`, `OUTSIDE_PERMISSION`, `HUMAN_REQUESTED`, or `SAFETY_CONCERN`). Free-form model or user text is rejected before audit persistence.

The existing authenticated maintenance cron deletes consumed or expired confirmation rows after 24 hours by default (`ASSISTANT_CONFIRMATION_RETENTION_HOURS`, bounded to 1–720). Pending, unexpired confirmations are retained only while operationally usable. Audit events follow the platform's separate audit-log retention policy.
