import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// A3.3 — authorization for the self-serve STR wizard path (the endpoints the wizard drives). Applies the
// A1 IDOR pattern to the wizard: a host may create/edit/submit/upload-media only to their OWN
// accommodation/listing (rejected on another host's), and a host cannot approve their own listing
// (that is admin-only). Complements the general A1 authorization suite with wizard-path coverage.

const XC = 'XC'
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGNk+M9Qz0BkYBxVSF+FAP7pBQVFvY4EAAAAAElFTkSuQmCC'
const CONTRACT = 'str-host-commission-v3-card-fee'
const bearer = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

describe('A3.3 — self-serve wizard authorization (own-listing-only + no self-approve)', () => {
  let app
  let hostA
  let hostB
  let accA
  let listingA

  async function createHost(label) {
    const u = await db().user.create({
      data: {
        email: uniqueTestEmail(label),
        passwordHash: hashPassword('correct-horse-battery'),
        displayName: `A3.3 ${label}`,
        referralCode: uniqueTestReferralCode(),
        status: 'ACTIVE',
        roles: { create: { role: 'HOST' } },
        phoneHash: `a33-${label}-${Math.random().toString(36).slice(2)}`,
      },
    })
    trackTestUser(u.id)
    return { token: createSessionToken(u), id: u.id }
  }

  beforeAll(async () => {
    app = testApp()
    hostA = await createHost('a33-hostA')
    hostB = await createHost('a33-hostB')
    // host A creates their own accommodation + room-type listing (the wizard's create path)
    const acc = await request(app)
      .post('/api/accommodations')
      .set(bearer(hostA.token))
      .send({ titleAr: 'شقة المضيف A', governorate: 'damascus', city: 'damascus', area: 'mazzeh', address: 'A st', metadata: { country: XC } })
    accA = acc.body.accommodation.id
    const room = await request(app)
      .post(`/api/accommodations/${accA}/room-types`)
      .set(bearer(hostA.token))
      .send({ titleAr: 'غرفة A', priceMinor: 100_00, currency: 'USD', metadata: { country: XC } })
    listingA = room.body.listing.id
  })
  afterAll(async () => {
    await db().listingMedia.deleteMany({ where: { listingId: listingA } }).catch(() => {})
    await db().listing.deleteMany({ where: { accommodationId: accA } }).catch(() => {})
    await db().accommodation.deleteMany({ where: { id: accA } }).catch(() => {})
    await cleanupTestUsers()
  })

  // ---- positive controls: host A can act on their OWN listing ----
  it('host A CAN upload media to their own listing', async () => {
    const res = await request(app).post(`/api/listings/${listingA}/media`).set(bearer(hostA.token)).send({ fileBase64: PNG_B64, mimeType: 'image/png' })
    expect(res.status).toBe(201)
  })
  it('host A CAN submit their own accommodation', async () => {
    const res = await request(app).patch(`/api/accommodations/${accA}/submit`).set(bearer(hostA.token)).send({ acceptContract: true, contractVersion: CONTRACT })
    expect(res.status).toBe(200)
  })

  // ---- IDOR: host B cannot act on host A's accommodation/listing ----
  it('host B cannot add a room-type to host A\'s accommodation → 404', async () => {
    const res = await request(app).post(`/api/accommodations/${accA}/room-types`).set(bearer(hostB.token)).send({ titleAr: 'دخيل', priceMinor: 100_00, currency: 'USD' })
    expect(res.status).toBe(404)
    expect(res.body.error?.code).toBe('ACCOMMODATION_NOT_FOUND')
  })
  it('host B cannot upload media to host A\'s listing → 404', async () => {
    const res = await request(app).post(`/api/listings/${listingA}/media`).set(bearer(hostB.token)).send({ fileBase64: PNG_B64, mimeType: 'image/png' })
    expect(res.status).toBe(404)
    expect(res.body.error?.code).toBe('LISTING_NOT_FOUND')
  })
  it('host B cannot submit host A\'s accommodation → 404', async () => {
    const res = await request(app).patch(`/api/accommodations/${accA}/submit`).set(bearer(hostB.token)).send({ acceptContract: true, contractVersion: CONTRACT })
    expect(res.status).toBe(404)
    expect(res.body.error?.code).toBe('ACCOMMODATION_NOT_FOUND')
  })
  it('host B cannot submit host A\'s listing via the single-listing submit → 404', async () => {
    const res = await request(app).patch(`/api/listings/${listingA}/submit`).set(bearer(hostB.token)).send({ acceptContract: true, contractVersion: CONTRACT })
    expect(res.status).toBe(404)
    expect(res.body.error?.code).toBe('LISTING_NOT_FOUND')
  })

  // ---- a host cannot approve their OWN listing (approval is admin-only) ----
  it('host A cannot approve their own listing (admin-only) → 403', async () => {
    const res = await request(app).patch(`/api/admin/review-queue/listing/${listingA}`).set(bearer(hostA.token)).send({ decision: 'APPROVED' })
    expect(res.status).toBe(403)
  })
})
