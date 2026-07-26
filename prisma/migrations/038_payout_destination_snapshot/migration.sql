-- 038 — D1: freeze the payout destination on the Payout row.
--
-- Additive + nullable, so it is backward-compatible: existing rows get NULL, and disburse refuses a NULL
-- destination (403 PAYOUT_DESTINATION_MISSING) rather than reading the live host method. `destination_snapshot`
-- holds a copy of the host's User.payoutMethod captured in the SAME transaction that freezes amountMinor;
-- `destination_fingerprint` is a hash of that snapshot for tamper-evident comparison.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). NOTE: `prisma db push` also creates these columns from the schema,
-- but on a migrate-deploy-provisioned environment this file is the source of record.

ALTER TABLE payouts ADD COLUMN IF NOT EXISTS destination_snapshot JSONB;
--> statement-breakpoint
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS destination_fingerprint TEXT;
