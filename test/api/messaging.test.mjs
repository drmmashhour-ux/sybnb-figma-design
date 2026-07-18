import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  if (role === 'HOST' || role === 'DRIVER') await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({
    role,
    email,
    password: 'correct-horse-battery',
  })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

// Fixtures are created directly via Prisma rather than by driving the full booking/payment/host
// flow (already covered end-to-end elsewhere this session) — this file's job is to exercise
// messaging authorization/eligibility, not booking-state-machine transitions.
async function createListing(ownerId, overrides = {}) {
  return db().listing.create({
    data: {
      ownerId,
      division: 'STAYS',
      titleAr: 'شقة اختبار',
      status: 'APPROVED',
      priceMinor: 100000,
      currency: 'USD',
      ...overrides,
    },
  })
}

async function createBooking(listingId, guestId, status) {
  return db().booking.create({
    data: {
      listingId,
      guestId,
      status,
      amountMinor: 100000,
      currency: 'USD',
    },
  })
}

describe('booking-thread messaging', () => {
  let app
  let host
  let guest
  let listing

  beforeAll(async () => {
    app = testApp()
    host = await registerUser(app, 'HOST', 'msg-host')
    guest = await registerUser(app, 'GUEST', 'msg-guest')
    listing = await createListing(host.user.id)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('the guest can send a message on a CONFIRMED booking, tagged with senderRole GUEST', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'Hello from the guest' })

    expect(res.status).toBe(201)
    expect(res.body.message.senderRole).toBe('GUEST')
    expect(res.body.message.body).toBe('Hello from the guest')
  })

  it('the host (listing owner) can reply on the same booking, tagged with senderRole HOST', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'Guest opener' })

    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ body: 'Host reply' })

    expect(res.status).toBe(201)
    expect(res.body.message.senderRole).toBe('HOST')
  })

  it('guest and host both read the identical thread (same message list)', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'shared visibility check' })

    const guestView = await request(app).get(`/api/bookings/${booking.id}/thread`).set('Authorization', `Bearer ${guest.token}`)
    const hostView = await request(app).get(`/api/bookings/${booking.id}/thread`).set('Authorization', `Bearer ${host.token}`)

    expect(guestView.status).toBe(200)
    expect(hostView.status).toBe(200)
    expect(guestView.body.thread.id).toBe(hostView.body.thread.id)
    expect(guestView.body.thread.messages.map((m) => m.id)).toEqual(hostView.body.thread.messages.map((m) => m.id))
  })

  it('an unrelated account cannot read or post to the thread (403)', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    const outsider = await registerUser(app, 'GUEST', 'msg-outsider')

    const readRes = await request(app).get(`/api/bookings/${booking.id}/thread`).set('Authorization', `Bearer ${outsider.token}`)
    const writeRes = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ body: 'should not be allowed' })

    expect(readRes.status).toBe(403)
    expect(readRes.body.error.code).toBe('BOOKING_FORBIDDEN')
    expect(writeRes.status).toBe(403)
  })

  it('messaging is blocked before the booking reaches an eligible status (REQUESTED)', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'REQUESTED')
    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'too early' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MESSAGING_NOT_ELIGIBLE')
  })

  it('messaging remains open on a COMPLETED booking', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'COMPLETED')
    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'post-stay follow up' })

    expect(res.status).toBe(201)
  })

  it('rejects an empty message body', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: '   ' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MESSAGE_BODY_REQUIRED')
  })

  it('rejects a message body over 4000 characters', async () => {
    const booking = await createBooking(listing.id, guest.user.id, 'CONFIRMED')
    const res = await request(app)
      .post(`/api/bookings/${booking.id}/thread/messages`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ body: 'x'.repeat(4001) })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('MESSAGE_BODY_TOO_LONG')
  })
})

describe('listing-inquiry-thread messaging', () => {
  let app
  let owner
  let inquiringGuest
  let listing

  beforeAll(async () => {
    app = testApp()
    owner = await registerUser(app, 'HOST', 'msg-listing-owner')
    inquiringGuest = await registerUser(app, 'GUEST', 'msg-listing-guest')
    listing = await createListing(owner.user.id)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a guest can open an inquiry thread on an approved listing by sending the first message', async () => {
    const res = await request(app)
      .post(`/api/listings/${listing.id}/thread/messages`)
      .set('Authorization', `Bearer ${inquiringGuest.token}`)
      .send({ body: 'Is this still available?' })

    expect(res.status).toBe(201)
    expect(res.body.message.senderRole).toBe('GUEST')
  })

  it('the owner can reply by supplying the guestId explicitly', async () => {
    const res = await request(app)
      .post(`/api/listings/${listing.id}/thread/messages`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ body: 'Yes, it is!', guestId: inquiringGuest.user.id })

    expect(res.status).toBe(201)
    expect(res.body.message.senderRole).toBe('HOST')
  })

  it('the owner cannot open a thread with themselves', async () => {
    const res = await request(app)
      .get(`/api/listings/${listing.id}/thread`)
      .query({ guestId: owner.user.id })
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_GUEST_ID')
  })

  it('the owner must supply guestId to read a thread', async () => {
    const res = await request(app).get(`/api/listings/${listing.id}/thread`).set('Authorization', `Bearer ${owner.token}`)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('GUEST_ID_REQUIRED')
  })

  it('a non-owner guest cannot read another guest\'s inquiry thread by passing their id as a query param (ignored, not honored)', async () => {
    await request(app)
      .post(`/api/listings/${listing.id}/thread/messages`)
      .set('Authorization', `Bearer ${inquiringGuest.token}`)
      .send({ body: 'my private inquiry' })

    const thirdPartyGuest = await registerUser(app, 'GUEST', 'msg-listing-third-party')
    const res = await request(app)
      .get(`/api/listings/${listing.id}/thread`)
      .query({ guestId: inquiringGuest.user.id })
      .set('Authorization', `Bearer ${thirdPartyGuest.token}`)

    // Non-owner callers always read (and lazily create) their own guestId-keyed thread — the
    // guestId query param is silently ignored for them, never used to read someone else's thread.
    expect(res.status).toBe(200)
    expect(res.body.thread.guestId).toBe(thirdPartyGuest.user.id)
    expect(res.body.thread.messages).toEqual([])
  })
})

