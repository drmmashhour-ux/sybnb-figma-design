import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof, bookingFinanceSplit } from '../../server/lib/finance-ledger.mjs'
import { buildStayStatement } from '../../server/lib/stay-statements.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// M1 (money-panel addition) — a NON-13% active policy must flow through EACH of the 3 restructured maps:
// admin payout queue, host earnings, and the stay statement. A 13% seed can't catch a wiring defect
// because 13% == the fallback. We use an isolated jurisdiction (country 'ZZ') with a 20% policy so it can
// never affect the real Syria (SY) rows in parallel tests, and assert every map reflects 20%, not 13%.

const ZZ = 'ZZ'
const AMOUNT = 100_00

describe('M1 — a non-13% commission policy flows through all 3 restructured maps', () => {
  let app, admin, host, guest, listing, booking, policyId
  const expected20 = bookingFinanceSplit({ amountMinor: AMOUNT, currency: 'USD', listing: { division: 'STAYS', metadata: { country: ZZ } }, metadata: {} }, AMOUNT, 0.20).hostGrossMinor
  const expected13 = bookingFinanceSplit({ amountMinor: AMOUNT, currency: 'USD', listing: { division: 'STAYS', metadata: { country: ZZ } }, metadata: {} }, AMOUNT, 0.13).hostGrossMinor

  async function createUser(role, label) {
    const user = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `Test ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(user.id)
    return { token: createSessionToken(user), user }
  }

  beforeAll(async () => {
    app = testApp()
    admin = await createUser('ADMIN', 'e2e-admin')
    host = await createUser('HOST', 'e2e-host')
    guest = await createUser('GUEST', 'e2e-guest')

    const policy = await db().jurisdictionCommissionPolicy.create({
      data: { country: ZZ, serviceType: 'STAY', policyType: 'FLAT', flatRateParts: 200_000, effectiveFrom: new Date('2020-01-01'), active: true, note: 'e2e 20% test policy' },
    })
    policyId = policy.id

    // Listing in the isolated ZZ jurisdiction.
    listing = await db().listing.create({ data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'ت', titleEn: 'E2E ZZ Stay', priceMinor: 50_00, currency: 'USD', status: 'APPROVED', metadata: { country: ZZ } } })

    const checkOut = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // well past -> payout eligible
    booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', checkIn: new Date(checkOut.getTime() - 2 * 86400000), checkOut, amountMinor: AMOUNT, currency: 'USD' } })
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guest.user.id, provider: 'sham_cash', status: 'PENDING_ADMIN_REVIEW', amountMinor: AMOUNT, currency: 'USD' } })
    // approvePaymentProof is itself a wired call site — it resolves the ZZ 20% rate for the wallet entries.
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: admin.user.id }))
    await db().booking.update({ where: { id: booking.id }, data: { status: 'COMPLETED' } })
  })

  afterAll(async () => {
    await db().walletEntry.deleteMany({ where: { referenceId: booking.id } })
    await db().paymentProof.deleteMany({ where: { bookingId: booking.id } })
    await db().booking.deleteMany({ where: { id: booking.id } })
    await db().listing.deleteMany({ where: { id: listing.id } })
    await db().jurisdictionCommissionPolicy.deleteMany({ where: { id: policyId } })
    await cleanupTestUsers()
  })

  it('sanity: the 20% and 13% host payouts differ (so the assertions are meaningful)', () => {
    expect(expected20).not.toBe(expected13)
  })

  it('MAP 1 — admin payout queue reflects the 20% policy', async () => {
    const res = await request(app).get('/api/admin/payouts').set('authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    const row = res.body.payouts.find((p) => p.bookingId === booking.id)
    expect(row, 'booking present in payout queue').toBeTruthy()
    expect(row.hostPayoutMinor).toBe(expected20)
    expect(row.hostPayoutMinor).not.toBe(expected13)
  })

  it('MAP 2 — host earnings reflects the 20% policy', async () => {
    const res = await request(app).get('/api/host/earnings').set('authorization', `Bearer ${host.token}`)
    expect(res.status).toBe(200)
    const row = res.body.earnings.rows.find((r) => r.bookingId === booking.id)
    expect(row, 'booking present in host earnings').toBeTruthy()
    expect(row.hostGrossMinor ?? row.hostPayoutMinor).toBe(expected20)
  })

  it('MAP 3 — stay statement reflects the 20% policy', async () => {
    const statement = await buildStayStatement(db(), { hostId: host.user.id, periodType: 'custom', periodStart: new Date('2020-01-01'), periodEnd: new Date(Date.now() + 86400000) })
    const line = statement.lines.find((l) => l.bookingId === booking.id)
    expect(line, 'booking present in stay statement').toBeTruthy()
    // Commission recorded at approval time from the ZZ 20% policy.
    const rent = Math.round(AMOUNT / 1.05)
    expect(line.commissionMinor).toBe(Math.round(rent * 0.20))
    expect(line.commissionMinor).not.toBe(Math.round(rent * 0.13))
  })
})
