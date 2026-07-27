import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Fix F4 — TRUNCATE bypass of append-only immutability. The 037/040 triggers reject UPDATE/DELETE but TRUNCATE is
// a statement-level op that fires neither, so `TRUNCATE admin_audit_logs` (or reconciliation_records) would wipe
// the table. Migration 042 adds BEFORE TRUNCATE ... FOR EACH STATEMENT triggers that RAISE. `prisma db push`
// skips raw SQL, so — like the 037/040 suites — this file applies migration 042 in beforeAll and drops the
// TRUNCATE triggers in afterAll. DB tests run sequentially (fileParallelism:false), so nothing races them. This
// file installs ONLY the TRUNCATE triggers (not the UPDATE/DELETE ones), so its own DELETE cleanup stays allowed.

const MIGRATION_SQL = readFileSync(new URL('../../prisma/migrations/042_append_only_no_truncate/migration.sql', import.meta.url), 'utf8')
const MIGRATION_STATEMENTS = MIGRATION_SQL.split('--> statement-breakpoint')
  .map((chunk) => chunk.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)

describe('admin_audit_logs + reconciliation_records reject TRUNCATE (append-only, F4)', () => {
  const userIds = []
  const bookingIds = []
  const auditIds = []
  const recordIds = []

  beforeAll(async () => {
    // Seed one row into each table BEFORE the triggers (INSERT is always allowed).
    const audit = await db().adminAuditLog.create({ data: { actorUserId: null, action: 'F4_TRUNCATE_SEED', entityType: 'f4_truncate_test', entityId: 'probe' } })
    auditIds.push(audit.id)

    const host = await db().user.create({ data: { email: uniqueTestEmail('f4-host'), passwordHash: hashPassword('correct-horse-battery'), displayName: 'F4 HOST', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'HOST' } } } })
    const guest = await db().user.create({ data: { email: uniqueTestEmail('f4-guest'), passwordHash: hashPassword('correct-horse-battery'), displayName: 'F4 GUEST', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'GUEST' } } } })
    trackTestUser(host.id); trackTestUser(guest.id); userIds.push(host.id, guest.id)
    const listing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'F4', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' } })
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'COMPLETED', amountMinor: 120_00, currency: 'USD' } })
    bookingIds.push(booking.id)
    const payment = await db().payment.create({ data: { bookingId: booking.id, grossMinor: 120_00, commissionBaseMinor: 100_00, commissionRateParts: 150_000, commissionAmountMinor: 15_00, hostPayoutMinor: 105_00, currency: 'USD', settlementRef: 'SETL-F4', baseVersion: 'test' } })
    const rec = await db().reconciliationRecord.create({ data: { bookingId: booking.id, paymentId: payment.id, statementRef: 'SHAM-F4', amountMinor: 120_00, currency: 'USD', source: 'manual', status: 'MATCHED', matchedAt: new Date() } })
    recordIds.push(rec.id)

    for (const stmt of MIGRATION_STATEMENTS) await db().$executeRawUnsafe(stmt)
  })

  afterAll(async () => {
    // Drop the TRUNCATE triggers so nothing lingers; DELETE cleanup below is unaffected by them anyway.
    await db().$executeRawUnsafe('DROP TRIGGER IF EXISTS admin_audit_logs_no_truncate ON admin_audit_logs').catch(() => {})
    await db().$executeRawUnsafe('DROP TRIGGER IF EXISTS reconciliation_records_no_truncate ON reconciliation_records').catch(() => {})
    await db().reconciliationRecord.deleteMany({ where: { id: { in: recordIds } } }).catch(() => {})
    await db().payment.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().booking.deleteMany({ where: { id: { in: bookingIds } } }).catch(() => {})
    await db().listing.deleteMany({ where: { ownerId: { in: userIds } } }).catch(() => {})
    await db().adminAuditLog.deleteMany({ where: { id: { in: auditIds } } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('TRUNCATE admin_audit_logs is REJECTED at the DB layer', async () => {
    await expect(db().$executeRawUnsafe('TRUNCATE admin_audit_logs')).rejects.toThrow(/append-only|not permitted/i)
  })

  it('TRUNCATE reconciliation_records is REJECTED at the DB layer', async () => {
    await expect(db().$executeRawUnsafe('TRUNCATE reconciliation_records')).rejects.toThrow(/append-only|not permitted/i)
  })

  it('INSERT into both tables still SUCCEEDS (append-only, not read-only)', async () => {
    const audit = await db().adminAuditLog.create({ data: { actorUserId: null, action: 'F4_INSERT_OK', entityType: 'f4_truncate_test', entityId: 'probe2' } })
    auditIds.push(audit.id)
    expect(audit.id).toBeTruthy()
    const payment = await db().payment.findFirst({ where: { bookingId: { in: bookingIds } } })
    const rec = await db().reconciliationRecord.create({ data: { bookingId: bookingIds[0], paymentId: payment.id, statementRef: 'SHAM-F4-2', amountMinor: 120_00, currency: 'USD', source: 'manual', status: 'MISMATCH', mismatchReason: 'DUPLICATE' } })
    recordIds.push(rec.id)
    expect(rec.id).toBeTruthy()
  })
})
