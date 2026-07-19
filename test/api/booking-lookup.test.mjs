import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// GET /api/bookings/lookup: a guest tracks their trip from ANY device using just the confirmation
// number shown on the payment page (the first 12 chars of the booking id) plus the phone number
// they gave via PATCH /api/bookings/:id/contact -- no login, no session required. This is the
// public counterpart to the device-bound frictionless guest session, for when a guest switches
// phones or clears their browser.
describe('GET /api/bookings/lookup (public trip-status lookup)', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerHost(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  async function makeBookingWithContact(host, guest, phone) {
    const listing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'اختبار التتبع', titleEn: 'Lookup Test Stay', priceMinor: 50_00, currency: 'USD', status: 'APPROVED' },
    })
    const booking = await db().booking.create({
      data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', amountMinor: 50_00, currency: 'USD' },
    })
    await request(app)
      .patch(`/api/bookings/${booking.id}/contact`)
      .set('authorization', `Bearer ${guest.token}`)
      .send({ guestName: 'Trip Tracker', guestPhone: phone })
    return booking
  }

  it('finds the trip with the exact confirmation number + phone shown at checkout', async () => {
    const host = await registerHost('lookup-host-1')
    const guest = await registerGuest('lookup-guest-1')
    const booking = await makeBookingWithContact(host, guest, '+963991112222')

    const ref = booking.id.slice(0, 12).toUpperCase()
    const res = await request(app).get('/api/bookings/lookup').query({ ref, phone: '+963991112222' })

    expect(res.status).toBe(200)
    expect(res.body.trip.confirmationNumber).toBe(ref)
    expect(res.body.trip.status).toBe('PAYMENT_PENDING')
    expect(res.body.trip.listingTitleEn).toBe('Lookup Test Stay')
  })

  it('works with the confirmation number typed without its dash', async () => {
    const host = await registerHost('lookup-host-2')
    const guest = await registerGuest('lookup-guest-2')
    const booking = await makeBookingWithContact(host, guest, '+963993334444')

    const ref = booking.id.slice(0, 12).replace(/-/g, '')
    const res = await request(app).get('/api/bookings/lookup').query({ ref, phone: '+963993334444' })

    expect(res.status).toBe(200)
    expect(res.body.trip.confirmationNumber).toBe(booking.id.slice(0, 12).toUpperCase())
  })

  it('works with phone punctuation typed differently than it was originally submitted', async () => {
    const host = await registerHost('lookup-host-3')
    const guest = await registerGuest('lookup-guest-3')
    const booking = await makeBookingWithContact(host, guest, '+963 99 555 6666')

    const ref = booking.id.slice(0, 12).toUpperCase()
    const res = await request(app).get('/api/bookings/lookup').query({ ref, phone: '+963-99-555-6666' })

    expect(res.status).toBe(200)
  })

  it('rejects the right confirmation number with the WRONG phone (404, no leak)', async () => {
    const host = await registerHost('lookup-host-4')
    const guest = await registerGuest('lookup-guest-4')
    const booking = await makeBookingWithContact(host, guest, '+963991112222')

    const ref = booking.id.slice(0, 12).toUpperCase()
    const res = await request(app).get('/api/bookings/lookup').query({ ref, phone: '+963990000000' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('BOOKING_LOOKUP_NOT_FOUND')
  })

  it('rejects a booking that never had contact info collected, even with a correct-looking phone', async () => {
    const host = await registerHost('lookup-host-5')
    const guest = await registerGuest('lookup-guest-5')
    const listing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'بدون جهة اتصال', priceMinor: 50_00, currency: 'USD', status: 'APPROVED' },
    })
    const booking = await db().booking.create({
      data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', amountMinor: 50_00, currency: 'USD' },
    })

    const ref = booking.id.slice(0, 12).toUpperCase()
    const res = await request(app).get('/api/bookings/lookup').query({ ref, phone: '+963991112222' })

    expect(res.status).toBe(404)
  })

  it('rejects a missing ref or phone with 400, not a 500/404', async () => {
    const missingPhone = await request(app).get('/api/bookings/lookup').query({ ref: '3432C45D22D' })
    expect(missingPhone.status).toBe(400)

    const missingRef = await request(app).get('/api/bookings/lookup').query({ phone: '+963991112222' })
    expect(missingRef.status).toBe(400)
  })

  it('does not require any Authorization header', async () => {
    const host = await registerHost('lookup-host-6')
    const guest = await registerGuest('lookup-guest-6')
    const booking = await makeBookingWithContact(host, guest, '+963997778888')

    const ref = booking.id.slice(0, 12).toUpperCase()
    const res = await request(app).get('/api/bookings/lookup').query({ ref, phone: '+963997778888' })
    // No .set('authorization', ...) anywhere above -- proves this really is a public route.
    expect(res.status).toBe(200)
  })
})
