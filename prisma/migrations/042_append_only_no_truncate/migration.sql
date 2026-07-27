-- 042 — F4: block TRUNCATE on the append-only tables (admin_audit_logs, reconciliation_records).
--
-- The BEFORE UPDATE OR DELETE triggers from 037/040 make these tables row-immutable, but TRUNCATE is a
-- STATEMENT-level operation that fires NEITHER — so the append-only guarantee was bypassable with a single
-- `TRUNCATE admin_audit_logs`. This adds BEFORE TRUNCATE ... FOR EACH STATEMENT triggers that RAISE, reusing
-- the same reject functions (mirrored here with CREATE OR REPLACE so this migration is self-contained and
-- idempotent — re-affirming the identical bodies from 037/040, which the existing UPDATE/DELETE triggers keep
-- using unchanged). INSERT and SELECT stay fully allowed; the UPDATE/DELETE triggers are untouched.
--
-- SCOPE: only the truly-immutable tables. Payout/Payment are deliberately mutable state records and get no
-- immutability trigger.
--
-- Idempotent (CREATE OR REPLACE / DROP+CREATE trigger). NOTE: `prisma db push` does NOT execute raw SQL — apply
-- this explicitly (migrate deploy / `prisma db execute --file`) on a db-push-provisioned environment.
--
-- CAVEAT (provisioning, not code): a table OWNER can still `ALTER TABLE ... DISABLE TRIGGER` or DROP it. If the
-- app runtime Neon role OWNS these tables, this trigger is defeatable by that role — the definitive fix is a
-- least-privilege runtime role that is NOT the table owner (a pilot DB-provisioning task, out of scope here).

CREATE OR REPLACE FUNCTION admin_audit_logs_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs is append-only: % is not permitted (audit rows are immutable)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_audit_logs_no_truncate ON admin_audit_logs;
--> statement-breakpoint
CREATE TRIGGER admin_audit_logs_no_truncate
  BEFORE TRUNCATE ON admin_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_logs_reject_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reconciliation_records_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reconciliation_records is append-only: % is not permitted (a re-attempt is a new row)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS reconciliation_records_no_truncate ON reconciliation_records;
--> statement-breakpoint
CREATE TRIGGER reconciliation_records_no_truncate
  BEFORE TRUNCATE ON reconciliation_records
  FOR EACH STATEMENT EXECUTE FUNCTION reconciliation_records_reject_mutation();
