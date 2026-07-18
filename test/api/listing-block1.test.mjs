import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// A 1x1 transparent PNG — the smallest possible "real photo" for the upload round-trip.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// SELLER now passes the same real 'staff-login' email OTP as HOST/DRIVER (Block 2), so verify the
// email code before registering.
async function registerSeller(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app)
    .post('/api/auth/register')
    .send({ role: 'SELLER', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function approveSellerPlan(userId, planCode = 'plus') {
  await db().sellerProfile.upsert({
    where: { userId },
    create: { userId, legalName: 'Test Seller', sellerType: 'INDIVIDUAL', documentStatus: 'APPROVED', planCode },
    update: { documentStatus: 'APPROVED', planCode },
  })
}

async function createListing(app, token, { division, metadata = {}, priceMinor = 100 }) {
  const res = await request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${token}`)
    .send({ division, titleAr: `عقار ${division}`, priceMinor, currency: 'SYP', metadata })
  return res
}

async function uploadPhoto(app, token, listingId, mimeType = 'image/png', fileBase64 = PNG_1x1) {
  return request(app)
    .post(`/api/listings/${listingId}/media`)
    .set('Authorization', `Bearer ${token}`)
    .send({ fileBase64, mimeType })
}

const COMPLETE_PROPERTY = {
  propertyType: 'apartment',
  governorate: 'Damascus',
  city: 'Mazzeh',
  bedrooms: 2,
  bathrooms: 1,
  areaSqm: 120,
}

const COMPLETE_CAR = {
  vehicle: { make: 'Kia', model: 'Rio', year: 2019, mileageKm: 82000, transmission: 'AUTO', fuelType: 'PETROL', condition: 'USED' },
  mapLocation: { latitude: 33.5138, longitude: 36.2765, pinConfirmed: true },
}

describe('Marketplace trust Block 1: photos + required attributes + submit guards', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  describe('listing media upload + owner-gated serving', () => {
    it('the owner uploads a real photo, gets a stable serve URL, and can list it', async () => {
      const seller = await registerSeller(app, 'media-owner')
      const listing = (await createListing(app, seller.token, { division: 'BUY', metadata: COMPLETE_PROPERTY })).body.listing

      const up = await uploadPhoto(app, seller.token, listing.id)
      expect(up.status).toBe(201)
      expect(up.body.media.kind).toBe('photo')
      expect(up.body.media.url).toContain(`/api/listings/${listing.id}/media/file/`)

      const list = await request(app).get(`/api/listings/${listing.id}/media`).set('Authorization', `Bearer ${seller.token}`)
      expect(list.status).toBe(200)
      expect(list.body.media).toHaveLength(1)
    })

    it('rejects a non-image mime and an empty file', async () => {
      const seller = await registerSeller(app, 'media-badtype')
      const listing = (await createListing(app, seller.token, { division: 'BUY', metadata: COMPLETE_PROPERTY })).body.listing

      const badType = await uploadPhoto(app, seller.token, listing.id, 'application/pdf')
      expect(badType.status).toBe(400)
      expect(badType.body.error.code).toBe('LISTING_MEDIA_TYPE_INVALID')

      const empty = await uploadPhoto(app, seller.token, listing.id, 'image/png', '')
      expect(empty.status).toBe(400)
      expect(empty.body.error.code).toBe('LISTING_MEDIA_EMPTY')
    })

    it('a stranger cannot upload to, list, or delete another seller’s listing media', async () => {
      const owner = await registerSeller(app, 'media-owner2')
      const stranger = await registerSeller(app, 'media-stranger')
      const listing = (await createListing(app, owner.token, { division: 'BUY', metadata: COMPLETE_PROPERTY })).body.listing
      const media = (await uploadPhoto(app, owner.token, listing.id)).body.media

      const strangerUpload = await uploadPhoto(app, stranger.token, listing.id)
      expect(strangerUpload.status).toBe(404)
      const strangerList = await request(app).get(`/api/listings/${listing.id}/media`).set('Authorization', `Bearer ${stranger.token}`)
      expect(strangerList.status).toBe(404)
      const strangerDelete = await request(app).delete(`/api/listings/${listing.id}/media/${media.id}`).set('Authorization', `Bearer ${stranger.token}`)
      expect(strangerDelete.status).toBe(404)
    })

    it('a draft photo is private (owner-only) but becomes public once the listing is APPROVED', async () => {
      const owner = await registerSeller(app, 'media-serve-owner')
      const stranger = await registerSeller(app, 'media-serve-stranger')
      const listing = (await createListing(app, owner.token, { division: 'BUY', metadata: COMPLETE_PROPERTY })).body.listing
      const media = (await uploadPhoto(app, owner.token, listing.id)).body.media
      const fileUrl = media.url

      // Draft: owner can read the bytes; a stranger and an anonymous caller cannot.
      const ownerRead = await request(app).get(fileUrl).set('Authorization', `Bearer ${owner.token}`)
      expect(ownerRead.status).toBe(200)
      expect(ownerRead.headers['content-type']).toContain('image/png')
      const strangerRead = await request(app).get(fileUrl).set('Authorization', `Bearer ${stranger.token}`)
      expect(strangerRead.status).toBe(403)
      const anonRead = await request(app).get(fileUrl)
      expect(anonRead.status).toBe(401)

      // Once APPROVED, the photo is public (anyone browsing the catalog can load it).
      await db().listing.update({ where: { id: listing.id }, data: { status: 'APPROVED' } })
      const publicRead = await request(app).get(fileUrl)
      expect(publicRead.status).toBe(200)
    })

    it('a deleted photo can no longer be served', async () => {
      const owner = await registerSeller(app, 'media-del-owner')
      const listing = (await createListing(app, owner.token, { division: 'BUY', metadata: COMPLETE_PROPERTY })).body.listing
      const media = (await uploadPhoto(app, owner.token, listing.id)).body.media

      const del = await request(app).delete(`/api/listings/${listing.id}/media/${media.id}`).set('Authorization', `Bearer ${owner.token}`)
      expect(del.status).toBe(200)
      const gone = await request(app).get(media.url).set('Authorization', `Bearer ${owner.token}`)
      expect(gone.status).toBe(404)
    })

    it('a malformed listing/media id is a clean 404, not a 500', async () => {
      const owner = await registerSeller(app, 'media-uuid')
      const bad = await request(app).get('/api/listings/not-a-uuid/media/file/whatever.png')
      expect(bad.status).toBe(404)
      expect(bad.body.error.code).toBe('LISTING_NOT_FOUND')
    })
  })

  describe('submit guards (non-paid property division: BUY)', () => {
    it('refuses to submit a photo-required listing with no photos', async () => {
      const seller = await registerSeller(app, 'submit-nophoto')
      const listing = (await createListing(app, seller.token, { division: 'BUY', metadata: COMPLETE_PROPERTY })).body.listing
      const res = await request(app).patch(`/api/listings/${listing.id}/submit`).set('Authorization', `Bearer ${seller.token}`)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('LISTING_PHOTOS_REQUIRED')
    })

    it('refuses to submit when required attributes are incomplete, and reports which', async () => {
      const seller = await registerSeller(app, 'submit-noattrs')
      const listing = (await createListing(app, seller.token, { division: 'BUY', metadata: { governorate: 'Damascus' } })).body.listing
      await uploadPhoto(app, seller.token, listing.id) // photo present, attributes still incomplete
      const res = await request(app).patch(`/api/listings/${listing.id}/submit`).set('Authorization', `Bearer ${seller.token}`)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('LISTING_ATTRIBUTES_INCOMPLETE')
      expect(Array.isArray(res.body.error.details.missing)).toBe(true)
      expect(res.body.error.details.missing.length).toBeGreaterThan(0)
    })

    it('accepts a complete listing (photo + all attributes) and moves it to PENDING_REVIEW', async () => {
      const seller = await registerSeller(app, 'submit-ok')
      const listing = (await createListing(app, seller.token, { division: 'BUY', metadata: COMPLETE_PROPERTY })).body.listing
      await uploadPhoto(app, seller.token, listing.id)
      const res = await request(app).patch(`/api/listings/${listing.id}/submit`).set('Authorization', `Bearer ${seller.token}`)
      expect(res.status).toBe(200)
      expect(res.body.listing.status).toBe('PENDING_REVIEW')
    })
  })

  describe('paid division (CARS): plan gate at create AND re-check at submit', () => {
    it('a car listing cannot even be created without an approved seller plan', async () => {
      const seller = await registerSeller(app, 'car-noplan')
      const res = await createListing(app, seller.token, { division: 'CARS', metadata: COMPLETE_CAR })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('SELLER_PLAN_REQUIRED')
    })

    it('with an approved plan the car submits only with a photo + full car attributes', async () => {
      const seller = await registerSeller(app, 'car-ok')
      await approveSellerPlan(seller.user.id)
      const listing = (await createListing(app, seller.token, { division: 'CARS', metadata: COMPLETE_CAR })).body.listing
      expect(listing.status).toBe('DRAFT')

      // no photo yet -> blocked
      const noPhoto = await request(app).patch(`/api/listings/${listing.id}/submit`).set('Authorization', `Bearer ${seller.token}`)
      expect(noPhoto.status).toBe(400)
      expect(noPhoto.body.error.code).toBe('LISTING_PHOTOS_REQUIRED')

      await uploadPhoto(app, seller.token, listing.id)
      const ok = await request(app).patch(`/api/listings/${listing.id}/submit`).set('Authorization', `Bearer ${seller.token}`)
      expect(ok.status).toBe(200)
      expect(ok.body.listing.status).toBe('PENDING_REVIEW')
    })

    it('re-checks the plan at submit time: a lapsed plan blocks a complete car listing', async () => {
      const seller = await registerSeller(app, 'car-lapsed')
      await approveSellerPlan(seller.user.id)
      const listing = (await createListing(app, seller.token, { division: 'CARS', metadata: COMPLETE_CAR })).body.listing
      await uploadPhoto(app, seller.token, listing.id)

      // Plan is revoked/lapses AFTER the draft was created but BEFORE submit.
      await db().sellerProfile.update({ where: { userId: seller.user.id }, data: { documentStatus: 'REJECTED' } })

      const res = await request(app).patch(`/api/listings/${listing.id}/submit`).set('Authorization', `Bearer ${seller.token}`)
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('SELLER_PLAN_REQUIRED')
    })
  })
})
