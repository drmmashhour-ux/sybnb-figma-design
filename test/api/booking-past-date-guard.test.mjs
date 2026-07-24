import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// FIX 3 (server backstop) — the client greys past days, but the server is authoritative: a crafted
// POST /api/bookings with a check-in before today must be rejected with BOOKING_DATE_IN_PAST before any
// hold/"awaiting payment proof" state is created. This guard is generic (division-agnostic) and lives
// before/separate from the CITQ block, so it changes no Quebec compliance logic.

describe('FIX 3 — POST /api/bookings rejects a past check-in', () => {
  let app
  beforeAll(async () => { app = await testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  function isoDay(offsetDays) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + offsetDays)
    return d.toISOString().slice(0, 10)
  }

  async function setup(tag) {
    const hostEmail = uniqueTestEmail(`${tag}-host`)
    await verifyEmailForTest(app, hostEmail, 'staff-login')
    const hostRes = await request(app).post('/api/auth/register').send({ role: 'HOST', email: hostEmail, password: 'correct-horse-battery' })
    const hostId = hostRes.body.user.id
    trackTestUser(hostId)

    const guestEmail = uniqueTestEmail(`${tag}-guest`)
    await verifyEmailForTest(app, guestEmail)
    const guestRes = await request(app).post('/api/auth/register').send({ role: 'GUEST', email: guestEmail, password: 'correct-horse-battery' })
    trackTestUser(guestRes.body.user.id)

    const listing = await db().listing.create({
      data: { ownerId: hostId, division: 'STAYS', titleAr: 'اختبار الماضي', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' },
    })
    return { guestToken: guestRes.body.token, listingId: listing.id }
  }

  it('rejects a check-in before today with BOOKING_DATE_IN_PAST (400)', async () => {
    const { guestToken, listingId } = await setup('past-reject')
    const res = await request(app)
      .post('/api/bookings')
      .set('authorization', `Bearer ${guestToken}`)
      .send({ listingId, checkIn: isoDay(-4), checkOut: isoDay(-2) })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BOOKING_DATE_IN_PAST')
  })

  it('does not apply the past-date guard to a valid future check-in', async () => {
    const { guestToken, listingId } = await setup('future-ok')
    const res = await request(app)
      .post('/api/bookings')
      .set('authorization', `Bearer ${guestToken}`)
      .send({ listingId, checkIn: isoDay(10), checkOut: isoDay(12) })
    expect(res.status).toBeLessThan(400)
    expect(res.body.error?.code).not.toBe('BOOKING_DATE_IN_PAST')
  })
})
