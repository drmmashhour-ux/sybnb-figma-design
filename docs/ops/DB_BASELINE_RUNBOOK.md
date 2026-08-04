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

### Step 1 — Collect READ-ONLY evidence (P1 gate)

Run BOTH of these against production. Neither writes anything (`migrate diff --script` prints SQL, it
does not execute it; the diagnostic issues only SELECTs). **Do not paste the connection string back.**

```bash
# PROD_URL = the production/staging connection string (keep it in your shell only; never commit it)

# (a) Structured read-only diagnostic — id types, migration state, object inventory, FK type-compat.
DATABASE_URL="$PROD_URL" node scripts/prod-db-diagnose.mjs > prod-diagnose.json

# (b) Full schema delta prod -> repo schema (read-only; --script does NOT apply anything).
DATABASE_URL="$PROD_URL" npx prisma migrate diff \
  --from-url "$PROD_URL" --to-schema-datamodel prisma/schema.prisma --script > prod-vs-schema.sql

# (c) Exit-code form for a quick "match / differ" signal (0 = no diff, 2 = differs).
DATABASE_URL="$PROD_URL" npx prisma migrate diff \
  --from-url "$PROD_URL" --to-schema-datamodel prisma/schema.prisma --exit-code; echo "exit=$?"
```

**Return `prod-diagnose.json` + `prod-vs-schema.sql` + the exit code.** That is the P1 evidence.

**Known-good reference (the dev DB, post-B1, verified 2026-07-27):**
| Signal | Healthy value (dev) | RED flag on prod |
|---|---|---|
| `id_column_type_distribution` | only `text` (184 cols) | any `uuid` → **old uuid lineage** |
| `key_table_id_types` | all `text` | any `uuid` |
| `incompatible_fk_type_pairs` | `[]` (empty) | **non-empty** → text↔uuid FK mismatch (the B1 defect) |
| `prisma_migrations` | `00000000000000_init_baseline`, `20260727000000_add_rate_limit_hits` | orphaned/unknown rows |
| base tables / enums / FKs / indexes | 64 / 48 / 96 / 177 | large deltas → investigate via `prod-vs-schema.sql` |
| `extensions` | `plpgsql`, `postgis` | missing `postgis` |

### Decision tree (interpret the evidence — do NOT act until it points to a branch)

- **Prod ids include `uuid` OR `incompatible_fk_type_pairs` is non-empty →** prod is on the **old uuid
  lineage**. **STOP. Do NOT baseline, do NOT `migrate resolve`, do NOT deploy.** This needs a
  data-preserving `uuid → text` conversion (per-table `ALTER … TYPE text USING id::text`, FKs dropped
  and recreated, with a full backup + a rehearsed rollback). Bring `prod-vs-schema.sql` back for a
  reviewed conversion plan. **P1 stays RED.**
- **Prod is all-`text`, `incompatible_fk_type_pairs` empty, AND `prod-vs-schema.sql` is empty (exit 0) →**
  prod already matches the baseline. Safe to baseline (Step 2). **P1 → GREEN after Step 3 verifies.**
- **Prod is all-`text` but `prod-vs-schema.sql` is non-empty →** review every statement. Extra frozen
  tables/columns are expected (they exist in dev too and ARE in the schema now). Only proceed once every
  line is understood and intentionally reconciled; otherwise **P1 stays RED** pending a plan.

> The diagnostic tool itself is verified: run against the dev DB it returns the "healthy" column above
> (all-text, empty incompatible-FK set). That is the reference the prod output is compared against.

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
