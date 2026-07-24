import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// H4 — ListingAvailability (host-set BLOCKED + price overrides) + active Booking rows are the SINGLE
// availability source. The guest date-picker, the host calendar (both hit /api/listings/:id/availability),
// and the booking overlap guard all read the SAME two tables with the SAME booking-status set, so a date
// can never look bookable in one place and be unavailable in another (R3), and a blocked/booked date is
// rejected at booking (R1).

function isoDay(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

describe('H4 — availability single source (R3)', () => {
  let app, host, guest, listing
  async function createUser(role, label) {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `T ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    return { token: createSessionToken(u), user: u }
  }
  beforeAll(async () => {
    app = testApp()
    host = await createUser('HOST', 'h4-host'); guest = await createUser('GUEST', 'h4-guest')
    listing = await db().listing.create({ data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'شقة', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', metadata: { country: 'SY' } } })
  })
  afterAll(async () => {
    await db().listingAvailability.deleteMany({ where: { listingId: listing.id } }).catch(() => {})
    await db().booking.deleteMany({ where: { listingId: listing.id } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: listing.id } })
    await cleanupTestUsers()
  })

  it('a host-blocked date shows as blocked in the availability endpoint AND is rejected at booking', async () => {
    const blocked = isoDay(30)
    // Host blocks the date (writes ListingAvailability BLOCKED) — the single write path.
    const patch = await request(app).patch(`/api/host/listings/${listing.id}/availability`).set('authorization', `Bearer ${host.token}`)
      .send({ dates: [{ date: blocked, status: 'BLOCKED' }] })
    expect(patch.status).toBeLessThan(400)

    // The guest-facing availability endpoint (same source the host calendar reads) reports it blocked.
    const avail = await request(app).get(`/api/listings/${listing.id}/availability`).query({ from: isoDay(0), to: isoDay(60) })
    expect(avail.status).toBe(200)
    expect(avail.body.blockedDates).toContain(blocked)

    // Booking that blocked night is rejected by the overlap guard (same ListingAvailability BLOCKED read).
    const book = await request(app).post('/api/bookings').set('authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn: blocked, checkOut: isoDay(32) })
    expect(book.status).toBe(409)
    expect(book.body.error.code).toBe('BOOKING_DATES_UNAVAILABLE')
  })

  it('a booked range is reflected in the availability endpoint (so the calendar/picker see it)', async () => {
    const checkIn = isoDay(50), checkOut = isoDay(53)
    const created = await request(app).post('/api/bookings').set('authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn, checkOut })
    expect(created.status).toBe(201)

    const avail = await request(app).get(`/api/listings/${listing.id}/availability`).query({ from: isoDay(0), to: isoDay(90) })
    expect(avail.body.bookedRanges.some((r) => r.checkIn === checkIn && r.checkOut === checkOut)).toBe(true)
  })
})
