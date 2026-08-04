import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { expireStalePaymentPendingBookings, paymentPendingTtlMinutes } from '../../server/lib/booking-lifecycle.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// Regression coverage for M3: a booking is created PAYMENT_PENDING and its dates are counted as
// occupied by the overlap/availability checks. Nothing ever reaped abandoned (never-paid) pending
// bookings, so anyone could squat a listing's best dates forever (free denial-of-availability). The
// fix reaps PENDING bookings older than the payment TTL that have NO payment proof, from the booking
// create path and the availability read path. A pending booking that HAS a submitted proof (guest is
// awaiting admin review) and a still-fresh pending booking must both be spared.
describe('Stale PAYMENT_PENDING bookings are reaped so dates free up (M3)', () => {
  let app
  let listing
  const STALE_MS = (paymentPendingTtlMinutes() + 30) * 60 * 1000 // safely past the TTL
  const FRESH_MS = 60 * 1000

  beforeAll(async () => {
    app = testApp()
    const host = await registerGuest('reaper-host')
    listing = await db().listing.create({
      data: { ownerId: host.id, division: 'STAYS', titleAr: 'وحدة اختبار', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' },
    })
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    const legacyVerificationGrant1 = await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }

  // days offset from now, so each test uses its own non-overlapping window
  function window(startDayOffset) {
    const checkIn = new Date()
    checkIn.setUTCDate(checkIn.getUTCDate() + startDayOffset)
    checkIn.setUTCHours(0, 0, 0, 0)
    const checkOut = new Date(checkIn.getTime() + 2 * 24 * 60 * 60 * 1000)
    return { checkIn, checkOut }
  }

  async function makePending(guestId, { checkIn, checkOut }, { ageMs = 0, withProof = false } = {}) {
    const booking = await db().booking.create({
      data: {
        listingId: listing.id,
        guestId,
        status: 'PAYMENT_PENDING',
        checkIn,
        checkOut,
        amountMinor: 100_00,
        currency: 'USD',
        createdAt: new Date(Date.now() - ageMs),
      },
    })
    if (withProof) {
      await db().paymentProof.create({
        data: { bookingId: booking.id, userId: guestId, provider: 'manual', amountMinor: 100_00, currency: 'USD' },
      })
    }
    return booking
  }

  const statusOf = async (id) => (await db().booking.findUnique({ where: { id } }))?.status

  it('reaps an abandoned pending booking when the availability calendar is read', async () => {
    const guest = await registerGuest('reaper-abandoned')
    const win = window(400)
    const stale = await makePending(guest.id, win, { ageMs: STALE_MS })

    const res = await request(app).get(`/api/listings/${listing.id}/availability`)
    expect(res.status).toBe(200)

    expect(await statusOf(stale.id)).toBe('CANCELLED')
  })

  it('lets a new guest book dates squatted by an abandoned pending booking', async () => {
    const squatter = await registerGuest('reaper-squatter')
    const newGuest = await registerGuest('reaper-newguest')
    const win = window(500)
    const stale = await makePending(squatter.id, win, { ageMs: STALE_MS })

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${newGuest.token}`)
      .send({ listingId: listing.id, checkIn: win.checkIn.toISOString(), checkOut: win.checkOut.toISOString(), currency: 'USD' })

    expect(res.status).toBe(201)
    expect(res.body.booking.guestId).toBe(newGuest.id)
    expect(await statusOf(stale.id)).toBe('CANCELLED')
  })

  it('does NOT reap a pending booking that has a submitted payment proof (awaiting review)', async () => {
    const guest = await registerGuest('reaper-hasproof')
    const win = window(600)
    const pending = await makePending(guest.id, win, { ageMs: STALE_MS, withProof: true })

    const reaped = await expireStalePaymentPendingBookings({ listingId: listing.id })

    expect(await statusOf(pending.id)).toBe('PAYMENT_PENDING')
    expect(reaped).toBe(0)
  })

  it('reaps an expired Stripe Checkout placeholder but never treats it as submitted payment', async () => {
    const guest = await registerGuest('reaper-checkout-expired')
    const pending = await makePending(guest.id, window(650), { ageMs: STALE_MS })
    const placeholder = await db().paymentProof.create({
      data: {
        bookingId: pending.id,
        userId: guest.id,
        provider: 'stripe_checkout',
        status: 'PENDING_PROOF',
        amountMinor: 100_00,
        currency: 'USD',
        providerRef: `cs_expired_${Date.now()}`,
        createdAt: new Date(Date.now() - STALE_MS),
      },
    })

    expect(await expireStalePaymentPendingBookings({ id: pending.id })).toBe(1)
    expect(await statusOf(pending.id)).toBe('CANCELLED')
    expect(await db().paymentProof.findUnique({ where: { id: placeholder.id } })).toBeNull()
  })

  it('keeps a stale booking while its Stripe Checkout placeholder is still fresh', async () => {
    const guest = await registerGuest('reaper-checkout-open')
    const pending = await makePending(guest.id, window(675), { ageMs: STALE_MS })
    await db().paymentProof.create({
      data: {
        bookingId: pending.id,
        userId: guest.id,
        provider: 'stripe_checkout',
        status: 'PENDING_PROOF',
        amountMinor: 100_00,
        currency: 'USD',
        providerRef: `cs_open_${Date.now()}`,
      },
    })

    expect(await expireStalePaymentPendingBookings({ id: pending.id })).toBe(0)
    expect(await statusOf(pending.id)).toBe('PAYMENT_PENDING')
  })

  it('does NOT reap a still-fresh pending booking (within the TTL)', async () => {
    const guest = await registerGuest('reaper-fresh')
    const win = window(700)
    const pending = await makePending(guest.id, win, { ageMs: FRESH_MS })

    await expireStalePaymentPendingBookings({ listingId: listing.id })

    expect(await statusOf(pending.id)).toBe('PAYMENT_PENDING')
  })
})
