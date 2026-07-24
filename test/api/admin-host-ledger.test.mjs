import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// AD4 — the admin per-host payments ledger. Reads the FROZEN M5 Payout/Payment records (no recompute),
// filtered by host + date range; platform revenue (commission + the separately-ledgered plan fee) is shown
// to the admin only and never leaks to a guest (R7).

const XC = 'XC'
function isoDay(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

describe('AD4 — admin per-host ledger', () => {
  let app, admin, guest, hostA, hostB
  async function createUser(role, label) {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `T ${role} ${label}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    return { token: createSessionToken(u), id: u.id }
  }
  async function settle(hostId) {
    const listing = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'شقة', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: XC, cleaningFeeMinor: 20_00 } } })
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD' } })
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guest.id, provider: 'stripe', providerRef: 'pi_ad4', status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: admin.id }))
    return booking.id
  }

  beforeAll(async () => {
    app = testApp()
    admin = await createUser('ADMIN', 'ad4-admin'); guest = await createUser('GUEST', 'ad4-guest')
    hostA = await createUser('HOST', 'ad4-hostA'); hostB = await createUser('HOST', 'ad4-hostB')
    await settle(hostA.id)
    await settle(hostB.id)
    // Host A also paid a $19 plan fee — a SEPARATE admin-revenue stream from commission.
    await db().paymentProof.create({ data: { userId: hostA.id, provider: 'seller_plan', providerRef: 'plan_ad4', status: 'APPROVED', amountMinor: 19_00, currency: 'USD' } })
  })
  afterAll(async () => {
    const bIds = (await db().booking.findMany({ where: { guestId: guest.id }, select: { id: true } })).map((b) => b.id)
    await db().payout.deleteMany({ where: { bookingId: { in: bIds } } }).catch(() => {})
    await db().payment.deleteMany({ where: { bookingId: { in: bIds } } }).catch(() => {})
    await db().walletEntry.deleteMany({ where: { wallet: { userId: { in: [hostA.id, hostB.id, guest.id, admin.id] } } } }).catch(() => {})
    await db().paymentProof.deleteMany({ where: { OR: [{ userId: guest.id }, { userId: hostA.id }] } })
    await db().booking.deleteMany({ where: { guestId: guest.id } })
    await db().listing.deleteMany({ where: { ownerId: { in: [hostA.id, hostB.id] } } })
    await cleanupTestUsers()
  })

  it('reconciles the ledger + totals to the frozen M5 records, scoped to the host', async () => {
    const res = await request(app).get('/api/admin/host-ledger').query({ hostId: hostA.id, from: isoDay(-1), to: isoDay(1) }).set('authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.ledger.hostId).toBe(hostA.id)
    expect(res.body.ledger.rows.length).toBe(1)
    const row = res.body.ledger.rows[0]
    const payment = await db().payment.findUnique({ where: { bookingId: row.bookingId } })
    const payout = await db().payout.findUnique({ where: { bookingId: row.bookingId } })
    expect(row.grossMinor).toBe(payment.grossMinor)
    expect(row.commissionMinor).toBe(payment.commissionAmountMinor) // 15.60
    expect(row.netPayoutMinor).toBe(payout.amountMinor)
    expect(res.body.ledger.totals.commissionMinor).toBe(payment.commissionAmountMinor)
    expect(res.body.ledger.totals.netMinor).toBe(payout.amountMinor)
  })

  it('platform revenue lists commission and the plan fee as SEPARATE lines', async () => {
    const res = await request(app).get('/api/admin/host-ledger').query({ hostId: hostA.id, from: isoDay(-1), to: isoDay(1) }).set('authorization', `Bearer ${admin.token}`)
    expect(res.body.ledger.revenue.commissionMinor).toBe(15_60)
    expect(res.body.ledger.revenue.planFeeMinor).toBe(19_00) // the $19 plan fee, never folded into commission
    expect(res.body.ledger.revenue.planFeeCount).toBe(1)
  })

  it('scopes to the requested host and respects the date filter', async () => {
    const other = await request(app).get('/api/admin/host-ledger').query({ hostId: hostB.id, from: isoDay(-1), to: isoDay(1) }).set('authorization', `Bearer ${admin.token}`)
    expect(other.body.ledger.rows.every((r) => r.commissionMinor === 15_60)).toBe(true) // only host B's own record
    expect(other.body.ledger.rows.length).toBe(1)
    // A window that excludes today returns nothing.
    const past = await request(app).get('/api/admin/host-ledger').query({ hostId: hostA.id, from: '2020-01-01', to: '2020-12-31' }).set('authorization', `Bearer ${admin.token}`)
    expect(past.body.ledger.rows.length).toBe(0)
  })

  it('is admin-only (a host/guest cannot read another host\'s ledger — R7)', async () => {
    const asHost = await request(app).get('/api/admin/host-ledger').query({ hostId: hostA.id }).set('authorization', `Bearer ${hostB.token}`)
    expect(asHost.status).toBe(403)
    const asGuest = await request(app).get('/api/admin/host-ledger').query({ hostId: hostA.id }).set('authorization', `Bearer ${guest.token}`)
    expect(asGuest.status).toBe(403)
  })
})
