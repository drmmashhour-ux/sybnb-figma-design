-- Reconcile the SR dispatch migrations with the platform's canonical schema.
--
-- Platform identifiers are stored as TEXT throughout the database. Prisma's
-- @default(uuid()) generates UUID-shaped values but does not use PostgreSQL's
-- native UUID type unless @db.Uuid is declared. offered_driver_id identifies a
-- users.id value, so keeping it as UUID would leave one incompatible identifier
-- column and require application-side casts.
--
-- Prisma maps an unannotated PostgreSQL DateTime to TIMESTAMP(3). The original
-- incremental migrations used unqualified TIMESTAMP (precision 6), which caused
-- persistent drift after an otherwise successful fresh migration replay.

ALTER TABLE "driver_profiles"
  ALTER COLUMN "last_location_at" TYPE TIMESTAMP(3);

ALTER TABLE "ride_requests"
  ALTER COLUMN "offered_driver_id" TYPE TEXT USING "offered_driver_id"::text,
  ALTER COLUMN "offer_expires_at" TYPE TIMESTAMP(3);

-- The two existing indexes are intentionally retained. Their mapped definitions
-- now live in schema.prisma, so no index DDL is required here.
