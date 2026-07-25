import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// A3.2 — the STR self-serve wizard flow, end-to-end at the endpoints the wizard drives
// (createAccommodation → addAccommodationRoomType → uploadListingPhoto → submitAccommodation w/ 13%
// consent). Asserts: the uploaded photo PERSISTS (ListingMedia row + storage), the 13% consent is
// CAPTURED (contract version audited), the result is PENDING_REVIEW, and /api/me/overview exposes the
// hasPhone flag the wizard's Finding-3 gate depends on.
//
// Storage note: the test env uses STORAGE_DRIVER=local, so the photo lands on local disk — durable for
// the test but NOT for staging/prod, which must use the S3/R2 driver (STORAGE_DRIVER=s3).

const XC = 'XC'
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGNk+M9Qz0BkYBxVSF+FAP7pBQVFvY4EAAAAAElFTkSuQmCC'
const CONTRACT_VERSION = 'str-host-commission-v3-card-fee'
const bearer = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

describe('A3.2 — STR wizard create → media → submit flow (photo persists, consent, PENDING_REVIEW)', () => {
  let app
  let host // has a phone on file
  let phonelessHost

  async function createHost(label, withPhone) {
    const u = await db().user.create({
      data: {
        email: uniqueTestEmail(label),
        passwordHash: hashPassword('correct-horse-battery'),
        displayName: `A3 ${label}`,
        referralCode: uniqueTestReferralCode(),
        status: 'ACTIVE',
        roles: { create: { role: 'HOST' } },
        ...(withPhone ? { phoneHash: `a3-phone-${label}-${Math.random().toString(36).slice(2)}` } : {}),
      },
    })
    trackTestUser(u.id)
    return { token: createSessionToken(u), id: u.id }
  }

  beforeAll(async () => {
    app = testApp()
    host = await createHost('a3-wiz-host', true)
    phonelessHost = await createHost('a3-wiz-nophone', false)
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('drives the wizard flow and persists the photo, the 13% consent, and PENDING_REVIEW', async () => {
    // 1) create accommodation
    const acc = await request(app)
      .post('/api/accommodations')
      .set(bearer(host.token))
      .send({ titleAr: 'شقة الويزارد', governorate: 'damascus', city: 'damascus', area: 'mazzeh', address: 'A3.2 street', metadata: { country: XC, mapLocation: { latitude: 33.5, longitude: 36.2, pinConfirmed: true } } })
    expect(acc.status).toBe(201)
    const accommodationId = acc.body.accommodation.id

    // 2) add a room-type (the bookable STAYS listing)
    const room = await request(app)
      .post(`/api/accommodations/${accommodationId}/room-types`)
      .set(bearer(host.token))
      .send({ titleAr: 'غرفة الويزارد', priceMinor: 120_00, currency: 'USD', metadata: { country: XC, cleaningFeeMinor: 25_00 } })
    expect(room.status).toBe(201)
    const listingId = room.body.listing.id

    // 3) upload a real photo → must persist (ListingMedia row) + return a URL
    const media = await request(app)
      .post(`/api/listings/${listingId}/media`)
      .set(bearer(host.token))
      .send({ fileBase64: PNG_B64, mimeType: 'image/png' })
    expect(media.status).toBe(201)
    expect(media.body.media.url).toBeTruthy()
    const mediaCount = await db().listingMedia.count({ where: { listingId } })
    expect(mediaCount, 'uploaded photo persisted as a ListingMedia row').toBeGreaterThanOrEqual(1)

    // 4) submit the accommodation with the 13% commission consent → PENDING_REVIEW
    const submit = await request(app)
      .patch(`/api/accommodations/${accommodationId}/submit`)
      .set(bearer(host.token))
      .send({ acceptContract: true, contractVersion: CONTRACT_VERSION })
    expect(submit.status).toBe(200)

    const listing = await db().listing.findUnique({ where: { id: listingId }, select: { status: true } })
    expect(listing.status, 'listing is PENDING_REVIEW after submit').toBe('PENDING_REVIEW')

    // consent captured: recorded in the audit trail against this accommodation with the contract version
    const consent = await db().adminAuditLog.findFirst({
      where: { entityType: 'host_contract', entityId: accommodationId, actorUserId: host.id },
      orderBy: { createdAt: 'desc' },
    })
    expect(consent, 'host contract consent audited on publish').toBeTruthy()
    expect(consent.after?.version).toBe(CONTRACT_VERSION)
  })

  it('rejects submit without the 13% consent (consent is required to publish)', async () => {
    const acc = await request(app)
      .post('/api/accommodations')
      .set(bearer(host.token))
      .send({ titleAr: 'شقة بدون موافقة', governorate: 'damascus', city: 'damascus', area: 'mazzeh', metadata: { country: XC } })
    const accommodationId = acc.body.accommodation.id
    await request(app)
      .post(`/api/accommodations/${accommodationId}/room-types`)
      .set(bearer(host.token))
      .send({ titleAr: 'غرفة', priceMinor: 100_00, currency: 'USD', metadata: { country: XC } })
    const submit = await request(app).patch(`/api/accommodations/${accommodationId}/submit`).set(bearer(host.token)).send({})
    expect(submit.status).toBeGreaterThanOrEqual(400)
  })

  it('/api/me/overview exposes hasPhone: true for a host with a phone, false without (Finding-3 gate input)', async () => {
    const withPhone = await request(app).get('/api/me/overview').set(bearer(host.token))
    expect(withPhone.status).toBe(200)
    expect(withPhone.body.overview.user.hasPhone).toBe(true)

    const without = await request(app).get('/api/me/overview').set(bearer(phonelessHost.token))
    expect(without.status).toBe(200)
    expect(without.body.overview.user.hasPhone).toBe(false)
  })
})
