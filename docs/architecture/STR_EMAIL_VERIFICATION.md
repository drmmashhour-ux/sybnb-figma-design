# STR Email Verification Architecture

Email verification is the **sole account-verification channel** for the Syria-first STR launch. SMS
verification exists in the codebase but is deliberately left **unconfigured** (no `SMS_PROVIDER`), so
every guest/staff sign-up and sign-in proves ownership by email.

This document reflects the implementation committed in
`fix(str-auth): harden Resend email verification`.

- Domain logic: `server/lib/email-verification.mjs`
- Transport: `server/lib/mailer.mjs`
- Routes: `server/routes/auth.mjs` (`/api/auth/email-code/send`, `/api/auth/email-code/verify`)
- Startup validation: `server/lib/env.mjs` (`validateProductionConfig`)
- Rate limiting: `server/lib/rate-limit.mjs` + `server/lib/rate-limit-store.mjs` (Upstash / in-memory)
- Storage: `EmailVerificationCode` model in `prisma/schema.prisma`

---

## 1. Overall architecture

```
Frontend (GuestAccountPage / StaffAccessPage)
   │  POST /api/auth/email-code/send { email, purpose }
   ▼
Route  server/routes/auth.mjs
   validate email → per-email rate limit (hashed key) → sendEmailVerificationCode()
   ▼
Domain  server/lib/email-verification.mjs
   generate code → HMAC-hash → atomically (invalidate older unconsumed + store new) → deliver
   ▼
Transport  server/lib/mailer.mjs
   isMailerConfigured() (call-time) → Resend HTTP API (timeout + bounded retry) │ SMTP fallback
   ▼
Storage  EmailVerificationCode (hashed code, TTL, single-use, attempt counter)
```

Verification is a two-call flow (send, then verify), followed by a server-side re-check at
registration/login time (`hasRecentlyVerifiedEmail`) — the server never trusts a client-supplied
"I verified it" flag.

---

## 2. Verification lifecycle

1. **Send** — `POST /api/auth/email-code/send { email, purpose }`
   - Email normalized (trim + lowercase) and validated.
   - Per-email rate limit checked (in addition to per-IP).
   - A 6-digit code is generated and hashed; older unconsumed codes for this `email + purpose` are
     atomically invalidated and the new hashed row is stored (single transaction).
   - Delivery is attempted if a provider is configured; a definitive failure returns a non-2xx.
2. **Verify** — `POST /api/auth/email-code/verify { email, code, purpose }`
   - The newest non-expired, non-consumed row for `email + purpose` is selected.
   - On match: the row is marked consumed (single-use). On mismatch: the row's attempt counter is
     incremented. Wrong / expired / already-consumed / attempts-exhausted all deny identically.
3. **Trust window** — At registration/login, `hasRecentlyVerifiedEmail` confirms a code for this
   `email + purpose` was **consumed within the last 30 minutes**.

`purpose` is one of `guest-signup`, `staff-login`, `password-reset`.

---

## 3. Code generation

- `generateEmailVerificationCode()` → `String(randomInt(0, 1_000_000)).padStart(6, '0')`.
- A **6-digit** numeric code drawn from Node's crypto `randomInt` (CSPRNG), uniformly over
  `000000`–`999999`.
- The raw code is returned to the caller as `devCode` **only outside production** (for local/QA
  without a live mailbox); it is **never** included when `NODE_ENV === 'production'`.

---

## 4. Hashing

- Codes are stored **hashed, never in plaintext**: `hashEmailVerificationCode(code)` =
  `HMAC-SHA256(AUTH_SECRET, code)` (`server/lib/security.mjs`).
- Verification recomputes the HMAC and compares in constant time
  (`verifyEmailVerificationCodeHash` → `timingSafeEqual`).
- Rotating `AUTH_SECRET` invalidates all outstanding codes.

---

## 5. TTL

- `CODE_TTL_MINUTES = 10`. `expiresAt = now + 10 min` at creation.
- Verification only selects rows with `expiresAt > now`; expired rows are never accepted.

---

