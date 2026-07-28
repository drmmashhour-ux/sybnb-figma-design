# P3 — Staging Deploy Runbook (owner actions)

**Status:** `BLOCKED — OWNER ACTION REQUIRED` (Vercel/staging access not available to the agent).
This is the exact, ordered set of owner steps to stand up staging and run the real-target E2E.
Deploy to **staging only** — never production.

> Key advantage: a **fresh** staging DB avoids the P1 unknown entirely. P1 is only about the *existing
> prod* DB's lineage; an empty staging DB takes the squashed baseline cleanly (proven locally:
> `migrate deploy` of the baseline + `20260727000000_add_rate_limit_hits` reproduces the schema with
> zero drift). So **staging does not depend on P1**.

Vercel project (from `.vercel/project.json`, non-secret): `projectName: sybnb-figma-design`,
`projectId: prj_oY9ipzr8BencTqKcmVeWhhhDR3G0`. Serverless config is in `vercel.json` (build `npm run
build`, function `api/index.mjs` maxDuration 30, `/api(/*)` → `/api/index`).

## Step 1 — Provision a staging Postgres (separate from prod)
A new Neon (or equivalent) Postgres DB. Note its pooled connection URL for `DATABASE_URL`.

## Step 2 — Set the staging environment variables (Vercel → this project → Preview/Staging env)
HARD-REQUIRED (server refuses to boot in production mode without these — `server/lib/env.mjs`
`validateProductionConfig`):
- `NODE_ENV=production`
- `AUTH_SECRET` (≥16 chars, random) · `PHONE_HASH_SECRET` (≥16 chars, random)
- `DATABASE_URL` (the staging DB from Step 1)
- `CORS_ORIGIN` (the staging origin, e.g. `https://<staging-host>`)
- `RATE_LIMIT_STORE=db`  ← required; the in-memory limiter is per-instance on Vercel (see P9 guard)
- `TRUST_PROXY=1`  ← required behind Vercel's proxy, else all clients bucket under the proxy IP
- `FORCE_HTTPS=1` · do NOT set `DISABLE_RATE_LIMIT`
Functional:
- `VITE_API_BASE_URL` (usually empty → same-origin `/api`) · `SYP_PER_USD`
- Email: `EMAIL_PROVIDER` + `RESEND_API_KEY` (or `SMTP_*`) + `EMAIL_FROM*`
- SMS (if used): `SMS_PROVIDER`/`SMS_API_KEY`/`SMS_GATEWAY_URL` or `TWILIO_*`
- `ANTHROPIC_API_KEY` (if AI features are exercised) · `DEMO_ACCOUNT_PASSWORD` (for seed)
Stripe TEST mode (P5):
- `STRIPE_SECRET_KEY=sk_test_...` · `STRIPE_CURRENCY=usd` · `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...` (from Step 5)

## Step 3 — Apply migrations to the staging DB (clean baseline)
```bash
DATABASE_URL="<STAGING_URL>" npx prisma migrate deploy
DATABASE_URL="<STAGING_URL>" npx prisma migrate status   # expect: up to date
```
(Fresh DB → the baseline applies with no lineage conflict. If this were an existing DB, run the P1
diagnostic first per `DB_BASELINE_RUNBOOK.md`.)

## Step 4 — Seed reference + demo data
```bash
DATABASE_URL="<STAGING_URL>" node scripts/seed-14-governorates.mjs      # location reference data
DATABASE_URL="<STAGING_URL>" DEMO_ACCOUNT_PASSWORD="<pw>" node scripts/seed-demo-accounts.mjs
```

## Step 5 — Stripe test webhook
In the Stripe **test** dashboard, add a webhook endpoint → `https://<staging-host>/api/payments/stripe/webhook`,
event `checkout.session.completed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET` (Step 2), redeploy.

## Step 6 — Deploy to STAGING only
```bash
vercel deploy            # preview/staging build — NOT `vercel deploy --prod`
```

## Step 7 — Post-deploy verification (real target)
```bash
curl -s https://<staging-host>/api/health         # {"ok":true,...,"database":{"ok":true}}
```
Then the smoke + real-target E2E against staging:
- Smoke: `SMOKE_FRONTEND_URL="https://<staging-host>" npm run smoke:routes` (route/auth-denial checks).
- Browser E2E vs staging: the current `playwright.config.ts` spawns LOCAL servers via `webServer` and
  uses a local `baseURL`. To run against staging, use a staging config that (a) sets
  `baseURL: https://<staging-host>`, (b) removes the `webServer` block, and (c) sets
  `PLAYWRIGHT_API_BASE_URL=https://<staging-host>`. (Ask the agent to add
  `playwright.staging.config.ts` once the staging URL exists — it's a small, safe addition.)

## Step 8 — Capture evidence (order item 11)
For one full booking→pay→confirm run on staging, record: bookingId, Stripe payment_intent + session id,
webhook delivery (Stripe dashboard), booking status, payment_proof status, wallet ledger entries
(host payout HOLD + admin share), and audit-log rows. Verify reconciliation.

## Single exact owner action that unblocks P3
Grant the agent Vercel access (authorize the Vercel connector via `/mcp` in an interactive session) OR
perform Steps 1–6 yourself and return the staging URL. Then the agent will add
`playwright.staging.config.ts` and run the real-target E2E (Step 7) against it.
