# SYBNB V6 — Rate Limit Policy

Date: 2026-07-10 (updated 2026-07-11, independent-review follow-up; updated 2026-07-22, STR launch
blocker P0 — distributed storage backend). Describes the abuse-protection limiter added under
security audit finding F-08 (`docs/security/SYBNB_V6_THREAT_MODEL.md`).
Implementation: `server/lib/rate-limit.mjs` (policy/interface) + `server/lib/rate-limit-store.mjs`
(storage backend), wired into `server/index.mjs`.

**Two bugs found and fixed in the 2026-07-11 pass** (full detail: F-20, F-21 in the threat model):
`TRUST_PROXY` was read once at module-import time, before `.env` had even been loaded, so a
`TRUST_PROXY` set only in `.env` (not a real shell environment variable) would silently never take
effect — now read lazily on every call. `RATE_LIMIT_<NAME>_MAX`/`_WINDOW_MS` overrides were passed
straight through `Number(...)` with no validation — a non-numeric, zero, or negative value could
silently disable the limit (`NaN`) or block every request (`0`) from one environment-variable typo
— now validated, falling back to the coded default on anything invalid, with
`validateProductionConfig()` refusing to start in production if any configured override is bad.

## How it works

A fixed-window counter keyed by `{ruleName}:{bucketKey}`. Each rule in `server/index.mjs`'s
`RATE_LIMIT_RULES` table matches an HTTP method + path pattern and carries its own `max` /
`windowMs`. On a match, the request either proceeds (and the bucket's count increments) or receives
`429` with a `Retry-After` header and body `{ ok: false, error: { code: 'RATE_LIMITED', message } }`.
(Earlier revisions of this document called the algorithm "sliding-window" — it has always actually
been a fixed window, resetting fully at its boundary rather than interpolating between windows;
corrected here, 2026-07-22, no behavior change.)

**Storage backend is now pluggable (2026-07-22).** `server/lib/rate-limit.mjs` (policy: which rule,
what `max`/`windowMs`, IP vs. user keying, fail-open/fail-closed) delegates the actual counter
storage to `server/lib/rate-limit-store.mjs`:

- **Local dev / automated tests**: the original in-memory `Map`, used automatically whenever
  `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are unset — no live Redis connection is ever
  required to run this codebase's test suite.
- **Production (required)**: [Upstash Redis](https://upstash.com) via the Vercel Marketplace
  integration, using `@upstash/redis` (`Redis.fromEnv()`, an HTTP/REST client — no persistent TCP
  connection, the correct shape for Vercel Functions/Fluid Compute) and `@upstash/ratelimit`
  (`Ratelimit.fixedWindow`, matching the exact algorithm above). `validateProductionConfig()`
  (`server/lib/env.mjs`) refuses to start with `NODE_ENV=production` if either Upstash env var is
  missing — there is no silent fallback to the in-memory store in production.

**Why this was a real defect, not just a scaling nicety.** `api/index.mjs` runs this exact same
`handleRequest()` as a Vercel serverless function. Before this fix, buckets lived in one process's
memory — every cold start or concurrent instance got its own empty `Map`, so the *effective* limit
for a client became `max × instance count`, and any cold start reset an in-progress attacker to
zero for free. The rule table (which endpoints, what limits, IP vs. user keying) is unchanged by
this fix — only the counter storage moved off single-process memory.

**Client identification.** Rules marked `byUser` key on the authenticated caller's user id (a
shared office/NAT IP shouldn't throttle every user behind it). Unauthenticated rules key on client
IP. IP is read from the raw socket by default; `TRUST_PROXY=1` opts into trusting
`X-Forwarded-For` instead — only enable this when a real reverse proxy sits in front of the API,
since otherwise a client could set that header themselves to reset their own limit. Current `.env`
in this environment does not set `TRUST_PROXY` — confirmed absent (checked for the key's presence
only, value not inspected/printed), so the raw-socket path is what's actually active here.

**Storage mechanism.** A single in-process `Map` (`buckets`) in `server/lib/rate-limit.mjs`, keyed
by `` `${ruleName}:${bucketKey}` ``. Each entry holds `{ count, resetAt }`. No external store, no
disk persistence.

**Cleanup / memory bounds.** A `setInterval` sweep (`SWEEP_INTERVAL_MS`, 5 minutes) removes any
bucket whose `resetAt` has already passed. The sweeper is skipped when `NODE_ENV=test` (so Vitest
doesn't leave a dangling timer keeping the process alive) and uses `.unref()` so it never blocks
process exit on its own. Memory is bounded by the number of *distinct active* `{rule, key}` pairs
within the last unexpired window per rule — in the worst case (every request from a unique
IP/user, all rules constantly active), this scales linearly with distinct recent clients, not with
request volume. There is no hard cap on total bucket count; an attacker with access to a very
large number of distinct source IPs (well beyond what rate limiting itself is meant to blunt)
could in principle grow the Map faster than the 5-minute sweep reclaims it. Not considered a
practical risk at this deployment's expected scale, but worth flagging as an unbounded-growth
edge case rather than a hard guarantee.

**Restart behavior.** All buckets are in-memory only — a process restart (deploy, crash, manual
restart) resets every client's rate-limit state to zero immediately. This is a *feature* for
recovering from a misconfigured limit locking out legitimate traffic, and a *gap* in that it also
resets any limit an attacker was up against, mid-attack, for free.

**IPv4 / IPv6 handling.** `clientIp()` returns `req.socket.remoteAddress` verbatim — no
normalization. When the server binds to `127.0.0.1` (this deployment's default `API_HOST`),
`remoteAddress` for IPv4 clients is plain dotted-decimal (verified directly:
`net.createServer` on `127.0.0.1` reports `remoteAddress: '127.0.0.1'`, `remoteFamily: 'IPv4'` for
an IPv4 client — no `::ffff:`-mapped form). If a future deployment binds dual-stack
(`API_HOST=::` or `0.0.0.0` under an IPv6-capable stack), IPv4 clients may instead present as
`::ffff:x.x.x.x` while IPv6 clients present as native IPv6 literals — the module does not collapse
these to a comparable form. This does not let a single client evade its own bucket (a given TCP
connection consistently reports one address form), but it does mean **IPv6 clients get one bucket
per individual address** rather than per `/64` or `/56` prefix — a client with an IPv6 allocation
can rotate through effectively unlimited individual addresses within their own prefix to obtain a
fresh bucket each time, in a way an IPv4 client typically cannot (a single IPv4 address is a scarce
resource). Not exploitable today (this deployment binds IPv4-only), but relevant if the bind
address ever changes.

## Current rules

Corrected 2026-07-22: this table previously omitted three rule groups that already existed in
`server/index.mjs` (`AUTH_EMAIL_CODE_*`, `AUTH_PHONE_CODE_*`, `BOOKING_LOOKUP`) — a documentation
gap, not a code gap; all 13 rules below were already enforced. `failMode` is new as of this date
(see "Fail-open vs. fail-closed policy" below).

| Rule | Method + path | Max | Window | Keyed by | failMode |
|---|---|---|---|---|---|
| `AUTH_LOGIN` | `POST /api/auth/login` | 10 | 5 min | IP | closed |
| `AUTH_REGISTER` | `POST /api/auth/register` | 5 | 15 min | IP | closed |
| `AUTH_EMAIL_CODE_SEND` | `POST /api/auth/email-code/send` | 5 | 15 min | IP | closed |
| `AUTH_EMAIL_CODE_VERIFY` | `POST /api/auth/email-code/verify` | 10 | 15 min | IP | closed |
| `AUTH_PHONE_CODE_SEND` | `POST /api/auth/phone-code/send` | 5 | 15 min | IP | closed |
| `AUTH_PHONE_CODE_VERIFY` | `POST /api/auth/phone-code/verify` | 10 | 15 min | IP | closed |
| `PUBLIC_SEARCH` | `GET /api/listings` | 60 | 1 min | IP | open |
| `MESSAGING` | `POST /api/{listings,bookings}/:id/thread/messages` | 20 | 1 min | User | open |
| `BOOKING_CREATE` | `POST /api/bookings` | 10 | 1 min | User | open |
| `PAYMENT_PROOF` | `POST /api/payments/{seller-plan-proof,local-wallet-proof}` | 10 | 1 min | User | open |
| `ADMIN_DECISION` | `PATCH /api/admin/review-queue/:type/:id` | 60 | 1 min | User | open |
| `DOCUMENT_ACCESS` | `GET /api/{admin/id-document,me/id-document}/:id(/file)` | 30 | 1 min | User | open |
| `GEOCODING` | `POST /api/sr/{quote,rides}` | 20 | 1 min | User | open |
| `DRIVER_STATUS` | `PATCH /api/{driver/rides/:id/status,sr/rides/:id/claim}` | 30 | 1 min | User | open |
| `BOOKING_LOOKUP` | `GET /api/bookings/lookup` | 20 | 15 min | IP | open |

`GEOCODING` and `DRIVER_STATUS` are SR-owned rules, listed here only because they share this one
central table with STR's rules — their `failMode` was assigned mechanically as part of this
migration (every existing rule needed one), not as an SR policy decision.

These are conservative starting points based on plausible legitimate usage patterns, not numbers
derived from production traffic data (none exists yet for this prototype) — expect to retune after
real usage is observed.

## Fail-open vs. fail-closed policy (2026-07-22)

If the distributed store itself is unreachable (e.g. an Upstash outage), `checkRateLimit()`
(`server/lib/rate-limit.mjs`) logs the failure and then applies the rule's `failMode`:

- **`closed`** — the request is rejected (`429`) rather than risk unbounded abuse. Applied to
  pre-authentication, abuse-prone endpoints: login, registration, and all four OTP send/verify
  rules. These are exactly the endpoints rate limiting exists to protect; failing open here during
  an outage is when an attacker would be most likely to strike.
- **`open`** — the request proceeds as if unlimited, rather than take an unrelated storage outage
  and turn it into a full outage of an already-gated action. Applied to already-authenticated
  business operations (messaging, booking creation, payment proof, admin decisions, document
  access) and anonymous browsing/lookup (public search, booking lookup). A storage-layer outage
  degrades these into "temporarily unlimited" rather than "blocked/down."

This can only ever be exercised when the Redis backend is configured and fails — the in-memory
backend's `Map` read/write does not fail, so `failMode` is inert for local dev/test.

**Not yet built**: dedicated alerting on a `storeError: true` result (visible today only via a
`console.error` log line) — real alerting/monitoring is tracked as its own, separate STR launch
blocker and intentionally not bundled into this storage migration.

## Complementary edge layer: Vercel WAF rate limiting (manual dashboard configuration, not code)

Vercel's own WAF rate limiting (`Firewall` → `Configure` → `+ New Rule` in the project dashboard)
is a genuinely useful **complementary** layer for the IP-keyed, pre-authentication rules above —
but it cannot replace the application-level limiter for this project: on Hobby/Pro plans it can
only key on IP and JA4 TLS fingerprint (arbitrary header/User-Agent keys require Enterprise), it
has no concept of an authenticated application user ID at all, and its counters are tracked
**per-region**, not globally atomic. 7 of the 13 rules above are `byUser`-keyed — WAF cannot express
any of those. There is no `vercel.json`/`vercel.ts` config property for this; it is configured only
via the Vercel dashboard (or its API), so it is not something this repository's source controls.

Recommended manual configuration, as a defense-in-depth pre-filter in front of the rules already
enforced in application code — not a replacement for any of them:

| Vercel WAF rule | Path match | Key | Suggested limit |
|---|---|---|---|
| Auth abuse pre-filter | `/api/auth/*` | IP | ~30 req / 1 min (looser than the application rule — this is a coarse pre-filter, not the precise limit) |
| Public search pre-filter | `/api/listings` | IP | ~120 req / 1 min |

Set the **Then** action to **Log** first and observe real traffic before switching to **Deny**/
**Challenge**, per Vercel's own guidance — this avoids a WAF rule blocking legitimate traffic before
its thresholds are validated against this project's actual usage.

## Overriding without a code change

Every rule's `max` and `windowMs` can be overridden per-deployment via environment variables:
`RATE_LIMIT_<NAME>_MAX` and `RATE_LIMIT_<NAME>_WINDOW_MS` (e.g. `RATE_LIMIT_AUTH_LOGIN_MAX=20`).
`DISABLE_RATE_LIMIT=1` turns off all rate limiting entirely — `validateProductionConfig()`
(`server/lib/env.mjs`) refuses to start with `NODE_ENV=production` if this is set, so it can only
be used in development/testing.

## Production recommendation

**Resolved 2026-07-22.** Production now requires Upstash Redis (`UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN`), enforced at boot by `validateProductionConfig()` — there is no code
path that lets a production deployment silently run on the in-memory store. The rule table and
policy (which endpoints, what limits, byUser vs. by-IP) did not change; only the storage backend
did, exactly as this document previously recommended.

## Known, deliberately out-of-scope items (separate future work)

Two items were surfaced during the P0 audit that led to this fix, and are **intentionally not**
addressed here — each is its own separate task:

- **Missing-protection inventory**: several STR-owned endpoints (`/api/auth/checkout-guest`,
  `/api/auth/password-reset`, `/api/host/insights/generate`, `/api/host/listings/describe`,
  `/api/me/id-document` upload, `/api/listings/:id/thread/documents`, `/api/listings/:id/quote`,
  `/api/listings/:id/availability`, Stripe checkout-session creation/confirm, wallet top-up,
  disputes) currently have **no** rate-limit rule at all — most notably `checkout-guest`, which can
  silently create a new real database user + wallet per request with zero verification. This is a
  distinct, separate task (extending `RATE_LIMIT_RULES` with new entries) — deliberately not
  bundled into this storage-architecture migration.
- **Vercel WAF configuration**: the manual dashboard steps above are documented, not yet applied —
  applying them requires Vercel dashboard access this repository's automation does not have.

## Testing

`test/unit/rate-limit.test.mjs` exercises the limiter policy/interface directly (enforcement,
window reset, independent buckets, env overrides, disable flag, trusted-proxy IP resolution,
fail-open/fail-closed behavior when the store is unreachable).
`test/unit/rate-limit-store.test.mjs` exercises the storage backend in isolation: backend
selection (in-memory vs. Redis, based on env vars), the in-memory algorithm directly, and the
Redis-backed result mapping against a fake `Ratelimit` instance (no real network access anywhere in
either test file).
`test/security/rate-limit-http.test.mjs` confirms the wiring end-to-end against the real
`/api/auth/login` route, including the `429` response shape and `Retry-After` header.
`test/unit/env-production-config.test.mjs` confirms `validateProductionConfig()` refuses to start
without both Upstash env vars.