## 6. Single-use behavior

- On successful verify, the row's `consumedAt` is set. A consumed row is never re-selected by the
  verify query (`consumedAt: null` filter), so a code cannot be redeemed twice via the normal path.
- Each row carries an `attempts` counter capped at `MAX_ATTEMPTS = 5`; once reached, that row denies
  regardless of the submitted value.

---

## 7. Single-active-code policy

Issuing a new code **atomically invalidates all older unconsumed codes** for the same normalized
`email + purpose`, then stores the new one, in a single transaction:

```js
await db().$transaction([
  db().emailVerificationCode.deleteMany({ where: { email: normalized, purpose, consumedAt: null } }),
  db().emailVerificationCode.create({ data: { email: normalized, codeHash, purpose, expiresAt } }),
])
```

- **Only the newest code is valid.** This is now an explicit invariant, not merely an emergent
  property of the verify query's ordering.
- **Consumed rows are never touched** — the 30-minute trust window (`hasRecentlyVerifiedEmail`)
  depends on them.
- Only the target `email + purpose` is affected; other addresses are untouched.
- The transaction ensures a concurrent verifier never observes a window with zero valid codes.
- This also subsumes stale-row hygiene: expired unconsumed rows are removed as part of issuance
  (index-friendly via `@@index([email, purpose])`, **no schema migration**).

