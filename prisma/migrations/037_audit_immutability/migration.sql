-- 037 — DB-LEVEL append-only immutability for admin_audit_logs.
--
-- The runtime DB role OWNS this table (test: sybnb_v6_test_role; prod Neon: neondb_owner) and is NOT a
-- superuser. Table owners BYPASS `REVOKE`, so `REVOKE UPDATE, DELETE ... FROM <role>` would be a no-op here.
-- A BEFORE UPDATE OR DELETE trigger that RAISEs an exception cannot be bypassed by a normal write from any
-- role, including the owner (only an explicit `ALTER TABLE ... DISABLE TRIGGER` by the owner/superuser, an
-- ops action, lifts it — e.g. for a legal-retention purge). INSERT and SELECT stay fully allowed, so the
-- app's audit-write path (adminAuditLog.create) is unaffected.
--
-- Idempotent: safe to re-run. NOTE: `prisma db push` does NOT execute raw SQL, so on a db-push-provisioned
-- environment this file must be applied explicitly (e.g. `prisma db execute --file` or `migrate deploy`).

CREATE OR REPLACE FUNCTION admin_audit_logs_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_logs is append-only: % is not permitted (audit rows are immutable)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_audit_logs_append_only ON admin_audit_logs;
--> statement-breakpoint
CREATE TRIGGER admin_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION admin_audit_logs_reject_mutation();
