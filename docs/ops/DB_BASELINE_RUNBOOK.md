# DB Baseline Runbook — squashed migration history (B1 fix)

## What changed and why

The old `prisma/migrations/001–025` were internally inconsistent: `001–017` were hand-written
with native Postgres **`uuid`** primary/foreign keys, while `schema.prisma` (and the
Prisma-generated `018–025`) used **`text`**. A `text → uuid` foreign key is illegal in Postgres,
so **both `prisma migrate dev` (shadow build) and `prisma migrate deploy` (fresh DB) failed at
migration 018.** No new environment could be provisioned from the migration history.

The running databases were actually built by `prisma db push` (all `text`), so they never matched
the migration files. They also physically contain a **frozen Quebec / tax / legacy-payments layer**
that `schema.prisma` had been slimmed to omit.

**The fix:** `schema.prisma` was re-introspected so it once again describes the *entire* database
(STR models unchanged; frozen Quebec/tax/payments models restored as inert snake_case models;
PostGIS declared as a managed extension). The 25 legacy migrations were archived to
`docs/archive/legacy-migrations-pre-baseline/` and replaced by a single, verified, replayable
baseline: `prisma/migrations/00000000000000_init_baseline/`.

Verified locally:
- `migrate diff (dev DB → schema)` = **No difference**
- baseline replayed into a throwaway DB and `migrate diff (migrations → schema)` = **No difference**
- 66 unit + 361 API + 19 security tests pass; `tsc` + `vite build` green.

The dev DB has already been baselined (`_prisma_migrations` cleared of the stale
`036_payment_payout_records` row; baseline marked applied).

---

## Applying to the EXISTING prod / staging DB — DO THIS CAREFULLY

The prod/staging DB already has tables. **Do NOT run `prisma migrate deploy` against it** — that
would try to *create* tables that already exist and error out. The correct operation is to
**baseline** it (record the baseline as already-applied) **only after proving its structure matches
the baseline.**

> ⚠️ Take a full backup / snapshot of the prod DB before doing anything below.

### Step 1 — Prove the prod DB matches the new schema (READ-ONLY)

```bash
# PROD_URL = the production/staging connection string (do not commit it)
npx prisma migrate diff \
  --from-url "$PROD_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

- **"No difference detected" (exit 0):** prod matches the baseline → safe to baseline (Step 2).
- **Any differences reported (exit 2):** STOP. The prod DB is not identical to dev. Two common cases:
  - Prod was built from the **old `uuid` migrations** → its id columns are `uuid`, not `text`.
    This is a real type mismatch that needs a data-preserving conversion — **do not baseline; bring
    the diff back for review.**
  - Prod has a slightly different set of frozen tables/columns. Review each line; only proceed once
    the diff is empty or every difference is understood and intentionally reconciled.

### Step 2 — Baseline (only if Step 1 was empty)

```bash
# Clear any stale migration-tracking rows that reference migrations no longer in the repo,
# then record the baseline as already-applied WITHOUT running it.
# (Inspect first; only delete rows you recognise as stale.)
#   SELECT migration_name FROM _prisma_migrations;
#   DELETE FROM _prisma_migrations;          -- if all rows are stale/orphaned

DATABASE_URL="$PROD_URL" npx prisma migrate resolve --applied 00000000000000_init_baseline
```

### Step 3 — Verify

```bash
DATABASE_URL="$PROD_URL" npx prisma migrate status   # expect: "Database schema is up to date!"
```

From here on, new schema changes flow through normal `prisma migrate dev` (locally) →
`prisma migrate deploy` (prod), which now works because the history is consistent.

---

## Fresh environment (new DB from scratch)

```bash
DATABASE_URL="$NEW_URL" npx prisma migrate deploy   # applies the single baseline, done
```

## Rollback / recovery

The full pre-baseline migration history is preserved at
`docs/archive/legacy-migrations-pre-baseline/` if it is ever needed for forensic reference.
