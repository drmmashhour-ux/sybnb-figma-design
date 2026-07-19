import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// GET /api/admin/review-queue used to be hard-capped at 25 rows per section with no pagination and
// no per-division grouping. Every division (STAYS, RENTALS, BUY, CARS, NEW_CONSTRUCTION,
// MARKETPLACE) funnels into this one shared queue, so a busy division (bulk-added CARS inventory,
// for example) could push older PENDING_REVIEW rows from other divisions off the end of the list
// entirely, with no way for an admin to reach page 2. These tests prove: (1) limit/offset paging
// actually moves the window and covers every row exactly once, (2) the division filter narrows
// listings/bookings/payments to that division while gifts/ID-documents (which aren't attached to
// any division) are reported as empty rather than guessed at, and (3) out-of-range query params
// fall back to safe defaults instead of erroring or returning unbounded rows.

async function createPrivilegedUser(role, label) {
  const email = uniqueTestEmail(label)
  const user = await db().user.create({
    data: {
      email,
      passwordHash: hashPassword('correct-horse-battery'),
      displayName: `Test ${role}`,
      referralCode: uniqueTestReferralCode(),
      roles: { create: { role } },
    },
    include: { roles: true },
  })
  trackTestUser(user.id)
  return { email, token: createSessionToken(user), user }
}

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  else await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role, email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function createPendingListings(hostId, division, count, labelPrefix) {
  const created = []
  for (let i = 0; i < count; i += 1) {
    created.push(
      await db().listing.create({
        data: {
          ownerId: hostId,
          division,
          titleAr: `${labelPrefix} ${i}`,
          priceMinor: 100000 + i,
          currency: 'SYP',
          status: 'PENDING_REVIEW',
        },
      }),
    )
  }
  return created
}

