import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// Locks the STR deep-pass security & money-integrity fixes (S1–S11). Each test reproduces the exploit
// the audit found and asserts it is now closed. Server-enforced; see ORDER_FOR_CODEX_STR_SECURITY_HARDENING.md.
describe('STR security & money-integrity hardening', () => {
  let app
  let refSeq = 0
  const uniqueRef = (p) => `${p}-${Date.now()}-${refSeq++}`

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user, email }
  }

  async function registerHost(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user, email }
  }

  async function approvedStay(host) {
    return db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'اختبار الأمان', priceMinor: 100, currency: 'USD', status: 'APPROVED' },
    })
  }

  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  // ---- S1: host self-approve / verify-before-live bypass ----
  it('S1: a host cannot self-approve a PENDING_REVIEW listing to APPROVED', async () => {
    const host = await registerHost('s1-host')
    const listing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'قيد المراجعة', priceMinor: 100, currency: 'USD', status: 'PENDING_REVIEW' },
    })
    const res = await request(app)
      .patch(`/api/host/listings/${listing.id}/status`)
      .set('authorization', `Bearer ${host.token}`)
      .send({ action: 'APPROVE' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('HOST_LISTING_STATUS_FORBIDDEN')
    const after = await db().listing.findUnique({ where: { id: listing.id } })
    expect(after.status).toBe('PENDING_REVIEW')
  })

  it('S1: a host CAN pause an approved listing and resume it', async () => {
    const host = await registerHost('s1-host-ok')
    const listing = await approvedStay(host)
    const pause = await request(app).patch(`/api/host/listings/${listing.id}/status`).set('authorization', `Bearer ${host.token}`).send({ action: 'PAUSE' })
    expect(pause.status).toBe(200)
    expect(pause.body.listing.status).toBe('PAUSED')
    const resume = await request(app).patch(`/api/host/listings/${listing.id}/status`).set('authorization', `Bearer ${host.token}`).send({ action: 'RESUME' })
    expect(resume.status).toBe(200)
    expect(resume.body.listing.status).toBe('APPROVED')
  })

  // ---- S8: availability IDOR ----
  it('S8: availability of a non-approved listing is not exposed (404)', async () => {
    const host = await registerHost('s8-host')
    const listing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'مسودة', priceMinor: 100, currency: 'USD', status: 'PENDING_REVIEW' },
    })
    const res = await request(app).get(`/api/listings/${listing.id}/availability`)
    expect(res.status).toBe(404)
  })

  it('S8: availability of an APPROVED listing is still exposed (200)', async () => {
    const host = await registerHost('s8-host-ok')
    const listing = await approvedStay(host)
    const res = await request(app).get(`/api/listings/${listing.id}/availability`)
    expect(res.status).toBe(200)
  })

  // ---- S6: seller-plan fee is server-side, not client-controlled ----
  it('S6: a forged plan amount is ignored — the server price is used', async () => {
    const seller = await registerGuest('s6-seller')
    const res = await request(app)
      .post('/api/payments/seller-plan-proof')
      .set('authorization', `Bearer ${seller.token}`)
      .send({ planCode: 'premium', amountMinor: 1, providerRef: uniqueRef('s6a') })
    expect(res.status).toBe(201)
    expect(res.body.proof.amountMinor).toBe(49) // published premium price ($49 = 49 whole units), NOT the forged 1
  })

  it('S6: an unknown planCode is rejected', async () => {
    const seller = await registerGuest('s6-seller-bad')
    const res = await request(app)
      .post('/api/payments/seller-plan-proof')
      .set('authorization', `Bearer ${seller.token}`)
      .send({ planCode: 'free-lunch', amountMinor: 1, providerRef: uniqueRef('s6b') })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('PLAN_CODE_INVALID')
  })

  // ---- S10: guest email must not leak to the host ----
  it('S10: host inquiries payload carries no guest email', async () => {
    const host = await registerHost('s10-host')
    const guest = await registerGuest('s10-guest')
    const listing = await approvedStay(host)
    await request(app)
      .post(`/api/listings/${listing.id}/thread/messages`)
      .set('authorization', `Bearer ${guest.token}`)
      .send({ body: 'Is this available next month?' })
    const res = await request(app).get('/api/host/inquiries').set('authorization', `Bearer ${host.token}`)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain(guest.email)
  })

  // ---- S7: host must not see the guest's payment-proof screenshot / internal admin fields ----
  it('S7: host overview never exposes proofAssetUrl or adminNote', async () => {
    const host = await registerHost('s7-host')
    const guest = await registerGuest('s7-guest')
    const listing = await approvedStay(host)
    const booking = await db().booking.create({
      data: { listingId: listing.id, guestId: guest.user.id, status: 'CONFIRMED', amountMinor: 100, currency: 'USD' },
    })
    await db().paymentProof.create({
      data: {
        bookingId: booking.id,
        userId: guest.user.id,
        provider: 'syrian_local_wallet',
        status: 'APPROVED',
        amountMinor: 100,
        currency: 'USD',
        proofAssetUrl: 'https://secret.example/guest-bank-screenshot.png',
        adminNote: 'internal only',
        providerRef: uniqueRef('s7'),
      },
    })
    const res = await request(app).get('/api/host/overview').set('authorization', `Bearer ${host.token}`)
    expect(res.status).toBe(200)
    const body = JSON.stringify(res.body)
    expect(body).not.toContain('guest-bank-screenshot')
    expect(body).not.toContain('internal only')
  })

  // ---- S3: a second payment proof on a non-pending booking is rejected ----
  it('S3: a proof cannot be submitted for a booking that is not PAYMENT_PENDING', async () => {
    const host = await registerHost('s3-host')
    const guest = await registerGuest('s3-guest')
    // guest needs an ID document on file to submit a proof; set it directly
    await db().user.update({ where: { id: guest.user.id }, data: { idDocumentRef: 'idref-s3', idDocumentSubmittedAt: new Date() } })
    const listing = await approvedStay(host)
    const booking = await db().booking.create({
      data: { listingId: listing.id, guestId: guest.user.id, status: 'CONFIRMED', amountMinor: 100, currency: 'USD' },
    })
    const res = await request(app)
      .post('/api/payments/local-wallet-proof')
      .set('authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking.id, amountMinor: 110, providerRef: uniqueRef('s3') })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('BOOKING_NOT_AWAITING_PAYMENT')
  })

  // ---- S11: manual payment must cover the full expected total, not the bare stay ----
  it('S11: a manual proof below the full expected total (stay + fees) is rejected', async () => {
    const host = await registerHost('s11-host')
    const guest = await registerGuest('s11-guest')
    await db().user.update({ where: { id: guest.user.id }, data: { idDocumentRef: 'idref-s11', idDocumentSubmittedAt: new Date() } })
    const listing = await approvedStay(host)
    const booking = await db().booking.create({
      data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', amountMinor: 100, currency: 'USD' },
    })
    // 100 = bare stay, but the expected total adds cleaning + tax, so 100 must be rejected as too low.
    const res = await request(app)
      .post('/api/payments/local-wallet-proof')
      .set('authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking.id, amountMinor: 100, providerRef: uniqueRef('s11') })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('PAYMENT_AMOUNT_TOO_LOW')
  })
})
