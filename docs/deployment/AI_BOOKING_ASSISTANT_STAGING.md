# AI Booking Assistant staging deployment and rollback

Production deployment and public enablement are not authorized by this document.

## Staging enablement

Configure the existing SYBNB staging project only:

```text
SYBNB_DEPLOY_ENV=staging
AI_BOOKING_ASSISTANT_ENABLED=1
VITE_AI_BOOKING_ASSISTANT_ENABLED=1
OPENAI_API_KEY=<server-side secret>
OPENAI_MODEL=gpt-5.6-luna
RATE_LIMIT_ASSISTANT_ASK_MAX=20
RATE_LIMIT_ASSISTANT_ASK_WINDOW_MS=60000
RATE_LIMIT_ASSISTANT_ACTION_MAX=20
RATE_LIMIT_ASSISTANT_ACTION_WINDOW_MS=60000
```

Keep `OPENAI_API_KEY` out of all `VITE_*` variables. Preserve the existing required `RATE_LIMIT_STORE=db` setting for multi-instance staging. Before starting the staging application, apply `20260802120000_add_assistant_confirmations` with the existing migration deployment command. Run the repository validation and isolated browser suite, deploy to the existing staging target, and verify the server health endpoint before a limited internal test.

## Production guard

Production must keep both assistant flags at `0` or unset. The server throws during startup if `AI_BOOKING_ASSISTANT_ENABLED=1` while `SYBNB_DEPLOY_ENV` is anything other than `staging`. The browser flag alone cannot enable the server route.

## Rollback

Fast rollback requires no code or data operation:

1. Set `AI_BOOKING_ASSISTANT_ENABLED=0` and `VITE_AI_BOOKING_ASSISTANT_ENABLED=0` in staging.
2. Redeploy the existing staging build so the floating control disappears.
3. Confirm `POST /api/assistant/ask` returns `ASSISTANT_UNAVAILABLE`.
4. If code rollback is required, revert the assistant commits in reverse order. Do not delete audit records.

The confirmation table contains no transcripts or raw action payloads. Inert drafts never reserve inventory. Keep confirmation and audit rows during a normal rollback; disabling both flags immediately closes the endpoints and UI. A database rollback is not required, and the additive table may remain for forensic/audit continuity.