describe('Admin review queue — pagination and division filtering (platform-wide)', () => {
  let app
  let admin
  let support
  let host

  beforeAll(async () => {
    app = testApp()
    admin = await createPrivilegedUser('ADMIN', 'queue-admin')
    support = await createPrivilegedUser('SUPPORT', 'queue-support')
    host = await registerUser(app, 'HOST', 'queue-host')
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('defaults to a 25-row limit and offset 0, matching the historic behavior for callers that pass no query params', async () => {
    const res = await request(app).get('/api/admin/review-queue').set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.pagination.limit).toBe(25)
    expect(res.body.pagination.offset).toBe(0)
    expect(res.body.pagination.division).toBeNull()
    expect(res.body.queue.listings.length).toBeLessThanOrEqual(25)
    expect(res.body.pagination.hasMore.listings).toBe(
      res.body.pagination.offset + res.body.queue.listings.length < res.body.pagination.totals.listings,
    )
  })

  it('reports live totals that match the database exactly (no more silent 25-row cap hiding the real count)', async () => {
    // Measured right after the request (rather than before) to minimize the race against the
    // route's own completeExpiredBookings() side effect, which can flip booking status between
    // reads.
    const res = await request(app).get('/api/admin/review-queue?limit=1').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)

    const [trueListings, truePayments, trueGifts, trueBookings, trueIdDocuments] = await Promise.all([
      db().listing.count({ where: { status: 'PENDING_REVIEW' } }),
      db().paymentProof.count({ where: { status: 'PENDING_ADMIN_REVIEW' } }),
      db().walletGift.count({ where: { status: { in: ['CLAIM_PENDING', 'LOCKED'] } } }),
      db().booking.count({ where: { status: { in: ['REQUESTED', 'DISPUTED'] } } }),
      db().user.count({ where: { idDocumentStatus: 'PENDING_REVIEW' } }),
    ])

    expect(res.body.pagination.totals.listings).toBe(trueListings)
    expect(res.body.pagination.totals.payments).toBe(truePayments)
    expect(res.body.pagination.totals.gifts).toBe(trueGifts)
    expect(res.body.pagination.totals.bookings).toBe(trueBookings)
    expect(res.body.pagination.totals.idDocuments).toBe(trueIdDocuments)
  })

  it('limit is clamped to a max of 100 and non-positive values fall back to the default of 25', async () => {
    const tooLarge = await request(app).get('/api/admin/review-queue?limit=99999').set('Authorization', `Bearer ${admin.token}`)
    expect(tooLarge.body.pagination.limit).toBe(100)

    const zero = await request(app).get('/api/admin/review-queue?limit=0').set('Authorization', `Bearer ${admin.token}`)
    expect(zero.body.pagination.limit).toBe(25)

    const negative = await request(app).get('/api/admin/review-queue?limit=-5').set('Authorization', `Bearer ${admin.token}`)
    expect(negative.body.pagination.limit).toBe(25)
  })

  it('negative or non-numeric offset falls back to 0', async () => {
    const negative = await request(app).get('/api/admin/review-queue?offset=-10').set('Authorization', `Bearer ${admin.token}`)
    expect(negative.body.pagination.offset).toBe(0)

    const nonNumeric = await request(app).get('/api/admin/review-queue?offset=not-a-number').set('Authorization', `Bearer ${admin.token}`)
    expect(nonNumeric.body.pagination.offset).toBe(0)
  })

  it('an unrecognized division value is ignored and falls back to the unfiltered queue', async () => {
    const res = await request(app).get('/api/admin/review-queue?division=NOT_A_REAL_DIVISION').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.pagination.division).toBeNull()
  })

  it('walking every page with a small limit covers each pending listing exactly once, with no duplicates or gaps', async () => {
    const created = await createPendingListings(host.user.id, 'CARS', 12, 'queue-walk-cars')
    const createdIds = new Set(created.map((listing) => listing.id))

    const seen = new Set()
    let offset = 0
    const limit = 5
    let totals = null
    let guard = 0

    while (guard < 200) {
      guard += 1
      const res = await request(app)
        .get(`/api/admin/review-queue?limit=${limit}&offset=${offset}`)
        .set('Authorization', `Bearer ${admin.token}`)
      expect(res.status).toBe(200)
      totals = res.body.pagination.totals.listings

      for (const listing of res.body.queue.listings) {
        expect(seen.has(listing.id)).toBe(false)
        seen.add(listing.id)
      }

      if (!res.body.pagination.hasMore.listings) break
      offset += limit
    }

    expect(seen.size).toBe(totals)
    for (const id of createdIds) {
      expect(seen.has(id)).toBe(true)
    }
  })

  it('the division filter narrows listings to just that division', async () => {
    const carsListings = await createPendingListings(host.user.id, 'CARS', 3, 'queue-division-cars')
    const marketplaceListings = await createPendingListings(host.user.id, 'MARKETPLACE', 2, 'queue-division-marketplace')

    const trueCarsCount = await db().listing.count({ where: { status: 'PENDING_REVIEW', division: 'CARS' } })

    const res = await request(app)
      .get('/api/admin/review-queue?division=CARS&limit=100')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.pagination.division).toBe('CARS')
    expect(res.body.pagination.totals.listings).toBe(trueCarsCount)
    expect(res.body.queue.listings.every((listing) => listing.division === 'CARS')).toBe(true)

    const returnedIds = new Set(res.body.queue.listings.map((listing) => listing.id))
    for (const listing of carsListings) expect(returnedIds.has(listing.id)).toBe(true)
    for (const listing of marketplaceListings) expect(returnedIds.has(listing.id)).toBe(false)
  })

  it('the division filter reports gifts and ID documents as empty instead of guessing which division they belong to', async () => {
    const res = await request(app)
      .get('/api/admin/review-queue?division=STAYS')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.queue.gifts).toEqual([])
    expect(res.body.queue.idDocuments).toEqual([])
    expect(res.body.pagination.totals.gifts).toBe(0)
    expect(res.body.pagination.totals.idDocuments).toBe(0)
    expect(res.body.pagination.hasMore.gifts).toBe(false)
    expect(res.body.pagination.hasMore.idDocuments).toBe(false)
  })

  it('the division filter narrows bookings to bookings whose listing is in that division', async () => {
    const guest = await registerUser(app, 'GUEST', 'queue-division-guest')
    const carsListing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'CARS', titleAr: 'سيارة للحجز', priceMinor: 500000, currency: 'SYP', status: 'APPROVED' },
    })
    const staysListing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'إقامة للحجز', priceMinor: 500000, currency: 'SYP', status: 'APPROVED' },
    })
    const checkIn = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const checkOut = new Date(checkIn.getTime() + 2 * 24 * 60 * 60 * 1000)
    const carsBooking = await db().booking.create({
      data: { listingId: carsListing.id, guestId: guest.user.id, status: 'REQUESTED', checkIn, checkOut, amountMinor: 500000, currency: 'SYP' },
    })
    const staysBooking = await db().booking.create({
      data: { listingId: staysListing.id, guestId: guest.user.id, status: 'REQUESTED', checkIn, checkOut, amountMinor: 500000, currency: 'SYP' },
    })

    const res = await request(app)
      .get('/api/admin/review-queue?division=CARS&limit=100')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    const returnedBookingIds = new Set(res.body.queue.bookings.map((booking) => booking.id))
    expect(returnedBookingIds.has(carsBooking.id)).toBe(true)
    expect(returnedBookingIds.has(staysBooking.id)).toBe(false)
  })

  it('SUPPORT can also page and filter the queue (view-only, same as before)', async () => {
    const res = await request(app)
      .get('/api/admin/review-queue?limit=5&offset=0&division=CARS')
      .set('Authorization', `Bearer ${support.token}`)

    expect(res.status).toBe(200)
    expect(res.body.pagination.limit).toBe(5)
    expect(res.body.pagination.division).toBe('CARS')
  })

  it('a Premium listing surfaces ahead of an older Basic listing (priority admin review)', async () => {
    const basicListing = await db().listing.create({
      data: {
        ownerId: host.user.id,
        division: 'RENTALS',
        titleAr: 'Priority test — basic',
        priceMinor: 100,
        currency: 'USD',
        status: 'PENDING_REVIEW',
        metadata: { listingPlan: 'basic' },
      },
    })
    // Guarantee the basic listing is strictly older, so createdAt-only ordering would rank it first.
    await new Promise((resolve) => setTimeout(resolve, 10))
    const premiumListing = await db().listing.create({
      data: {
        ownerId: host.user.id,
        division: 'RENTALS',
        titleAr: 'Priority test — premium',
        priceMinor: 100,
        currency: 'USD',
        status: 'PENDING_REVIEW',
        metadata: { listingPlan: 'premium' },
      },
    })

    const res = await request(app)
      .get('/api/admin/review-queue?division=RENTALS&limit=100')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    const ids = res.body.queue.listings.map((listing) => listing.id)
    expect(ids.indexOf(premiumListing.id)).toBeLessThan(ids.indexOf(basicListing.id))
  })
})
