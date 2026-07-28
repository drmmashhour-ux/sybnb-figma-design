# STR — Final Launch Checklist (go / no-go)
Updated 2026-07-27 · Branch `security/sybnb-v6-predeployment` · Governing matrix: `STR_LAUNCH_AUDIT_MATRIX.md`

## A. Code / repo readiness — ✅ CERTIFIED GREEN (verified locally)
- [x] Unit **69**, API **407**, Security **19**, Browser E2E **38** (2 documented WebKit skips) — all pass
- [x] Smoke: 8 API + 7 route checks pass
- [x] `tsc --noEmit` clean · `vite build` clean
- [x] `npm audit` = **0 vulnerabilities** (full + prod-only); single `brace-expansion@5.0.8`
- [x] Prisma schema valid; migrations = one clean baseline + `add_rate_limit_hits`
- [x] No real `.env` tracked; no hardcoded live keys
- [x] Deploy entry `api/index.mjs` is **fail-closed**: `validateProductionConfig()` runs at cold start in production and refuses to boot on missing/unsafe config (`AUTH_SECRET`/`PHONE_HASH_SECRET` ≥16, `DATABASE_URL`, `CORS_ORIGIN`, `RATE_LIMIT_STORE=db`, no `DISABLE_RATE_LIMIT`)
- [x] Booking no-double-booking invariant proven + concurrency tests hardened (no flakiness)
- [x] Wallet ledger invariant (balance == Σ entries, ≥0), spend/fee/reversal races locked, S5 clawback debt semantics proven
- [x] Stripe immediate-capture path: finalize/idempotency/fail-closed proven locally (fake sessions)
- [x] Tax P6 = A applied: no auto-charged tax (`STR_TAX_RATE=0`)

## B. Owner deploy steps (the remaining work — infra only, no code)
```bash
# 1. Provision production Postgres (Neon). Keep the URL in your shell only.
export PROD_URL='postgresql://…prod…'

# 2. Apply the schema + reference data to the FRESH prod DB (clean baseline; no P1 diagnostic needed).
DATABASE_URL="$PROD_URL" npx prisma migrate deploy
DATABASE_URL="$PROD_URL" node scripts/seed-14-governorates.mjs
# (optional demo accounts) DATABASE_URL="$PROD_URL" DEMO_ACCOUNT_PASSWORD="…" node scripts/seed-demo-accounts.mjs

# 3. Set Vercel PRODUCTION env (project: sybnb-figma-design):
#    NODE_ENV=production, AUTH_SECRET (≥16), PHONE_HASH_SECRET (≥16), DATABASE_URL,
#    CORS_ORIGIN=https://<domain>, RATE_LIMIT_STORE=db, TRUST_PROXY=1, FORCE_HTTPS=1,
#    STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, VITE_STRIPE_PUBLISHABLE_KEY, STRIPE_CURRENCY,
#    email provider (RESEND_API_KEY/SMTP_*, EMAIL_FROM*), SMS provider if used, SYP_PER_USD.

# 4. Register the Stripe webhook (live or test): https://<domain>/api/payments/stripe/webhook → checkout.session.completed
# 5. Deploy to production (Vercel).
# 6. Verify:
curl -s https://<domain>/api/health      # {"ok":true,...,"database":{"ok":true}}
```

## C. Go-live gates the owner must confirm
- [ ] **P1** — prod DB created + `migrate deploy` succeeded + `/api/health` shows `database.ok`
- [ ] **P2** — `RATE_LIMIT_STORE=db` set in prod (fail-closed guard enforces it)
- [ ] **P3** — production deployment succeeded; smoke passes against the live domain
- [ ] **P5** — Stripe keys set; a real test-mode transaction + webhook validated (see the external-validation matrix in the audit doc) before taking live payments
- [ ] **P6** — confirmed launching with **A** (no tax) [applied]
- [ ] **P11** — (if shipping mobile) iOS/Android built + tested against the prod API
- [ ] **Backups/monitoring** — DB backups/PITR enabled; error/latency/webhook alerts on

## D. Final status
- **Code/repo:** `READY FOR DEPLOYMENT` (technically certified — every code gate green).
- **Overall launch:** `NOT LIVE UNTIL C IS SATISFIED` — the remaining items are owner-side infra/ops
  (provision DB, set env, deploy, real Stripe validation, backups/monitoring). No code work remains.
