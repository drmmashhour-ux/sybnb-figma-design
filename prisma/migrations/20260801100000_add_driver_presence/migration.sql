-- SR driver presence (Phase 1): record WHEN a driver last broadcast their idle location, so the
-- nearest-first pending pool can ignore stale positions. `active` (online flag) and `last_location_geo`
-- already exist on driver_profiles; this only adds the timestamp.
ALTER TABLE "driver_profiles" ADD COLUMN "last_location_at" TIMESTAMP;

-- Speeds up "online drivers with a recent location" scans used by dispatch.
CREATE INDEX IF NOT EXISTS "driver_profiles_active_last_location_at_idx"
  ON "driver_profiles" ("active", "last_location_at");
