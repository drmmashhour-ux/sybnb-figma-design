# AI Booking Assistant architecture and threat model

Status: staging-only, disabled by default. Production enablement and deployment are not authorized.

## Architecture

The existing `POST /api/assistant/ask` route and `AssistantWidget` remain the only assistant entry points. The authenticated route orchestrates the OpenAI Responses API on the server and exposes only named application tools. Tools call Prisma through the existing database package and reuse current listing visibility, availability, pricing, booking, authentication, rate-limit, and audit conventions. The browser receives typed display records, never provider credentials or raw model tool arguments.

Conversation history is session-memory only in the widget and is bounded before submission. The server stores no transcript. Audit events contain actor, action, entity identifiers, tool names, and outcome categories; they exclude prompts, responses, email, phone, payment data, message bodies, and provider credentials.

Booking drafts are inert, short-lived prepared summaries. They do not reserve inventory or move money. Reservation, payment, cancellation, refund, and message execution are outside the assistant tool allowlist. The user must continue through the existing product flow and explicitly confirm there.

## Trust boundaries and threats

| Threat | Control |
| --- | --- |
| Prompt injection or arbitrary SQL/URL execution | Fixed system policy, fixed function allowlist, strict schemas, server validators, no SQL or URL tool |
| Fabricated listing facts or totals | Client cards and consequential summaries are built only from tool results; unknown stored fields are omitted; totals use the existing pricing engine |
| Cross-user access/IDOR | Authentication is mandatory; booking status is scoped to `guestId`; unpublished listings are never returned; no host private fields are selected |
| Consequential action without consent | No payment/refund/cancel/message execution tools; draft creation is inert and requires explicit confirmation in existing flows |
| Secret or personal-data exposure | `OPENAI_API_KEY` is server-only; prompts contain pseudonymous actor role and bounded criteria; prompt/log redaction removes common email, phone, bearer-token, and card patterns |
| Cost/abuse amplification | Existing per-user `ASSISTANT_ASK` limiter, bounded history/tool rounds/results, provider timeout, one retry for transient failures, request/body limits |
| Feature accidentally enabled in production | Server requires both `AI_BOOKING_ASSISTANT_ENABLED=1` and `SYBNB_DEPLOY_ENV=staging`; startup fails for any other enabled environment |
| Model output rendered as code/markup | Output is treated as untrusted plain text; structured UI uses server-owned tool records and React escaping |
| Stale availability | Every draft recalculates availability and price; final booking remains subject to the existing transactional overlap checks |

## Data minimization

Only the last bounded session messages, locale, role, and non-sensitive search criteria are sent to the model. Listing tool results contain public listing fields. Host IDs, guest IDs, emails, phones, payment proof data, internal notes, and cross-tenant records are excluded.
