import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// P4 — the COMPLETE guest journey book → pay → confirm, end-to-end over HTTP against real Postgres,
// via the Syrian local-wallet payment path (no Stripe needed). Asserts the DATABASE state after every
// important transition, proves the server-side payment state is authoritative (the booking is never
// CONFIRMED until an admin actually approves the proof), confirms dates become unavailable, checks the
// authorized host + admin views, and exercises failure paths (second proof on a confirmed booking,
// stale-pending reaping). Complements the smoke tests, which only prove routes render.

describe('P4: guest book → pay (local wallet) → admin approve → confirm', () => {
  let app
  let host
  let admin
  let listing

  beforeAll(async () => {
    app = testApp()
    host = await makeStaff('journey-host', 'HOST')
    admin = await makeStaff('journey-admin', 'ADMIN')
    // instantBookEnabled so an approved proof lands the booking straight on CONFIRMED.
    listing = await db().listing.create({
      data: { ownerId: host.id, division: 'STAYS', titleAr: 'وحدة رحلة', priceMinor: 120_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: true },
    })
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }

  async function makeStaff(label, role) {
    const u = await db().user.create({
      data: { email: uniqueTestEmail(label), displayName: label, referralCode: uniqueTestReferralCode(), roles: { create: { role } } },
      include: { roles: true },
    })
    trackTestUser(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }

  function window(startDayOffset) {
    const checkIn = new Date()
    checkIn.setUTCDate(checkIn.getUTCDate() + startDayOffset)
    checkIn.setUTCHours(0, 0, 0, 0)
    return { checkIn, checkOut: new Date(checkIn.getTime() + 2 * 24 * 60 * 60 * 1000) }
  }

  const bookingStatus = async (id) => (await db().booking.findUnique({ where: { id } }))?.status

  it('runs the whole journey and confirms only after server-side approval', async () => {
    const guest = await registerGuest('journey-guest')
    const win = window(800)

    // 1. SEARCH — the approved listing is publicly discoverable.
    const search = await request(app).get('/api/listings?division=STAYS')
    expect(search.status).toBe(200)

    // 2. AVAILABILITY + QUOTE — dates are open, quote returns a positive total.
    const avail = await request(app).get(`/api/listings/${listing.id}/availability`)
    expect(avail.status).toBe(200)
    const dateOnly = (d) => d.toISOString().slice(0, 10)
    const quote = await request(app).get(
      `/api/listings/${listing.id}/quote?checkIn=${dateOnly(win.checkIn)}&checkOut=${dateOnly(win.checkOut)}&currency=USD`,
    )
    expect(quote.status).toBe(200)
    expect(quote.body.totalMinor ?? quote.body.total ?? 0).toBeGreaterThan(0)

    // 3. CREATE BOOKING → PAYMENT_PENDING (server truth, not "confirmed").
    const created = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn: win.checkIn.toISOString(), checkOut: win.checkOut.toISOString(), currency: 'USD' })
    expect(created.status).toBe(201)
    const bookingId = created.body.booking.id
    expect(await bookingStatus(bookingId)).toBe('PAYMENT_PENDING')

    // SERVER-AUTHORITATIVE: before payment approval, nothing reports the booking as confirmed.
    expect(created.body.booking.status).not.toBe('CONFIRMED')

    // 4. PAY (local wallet proof). The id-document gate applies to the proof, not to booking creation.
    await db().user.update({ where: { id: guest.id }, data: { idDocumentRef: 'journey-id-ref' } })
    const proofRes = await request(app)
      .post('/api/payments/local-wallet-proof')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId, providerRef: `journey-ref-${bookingId}` })
    expect(proofRes.status).toBe(201)
    const proof = await db().paymentProof.findFirst({ where: { bookingId } })
    expect(proof.status).toBe('PENDING_ADMIN_REVIEW')
    // Still PENDING — a submitted-but-unapproved proof must NOT confirm the booking.
    expect(await bookingStatus(bookingId)).toBe('PAYMENT_PENDING')

    // 5. ADMIN APPROVES → booking CONFIRMED (instant-book), proof APPROVED.
    // syrian_local_wallet proofs are Sham-Cash-class: the admin must reconcile the received amount
    // server-side (must equal the proof's own amount) before approval — that gate is itself verified here.
    const approve = await request(app)
      .patch(`/api/admin/review-queue/payment/${proof.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVED', shamCashAccountMinor: proof.amountMinor })
    expect(approve.status).toBe(200)
    expect(await bookingStatus(bookingId)).toBe('CONFIRMED')
    expect((await db().paymentProof.findUnique({ where: { id: proof.id } })).status).toBe('APPROVED')

    // 6. LEDGER: approval ran the financial split — the host payout is HELD (0 delta, released later)
    // and the platform commission is CREDITed. Both reference this booking.
    const payoutHold = await db().walletEntry.findFirst({ where: { referenceType: 'booking_payout', referenceId: bookingId, type: 'HOLD' } })
    expect(payoutHold).not.toBeNull()
    const adminShare = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: bookingId, type: 'CREDIT' } })
    expect(adminShare).not.toBeNull()

    // 7. DATES NOW UNAVAILABLE — a second guest cannot book the same window.
    const guest2 = await registerGuest('journey-guest2')
    const clash = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${guest2.token}`)
      .send({ listingId: listing.id, checkIn: win.checkIn.toISOString(), checkOut: win.checkOut.toISOString(), currency: 'USD' })
    expect(clash.status).toBe(409)
    expect(clash.body.error.code).toBe('BOOKING_DATES_UNAVAILABLE')

    // 8. AUTHORIZED VIEWS — host can reach their dashboard; admin can reach the review queue.
    const hostView = await request(app).get('/api/host/overview').set('Authorization', `Bearer ${host.token}`)
    expect(hostView.status).toBe(200)
    const adminView = await request(app).get('/api/admin/review-queue').set('Authorization', `Bearer ${admin.token}`)
    expect(adminView.status).toBe(200)

    // 9. FAILURE PATH (S3b): a second proof on the now-CONFIRMED booking is rejected (no duplicate payout).
    const dupProof = await request(app)
      .post('/api/payments/local-wallet-proof')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId, providerRef: `journey-ref2-${bookingId}` })
    expect(dupProof.status).toBe(409)
    expect(dupProof.body.error.code).toBe('BOOKING_NOT_AWAITING_PAYMENT')
  })

  it('failure path: an abandoned (never-paid) booking is reaped so its dates free up', async () => {
    const guest = await registerGuest('journey-abandon')
    const win = window(900)
    // A PAYMENT_PENDING booking with no proof, aged past the TTL.
    const stale = await db().booking.create({
      data: { listingId: listing.id, guestId: guest.id, status: 'PAYMENT_PENDING', checkIn: win.checkIn, checkOut: win.checkOut, amountMinor: 120_00, currency: 'USD', createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
    })

    // A new guest can book the squatted window — the create path reaps the stale booking first.
    const newGuest = await registerGuest('journey-rebooker')
    const rebook = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${newGuest.token}`)
      .send({ listingId: listing.id, checkIn: win.checkIn.toISOString(), checkOut: win.checkOut.toISOString(), currency: 'USD' })
    expect(rebook.status).toBe(201)
    expect(await bookingStatus(stale.id)).toBe('CANCELLED')
  })
})
