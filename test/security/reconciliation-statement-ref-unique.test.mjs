import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Fix F3 — one real deposit line backs at most ONE MATCHED reconciliation, enforced at the DB layer. The app
// catches a reused statement_ref (-> MISMATCH DUPLICATE), but two concurrent reconciles of the same line could
// both pass the app read-check and both INSERT a MATCHED row (TOCTOU) = phantom funds. Migration 041 adds a
// partial UNIQUE index on statement_ref WHERE status='MATCHED'. `prisma db push` does not run raw SQL, so — like
// the audit/040 suites — this file applies migration 041 in beforeAll and drops the index in afterAll. DB tests
// run sequentially (fileParallelism:false), so nothing else races the index.

const MIGRATION_SQL = readFileSync(new URL('../../prisma/migrations/041_reconciliation_statement_ref_unique/migration.sql', import.meta.url), 'utf8')
const MIGRATION_STATEMENTS = MIGRATION_SQL.split('--> statement-breakpoint')
  .map((chunk) => chunk.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)

const SHARED_REF = 'SHAM-DEP-F3-SHARED'

describe('reconciliation_records DB-level uniqueness (one MATCHED per statement_ref)', () => {
  let paymentA
  let paymentB
  const userIds = []
  const bookingIds = []
  const recordIds = []

  const mkUser = async (role, label) => {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `F3 ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    userIds.push(u.id)
    return u.id
  }

  const mkPayment = async (hostId, guestId, settlementRef) => {
    const listing = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'F3', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' } })
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId, status: 'COMPLETED', amountMinor: 120_00, currency: 'USD' } })
    bookingIds.push(booking.id)
    const payment = await db().payment.create({ data: { bookingId: booking.id, grossMinor: 120_00, commissionBaseMinor: 100_00, commissionRateParts: 150_000, commissionAmountMinor: 15_00, hostPayoutMinor: 105_00, currency: 'USD', settlementRef, baseVersion: 'test' } })
    return { paymentId: payment.id, bookingId: booking.id }
  }

  const seed = (payment, status, statementRef, extra = {}) => db().reconciliationRecord.create({
    data: { bookingId: payment.bookingId, paymentId: payment.paymentId, statementRef, amountMinor: 120_00, currency: 'USD', source: 'manual', status, ...extra },
  }).then((r) => { recordIds.push(r.id); return r })

  beforeAll(async () => {
    const hostId = await mkUser('HOST', 'f3-host')
    const guestId = await mkUser('GUEST', 'f3-guest')
    paymentA = await mkPayment(hostId, guestId, 'SETL-F3-A')
    paymentB = await mkPayment(hostId, guestId, 'SETL-F3-B')
    for (const stmt of MIGRATION_STATEMENTS) await db().$executeRawUnsafe(stmt)
  })

  afterAll(async () => {
    await db().$executeRawUnsafe('DROP INDEX IF EXISTS reconciliation_records_one_match_per_statement_ref').catch(() => {})
    await db().reconciliationRecord.deleteMany({ where: { id: { in: recordIds } } }).catch(() => {})
    await db().payment.deleteMany({ where: { bookingId: { in: bookingIds } } }).catch(() => {})
    await db().booking.deleteMany({ where: { id: { in: bookingIds } } }).catch(() => {})
    await db().listing.deleteMany({ where: { ownerId: { in: userIds } } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('a first MATCHED for a statement_ref SUCCEEDS', async () => {
    const row = await seed(paymentA, 'MATCHED', SHARED_REF, { matchedAt: new Date() })
    expect(row.id).toBeTruthy()
  })

  it('a SECOND MATCHED for the SAME statement_ref (different payment) is REJECTED — one deposit, one MATCHED', async () => {
    await expect(seed(paymentB, 'MATCHED', SHARED_REF, { matchedAt: new Date() })).rejects.toThrow()
  })

  it('a MISMATCH re-attempt with that same statement_ref is still ALLOWED (append-only intact)', async () => {
    const row = await seed(paymentB, 'MISMATCH', SHARED_REF, { mismatchReason: 'DUPLICATE' })
    expect(row.id).toBeTruthy()
  })
})
