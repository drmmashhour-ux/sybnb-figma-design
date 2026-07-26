-- 039 — D2: record the disbursing admin on the payout for maker!=checker dual control.
--
-- Additive + nullable, backward-compatible: existing rows get NULL. Disburse now rejects an actor equal to
-- Payout.released_by_id or the booking's approved PaymentProof.reviewed_by_id (403 PAYOUT_DUAL_CONTROL_REQUIRED),
-- and stamps the disbursing actor here on success — the audit-symmetry counterpart to released_by_id/reviewed_by_id.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). `prisma db push` also creates this column from the schema; on a
-- migrate-deploy-provisioned environment this file is the source of record.

ALTER TABLE payouts ADD COLUMN IF NOT EXISTS disbursed_by_id TEXT;
