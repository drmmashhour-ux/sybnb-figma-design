-- SR pickup PIN: a 4-digit per-ride code the rider shares with the driver at pickup to confirm the
-- correct rider↔driver pairing. The trip cannot start (IN_PROGRESS) until the driver enters the
-- matching code. pin_attempts locks brute-force after a few misses.
-- (Migration 017 — follows SR safety 014, trust 015, money 016.)
ALTER TABLE "ride_requests" ADD COLUMN "pickup_pin" TEXT;
ALTER TABLE "ride_requests" ADD COLUMN "pickup_verified_at" TIMESTAMP(3);
ALTER TABLE "ride_requests" ADD COLUMN "pin_attempts" INTEGER NOT NULL DEFAULT 0;