// Real per-thread document upload (025): Rentals/Buy renter/buyer request documents used to only
// ever exist as a filename typed into the chat body -- the bytes were discarded client-side and
// never stored anywhere. These tests drive the real upload/list/download endpoints.
describe('listing-inquiry-thread documents', () => {
  let app
  let owner
  let guest
  let listing

  // A well-known minimal valid 1x1 transparent PNG, base64-encoded.
  const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

  beforeAll(async () => {
    app = testApp()
    owner = await registerUser(app, 'HOST', 'msg-doc-owner')
    guest = await registerUser(app, 'GUEST', 'msg-doc-guest')
    listing = await createListing(owner.user.id, { division: 'RENTALS' })
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a guest can upload a real document to their own inquiry thread, without leaking the storage key', async () => {
    const res = await request(app)
      .post(`/api/listings/${listing.id}/thread/documents`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ fileBase64: TINY_PNG_BASE64, mimeType: 'image/png', originalFilename: 'id-card.png' })

    expect(res.status).toBe(201)
    expect(res.body.document.mimeType).toBe('image/png')
    expect(res.body.document.originalFilename).toBe('id-card.png')
    expect(res.body.document.uploaderUserId).toBe(guest.user.id)
    expect(res.body.document.assetUrl).toBeUndefined()
  })

  it('the uploaded document appears in the guest\'s own thread view', async () => {
    const res = await request(app).get(`/api/listings/${listing.id}/thread`).set('Authorization', `Bearer ${guest.token}`)
    expect(res.status).toBe(200)
    expect(res.body.thread.documents.length).toBeGreaterThan(0)
    expect(res.body.thread.documents[0].originalFilename).toBe('id-card.png')
  })

  it('the owner sees the same document when reading the thread with guestId, and in /api/host/inquiries', async () => {
    const threadRes = await request(app)
      .get(`/api/listings/${listing.id}/thread`)
      .query({ guestId: guest.user.id })
      .set('Authorization', `Bearer ${owner.token}`)
    expect(threadRes.status).toBe(200)
    expect(threadRes.body.thread.documents.length).toBeGreaterThan(0)

    const inboxRes = await request(app).get('/api/host/inquiries').set('Authorization', `Bearer ${owner.token}`)
    expect(inboxRes.status).toBe(200)
    const thread = inboxRes.body.threads.find((entry) => entry.listingId === listing.id && entry.guestId === guest.user.id)
    expect(thread).toBeTruthy()
    expect(thread.documents.length).toBeGreaterThan(0)
  })

  it('both the uploading guest and the listing owner can download the real file bytes', async () => {
    const uploadRes = await request(app)
      .post(`/api/listings/${listing.id}/thread/documents`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ fileBase64: TINY_PNG_BASE64, mimeType: 'image/png' })
    const documentId = uploadRes.body.document.id

    const guestFileRes = await request(app)
      .get(`/api/listings/${listing.id}/thread/documents/${documentId}/file`)
      .set('Authorization', `Bearer ${guest.token}`)
    expect(guestFileRes.status).toBe(200)
    expect(guestFileRes.headers['content-type']).toContain('image/png')

    const ownerFileRes = await request(app)
      .get(`/api/listings/${listing.id}/thread/documents/${documentId}/file`)
      .set('Authorization', `Bearer ${owner.token}`)
    expect(ownerFileRes.status).toBe(200)
  })

  it('an unrelated account cannot download the document (403)', async () => {
    const uploadRes = await request(app)
      .post(`/api/listings/${listing.id}/thread/documents`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ fileBase64: TINY_PNG_BASE64, mimeType: 'image/png' })
    const documentId = uploadRes.body.document.id

    const outsider = await registerUser(app, 'GUEST', 'msg-doc-outsider')
    const res = await request(app)
      .get(`/api/listings/${listing.id}/thread/documents/${documentId}/file`)
      .set('Authorization', `Bearer ${outsider.token}`)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('THREAD_DOCUMENT_FORBIDDEN')
  })

  it('rejects an unsupported file type', async () => {
    const res = await request(app)
      .post(`/api/listings/${listing.id}/thread/documents`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ fileBase64: TINY_PNG_BASE64, mimeType: 'application/zip' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('THREAD_DOCUMENT_TYPE_INVALID')
  })

  it('rejects a missing file', async () => {
    const res = await request(app)
      .post(`/api/listings/${listing.id}/thread/documents`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ mimeType: 'image/png' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('THREAD_DOCUMENT_REQUIRED')
  })

  it('rejects an unknown field in the request body', async () => {
    const res = await request(app)
      .post(`/api/listings/${listing.id}/thread/documents`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ fileBase64: TINY_PNG_BASE64, mimeType: 'image/png', extra: 'nope' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_UNKNOWN_FIELDS')
  })
})
