# SYBNB V6 — Rate Limit Policy

Date: 2026-07-10. Describes the abuse-protection limiter added under security audit finding F-08
(`docs/security/SYBNB_V6_THREAT_MODEL.md`). Implementation: `server/lib/rate-limit.mjs`, wired into
`server/index.mjs`.

## How it works

An in-memory sliding-window counter keyed by `{ruleName}:{bucketKey}`. Each rule in
`server/index.mjs`'s `RATE_LIMIT_RULES` table matches an HTTP method + path pattern and carries its
own `max` / `windowMs`. On a match, the request either proceeds (and the bucket's count increments)
or receives `429` with a `Retry-After` header and body `{ ok: false, error: { code: 'RATE_LIMITED', message } }`.

**Single-instance only.** Buckets live in this process's memory — running more than one API
process/container behind a load balancer gives each instance its own independent limit, so the
*effective* limit for a client becomes `max × instance count`. A production deployment with more
than one instance needs a shared store (Redis or equivalent) instead of this module. The policy
below (which endpoints, what limits) carries over unchanged to that future implementation.

**Client identification.** Rules marked `byUser` key on the authenticated caller's user id (a
shared office/NAT IP shouldn't throttle every user behind it). Unauthenticated rules key on client
IP. IP is read from the raw socket by default; `TRUST_PROXY=1` opts into trusting
`X-Forwarded-For` instead — only enable this when a real reverse proxy sits in front of the API,
since otherwise a client could set that header themselves to reset their own limit.

## Current rules

| Rule | Method + path | Max | Window | Keyed by |
|---|---|---|---|---|
| `AUTH_LOGIN` | `POST /api/auth/login` | 10 | 5 min | IP |
| `AUTH_REGISTER` | `POST /api/auth/register` | 5 | 15 min | IP |
| `PUBLIC_SEARCH` | `GET /api/listings` | 60 | 1 min | IP |
| `MESSAGING` | `POST /api/{listings,bookings}/:id/thread/messages` | 20 | 1 min | User |
| `BOOKING_CREATE` | `POST /api/bookings` | 10 | 1 min | User |
| `PAYMENT_PROOF` | `POST /api/payments/{seller-plan-proof,local-wallet-proof}` | 10 | 1 min | User |
| `ADMIN_DECISION` | `PATCH /api/admin/review-queue/:type/:id` | 60 | 1 min | User |
| `DOCUMENT_ACCESS` | `GET /api/{admin/id-document,me/id-document}/:id(/file)` | 30 | 1 min | User |
| `GEOCODING` | `POST /api/sr/{quote,rides}` | 20 | 1 min | User |
| `DRIVER_STATUS` | `PATCH /api/{driver/rides/:id/status,sr/rides/:id/claim}` | 30 | 1 min | User |

These are conservative starting points based on plausible legitimate usage patterns, not numbers
derived from production traffic data (none exists yet for this prototype) — expect to retune after
real usage is observed.

## Overriding without a code change

Every rule's `max` and `windowMs` can be overridden per-deployment via environment variables:
`RATE_LIMIT_<NAME>_MAX` and `RATE_LIMIT_<NAME>_WINDOW_MS` (e.g. `RATE_LIMIT_AUTH_LOGIN_MAX=20`).
`DISABLE_RATE_LIMIT=1` turns off all rate limiting entirely — `validateProductionConfig()`
(`server/lib/env.mjs`) refuses to start with `NODE_ENV=production` if this is set, so it can only
be used in development/testing.

## Testing

`test/unit/rate-limit.test.mjs` exercises the limiter algorithm directly (enforcement, window
reset, independent buckets, env overrides, disable flag, trusted-proxy IP resolution).
`test/security/rate-limit-http.test.mjs` confirms the wiring end-to-end against the real
`/api/auth/login` route, including the `429` response shape and `Retry-After` header.
