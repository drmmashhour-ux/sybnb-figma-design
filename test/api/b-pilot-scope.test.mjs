import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { CANCELLATION_VIA_SUPPORT_CODE, CARD_PAYMENT_NOT_IN_PILOT_CODE } from '../../server/lib/pilot-scope.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Section B — the Sham-Cash-only Syria pilot DEFERS card payments and the self-serve automated
// cancellation+refund. The server must ENFORCE both (defense-in-depth: a hidden UI can't be bypassed), the
// /api/config/country capabilities must report them as deferred (so the UI hides them), and the
// admin-handled cancellation fallback (open a dispute) must STILL work so no guest is trapped. All
// config-driven via STR_PILOT_SHAM_CASH_ONLY (default OFF = full feature set, baseline unchanged).

const FLAG = 'STR_PILOT_SHAM_CASH_ONLY'
const ALLOWED_ORIGIN = 'http://localhost:5199'
const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

describe('Section B — Sham-Cash-only pilot scope (server enforcement + capabilities)', () => {
  let app
  let guest
  let hostId
  const listingIds = []
  const bookingIds = []

  const mkUser = async (role, label) => {
    const u = await db().user.create({
      data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `B ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } }, phoneHash: `b-${Math.random().toString(36).slice(2)}` },
    })
    trackTestUser(u.id)
    return u
  }

  // A CONFIRMED STAYS booking owned by `guest` (dispute window open via a near-future checkOut).
  async function confirmedBooking() {
    const listing = await db().listing.create({
      data: { ownerId: hostId, division: 'STAYS', titleAr: 'B', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } },
    })
    listingIds.push(listing.id)
    const checkOut = new Date(Date.now() + 5 * 86_400_000)
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'CONFIRMED', amountMinor: 100_00, currency: 'USD', checkOut } })
    bookingIds.push(booking.id)
    return booking
  }

  beforeAll(async () => {
    app = testApp()
    const g = await mkUser('GUEST', 'b-guest')
    guest = { id: g.id, token: createSessionToken(g) }
    hostId = (await mkUser('HOST', 'b-host')).id
  })
  afterAll(async () => {
    delete process.env[FLAG]
    await db().booking.deleteMany({ where: { id: { in: bookingIds } } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: { in: listingIds } } }).catch(() => {})
    await cleanupTestUsers()
  })

  describe('pilot ACTIVE (STR_PILOT_SHAM_CASH_ONLY=1)', () => {
    let prev
    beforeAll(() => {
      prev = process.env[FLAG]
      process.env[FLAG] = '1'
    })
    afterAll(() => {
      if (prev === undefined) delete process.env[FLAG]
      else process.env[FLAG] = prev
    })

    it('card checkout is REFUSED with a clear "not available in this pilot" code', async () => {
      const res = await request(app).post('/api/payments/stripe/create-checkout-session').set(auth(guest.token)).send({ bookingId: 'any', origin: ALLOWED_ORIGIN })
      expect(res.status).toBe(403)
      expect(res.body.error?.code).toBe(CARD_PAYMENT_NOT_IN_PILOT_CODE)
    })

    it('self-serve automated cancellation is REFUSED and routed to support', async () => {
      const booking = await confirmedBooking()
      const res = await request(app).patch(`/api/bookings/${booking.id}/cancel`).set(auth(guest.token)).send({})
      expect(res.status).toBe(409)
      expect(res.body.error?.code).toBe(CANCELLATION_VIA_SUPPORT_CODE)
      // the booking is NOT auto-cancelled by the deferred path
      const after = await db().booking.findUnique({ where: { id: booking.id } })
      expect(after.status).toBe('CONFIRMED')
    })

    it('config capabilities report card + self-serve cancellation as DEFERRED', async () => {
      const res = await request(app).get('/api/config/country')
      expect(res.status).toBe(200)
      expect(res.body.scope?.shamCashOnly).toBe(true)
      expect(res.body.scope?.cardPaymentAvailable).toBe(false)
      expect(res.body.scope?.selfServeCancellation).toBe(false)
    })

    it('admin-handled fallback is NOT blocked — a guest can still open a dispute (contact support / manual cancel)', async () => {
      const booking = await confirmedBooking()
      const res = await request(app).post('/api/disputes').set(auth(guest.token)).send({ bookingId: booking.id, reason: 'Please cancel my booking — using the pilot support flow.' })
      expect(res.status).toBe(201)
      expect(res.body.dispute?.bookingId).toBe(booking.id)
    })
  })

  describe('pilot OFF (default — full feature set)', () => {
    beforeAll(() => {
      delete process.env[FLAG]
    })

    it('card checkout is NOT blocked by the pilot (proceeds to normal validation)', async () => {
      const res = await request(app).post('/api/payments/stripe/create-checkout-session').set(auth(guest.token)).send({ bookingId: 'any', origin: ALLOWED_ORIGIN })
      expect(res.body.error?.code).not.toBe(CARD_PAYMENT_NOT_IN_PILOT_CODE)
    })

    it('self-serve cancellation is NOT blocked by the pilot', async () => {
      const booking = await confirmedBooking()
      const res = await request(app).patch(`/api/bookings/${booking.id}/cancel`).set(auth(guest.token)).send({})
      expect(res.body.error?.code).not.toBe(CANCELLATION_VIA_SUPPORT_CODE)
    })

    it('config capabilities report the full feature set', async () => {
      const res = await request(app).get('/api/config/country')
      expect(res.body.scope?.shamCashOnly).toBe(false)
      expect(res.body.scope?.cardPaymentAvailable).toBe(true)
      expect(res.body.scope?.selfServeCancellation).toBe(true)
    })
  })
})
