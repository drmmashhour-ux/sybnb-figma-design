# Vercel Agent — Security & Launch Order (SYBNB)

**For:** the Vercel agent operating the `sybnb` production project.
**Goal:** finish the security hardening that lives in configuration (not code). The code side is done and committed on branch `security/sybnb-v6-predeployment`. Do these in order, then redeploy and verify.

> Do NOT paste secret values into chat or commit them. Set them in the Vercel dashboard (Project → Settings → Environment Variables) or via `vercel env add`. Generate random secrets locally.

---

## 1. Environment variables — Production (and Preview where noted)

### 🔴 REQUIRED — the platform is not usable/safe without these

| Variable | Value | Why |
|---|---|---|
| **OTP provider** — set ONE of: `RESEND_API_KEY` (+ `MAIL_FROM`, e.g. `no-reply@sybnb.app`) **or** SMTP vars **or** an SMS provider | your provider key | **Launch blocker.** Without an email/SMS sender, NO new user can register and NO host/admin can log in (2-factor code can't be sent). |
| **`TRUST_PROXY`** | `1` | Vercel is a reverse proxy. Without this the rate limiter + login lockout see every visitor as one IP → either self-DoS or ineffective throttling. |
| **`CRON_SECRET`** | a fresh random string — generate with `openssl rand -hex 32` | The maintenance cron (`/api/cron/maintenance`) is now **fail-closed**: it runs ONLY with this bearer, which Vercel injects automatically once the var is set. Without it the sweeps don't run (and can't be spoofed by the public). |
| **`FORCE_HTTPS`** | `1` | Enables HSTS on the API responses (the frontend HSTS is already set via `vercel.json`). |
| **`DATABASE_URL`** | the **sybnb-production** Neon **pooled** (`-pooler`) connection string, freshly rotated (see step 2) | Must point at sybnb-production (NOT lecipm-clean-final, which is empty) and use the pooled endpoint for serverless connection limits. The app auto-appends `pgbouncer=true`. |
| **`AUTH_SECRET`, `PHONE_HASH_SECRET`** | already set — confirm present | Required for sessions + phone/identifier hashing (the login lockout also uses `AUTH_SECRET`). Deploy refuses to boot without them. |
| **`RATE_LIMIT_STORE`** | `db` | Already required by `validateProductionConfig`. Confirm it's set. |

### 🟠 OPTIONAL — set if card payments go live at launch

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | your `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_…` for the `/api/payments/stripe/webhook` endpoint |
| `STRIPE_CURRENCY` | `usd` |

Without these the card button self-disables and Sham Cash (manual) still works — safe to launch card-less.

### ⚪ OPTIONAL — login-lockout tuning (defaults are fine)

`LOGIN_LOCK_MAX_ATTEMPTS` (default 8), `LOGIN_LOCK_WINDOW_MS` (default 900000), `LOGIN_LOCK_DURATION_MS` (default 900000), `AUDIT_LOG_RETENTION_DAYS` (default 730).

---

## 2. Rotate the Neon database password

The previous password was exposed in a chat/terminal earlier. In the Neon console for project **sybnb-production**: reset the role password, copy the new **pooled** connection string, and update `DATABASE_URL` (step 1) with it. Redeploy so functions pick it up.

---

## 3. Enable bot protection (Vercel BotID)

Turn on **Vercel BotID** / Attack Challenge Mode for the project (Project → Firewall/Security). This blocks automated signup/login floods and card-testing at the edge, before requests reach the functions. Highest-value single toggle for a launching platform.

---

## 4. Redeploy

After all env changes: trigger a production redeploy (env changes only take effect on a new deployment).

---

## 5. Verify (post-deploy)

1. `curl -sS https://sybnb.app/api/health` → `{"ok":true,...,"database":{"code":"DATABASE_CONNECTED"}}`.
2. Frontend security headers present:
   `curl -sI https://sybnb.app/ | grep -iE 'content-security-policy|strict-transport|x-frame-options'` → all three appear.
3. Cron is locked: `curl -sS -o /dev/null -w "%{http_code}" https://sybnb.app/api/cron/maintenance` → **401** (public can't trigger it). Vercel's scheduled invocation still runs it because it carries the `CRON_SECRET` bearer.
4. OTP works: request an email/phone code from the sign-in screen and confirm it arrives.
5. Login lockout works: 8 wrong passwords on a test account → the 9th attempt returns HTTP **429** `ACCOUNT_TEMPORARILY_LOCKED`; it appears on the admin **Office dashboard** security panel.

---

## Summary of what the CODE already does (no action needed)
- Frontend + API security headers (CSP, HSTS, X-Frame-Options, permissions-policy).
- Stripe webhook signature verification (raw-body `constructEvent`, rejects forged).
- Server-authoritative money; per-IP rate limiting; per-account login lockout + admin alerting.
- Fail-closed maintenance cron; fail-open rate limiter (availability).
- Real card refunds on all four cancel paths with idempotency keys.
