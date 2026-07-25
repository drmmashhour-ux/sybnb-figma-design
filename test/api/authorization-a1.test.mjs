import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// A1 — Authorization negative tests (STR money path). Asserts that unauthorized callers are rejected
// (401 no session / 403 wrong role / 403|404 wrong owner) on the admin review + settlement routes,
// the host-only listing routes, and cross-user (IDOR) access to another user's booking/listing.
//
// Finding 5 is called out explicitly: the partner "host" login is stored as a STAFF session, so this
// file proves a HOST session can NOT reach any admin/staff capability (approve, verify/reconcile a
// payment proof, release a payout, read the per-host ledger) — it must be rejected with 403.
//
// These are regression locks: even where a route is already protected today, a future change that
// silently drops the guard is caught here. XC is the neutral test jurisdiction (avoids SY fail-closed).

const XC = 'XC'
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGNk+M9Qz0BkYBxVSF+FAP7pBQVFvY4EAAAAAElFTkSuQmCC'
const authH = (token) => (token ? { Authorization: `Bearer ${token}` } : {})

describe('A1 — authorization negative tests', () => {
  let app, admin, hostA, hostB, guestA, guestB
  let accA, listingA, bookingA, proofA

  async function createUser(role, label) {
    const u = await db().user.create({
      data: {
        email: uniqueTestEmail(label),
        passwordHash: hashPassword('correct-horse-battery'),
        displayName: `A1 ${role} ${label}`,
        referralCode: uniqueTestReferralCode(),
        status: 'ACTIVE',
        roles: { create: { role } },
      },
    })
    trackTestUser(u.id)
    return { token: createSessionToken(u), id: u.id }
  }

  beforeAll(async () => {
    app = testApp()
    admin = await createUser('ADMIN', 'a1-admin')
    hostA = await createUser('HOST', 'a1-hostA')
    hostB = await createUser('HOST', 'a1-hostB')
    guestA = await createUser('GUEST', 'a1-guestA')
    guestB = await createUser('GUEST', 'a1-guestB')

    // Host A owns an accommodation + a (pending-review) listing.
    accA = await db().accommodation.create({
      data: {
        ownerId: hostA.id,
        titleAr: 'شقة A1',
        governorate: 'damascus',
        city: 'damascus',
        area: 'mazzeh',
        address: 'A1 exact street address',
        metadata: { country: XC, mapLocation: { latitude: 33.51, longitude: 36.27, pinConfirmed: true } },
      },
    })
    listingA = await db().listing.create({
      data: {
        ownerId: hostA.id,
        accommodationId: accA.id,
        division: 'STAYS',
        titleAr: 'غرفة A1',
        priceMinor: 100_00,
        currency: 'USD',
        status: 'PENDING_REVIEW',
        instantBookEnabled: false,
        metadata: { country: XC, cleaningFeeMinor: 20_00 },
      },
    })
    // Guest A owns a booking + a pending Sham Cash proof on it.
    bookingA = await db().booking.create({
      data: {
        listingId: listingA.id,
        guestId: guestA.id,
        status: 'PAYMENT_PENDING',
        amountMinor: 120_00,
        currency: 'USD',
        metadata: { guestContactName: 'Guest A', guestContactPhone: '+963991000001' },
      },
    })
    proofA = await db().paymentProof.create({
      data: {
        bookingId: bookingA.id,
        userId: guestA.id,
        provider: 'syrian_local_wallet',
        providerRef: `A1-${Math.random().toString(36).slice(2)}`,
        status: 'PENDING_ADMIN_REVIEW',
        amountMinor: 120_00,
        currency: 'USD',
      },
    })
  })

  afterAll(async () => {
    await db().paymentProof.deleteMany({ where: { bookingId: bookingA?.id } }).catch(() => {})
    await db().booking.deleteMany({ where: { id: bookingA?.id } }).catch(() => {})
    await db().listing.deleteMany({ where: { accommodationId: accA?.id } }).catch(() => {})
    await db().accommodation.deleteMany({ where: { id: accA?.id } }).catch(() => {})
    await cleanupTestUsers()
  })

  // ---------- Admin review + settlement routes: reject 401 (no session) and 403 (non-admin) ----------
  // Route table exercised by role. The role guard runs before any entity lookup, so a fake/real id is
  // equivalent for the auth assertion.
  describe('admin money-path routes reject unauthenticated + non-admin callers', () => {
    const routes = () => [
      { name: 'review-queue list', m: 'get', path: '/api/admin/review-queue', body: undefined },
      { name: 'approve listing', m: 'patch', path: `/api/admin/review-queue/listing/${listingA.id}`, body: { decision: 'APPROVED' } },
      { name: 'verify+reconcile payment proof', m: 'patch', path: `/api/admin/review-queue/payment/${proofA.id}`, body: { decision: 'APPROVED', shamCashReconciliation: { accountMinor: 120_00 } } },
      { name: 'release payout', m: 'patch', path: `/api/admin/payouts/${bookingA.id}/release`, body: {} },
      { name: 'per-host ledger', m: 'get', path: `/api/admin/host-ledger?hostId=${hostA.id}`, body: undefined },
    ]

    it('401 for every admin route with NO session', async () => {
      for (const r of routes()) {
        const res = await request(app)[r.m](r.path).send(r.body || {})
        expect(res.status, `${r.name} unauth`).toBe(401)
      }
    })

    it('403 for every admin route with a GUEST session', async () => {
      for (const r of routes()) {
        const res = await request(app)[r.m](r.path).set(authH(guestA.token)).send(r.body || {})
        expect(res.status, `${r.name} guest`).toBe(403)
      }
    })
  })

  // ---------- Finding 5: a HOST (partner "staff") session cannot reach admin/staff capabilities ----------
  describe('Finding 5 — a HOST session cannot escalate to admin/staff capabilities', () => {
    it('HOST cannot list the admin review queue', async () => {
      const res = await request(app).get('/api/admin/review-queue').set(authH(hostA.token))
      expect(res.status).toBe(403)
    })
    it('HOST cannot approve a listing', async () => {
      const res = await request(app).patch(`/api/admin/review-queue/listing/${listingA.id}`).set(authH(hostA.token)).send({ decision: 'APPROVED' })
      expect(res.status).toBe(403)
    })
    it('HOST cannot verify/reconcile a payment proof', async () => {
      const res = await request(app)
        .patch(`/api/admin/review-queue/payment/${proofA.id}`)
        .set(authH(hostA.token))
        .send({ decision: 'APPROVED', shamCashReconciliation: { accountMinor: 120_00 } })
      expect(res.status).toBe(403)
    })
    it('HOST cannot release a payout', async () => {
      const res = await request(app).patch(`/api/admin/payouts/${bookingA.id}/release`).set(authH(hostA.token)).send({})
      expect(res.status).toBe(403)
    })
    it('HOST cannot read the per-host ledger (even for itself)', async () => {
      const res = await request(app).get(`/api/admin/host-ledger?hostId=${hostA.id}`).set(authH(hostA.token))
      expect(res.status).toBe(403)
    })
  })

  // ---------- Host-only listing routes: reject 401 (no session) and 403 (GUEST) ----------
  describe('host-only routes reject unauthenticated + guest callers', () => {
    const accBody = { titleAr: 'شقة X', governorate: 'damascus', city: 'damascus', area: 'mazzeh', metadata: { country: XC } }
    const listBody = { division: 'STAYS', titleAr: 'إعلان X', priceMinor: 100_00, currency: 'USD', metadata: { country: XC } }

    it('401 POST /api/accommodations with no session', async () => {
      const res = await request(app).post('/api/accommodations').send(accBody)
      expect(res.status).toBe(401)
    })
    it('403 POST /api/accommodations as GUEST', async () => {
      const res = await request(app).post('/api/accommodations').set(authH(guestA.token)).send(accBody)
      expect(res.status).toBe(403)
    })
    it('403 POST /api/listings as GUEST', async () => {
      const res = await request(app).post('/api/listings').set(authH(guestA.token)).send(listBody)
      expect(res.status).toBe(403)
    })
    it('403 POST /api/accommodations/:id/room-types as GUEST', async () => {
      const res = await request(app).post(`/api/accommodations/${accA.id}/room-types`).set(authH(guestA.token)).send({ titleAr: 'غرفة X', priceMinor: 100_00, currency: 'USD' })
      expect(res.status).toBe(403)
    })
  })

  // ---------- Cross-user (IDOR / F-07): one user cannot read or act on another user's data ----------
  describe('cross-user IDOR: a caller cannot act on another user\'s booking/listing', () => {
    // Each asserts BOTH the rejection status AND the specific ownership-guard code, so a pass can only
    // come from a genuine owner check — never a spurious route-miss 404, a validation 400, or (worst)
    // an unprotected 200.
    it('guest B cannot set contact on guest A\'s booking → 404 BOOKING_NOT_FOUND', async () => {
      const res = await request(app)
        .patch(`/api/bookings/${bookingA.id}/contact`)
        .set(authH(guestB.token))
        .send({ guestName: 'Intruder', guestPhone: '+963991000002', guestEmail: 'intruder@sybnb.test' })
      expect(res.status).toBe(404)
      expect(res.body.error?.code).toBe('BOOKING_NOT_FOUND')
    })
    it('guest B cannot submit a Sham Cash proof against guest A\'s booking → 403 PAYMENT_BOOKING_FORBIDDEN', async () => {
      const res = await request(app)
        .post('/api/payments/local-wallet-proof')
        .set(authH(guestB.token))
        .send({ bookingId: bookingA.id, providerRef: `idor-${Math.random().toString(36).slice(2)}`, amountMinor: 120_00 })
      expect(res.status).toBe(403)
      expect(res.body.error?.code).toBe('PAYMENT_BOOKING_FORBIDDEN')
    })
    it('host B cannot submit host A\'s listing → 404 LISTING_NOT_FOUND', async () => {
      const res = await request(app)
        .patch(`/api/listings/${listingA.id}/submit`)
        .set(authH(hostB.token))
        .send({ acceptContract: true, contractVersion: 'str-host-commission-v3-card-fee' })
      expect(res.status).toBe(404)
      expect(res.body.error?.code).toBe('LISTING_NOT_FOUND')
    })
    it('host B cannot upload media to host A\'s listing → 404 LISTING_NOT_FOUND', async () => {
      const res = await request(app)
        .post(`/api/listings/${listingA.id}/media`)
        .set(authH(hostB.token))
        .send({ fileBase64: PNG_B64, mimeType: 'image/png' })
      expect(res.status).toBe(404)
      expect(res.body.error?.code).toBe('LISTING_NOT_FOUND')
    })
    it('host B cannot add a room-type to host A\'s accommodation → 404 ACCOMMODATION_NOT_FOUND', async () => {
      const res = await request(app)
        .post(`/api/accommodations/${accA.id}/room-types`)
        .set(authH(hostB.token))
        .send({ titleAr: 'غرفة دخيل', priceMinor: 100_00, currency: 'USD' })
      expect(res.status).toBe(404)
      expect(res.body.error?.code).toBe('ACCOMMODATION_NOT_FOUND')
    })
  })
})
