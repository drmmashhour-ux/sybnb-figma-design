-- SR driver payouts are paid via Sham Cash using the driver's payout method on file. These two
-- nullable columns hold that method (e.g. 'SHAM_CASH') and the account reference (the Sham Cash
-- number/handle). Nullable/default-null: existing driver profiles simply have no method until one
-- is added, and POST /api/admin/sr-payouts/:driverId/release refuses a payout without one.
-- (Renumbered to 016 so it follows the SR safety-layer 014 and trust-layer 015 migrations.)
ALTER TABLE "driver_profiles" ADD COLUMN "payout_method" TEXT;
ALTER TABLE "driver_profiles" ADD COLUMN "payout_account_ref" TEXT;
