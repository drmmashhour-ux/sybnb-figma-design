import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { recordWalletEntry } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, fundWallet, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// DELETE /api/me — in-app account deletion (store requirement): anonymize PII + kill sessions, while
// RETAINING wallet ledger + audit rows (law/finance retention). Refuse if the account still owes money
// (non-zero balance) or has active bookings/rides.
describe('DELETE /api/me — account deletion (anonymize + retain)', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token, email }
  }

  it('scrubs PII, retains ledger + audit, and kills the session', async () => {
    const guest = await registerGuest('del-happy')
    // Give the account a wallet ledger that nets to zero (entries must survive deletion).
    await fundWallet(guest.id, 1000, 'SYP')
    await db().$transaction((tx) => recordWalletEntry(tx, { userId: guest.id, type: 'DEBIT', amountMinor: 1000, currency: 'SYP', referenceType: 'test_spend', referenceId: `del-${guest.id}`, keyParts: ['del-zero', guest.id], note: 'spend to zero' }))
    const ledgerBefore = await db().walletEntry.count({ where: { wallet: { userId: guest.id } } })
    expect(ledgerBefore).toBeGreaterThanOrEqual(2)

    const del = await request(app).delete('/api/me').set('Authorization', `Bearer ${guest.token}`)
    expect(del.status).toBe(200)
    expect(del.body.account.status).toBe('CLOSED')

    // PII scrubbed on the row.
    const row = await db().user.findUnique({ where: { id: guest.id } })
    expect(row.email).toBeNull()
    expect(row.phoneHash).toBeNull()
    expect(row.passwordHash).toBeNull()
    expect(row.displayName).toBe('Deleted user')
    expect(row.status).toBe('CLOSED')
    expect(row.deletedAt).not.toBeNull()

    // Retention: the wallet ledger and the closure audit row are KEPT, referencing the anonymized id.
    expect(await db().walletEntry.count({ where: { wallet: { userId: guest.id } } })).toBe(ledgerBefore)
    const audit = await db().adminAuditLog.findFirst({ where: { entityType: 'users', entityId: guest.id, action: 'ACCOUNT_SELF_DELETED' } })
    expect(audit).not.toBeNull()

    // The session is dead: the token issued before deletion is now rejected.
    const after = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${guest.token}`)
    expect(after.status).toBe(401)

    // A second delete with the (now dead) token is refused — clean, not a crash.
    const secondDelete = await request(app).delete('/api/me').set('Authorization', `Bearer ${guest.token}`)
    expect(secondDelete.status).toBe(401)
  })

  it('refuses deletion with a non-zero wallet balance', async () => {
    const guest = await registerGuest('del-balance')
    await fundWallet(guest.id, 5000, 'SYP')
    const del = await request(app).delete('/api/me').set('Authorization', `Bearer ${guest.token}`)
    expect(del.status).toBe(409)
    expect(del.body.error.code).toBe('WALLET_NOT_EMPTY')
    // Still active — not scrubbed.
    expect((await db().user.findUnique({ where: { id: guest.id } })).status).toBe('ACTIVE')
  })

  it('refuses deletion with an active booking', async () => {
    const guest = await registerGuest('del-booking')
    const host = await db().user.create({ data: { email: uniqueTestEmail('del-host'), displayName: 'Del Host', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'HOST' } } } })
    trackTestUser(host.id)
    const listing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'اختبار', priceMinor: 100, currency: 'USD', status: 'APPROVED' } })
    await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'CONFIRMED', checkIn: new Date(Date.now() + 5 * 864e5), checkOut: new Date(Date.now() + 7 * 864e5), amountMinor: 100, currency: 'USD' } })

    const del = await request(app).delete('/api/me').set('Authorization', `Bearer ${guest.token}`)
    expect(del.status).toBe(409)
    expect(del.body.error.code).toBe('ACCOUNT_HAS_ACTIVE_OBLIGATIONS')
  })
})
