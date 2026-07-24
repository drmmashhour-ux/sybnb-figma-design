import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// H6 — the host payments calendar reads the FROZEN M5 Payout/Payment records (never a live recompute), is
// scoped to the caller's own payouts (Payout.hostId), shows the host their OWN commission (R7 keeps
// commission out of guest responses, not host ones), and reflects the payout release date + status.

const XC = 'XC' // synthetic country so an activated commission policy can't touch real jurisdictions

describe('H6 — host payments calendar (frozen M5 records)', () => {
  let app, hostA, hostB, guest, admin, listingA, listingB
  async function createUser(role, label) {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `T ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    return { token: createSessionToken(u), user: u }
  }
  async function settle(listing) {
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD', checkIn: new Date('2027-02-01'), checkOut: new Date('2027-02-03') } })
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guest.user.id, provider: 'stripe', providerRef: 'pi_h6', status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: admin.user.id }))
    return booking
  }

  beforeAll(async () => {
    app = testApp()
    hostA = await createUser('HOST', 'h6-hostA'); hostB = await createUser('HOST', 'h6-hostB')
    guest = await createUser('GUEST', 'h6-guest'); admin = await createUser('ADMIN', 'h6-admin')
    listingA = await db().listing.create({ data: { ownerId: hostA.user.id, division: 'STAYS', titleAr: 'شقة أ', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: XC, cleaningFeeMinor: 20_00 } } })
    listingB = await db().listing.create({ data: { ownerId: hostB.user.id, division: 'STAYS', titleAr: 'شقة ب', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: XC, cleaningFeeMinor: 20_00 } } })
  })
  afterAll(async () => {
    const bIds = (await db().booking.findMany({ where: { guestId: guest.user.id }, select: { id: true } })).map((b) => b.id)
    await db().payout.deleteMany({ where: { bookingId: { in: bIds } } }).catch(() => {})
    await db().payment.deleteMany({ where: { bookingId: { in: bIds } } }).catch(() => {})
    await db().walletEntry.deleteMany({ where: { wallet: { userId: { in: [hostA.user.id, hostB.user.id, guest.user.id, admin.user.id] } } } }).catch(() => {})
    await db().jurisdictionCommissionPolicy.deleteMany({ where: { country: XC } }).catch(() => {})
    await db().paymentProof.deleteMany({ where: { userId: guest.user.id } })
    await db().booking.deleteMany({ where: { guestId: guest.user.id } })
    await db().listing.deleteMany({ where: { id: { in: [listingA.id, listingB.id] } } })
    await cleanupTestUsers()
  })

  it('reconciles each row to the frozen Payment/Payout record (accom+cleaning − commission), no recompute', async () => {
    const booking = await settle(listingA)
    const payment = await db().payment.findUnique({ where: { bookingId: booking.id } })

    const res = await request(app).get('/api/host/payments').set('authorization', `Bearer ${hostA.token}`)
    expect(res.status).toBe(200)
    const row = res.body.payments.rows.find((r) => r.bookingId === booking.id)
    expect(row.commissionMinor).toBe(payment.commissionAmountMinor) // 13% of 120.00 = 15.60
    expect(row.hostPayoutMinor).toBe(payment.hostPayoutMinor)       // 120.00 − 15.60 = 104.40
    expect(row.accommodationMinor).toBe(100_00)
    expect(row.cleaningFeeMinor).toBe(20_00)
    expect(row.payoutStatus).toBe('PENDING_HOLD')
    expect(row.paymentDate).toBeTruthy()

    // Frozen: after a live rate change the payments row is unchanged (reads the record, not a recompute).
    await db().jurisdictionCommissionPolicy.create({ data: { country: XC, serviceType: 'STAY', policyType: 'FLAT', flatRateParts: 250_000, effectiveFrom: new Date('2020-01-01'), active: true, legallyReviewedById: admin.user.id, legallyReviewedAt: new Date() } })
    const after = await request(app).get('/api/host/payments').set('authorization', `Bearer ${hostA.token}`)
    const rowAfter = after.body.payments.rows.find((r) => r.bookingId === booking.id)
    expect(rowAfter.commissionMinor).toBe(15_60) // still 13%, not 25%
    await db().jurisdictionCommissionPolicy.deleteMany({ where: { country: XC } })
  })

  it('scopes to the caller: a host never sees another host\'s payouts', async () => {
    const bookingB = await settle(listingB)
    const resA = await request(app).get('/api/host/payments').set('authorization', `Bearer ${hostA.token}`)
    expect(resA.body.payments.rows.some((r) => r.bookingId === bookingB.id)).toBe(false)
    const resB = await request(app).get('/api/host/payments').set('authorization', `Bearer ${hostB.token}`)
    expect(resB.body.payments.rows.some((r) => r.bookingId === bookingB.id)).toBe(true)
  })

  it('reflects the payout release date + status once released', async () => {
    const booking = await settle(listingA)
    await db().payout.update({ where: { bookingId: booking.id }, data: { status: 'RELEASED', releaseDate: new Date('2027-02-17') } })
    const res = await request(app).get('/api/host/payments').set('authorization', `Bearer ${hostA.token}`)
    const row = res.body.payments.rows.find((r) => r.bookingId === booking.id)
    expect(row.payoutStatus).toBe('RELEASED')
    expect(new Date(row.releaseDate).toISOString().slice(0, 10)).toBe('2027-02-17')
  })

  it('accepts a Sham Cash and a bank payout method (founder decision #12)', async () => {
    const sham = await request(app).patch('/api/me/payout-method').set('authorization', `Bearer ${hostA.token}`).send({ type: 'sham_cash', receiverName: 'Host A', phone: '+963900000000' })
    expect(sham.status).toBeLessThan(400)
    const bank = await request(app).patch('/api/me/payout-method').set('authorization', `Bearer ${hostA.token}`).send({ type: 'bank_transfer', receiverName: 'Host A', accountRef: 'SY-IBAN-0001' })
    expect(bank.status).toBeLessThan(400)
  })
})
