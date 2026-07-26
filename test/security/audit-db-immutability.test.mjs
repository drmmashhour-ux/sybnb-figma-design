import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'

// Apply the ACTUAL migration 037 SQL (split on its statement-breakpoint markers) so this test exercises the
// exact trigger that ships, not a hand-copied duplicate.
const MIGRATION_SQL = readFileSync(new URL('../../prisma/migrations/037_audit_immutability/migration.sql', import.meta.url), 'utf8')
const MIGRATION_STATEMENTS = MIGRATION_SQL.split('--> statement-breakpoint')
  .map((chunk) => chunk.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)

// DB-LEVEL immutability for admin_audit_logs: app-code discipline (C9 static scan) keeps the app from ever
// calling .update/.delete, but the runtime role OWNS the table (sybnb_v6_test_role / prod neondb_owner), so
// a REVOKE is a no-op — an owner bypasses it. Migration 037 installs a BEFORE UPDATE OR DELETE trigger that
// RAISEs, which even the owner cannot bypass on a normal write. INSERT/SELECT stay allowed.
//
// This suite applies the migration's trigger in beforeAll and DROPS it in afterAll so it exists only for the
// duration of this one file (the DB tests run sequentially — vitest.config.ts fileParallelism:false — so no
// other file's audit-cleanup deleteMany runs while the trigger is active).

async function seedAuditRow(action) {
  return db().adminAuditLog.create({ data: { actorUserId: null, action, entityType: 'audit_immutability_test', entityId: 'probe' } })
}

describe('admin_audit_logs DB-level immutability (append-only)', () => {
  let seedRowId
  const createdRowIds = []

  beforeAll(async () => {
    // Seed a row BEFORE the trigger (INSERT is always allowed anyway), then install the trigger.
    const seed = await seedAuditRow('AUDIT_IMMUTABILITY_SEED')
    seedRowId = seed.id
    createdRowIds.push(seed.id)
    for (const stmt of MIGRATION_STATEMENTS) await db().$executeRawUnsafe(stmt)
  })

  afterAll(async () => {
    // Drop the trigger FIRST so the row cleanup below (a DELETE) is permitted again; then remove seeds.
    await db().$executeRawUnsafe('DROP TRIGGER IF EXISTS admin_audit_logs_append_only ON admin_audit_logs').catch(() => {})
    await db().$executeRawUnsafe('DROP FUNCTION IF EXISTS admin_audit_logs_reject_mutation()').catch(() => {})
    await db().adminAuditLog.deleteMany({ where: { id: { in: createdRowIds } } }).catch(() => {})
  })

  it('UPDATE on an audit row is REJECTED at the DB layer', async () => {
    await expect(db().adminAuditLog.update({ where: { id: seedRowId }, data: { action: 'TAMPERED' } })).rejects.toThrow(/append-only|not permitted/i)
  })

  it('DELETE on an audit row is REJECTED at the DB layer', async () => {
    await expect(db().adminAuditLog.delete({ where: { id: seedRowId } })).rejects.toThrow(/append-only|not permitted/i)
  })

  it('INSERT of a new audit row still SUCCEEDS', async () => {
    const row = await seedAuditRow('AUDIT_IMMUTABILITY_INSERT_OK')
    createdRowIds.push(row.id)
    expect(row.id).toBeTruthy()
  })
})
