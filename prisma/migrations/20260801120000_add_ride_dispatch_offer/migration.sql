-- SR auto-dispatch (Phase 2): when a ride is requested, it's OFFERED to the nearest online driver for a
-- short exclusive window before opening to the wider nearest-first pool. These two columns track that
-- offer. Nullable + additive — existing rides are simply "unoffered" (open pool), so no backfill.
ALTER TABLE "ride_requests" ADD COLUMN "offered_driver_id" UUID;
ALTER TABLE "ride_requests" ADD COLUMN "offer_expires_at" TIMESTAMP;

-- Drivers poll for "rides currently offered to me"; this index serves that lookup.
CREATE INDEX IF NOT EXISTS "ride_requests_offered_driver_idx"
  ON "ride_requests" ("offered_driver_id", "offer_expires_at");
