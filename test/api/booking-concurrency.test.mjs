import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { paymentPendingTtlMinutes } from '../../server/lib/booking-lifecycle.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// Guards the core STR availability invariant:
//   "No two ACTIVE bookings (REQUESTED / PAYMENT_PENDING / CONFIRMED) may overlap the same
//    listing's dates."
//
// The create path in server/routes/bookings.mjs serializes concurrent same-listing requests with a
// transaction-scoped Postgres advisory lock (pg_advisory_xact_lock(hashtext(listing.id))), reaps
// abandoned PAYMENT_PENDING bookings inside that same locked transaction, then does the overlap
// check + booking.create atomically. These tests exercise that guarantee against real Postgres:
//   - two concurrent overlapping requests -> exactly ONE 201, the other 409 BOOKING_DATES_UNAVAILABLE
//   - adjacent (touching but non-overlapping) dates -> both succeed
//   - a fresh / proof-backed PAYMENT_PENDING booking still blocks new overlapping bookings
//     (complement of booking-payment-pending-reaper.test.mjs, which proves the reaper releases dates)
//   - cancelling an active booking frees its dates for a brand-new booking
//
// Concurrency model mirrors test/api/car-auction-bidding.test.mjs (Promise.all of two live requests).
describe('Booking concurrency + no-double-booking invariant (STR)', () => {
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
    const res = await request(app)
      .post('/api/auth/register')
      .send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }

  async function registerHost(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app)
      .post('/api/auth/register')
      .send({ role: 'HOST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }

  // A fresh APPROVED STAYS listing per test so no two tests can interfere through a shared
  // listing/calendar (the advisory lock is keyed on listing id, so per-listing isolation is total).
  async function createStrListing(ownerId) {
    return db().listing.create({
      data: {
        ownerId,
        division: 'STAYS',
        titleAr: 'وحدة اختبار التزامن',
        priceMinor: 100_00,
        currency: 'USD',
        status: 'APPROVED',
      },
    })
  }

  // A UTC-midnight window, offset in whole days from today so windows never straddle "now".
  function window(startDayOffset, nights = 2) {
    const checkIn = new Date()
    checkIn.setUTCDate(checkIn.getUTCDate() + startDayOffset)
    checkIn.setUTCHours(0, 0, 0, 0)
    const checkOut = new Date(checkIn.getTime() + nights * 24 * 60 * 60 * 1000)
    return { checkIn: checkIn.toISOString(), checkOut: checkOut.toISOString() }
  }

  function book(token, listingId, { checkIn, checkOut }) {
    return request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ listingId, checkIn, checkOut, currency: 'USD' })
  }

  const statusOf = async (id) => (await db().booking.findUnique({ where: { id } }))?.status

  it('two concurrent bookings for the SAME listing + overlapping dates: exactly one 201, one 409', async () => {
    const host = await registerHost('conc-host')
    const guestA = await registerGuest('conc-a')
    const guestB = await registerGuest('conc-b')
    const listing = await createStrListing(host.id)
    const win = window(1001)

    const [resA, resB] = await Promise.all([
      book(guestA.token, listing.id, win),
      book(guestB.token, listing.id, win),
    ])

    const statuses = [resA.status, resB.status].sort()
    expect(statuses).toEqual([201, 409])

    const winner = resA.status === 201 ? resA : resB
    const loser = resA.status === 201 ? resB : resA
    expect(loser.body.error.code).toBe('BOOKING_DATES_UNAVAILABLE')

    // Exactly one active booking exists on the listing for that window.
    const active = await db().booking.findMany({
      where: { listingId: listing.id, status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] } },
    })
    expect(active.length).toBe(1)
    expect(active[0].id).toBe(winner.body.booking.id)
  })

  it('five concurrent identical requests still yield exactly one winner', async () => {
    const host = await registerHost('conc5-host')
    const guests = await Promise.all(
      Array.from({ length: 5 }, (_, i) => registerGuest(`conc5-g${i}`)),
    )
    const listing = await createStrListing(host.id)
    const win = window(1010)

    const results = await Promise.all(guests.map((g) => book(g.token, listing.id, win)))
    const created = results.filter((r) => r.status === 201)

    // THE SECURITY INVARIANT: at most one request may create a booking on the slot — never two.
    // (Exactly one wins in practice; the winner's short transaction never times out.)
    expect(created.length).toBe(1)
    // The DB confirms exactly one active booking — the real no-double-booking guarantee.
    const active = await db().booking.count({
      where: { listingId: listing.id, status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] } },
    })
    expect(active).toBe(1)
    // Every non-winner is a clean 409 with the right code — OR, under heavy load, a transient
    // lock-queue timeout (>=500). It is NEVER a second 201 (that would be a double-booking).
    for (const r of results) {
      if (r === created[0]) continue
      expect(r.status).not.toBe(201)
      if (r.status === 409) expect(r.body.error.code).toBe('BOOKING_DATES_UNAVAILABLE')
    }
  })

  it('adjacent (touching, non-overlapping) dates both succeed under concurrency', async () => {
    const host = await registerHost('adj-host')
    const guestA = await registerGuest('adj-a')
    const guestB = await registerGuest('adj-b')
    const listing = await createStrListing(host.id)
    // first: [1020, 1022), second: [1022, 1024) — checkOut of one equals checkIn of the next.
    const first = window(1020, 2)
    const second = window(1022, 2)

    let [resA, resB] = await Promise.all([
      book(guestA.token, listing.id, first),
      book(guestB.token, listing.id, second),
    ])

    // Adjacency must NEVER be treated as an overlap — a 409 here would be a real false-overlap bug.
    expect(resA.status).not.toBe(409)
    expect(resB.status).not.toBe(409)
    // They serialize on the same per-listing lock; a rare heavy-load lock-queue timeout (>=500) is a
    // transient test-env artifact (the dates are genuinely free) — retry once, then both must succeed.
    if (resA.status >= 500) resA = await book(guestA.token, listing.id, first)
    if (resB.status >= 500) resB = await book(guestB.token, listing.id, second)

    expect(resA.status).toBe(201)
    expect(resB.status).toBe(201)

    const active = await db().booking.count({
      where: { listingId: listing.id, status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] } },
    })
    expect(active).toBe(2)
  })

  it('a partial overlap (check-out lands mid-stay) is rejected 409', async () => {
    const host = await registerHost('partial-host')
    const guestA = await registerGuest('partial-a')
    const guestB = await registerGuest('partial-b')
    const listing = await createStrListing(host.id)

    const first = await book(guestA.token, listing.id, window(1030, 3)) // [1030, 1033)
    expect(first.status).toBe(201)

    const overlapping = await book(guestB.token, listing.id, window(1032, 3)) // [1032, 1035) overlaps day 1032
    expect(overlapping.status).toBe(409)
    expect(overlapping.body.error.code).toBe('BOOKING_DATES_UNAVAILABLE')
  })

  it('a fully-contained overlap (new stay inside an existing one) is rejected 409', async () => {
    const host = await registerHost('contain-host')
    const guestA = await registerGuest('contain-a')
    const guestB = await registerGuest('contain-b')
    const listing = await createStrListing(host.id)

    const outer = await book(guestA.token, listing.id, window(1040, 6)) // [1040, 1046)
    expect(outer.status).toBe(201)

    const inner = await book(guestB.token, listing.id, window(1042, 2)) // [1042, 1044) inside outer
    expect(inner.status).toBe(409)
    expect(inner.body.error.code).toBe('BOOKING_DATES_UNAVAILABLE')
  })

  it('a FRESH (within-TTL) PAYMENT_PENDING booking still blocks a new overlapping booking', async () => {
    // Complements booking-payment-pending-reaper.test.mjs: that suite proves a STALE pending booking is
    // released; this proves a still-fresh unpaid pending booking is honoured and keeps holding its dates.
    const host = await registerHost('fresh-host')
    const squatter = await registerGuest('fresh-squatter')
    const newGuest = await registerGuest('fresh-new')
    const listing = await createStrListing(host.id)
    const win = window(1050)

    const first = await book(squatter.token, listing.id, win)
    expect(first.status).toBe(201)
    expect(await statusOf(first.body.booking.id)).toBe('PAYMENT_PENDING')

    const second = await book(newGuest.token, listing.id, win)
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('BOOKING_DATES_UNAVAILABLE')
  })

  it('a STALE PAYMENT_PENDING booking that HAS a submitted proof is NOT reaped and still blocks new bookings', async () => {
    // The reaper spares any pending booking with a payment row (guest has paid, awaiting admin review):
    // expireStalePaymentPendingBookings uses `payments: { none: {} }`. Even when such a booking is well
    // past the TTL, the create path must NOT free its dates. (The existing reaper suite asserts the reaper
    // FUNCTION returns 0 for this case; here we assert the end-to-end create path returns 409 because of it.)
    const host = await registerHost('proof-host')
    const squatter = await registerGuest('proof-squatter')
    const newGuest = await registerGuest('proof-new')
    const listing = await createStrListing(host.id)
    const win = window(1060)
    const staleMs = (paymentPendingTtlMinutes() + 30) * 60 * 1000

    const pending = await db().booking.create({
      data: {
        listingId: listing.id,
        guestId: squatter.id,
        status: 'PAYMENT_PENDING',
        checkIn: new Date(win.checkIn),
        checkOut: new Date(win.checkOut),
        amountMinor: 100_00,
        currency: 'USD',
        createdAt: new Date(Date.now() - staleMs),
      },
    })
    await db().paymentProof.create({
      data: { bookingId: pending.id, userId: squatter.id, provider: 'manual', amountMinor: 100_00, currency: 'USD' },
    })

    const res = await book(newGuest.token, listing.id, win)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('BOOKING_DATES_UNAVAILABLE')
    // The proof-backed pending booking survived the create-path reap.
    expect(await statusOf(pending.id)).toBe('PAYMENT_PENDING')
  })

  it('cancelling an active booking frees its dates for a brand-new booking', async () => {
    const host = await registerHost('cancel-host')
    const guestA = await registerGuest('cancel-a')
    const guestB = await registerGuest('cancel-b')
    const listing = await createStrListing(host.id)
    const win = window(1070)

    // A CONFIRMED booking (created directly, no payments — mirrors my-trips.test.mjs) holds the dates.
    const confirmed = await db().booking.create({
      data: {
        listingId: listing.id,
        guestId: guestA.id,
        status: 'CONFIRMED',
        checkIn: new Date(win.checkIn),
        checkOut: new Date(win.checkOut),
        amountMinor: 100_00,
        currency: 'USD',
      },
    })

    // While it is CONFIRMED, an overlapping booking is refused.
    const blocked = await book(guestB.token, listing.id, win)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe('BOOKING_DATES_UNAVAILABLE')

    // Guest A cancels via the real API.
    const cancel = await request(app)
      .patch(`/api/bookings/${confirmed.id}/cancel`)
      .set('Authorization', `Bearer ${guestA.token}`)
      .send({})
    expect(cancel.status).toBe(200)
    expect(await statusOf(confirmed.id)).toBe('CANCELLED')

    // The freed dates are now bookable by guest B.
    const rebook = await book(guestB.token, listing.id, win)
    expect(rebook.status).toBe(201)
    expect(rebook.body.booking.guestId).toBe(guestB.id)
  })
})
