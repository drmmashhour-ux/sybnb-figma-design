# SYBNB — fully integrated overlay (SR safety + trust + money + pickup PIN, and all earlier security fixes)

This overlay contains **every file I changed or added across the whole session**, already integrated
together, preserving repo paths. Unzip it at your **repo root** and let it overwrite those files. Every
`.mjs` here passes `node --check`. The final gate is your DB test run (I can't run migrations/vitest in my
sandbox) — apply, run the commands below, and send me anything red.

## What's inside (35 files)
- **SR safety (014):** SOS, live location, trip-share — `sr-rides.mjs`, `admin.mjs`, `sr-geocoding.mjs`.
- **SR trust (015):** driver vetting docs, masked ride chat, two-way ratings + safety-match block —
  `auth-context.mjs`, `driver.mjs`, `admin.mjs`, `sr-rides.mjs`, new `driver-document-storage.mjs`/`sr-ratings.mjs`.
- **SR money (016):** prepaid wallet top-up (Sham Cash 1:1 + Mastercard +2.35%), 15% commission cashless
  ride charge, tips (100% to driver), dynamic pricing — `wallet.mjs`, `payments.mjs`, `finance-ledger.mjs`,
  `sr-rides.mjs`, `driver.mjs`, `admin.mjs`, `sr-geocoding.mjs`, new `sr-payments.mjs`/`sr-pricing.mjs`.
- **SR pickup PIN (017):** 4-digit rider code the driver enters; trip gated on it — `sr-rides.mjs`, `driver.mjs`.
- **Earlier security fixes** (already delivered but included so the tree is consistent): STR hardening
  (host self-approve, proof leak, protection-fee, double-approve, concurrency, clawback, seller-plan price,
  availability IDOR, metadata, email leak, underpay, $10 fee), referral 100× fix, booking-detail PII,
  self-review guard, marketplace/SR Part-B fixes.
- `prisma/schema.prisma` (7 new models/fields) + `prisma/migrations/014–017` + `test/support/testServer.mjs`
  (FK-safe cleanup) + 11 test files.

## Apply
```bash
cd <your repo root>
unzip /path/to/SR_INTEGRATED_OVERLAY.zip -d .
# (it writes into server/, prisma/, test/ preserving paths — overwriting those files)
```
If you keep your work in git, do it on a branch and `git diff` to review before committing.

## Run (the loop we agreed on)
```bash
npm run db:generate \
  && npm run db:test:push \
  && npm run test:api \
  && npm run test:security
```
- `db:generate` regenerates the Prisma client from the new `schema.prisma` (so the new models exist).
- `db:test:push` rebuilds the isolated test DB from the schema (creates `sos_events`, `driver_documents`,
  `ride_messages`, `ride_ratings`, the wallet-topup fields, `pickup_pin`, the PostGIS `last_location_geo`, etc.).
- then the two DB-backed suites run.

## Production deploy (separate from the test loop)
The test loop uses `db:test:push` (schema sync). For production, apply the migrations in order:
```bash
prisma migrate deploy   # applies 001…013 then 014_sr_safety_layer → 015 → 016 → 017
```

## If something's red
Send me the failing test name + the assertion error (expected vs received). Likely first-pass items I'd
look at, in order: a Prisma relation/field name mismatch (schema), a test-harness helper signature
(`createSessionToken`/`verifyEmailForTest` shape), or an existing SR test that now needs a **funded rider**
(the balance gate rejects a 0-credit rider — `driver-sr-ride.test.mjs` / `driver-one-active-ride.test.mjs`
may need a `recordWalletEntry` CREDIT in their setup, like `fundRider` in the new tests). I'll turn each
red into a patch.

## One tuning task before launch (not a bug)
Set the real **Syrian holiday dates and high-season ranges** in `SR_PRICING_CONFIG` (server/lib/sr-pricing.mjs)
— I left clearly-marked placeholders. Multiplier values (night 1.25 / traffic 1.2 / holiday 1.5 / season 1.3,
cap 2.5×) are tunable there too.