See [Known limitations](#15-known-limitations) for the residual concurrency caveat.

---

## 8. Retry policy

Applies to the **Resend HTTP call only** (`server/lib/mailer.mjs`), never the SMTP fallback.

- Bounded retry: `EMAIL_MAX_ATTEMPTS` attempts (default **3**), linear backoff
  `EMAIL_RETRY_BASE_MS * attempt` (default **300 ms**; `0` is allowed for immediate retries).
- **Retried (transient only):** network errors, request timeouts, HTTP **429**, HTTP **5xx**.
- **Never retried:** ordinary **4xx** responses (bad recipient, auth) — these throw on the first
  attempt.
- After the final attempt, the last error propagates as a definitive delivery failure.

---

## 9. Timeout policy

- Every Resend request runs under an `AbortController` with `EMAIL_SEND_TIMEOUT_MS` (default
  **10000 ms**). On abort the attempt fails with a timeout error, which is treated as transient and
  retried within the bounds above.
- Prevents a hung/slow provider from blocking the request until the platform's own function timeout.

---

## 10. Production configuration requirements

`validateProductionConfig()` (invoked only when `NODE_ENV === 'production'`) **refuses to start** the
server unless all of the following hold. This makes "valid to boot" equal to "will actually send".

- `AUTH_SECRET` (≥ 16 chars) and `PHONE_HASH_SECRET` (≥ 16 chars)
- `DATABASE_URL`
- `CORS_ORIGIN` (explicit; the dev localhost fallback is rejected)
- `DISABLE_RATE_LIMIT` must not be `1`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (distributed rate-limit store)
- **A configured email provider** — `isMailerConfigured()` must be true (Resend: `RESEND_API_KEY`;
  or SMTP: `SMTP_HOST`). Without it, verification email silently fails while the endpoint looks
  healthy, so boot is refused.
- Any `RATE_LIMIT_*_MAX` / `_WINDOW_MS` override must be a valid positive integer.

---

## 11. Resend integration

- Provider selection (`server/lib/mailer.mjs`) reads `process.env` **at call time** (no import-time
  capture), so detection reflects the current environment on Vercel and locally.
  - `provider = EMAIL_PROVIDER || (RESEND_API_KEY ? 'resend' : 'smtp')`.
  - `isResendConfigured()` = provider is `resend` **and** `RESEND_API_KEY` set.
  - `isMailerConfigured()` = Resend configured, or `SMTP_HOST` set (SMTP fallback).
- Send: `POST https://api.resend.com/emails` with `Authorization: Bearer ${RESEND_API_KEY}`, JSON
  body `{ from, to, reply_to, subject, text }`.
  - `from` = `EMAIL_FROM` (with `EMAIL_FROM_NAME`); `reply_to` = `EMAIL_REPLY_TO` (optional).
  - Non-2xx → thrown error; 2xx → resolved. Wrapped by the timeout + retry logic above.
- **SMTP** (nodemailer) is a fallback only, unchanged by this work beyond lazy (call-time)
  transporter creation.

---

## 12. Rate limiting

All limits use the shared limiter (`checkRateLimit`), backed by **Upstash Redis in production** and
an in-memory store in dev/test. Pre-auth OTP rules run `failMode: 'closed'` (deny if the store is
unreachable).

| Limit | Rule | Default | Key |
| --- | --- | --- | --- |
| Per-IP send | `AUTH_EMAIL_CODE_SEND` | 5 / 15 min | client IP |
| Per-IP verify | `AUTH_EMAIL_CODE_VERIFY` | 10 / 15 min | client IP |
| **Per-email send** | `AUTH_EMAIL_CODE_SEND_PER_EMAIL` | 3 / 15 min | `email:<sha256(normalized email)[:32]>` |

- The per-email limit is applied **in addition to** the per-IP limit, defeating rotating-IP
  email-bombing of one address. The pre-existing per-IP limits are unchanged (not weakened).
- The rate-limit key holds **only a one-way SHA-256 hash** of the normalized email — never the raw
  address — so no PII sits in the (potentially shared) store.
- All limits are overridable via `RATE_LIMIT_<NAME>_MAX` / `_WINDOW_MS`.

---

## 13. Error handling

- **Success:** `200 { ok: true, emailSent: true }` (plus `devCode` only outside production).
- **No provider configured (dev/test only; impossible in production per §10):**
  `200 { ok: true, emailSent: false, devCode }` — delivery not attempted.
- **Definitive delivery failure** (after retries, provider configured): **non-2xx `502`**
  `{ ok: false, error: { code: 'EMAIL_SEND_FAILED' } }`.
  - The message is **generic in production** (`sanitizeEmailError`) — it never exposes Resend URLs,
    status text, provider messages, API details, or stack traces. Full detail is retained only
    outside production for debugging.
  - The failure response is **identical for registered and unregistered emails** — no
    account-enumeration oracle.
- **Frontend:** a non-2xx throws in the API client and lands in the send handler's `catch`, which
  keeps `codeSent = false` and shows a real "could not send, try again" state; an explicit guard also
  refuses to claim "code sent" for the email channel when delivery is not confirmed and no dev code
  is present. The phone/SMS branch is untouched.

---

## 14. Security guarantees

- Codes are stored HMAC-hashed, never in plaintext, and compared in constant time.
- Codes are single-use, TTL-bounded (10 min), and attempt-capped (5 per code).
- Only the newest code for an `email + purpose` is valid (single-active policy).
- The raw code is never returned in production (`devCode` withheld) and never written to logs.
- Delivery-failure responses are generic in production and identical for registered vs unregistered
  emails (no enumeration).
- Registration/login re-verify server-side (`hasRecentlyVerifiedEmail`, 30-min window) — no trust in
  a client-supplied verified flag.
- Per-email + per-IP rate limits bound both send abuse (cost / bombing) and verify brute-force;
  rate-limit keys carry only a hash of the email.
- Production refuses to boot without a configured mailer, so the auth channel can never be silently
  dead.

---

## 15. Known limitations

- **Transient duplicate unconsumed rows under simultaneous issuance.**
  Without a **partial unique database constraint** on `(email, purpose) WHERE consumed_at IS NULL`,
  two send requests that arrive at the exact same instant can each delete-then-insert within their
  own transaction and, under `READ COMMITTED` isolation, both inserts may survive — transiently
  leaving **more than one** unconsumed row for that `email + purpose`.

  **Why this was intentionally deferred:**
  - It is **never worse than the prior behavior**, and creates **no security regression**: the verify
    query still selects the newest row, every row remains single-use and attempt-capped, and both the
    per-email and per-IP rate limits still apply. At worst two live codes coexist briefly until TTL /
    the next issuance sweeps the older one.
  - The sequential case (the overwhelming majority — a user pressing "resend") is already fully
    correct and atomic.
  - A hard guarantee would require adding a **partial unique index**, i.e. a **schema migration**,
    which was explicitly out of scope for the hardening change. Adding it is the clean future fix if
    real traffic ever shows simultaneous-issuance duplicates worth eliminating.

- **Abandoned expired rows.** Stale-row cleanup is opportunistic (on the next send for that address),
  so addresses that never send again can leave a bounded tail of expired rows. A global/scheduled
  sweep is warranted only if volume justifies it, and would benefit from an `expiresAt` index
  (another migration) — deferred until needed.

- **SMTP fallback** is retained but not hardened with the Resend timeout/retry logic; Resend is the
  intended launch provider.

---

## 16. Operational deployment checklist

### Required environment variables (production)

| Variable | Purpose | Required |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `resend` (or `smtp`) | Yes (or infer from `RESEND_API_KEY`) |
| `RESEND_API_KEY` | Resend API key | Yes (Resend path) |
| `EMAIL_FROM` | Sending address (e.g. `no-reply@sybnb.app`) | Yes |
| `EMAIL_FROM_NAME` | Display name (default `SYBNB`) | Optional |
| `EMAIL_REPLY_TO` | Reply-to address | Optional |
| `EMAIL_SEND_TIMEOUT_MS` | Resend timeout (default 10000) | Optional |
| `EMAIL_MAX_ATTEMPTS` | Retry attempts (default 3) | Optional |
| `EMAIL_RETRY_BASE_MS` | Backoff base (default 300) | Optional |
| `AUTH_SECRET` | HMAC key for code hashing / sessions (≥16) | Yes |
| `PHONE_HASH_SECRET` | (unrelated to email; still required to boot) | Yes |
| `DATABASE_URL` | Postgres connection | Yes |
| `CORS_ORIGIN` | Explicit allowed origin(s) | Yes |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Distributed rate-limit store | Yes |
| `RATE_LIMIT_AUTH_EMAIL_CODE_SEND_PER_EMAIL_MAX` / `_WINDOW_MS` | Per-email limit override | Optional |

> SMS is intentionally out of scope for launch: **do not set `SMS_PROVIDER`.**

### Required DNS for the sending domain (`sybnb.app`)

- **Verified sending domain** in Resend (domain added and verified in the Resend dashboard).
- **SPF** — TXT record authorizing Resend to send for `sybnb.app`.
- **DKIM** — the CNAME/TXT record(s) Resend provides for the domain, so mail is cryptographically
  signed.
- **DMARC** — a `_dmarc.sybnb.app` TXT policy (e.g. `v=DMARC1; p=quarantine; rua=...`) aligned with
  SPF/DKIM.

Without verified-domain + SPF + DKIM + DMARC, verification emails to Gmail/Outlook (typical Syrian
mailboxes) are likely to land in spam or be dropped, regardless of code correctness.

### Production startup requirements

- Server refuses to boot unless `validateProductionConfig()` passes (see §10) — including a
  configured mailer, `AUTH_SECRET`, `DATABASE_URL`, `CORS_ORIGIN`, and the Upstash store.

### Launch checklist

- [ ] `RESEND_API_KEY` set in production environment.
- [ ] `EMAIL_FROM` set to a `@sybnb.app` address.
- [ ] `sybnb.app` verified as a sending domain in Resend.
- [ ] SPF record published.
- [ ] DKIM record(s) published.
- [ ] DMARC policy published.
- [ ] `UPSTASH_REDIS_REST_URL` / `_TOKEN` set (distributed rate limiting).
- [ ] `AUTH_SECRET`, `PHONE_HASH_SECRET`, `DATABASE_URL`, `CORS_ORIGIN` set.
- [ ] `SMS_PROVIDER` **not** set (SMS deliberately disabled for launch).
- [ ] End-to-end send + verify exercised against a real inbox from production.
- [ ] Deliverability spot-checked (Gmail / Outlook inbox placement, not spam).
