import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Locks the STR "My Trips" client-section protocol: what a guest can and cannot do on their own trip
// in each booking state — enforced server-side, per STR_MY_TRIPS_CLIENT_PROTOCOL.md.
// Allowed/blocked matrix:
//   cancel   -> only REQUESTED or CONFIRMED         (else 400 BOOKING_NOT_CANCELLABLE)
//   message  -> only CONFIRMED/COMPLETED/DISPUTED    (else 400 MESSAGING_NOT_ELIGIBLE)
//   review   -> only COMPLETED, once                 (else 400 REVIEW_BOOKING_NOT_COMPLETED / 409)
//   read     -> owner only                           (else 403 BOOKING_FORBIDDEN)
//   money    -> no commission field in any My Trips payload
describe('My Trips — client-section state gates (STR)', () => {
  let app
  let host
  let guest

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  async function registerHost(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  let listing
  beforeAll(async () => {
    app = testApp()
    host = await registerHost('trips-host')
    guest = await registerGuest('trips-guest')
    listing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'رحلاتي', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' },
    })
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function makeBooking(status, guestId = guest.user.id, checkInDaysFromNow = 30) {
    const checkIn = new Date()
    checkIn.setUTCDate(checkIn.getUTCDate() + checkInDaysFromNow)
    return db().booking.create({
      data: {
        listingId: listing.id,
        guestId,
        status,
        checkIn,
        checkOut: new Date(checkIn.getTime() + 2 * 24 * 60 * 60 * 1000),
        amountMinor: 100_00,
        currency: 'USD',
      },
    })
  }

  // ---- isolation: a client only sees / acts on their own trips ----
  it('My Trips (/me/overview) returns only the caller\'s own bookings', async () => {
    const mine = await makeBooking('CONFIRMED')
    const other = await registerGuest('trips-other')
    const theirs = await makeBooking('CONFIRMED', other.user.id)

    const res = await request(app).get('/api/me/overview').set('authorization', `Bearer ${guest.token}`)
    expect(res.status).toBe(200)
    const ids = res.body.overview.bookings.map((b) => b.id)
    expect(ids).toContain(mine.id)
    expect(ids).not.toContain(theirs.id)
  })

  it("reading another guest's trip is forbidden (403), own is 200", async () => {
    const mine = await makeBooking('CONFIRMED')
    const other = await registerGuest('trips-read-other')
    const theirs = await makeBooking('CONFIRMED', other.user.id)

    const ownView = await request(app).get(`/api/bookings/${mine.id}`).set('authorization', `Bearer ${guest.token}`)
    const foreignView = await request(app).get(`/api/bookings/${theirs.id}`).set('authorization', `Bearer ${guest.token}`)

    expect(ownView.status).toBe(200)
    expect(foreignView.status).toBe(403)
    expect(foreignView.body.error.code).toBe('BOOKING_FORBIDDEN')
  })

  it('no commission / admin-share / host-payout field appears in the My Trips payload', async () => {
    await makeBooking('COMPLETED')
    const res = await request(app).get('/api/me/overview').set('authorization', `Bearer ${guest.token}`)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body.overview.bookings)).not.toMatch(/commission|adminShare|admin_share|hostPayout|host_payout/i)
  })

  // ---- cancel: only REQUESTED or CONFIRMED ----
  it('allows cancelling a REQUESTED trip', async () => {
    const b = await makeBooking('REQUESTED')
    const res = await request(app).patch(`/api/bookings/${b.id}/cancel`).set('authorization', `Bearer ${guest.token}`).send({})
    expect(res.status).toBe(200)
  })

  it('allows cancelling a CONFIRMED trip', async () => {
    const b = await makeBooking('CONFIRMED')
    const res = await request(app).patch(`/api/bookings/${b.id}/cancel`).set('authorization', `Bearer ${guest.token}`).send({})
    expect(res.status).toBe(200)
  })

  it('blocks cancelling a PAYMENT_PENDING trip', async () => {
    const b = await makeBooking('PAYMENT_PENDING')
    const res = await request(app).patch(`/api/bookings/${b.id}/cancel`).set('authorization', `Bearer ${guest.token}`).send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BOOKING_NOT_CANCELLABLE')
  })

  it('blocks cancelling a COMPLETED trip', async () => {
    const b = await makeBooking('COMPLETED')
    const res = await request(app).patch(`/api/bookings/${b.id}/cancel`).set('authorization', `Bearer ${guest.token}`).send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BOOKING_NOT_CANCELLABLE')
  })

  // ---- message host: only from CONFIRMED onward ----
  it('blocks messaging the host before the trip is confirmed (REQUESTED)', async () => {
    const b = await makeBooking('REQUESTED')
    const res = await request(app)
      .post(`/api/bookings/${b.id}/thread/messages`)
      .set('authorization', `Bearer ${guest.token}`)
      .send({ body: 'too early' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MESSAGING_NOT_ELIGIBLE')
  })

  it('allows messaging the host on a CONFIRMED trip', async () => {
    const b = await makeBooking('CONFIRMED')
    const res = await request(app)
      .post(`/api/bookings/${b.id}/thread/messages`)
      .set('authorization', `Bearer ${guest.token}`)
      .send({ body: 'Hello, a question about check-in' })
    expect(res.status).toBe(201)
    expect(res.body.message.senderRole).toBe('GUEST')
  })

  // ---- review: only after COMPLETED, once ----
  it('blocks reviewing a trip that is not COMPLETED', async () => {
    const b = await makeBooking('CONFIRMED')
    const res = await request(app).post('/api/reviews').set('authorization', `Bearer ${guest.token}`).send({ bookingId: b.id, rating: 5 })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('REVIEW_BOOKING_NOT_COMPLETED')
  })

  it('allows reviewing a COMPLETED trip exactly once', async () => {
    const b = await makeBooking('COMPLETED')
    const first = await request(app).post('/api/reviews').set('authorization', `Bearer ${guest.token}`).send({ bookingId: b.id, rating: 5, comment: 'Lovely stay' })
    expect(first.status).toBe(201)

    const second = await request(app).post('/api/reviews').set('authorization', `Bearer ${guest.token}`).send({ bookingId: b.id, rating: 4 })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('REVIEW_ALREADY_EXISTS')
  })
})
