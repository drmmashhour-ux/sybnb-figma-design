# SYBNB — Go-Live Runbook (STR + Synitres, one deploy)

**Audience:** the owner (or an agent acting with the owner's authenticated Vercel/Neon/Stripe access).
**What ships:** the whole `security/sybnb-v6-predeployment` branch — STR stays **and** Synitres
real-estate — in a single deploy. Code is verified green (655 automated tests, API + browser E2E).
Everything below is **owner config**; no code changes remain.

> **Fill every `<…>` with your own secret value.** Never commit secrets to git. Prefer the Vercel
> **dashboard** for entering secret values (it masks them) over shell history. Run **staging first**,
> verify, then production. Production deploy + live payment/auth are irreversible — do them deliberately.

Project (from `.vercel/project.json`, non-secret): `projectName=sybnb-figma-design`,
`projectId=prj_oY9ipzr8BencTqKcmVeWhhhDR3G0`, `orgId=team_04V3WENk58PlfnkpEhiCdJfY`.

---

## 0. Prerequisites (once)

```bash
npm i -g vercel@latest            # session's CLI was old (52.x); use latest
vercel login                      # your Vercel account
vercel link --project sybnb-figma-design   # from the repo root
```

You will also need: a **Neon** (Postgres) account, a **Stripe** account (test + live keys), and an
email sender — **Resend** API key *or* SMTP creds. Generate the two app secrets now:

```bash
openssl rand -base64 24    # use for AUTH_SECRET
openssl rand -base64 24    # use for PHONE_HASH_SECRET
```

---

## 1. Environment variables

### A) HARD-REQUIRED — the server refuses to boot in production without these
(`server/lib/env.mjs` `validateProductionConfig`)

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `AUTH_SECRET` | `<random ≥16 chars>` | session/token signing |
| `PHONE_HASH_SECRET` | `<random ≥16 chars>` | phone hashing |
| `DATABASE_URL` | `<neon POOLED url>` | runtime uses the **pooled** endpoint |
| `CORS_ORIGIN` | `https://sybnb.app` | the real origin(s), comma-separated; no trailing slash |
| `RATE_LIMIT_STORE` | `db` | shared limiter (in-memory is per-instance on serverless) |
| `TRUST_PROXY` | `1` | Vercel is proxied; without it all clients bucket as one IP (self-DoS) |
| `FORCE_HTTPS` | `1` | turns on app-level HSTS (`server/lib/security-headers.mjs`) |

Also: **do NOT set `DISABLE_RATE_LIMIT=1`** — the server refuses to boot with it.

### B) FEATURE-ENABLING — app boots without them, but the feature stays off

| Variable | Enables | Without it |
|---|---|---|
| `RESEND_API_KEY` *(or `SMTP_HOST`,`SMTP_PORT`,`SMTP_USER`,`SMTP_PASS`)* | **Email OTP** (sign-up + staff/admin login) | **sign-up + admin login blocked (503)** — the #1 launch blocker |
| `STRIPE_SECRET_KEY` | card payments (guest + host plan) | only Sham Cash (manual) works |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature check | webhook returns 503 |
| `VITE_STRIPE_PUBLISHABLE_KEY` | client Stripe UI (**build-time** — redeploy after change) | card UI hidden |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | first admin auto-created on deploy (`postbuild` runs bootstrap) | no admin exists to approve listings |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob media storage (listing photos, ID docs) | **photo/doc uploads fail on serverless** — confirm a Blob store exists for this project |
| `ANTHROPIC_API_KEY` | real AI descriptions + pricing insights | silently falls back to the deterministic template |
| `CRON_SECRET` | authenticates the `/api/cron/maintenance` cron (fail-closed) | cron rejected |

### C) REMOVE
| Variable | Why |
|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | the map is free OpenStreetMap now — removing it stops stray Maps billing |

Enter values in **Vercel → sybnb-figma-design → Settings → Environment Variables** (scope: the
target environment). CLI alternative (prompts for the value, not echoed):
```bash
vercel env add AUTH_SECRET production      # repeat per variable / environment
vercel env rm VITE_GOOGLE_MAPS_API_KEY production
```

---

## 2. Database (Neon)

Runtime uses the **pooled** URL (`DATABASE_URL`, step 1A). Prisma **migrations must run against the
DIRECT (non-pooled) URL** — pgbouncer can't run DDL. The schema uses a single `env("DATABASE_URL")`,
so point it at the direct URL just for the migrate command:

```bash
# STAGING: a FRESH, empty Neon DB is the clean path — the squashed baseline + increments apply with
# zero drift (proven). Use its DIRECT connection string here:
DATABASE_URL="<neon-staging-DIRECT-url>" npx prisma migrate deploy
```

- **Fresh prod DB (recommended):** same command with the prod direct URL → clean apply.
- **Existing prod DB (the current sybnb.app DB was built by `db push`):** it needs a **one-time
  baseline** before `migrate deploy` will work — follow **`docs/ops/DB_BASELINE_RUNBOOK.md`** exactly
  first, then run the migrate. Do **not** run a bare `migrate deploy` against the existing prod DB
  without that step.

---

## 3. Staging deploy + verify

1. Set the **step-1 variables on the Preview/Staging environment** (staging DB URL, staging
   `CORS_ORIGIN`, Stripe **test** keys, etc.).
2. Deploy a preview build:
   ```bash
   vercel deploy            # prints a https://…vercel.app preview URL  → call it STAGING_URL
   ```
3. Smoke-check the deployed target (replace `STAGING_URL`):
   ```bash
   curl -s "$STAGING_URL/api/health"                       # {"ok":true,"database":{"ok":true,...}}
   curl -s "$STAGING_URL/api/listings?division=BUY"        # {"listings":[...]}  (once inventory exists)
   curl -s "$STAGING_URL/api/listings?division=STAYS"      # {"listings":[...]}
   curl -s -o /dev/null -w "%{http_code}\n" "$STAGING_URL/api/me/properties"   # 401 (auth gate)
   ```
   Open `STAGING_URL` in a browser: sign up a guest (email OTP must arrive), list a place as a host,
   approve it as the admin, confirm it appears in search with a working map pin, open a property on
   `/synitres` → `/buy`, and confirm the gallery + "Recently viewed" render.
4. **Real payment test (Stripe test mode):** run one guest booking + one host-plan payment end to end;
   confirm the webhook fires and the booking/plan flips to paid. (See `STR_STAGING_DEPLOY_RUNBOOK.md`
   for the detailed staging steps.)

Only proceed to production once staging is clean.

---

## 4. Production deploy

1. Set the **step-1 + step-1B variables on the Production environment** (prod DB **pooled** URL,
   `CORS_ORIGIN=https://sybnb.app`, Stripe **live** keys, `RESEND_API_KEY`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`,
   `BLOB_READ_WRITE_TOKEN`, `FORCE_HTTPS=1`, `TRUST_PROXY=1`, remove `VITE_GOOGLE_MAPS_API_KEY`).
2. Run prod migrations (per step 2 — fresh vs existing DB).
3. Promote to production:
   ```bash
   vercel deploy --prod        # builds + deploys to the production domain
   ```
   The `postbuild` step creates the first admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` (idempotent).
4. Register the Stripe **live** webhook → endpoint `https://sybnb.app/api/…` (the payments webhook
   path) → set `STRIPE_WEBHOOK_SECRET` to the signing secret it gives you → redeploy.

---

## 5. Post-launch verification (production)

```bash
curl -s "https://sybnb.app/api/health"                     # ok:true, database ok
curl -s -o /dev/null -w "%{http_code}\n" "https://sybnb.app/api/me/properties"   # 401
curl -sI "https://sybnb.app/" | grep -i "strict-transport-security\|content-security-policy"  # headers present
```
Then in a browser on `https://sybnb.app`: sign in at the partner/admin gate with the admin creds,
publish + approve one real listing, and run one **live** low-value payment to confirm the real rail.

---

## 6. Rollback

Vercel keeps every deployment. To revert instantly:
```bash
vercel ls                        # find the last-good production deployment
vercel promote <deployment-url>  # re-promote it to production
```
Env-var and DB changes are **not** rolled back by this — a bad migration must be fixed forward or
restored from a Neon branch/backup (ensure PITR/backups are on before launch).

---

## Notes / decisions (non-blocking, from the launch audit)

- **Tax:** `STR_TAX_RATE = 0` (decision A: disclosed-not-charged). Activating a real rate first needs
  the collection + remittance wiring in `docs/product/STR_TAX_DECISION_REQUEST.md`.
- **Payouts:** manual admin release after an out-of-band Sham Cash transfer; no automated PSP payout.
- **Seed currency:** some *dev* fixtures are `SYP`; production is USD-only — start prod with clean data.
- **Synitres visibility:** deploying makes `/synitres`, `/buy`, `/rentals`, `/property/:id` reachable on
  `sybnb.app`. If Synitres should live on its own domain (`synitres.com`) or stay hidden for now, decide
  routing/domain before launch — the code ships either way.

**Deeper references:** `docs/ops/STR_STAGING_DEPLOY_RUNBOOK.md` (detailed staging), `docs/ops/DB_BASELINE_RUNBOOK.md`
(existing-DB baseline), `docs/ops/LAUNCH_CHECKLIST.md` (owner checklist), `docs/ops/STR_FINAL_LAUNCH_CHECKLIST.md`.
