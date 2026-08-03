# Database zero-drift reconciliation — 2026-08-03

## Decision

This change reconciles the published SR presence/dispatch migrations with the canonical Prisma
contract. It does not change any Neon/Vercel connection string and does not authorize a staging or
production deployment.

## Root causes and canonical contracts

1. `driver_profiles.last_location_at`
   - The published migration created `TIMESTAMP` (PostgreSQL default precision 6).
   - Prisma's unannotated `DateTime?` expects `TIMESTAMP(3)`.
   - Canonical contract: nullable `TIMESTAMP(3)`.
2. `ride_requests.offered_driver_id`
   - The published migration created native `UUID`.
   - Platform identifiers, including `users.id`, `driver_profiles.user_id`, and
     `ride_requests.driver_id`, are stored as `TEXT`. Prisma's `@default(uuid())` generates a
     UUID-shaped value but does not select PostgreSQL's native UUID type without `@db.Uuid`.
   - Application dispatch assigns `users.id` strings directly and contained explicit `::text`
     casts solely to tolerate the mismatched column.
   - Canonical contract: nullable `TEXT`. No foreign key is added by this reconciliation because
     the published feature did not define one and its lifecycle semantics require a separate
     design decision.
3. `ride_requests.offer_expires_at`
   - The published migration created `TIMESTAMP` (precision 6).
   - Prisma expects `TIMESTAMP(3)`.
   - Canonical contract: nullable `TIMESTAMP(3)`.
4. Migration-managed indexes were absent from `schema.prisma`.
   - `driver_profiles_active_last_location_at_idx`: non-unique B-tree on
     `(active, last_location_at)`.
   - `ride_requests_offered_driver_idx`: non-unique B-tree on
     `(offered_driver_id, offer_expires_at)`.
   - Both are intentional query-path indexes and are expressible with mapped Prisma `@@index`
     declarations.

## Forward migration and compatibility

`20260803000000_reconcile_dispatch_schema` changes the two timestamps to precision 3 and converts
`offered_driver_id` from UUID to text with an explicit `USING offered_driver_id::text`. Every
existing UUID value has a lossless text representation. The indexes are retained; no index drop or
recreate is required.

The migration is forward-only. An automatic rollback is unsafe after new writes because the
canonical text column may later contain a non-UUID identifier. A rollback would require a
pre-check proving every non-null value passes a UUID cast, followed by an explicitly reviewed
`TYPE UUID USING offered_driver_id::uuid` migration. Restoring a disposable database is preferred
for test rollback; production rollback requires a snapshot and a reviewed forward fix.

## Validation evidence

- Upgrade: applied the reconciliation migration to the preserved PostgreSQL 17 database after the
  original eight migrations; `prisma migrate status` reported current and the exact drift command
  returned `No difference detected` / exit 0.
- Fresh install: replayed all nine migrations into an empty PostgreSQL 17 database, generated the
  Prisma client, verified current migration status, and received zero drift / exit 0.
- Catalog: both timestamp columns are `timestamp without time zone` precision 3;
  `offered_driver_id` is `text`; both indexes are non-unique B-tree indexes with the ordered columns
  listed above.
- Tests: 124 unit + 512 API + 19 security tests passed (655 total) against a disposable guarded
  local PostgreSQL 17 + PostGIS database.
- TypeScript/build: `tsc --noEmit` and the production build passed.
- Lint/secret scanning: the repository has no ESLint configuration/script and no dedicated secret
  scanner. `git diff --check` and a focused credential/private-key pattern scan of the diff passed.

## Deployment state

Production and Vercel configuration were not changed. Review this commit before separately
authorizing any Preview database switch or staging deployment.
