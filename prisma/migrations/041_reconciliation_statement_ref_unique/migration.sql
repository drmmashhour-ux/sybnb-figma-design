-- 041 — F3: one real deposit line backs at most ONE MATCHED reconciliation.
--
-- ReconciliationRecord.statement_ref is a merchant-statement line id (a Sham Cash transaction id) — one real
-- received-funds deposit. Reuse was caught app-side only (server/routes/admin.mjs -> MISMATCH DUPLICATE), but two
-- CONCURRENT reconciles of the same line could both pass the app read-check and both INSERT a MATCHED row
-- (TOCTOU) — one deposit backing two payouts (phantom funds). This partial UNIQUE index makes that impossible at
-- the DB layer: at most ONE MATCHED row per statement_ref. It is keyed on statement_ref ALONE (not currency),
-- since a statement line is one deposit regardless of denomination — scoping by currency would let the same ref
-- back two MATCHED rows in different currencies. MISMATCH/PENDING re-attempts stay unconstrained (append-only
-- preserved), and this composes with migration 040's one-MATCHED-per-payment index. The app-side DUPLICATE check
-- is kept as the first line of defense (a friendly MISMATCH instead of a raw constraint error on the common path).
--
-- Additive + idempotent (CREATE UNIQUE INDEX IF NOT EXISTS). NOTE: `prisma db push` provisions the table but does
-- NOT execute this raw SQL — apply it explicitly (migrate deploy / `prisma db execute --file`) on a
-- db-push-provisioned environment.

CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_records_one_match_per_statement_ref
  ON reconciliation_records (statement_ref) WHERE status = 'MATCHED';
