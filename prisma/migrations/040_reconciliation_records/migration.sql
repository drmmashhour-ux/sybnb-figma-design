-- 040 — Fix E: received-funds reconciliation records (append-only, one MATCHED per payment).
--
-- Additive: a new table, nothing existing is altered. One row per reconciliation ATTEMPT of a frozen Payment
-- against a merchant-statement line. Status is decided at INSERT by the pure match function (server/lib/
-- reconciliation.mjs) and never edited in place — a re-attempt is a NEW row, and a MISMATCH is never flipped to
-- MATCHED. Two durable guarantees mirror the audit-log design (migration 037):
--   1. a partial UNIQUE index enforces at most one MATCHED row per payment (the "unique-per-match target"),
--      while allowing any number of PENDING/MISMATCH attempts;
--   2. a BEFORE UPDATE OR DELETE trigger RAISEs, so even the table owner cannot mutate a row on a normal write
--      (append-only). INSERT and SELECT stay fully allowed.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE trigger). NOTE: `prisma db push` provisions the
-- TABLE and its regular indexes from schema.prisma, but does NOT execute this raw SQL — the partial unique
-- index and the trigger must be applied explicitly (migrate deploy / `prisma db execute --file`) on a
-- db-push-provisioned environment.

CREATE TABLE IF NOT EXISTS reconciliation_records (
  id              TEXT PRIMARY KEY,
  booking_id      TEXT NOT NULL,
  payment_id      TEXT NOT NULL,
  statement_ref   TEXT NOT NULL,
  amount_minor    INTEGER NOT NULL,
  currency        TEXT NOT NULL,
  source          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  mismatch_reason TEXT,
  matched_by_id   TEXT,
  matched_at      TIMESTAMP(3),
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reconciliation_records_payment_id_fkey
    FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE CASCADE ON UPDATE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reconciliation_records_booking_id_status_idx ON reconciliation_records (booking_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reconciliation_records_payment_id_status_idx ON reconciliation_records (payment_id, status);
--> statement-breakpoint
-- At most one MATCHED reconciliation per payment; PENDING/MISMATCH attempts are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_records_one_match_per_payment
  ON reconciliation_records (payment_id) WHERE status = 'MATCHED';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reconciliation_records_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reconciliation_records is append-only: % is not permitted (a re-attempt is a new row)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS reconciliation_records_append_only ON reconciliation_records;
--> statement-breakpoint
CREATE TRIGGER reconciliation_records_append_only
  BEFORE UPDATE OR DELETE ON reconciliation_records
  FOR EACH ROW EXECUTE FUNCTION reconciliation_records_reject_mutation();
