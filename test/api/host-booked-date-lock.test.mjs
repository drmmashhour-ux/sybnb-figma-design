import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// H5 — booked dates are LOCKED server-side: a host cannot BLOCK or re-price any date inside an active
// booking ({REQUESTED, PAYMENT_PENDING, CONFIRMED}) via the calendar API — booked dates change only through
// the booking lifecycle. Vacant dates stay fully editable (the "lower the price to fill" case). The
// enforcement is server-side, not just the UI.

function isoDay(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

describe('H5 — server-side booked-date lock', () => {
  let app, host, guest, listing
  async function createUser(role, label) {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `T ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    return { token: createSessionToken(u), user: u }
  }
  const patchAvailability = (dates) => request(app).patch(`/api/host/listings/${listing.id}/availability`).set('authorization', `Bearer ${host.token}`).send({ dates })

  beforeAll(async () => {
    app = testApp()
    host = await createUser('HOST', 'h5-host'); guest = await createUser('GUEST', 'h5-guest')
    listing = await db().listing.create({ data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'شقة', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', metadata: { country: 'SY' } } })
    // Guest books [D50, D53): booked nights are D50, D51, D52; D53 is the departure day (vacant).
    const booked = await request(app).post('/api/bookings').set('authorization', `Bearer ${guest.token}`).send({ listingId: listing.id, checkIn: isoDay(50), checkOut: isoDay(53) })
    expect(booked.status).toBe(201)
  })
  afterAll(async () => {
    await db().listingAvailability.deleteMany({ where: { listingId: listing.id } }).catch(() => {})
    await db().booking.deleteMany({ where: { listingId: listing.id } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: listing.id } })
    await cleanupTestUsers()
  })

  it('rejects BLOCKING a date inside an active booking (server-side)', async () => {
    const res = await patchAvailability([{ date: isoDay(51), status: 'BLOCKED' }])
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('AVAILABILITY_DATE_BOOKED')
  })

  it('rejects RE-PRICING a date inside an active booking (server-side)', async () => {
    const res = await patchAvailability([{ date: isoDay(52), status: 'AVAILABLE', priceOverrideMinor: 50_00 }])
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('AVAILABILITY_DATE_BOOKED')
  })

  it('rejects a batch that touches even one booked date (all-or-nothing)', async () => {
    const res = await patchAvailability([{ date: isoDay(40), status: 'BLOCKED' }, { date: isoDay(50), status: 'BLOCKED' }])
    expect(res.status).toBe(409)
    // The vacant date in the batch must not have been written either (transaction rolled back).
    const row = await db().listingAvailability.findFirst({ where: { listingId: listing.id, date: new Date(isoDay(40)) } })
    expect(row).toBeNull()
  })

  it('allows blocking a vacant date', async () => {
    const res = await patchAvailability([{ date: isoDay(41), status: 'BLOCKED' }])
    expect(res.status).toBeLessThan(400)
  })

  it('allows lowering the price on a vacant date (fill-the-calendar case)', async () => {
    const res = await patchAvailability([{ date: isoDay(42), status: 'AVAILABLE', priceOverrideMinor: 60_00 }])
    expect(res.status).toBeLessThan(400)
    const row = await db().listingAvailability.findFirst({ where: { listingId: listing.id, date: new Date(isoDay(42)) } })
    expect(row.priceOverrideMinor).toBe(60_00)
  })

  it('allows editing the checkout day (exclusive — the guest has left)', async () => {
    const res = await patchAvailability([{ date: isoDay(53), status: 'BLOCKED' }])
    expect(res.status).toBeLessThan(400)
  })
})
