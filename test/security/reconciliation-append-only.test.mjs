import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Fix E, Slice 1 — the two DB-level guarantees migration 040 ships for reconciliation_records:
//   1. append-only: a BEFORE UPDATE OR DELETE trigger RAISEs (mirror admin_audit_logs / migration 037), so a
//      MISMATCH can never be flipped to MATCHED in place and a row can never be deleted on a normal write;
//   2. one MATCHED per payment: a partial UNIQUE index rejects a second MATCHED row for the same payment,
//      while any number of PENDING/MISMATCH attempts are allowed.
// `prisma db push` provisions the table but NOT the raw-SQL trigger/partial-index, so — exactly like the audit
// suite — this file applies migration 040's statements in beforeAll and drops the raw objects in afterAll. DB
// tests run sequentially (vitest.config.ts fileParallelism:false), so nothing else races these objects.

const MIGRATION_SQL = readFileSync(new URL('../../prisma/migrations/040_reconciliation_records/migration.sql', import.meta.url), 'utf8')
const MIGRATION_STATEMENTS = MIGRATION_SQL.split('--> statement-breakpoint')
  .map((chunk) => chunk.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)

describe('reconciliation_records DB-level integrity (append-only + one MATCHED per payment)', () => {
  let paymentId
  let bookingId
  const userIds = []
  const recordIds = []

  const mkUser = async (role, label) => {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `E1 ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    userIds.push(u.id)
    return u.id
  }

  const seed = (status, statementRef, extra = {}) => db().reconciliationRecord.create({
    data: { bookingId, paymentId, statementRef, amountMinor: 120_00, currency: 'USD', source: 'manual', status, ...extra },
  }).then((r) => { recordIds.push(r.id); return r })

  beforeAll(async () => {
    const hostId = await mkUser('HOST', 'e1-host')
    const guestId = await mkUser('GUEST', 'e1-guest')
    const listing = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'E1', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' } })
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId, status: 'COMPLETED', amountMinor: 120_00, currency: 'USD' } })
    bookingId = booking.id
    const payment = await db().payment.create({ data: { bookingId, grossMinor: 120_00, commissionBaseMinor: 100_00, commissionRateParts: 150_000, commissionAmountMinor: 15_00, hostPayoutMinor: 105_00, currency: 'USD', settlementRef: 'SHAM-TX-777', baseVersion: 'test' } })
    paymentId = payment.id
    for (const stmt of MIGRATION_STATEMENTS) await db().$executeRawUnsafe(stmt)
  })

  afterAll(async () => {
    // Drop the raw objects FIRST so the cascade cleanup (a DELETE) is permitted again.
    await db().$executeRawUnsafe('DROP TRIGGER IF EXISTS reconciliation_records_append_only ON reconciliation_records').catch(() => {})
    await db().$executeRawUnsafe('DROP FUNCTION IF EXISTS reconciliation_records_reject_mutation()').catch(() => {})
    await db().$executeRawUnsafe('DROP INDEX IF EXISTS reconciliation_records_one_match_per_payment').catch(() => {})
    await db().reconciliationRecord.deleteMany({ where: { id: { in: recordIds } } }).catch(() => {})
    await db().payment.deleteMany({ where: { id: paymentId } }).catch(() => {})
    await db().booking.deleteMany({ where: { id: bookingId } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('INSERT of a MATCHED reconciliation row SUCCEEDS', async () => {
    const row = await seed('MATCHED', 'SHAM-TX-777', { matchedAt: new Date() })
    expect(row.id).toBeTruthy()
    expect(row.status).toBe('MATCHED')
  })

  it('a SECOND MATCHED row for the same payment is REJECTED (one MATCHED per payment)', async () => {
    await expect(seed('MATCHED', 'SHAM-TX-777b', { matchedAt: new Date() })).rejects.toThrow()
  })

  it('multiple PENDING/MISMATCH attempts for the same payment are ALLOWED', async () => {
    const pending = await seed('PENDING', 'SHAM-TX-pending')
    const mismatch = await seed('MISMATCH', 'SHAM-TX-under', { mismatchReason: 'UNDERPAYMENT' })
    expect(pending.id).toBeTruthy()
    expect(mismatch.id).toBeTruthy()
  })

  it('UPDATE on a reconciliation row is REJECTED at the DB layer (append-only)', async () => {
    const row = await seed('MISMATCH', 'SHAM-TX-flip', { mismatchReason: 'WRONG_REFERENCE' })
    await expect(db().reconciliationRecord.update({ where: { id: row.id }, data: { status: 'MATCHED' } })).rejects.toThrow(/append-only|not permitted/i)
  })

  it('DELETE on a reconciliation row is REJECTED at the DB layer (append-only)', async () => {
    const row = await seed('MISMATCH', 'SHAM-TX-del', { mismatchReason: 'OVERPAYMENT' })
    await expect(db().reconciliationRecord.delete({ where: { id: row.id } })).rejects.toThrow(/append-only|not permitted/i)
  })
})
