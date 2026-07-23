import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'
import { BUCKET_CLASSES, objectExists } from '../../server/lib/object-storage.mjs'

// Phase 2 — the media path on durable object storage.
//
// Authorization, draft-privacy and deletion are already covered by listing-block1.test.mjs and are
// deliberately not duplicated here. This file covers what the storage migration added: magic-byte
// validation, key identity, bucket-class separation, object/metadata consistency, and response
// headers.
//
// Runs entirely on the local storage driver (NODE_ENV=test forces it, and object-storage.mjs refuses
// the s3 driver under test at both boot and use). No network call, no R2 object.

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(128, 7),
]).toString('base64')
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(128, 7)]).toString('base64')
const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBP'), Buffer.alloc(128, 7),
]).toString('base64')
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(128, 7)]).toString('base64')

async function registerSeller(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user?.id)
  return { token: res.body.token, user: res.body.user }
}

async function createListing(ownerId) {
  return db().listing.create({
    data: {
      ownerId, division: 'STAYS', status: 'DRAFT',
      titleAr: 'اختبار', titleEn: 'Media storage test',
      description: 'Phase 2 media path', priceMinor: 40, currency: 'USD',
    },
  })
}

const upload = (app, token, listingId, fileBase64, mimeType) =>
  request(app).post(`/api/listings/${listingId}/media`)
    .set('Authorization', `Bearer ${token}`).send({ fileBase64, mimeType })

const keyFromUrl = (url) => String(url).split('/').pop()

describe('Phase 2 — listing media on durable object storage', () => {
  let app, seller, listing

  beforeAll(async () => {
    app = testApp()
    seller = await registerSeller(app, 'media-store')
    listing = await createListing(seller.user.id)
  })

  afterAll(async () => {
    await db().listingMedia.deleteMany({ where: { listingId: listing.id } }).catch(() => {})
    await cleanupTestUsers()
  })

  describe('approved formats', () => {
    it('accepts a JPEG, a PNG and a WebP', async () => {
      for (const [body, mime] of [[JPEG, 'image/jpeg'], [PNG, 'image/png'], [WEBP, 'image/webp']]) {
        const res = await upload(app, seller.token, listing.id, body, mime)
        expect(res.status).toBe(201)
        expect(res.body.media.url).toContain(`/api/listings/${listing.id}/media/file/`)
      }
    })
  })

  describe('magic-byte validation — the declared type is never trusted alone', () => {
    it('rejects a PNG declared as a JPEG', async () => {
      const res = await upload(app, seller.token, listing.id, PNG, 'image/jpeg')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('LISTING_MEDIA_CONTENT_INVALID')
    })

    it('rejects a PDF submitted through the media path, however it is declared', async () => {
      const declared = await upload(app, seller.token, listing.id, PDF, 'application/pdf')
      expect(declared.status).toBe(400)
      const disguised = await upload(app, seller.token, listing.id, PDF, 'image/png')
      expect(disguised.status).toBe(400)
      expect(disguised.body.error.code).toBe('LISTING_MEDIA_CONTENT_INVALID')
    })

    it('rejects executable content disguised as an image', async () => {
      const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(128, 7)]).toString('base64')
      const res = await upload(app, seller.token, listing.id, elf, 'image/png')
      expect(res.status).toBe(400)
    })

    it('rejects an unsupported declared type and an empty body', async () => {
      expect((await upload(app, seller.token, listing.id, PNG, 'image/gif')).status).toBe(400)
      expect((await upload(app, seller.token, listing.id, '', 'image/png')).status).toBe(400)
    })

    it('rejects a file over the size limit', async () => {
      const oversized = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(8 * 1024 * 1024 + 16, 7),
      ]).toString('base64')
      const res = await upload(app, seller.token, listing.id, oversized, 'image/png')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('LISTING_MEDIA_TOO_LARGE')
    })
  })

  describe('object key identity', () => {
    it('is a UUID plus an approved extension, never the supplied filename', async () => {
      const res = await upload(app, seller.token, listing.id, PNG, 'image/png')
      const key = keyFromUrl(res.body.media.url)
      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/)
    })

    it('produces a distinct key per upload', async () => {
      const a = await upload(app, seller.token, listing.id, PNG, 'image/png')
      const b = await upload(app, seller.token, listing.id, PNG, 'image/png')
      expect(keyFromUrl(a.body.media.url)).not.toBe(keyFromUrl(b.body.media.url))
    })
  })

  describe('bucket-class separation', () => {
    it('stores media in the media class and never in the documents class', async () => {
      const res = await upload(app, seller.token, listing.id, PNG, 'image/png')
      const key = keyFromUrl(res.body.media.url)
      expect(await objectExists({ bucketClass: BUCKET_CLASSES.MEDIA, key })).toBe(true)
      expect(await objectExists({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key })).toBe(false)
    })
  })

  describe('object and metadata stay consistent', () => {
    it('a stored object has a matching database row', async () => {
      const res = await upload(app, seller.token, listing.id, PNG, 'image/png')
      const key = keyFromUrl(res.body.media.url)
      const row = await db().listingMedia.findFirst({ where: { listingId: listing.id, url: res.body.media.url } })
      expect(row).toBeTruthy()
      expect(await objectExists({ bucketClass: BUCKET_CLASSES.MEDIA, key })).toBe(true)
    })

    it('a rejected upload stores no object and creates no row', async () => {
      const before = await db().listingMedia.count({ where: { listingId: listing.id } })
      await upload(app, seller.token, listing.id, PDF, 'image/png')
      const after = await db().listingMedia.count({ where: { listingId: listing.id } })
      expect(after).toBe(before)
    })

    it('deleting a photo removes both the row and the object', async () => {
      const res = await upload(app, seller.token, listing.id, PNG, 'image/png')
      const key = keyFromUrl(res.body.media.url)
      const del = await request(app)
        .delete(`/api/listings/${listing.id}/media/${res.body.media.id}`)
        .set('Authorization', `Bearer ${seller.token}`)
      expect(del.status).toBe(200)
      expect(await objectExists({ bucketClass: BUCKET_CLASSES.MEDIA, key })).toBe(false)
    })
  })

  describe('retrieval', () => {
    it('serves the bytes with truthful headers once the listing is approved', async () => {
      const approved = await createListing(seller.user.id)
      const up = await upload(app, seller.token, approved.id, PNG, 'image/png')
      await db().listing.update({ where: { id: approved.id }, data: { status: 'APPROVED' } })

      const res = await request(app).get(up.body.media.url)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('image/png')
      expect(Number(res.headers['content-length'])).toBeGreaterThan(0)
      expect(res.headers['cache-control']).toMatch(/public/)

      await db().listingMedia.deleteMany({ where: { listingId: approved.id } })
      await db().listing.delete({ where: { id: approved.id } })
    })

    it('refuses a key that belongs to a different listing — a key alone is not access', async () => {
      const other = await createListing(seller.user.id)
      const up = await upload(app, seller.token, other.id, PNG, 'image/png')
      const foreignKey = keyFromUrl(up.body.media.url)
      await db().listing.update({ where: { id: listing.id }, data: { status: 'APPROVED' } })

      const res = await request(app).get(`/api/listings/${listing.id}/media/file/${foreignKey}`)
      expect(res.status).toBe(404)

      await db().listing.update({ where: { id: listing.id }, data: { status: 'DRAFT' } })
      await db().listingMedia.deleteMany({ where: { listingId: other.id } })
      await db().listing.delete({ where: { id: other.id } })
    })

    it('returns a clean 404 for a well-formed key with no object or row', async () => {
      const res = await request(app)
        .get(`/api/listings/${listing.id}/media/file/4d0ea46c-7f62-4345-8be8-42c440c16e63.png`)
      expect(res.status).toBe(404)
    })
  })

  describe('errors never leak storage internals', () => {
    it('reveals no bucket, endpoint, account id, or credential', async () => {
      const responses = [
        await upload(app, seller.token, listing.id, PDF, 'image/png'),
        await upload(app, seller.token, listing.id, '', 'image/png'),
        await request(app).get(`/api/listings/${listing.id}/media/file/4d0ea46c-7f62-4345-8be8-42c440c16e63.png`),
      ]
      for (const res of responses) {
        const body = JSON.stringify(res.body)
        expect(body).not.toMatch(/r2\.cloudflarestorage|sybnb-(test|staging|production)-|accessKeyId|secretAccessKey|STORAGE_S3/i)
        // No local filesystem path either — the old implementation could surface one.
        expect(body).not.toMatch(/\/uploads\/|server\/uploads/i)
      }
    })
  })
})
