import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'
import { BUCKET_CLASSES, objectExists } from '../../server/lib/object-storage.mjs'
import { DOCUMENT_ACCESS_ACTION } from '../../server/lib/document-access-audit.mjs'

// Phase 3 — the private-document path on durable object storage.
//
// The identity-document authorization state machine is already covered by verification-states and
// host-id-verification and is not duplicated here. This file covers what Phase 3 added: signature
// validation, DOCUMENTS bucket selection, forced download with a sanitised filename, fail-closed
// access, and the staff audit boundary.
//
// Local storage driver only — NODE_ENV=test forces it and the adapter refuses s3 at boot and at use.
// No network call, no R2 object, synthetic data only. No real identity document is ever used.

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(256, 7)]).toString('base64')
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(256, 7)]).toString('base64')
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBP'), Buffer.alloc(256, 7)]).toString('base64')
const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(256, 7)]).toString('base64')
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(256, 7)]).toString('base64')

async function registerGuest(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email)
  const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { token: res.body.token, user: res.body.user }
}

async function createStaff(role, label) {
  const user = await db().user.create({
    data: {
      email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'),
      displayName: `Test ${role}`, referralCode: uniqueTestReferralCode(), roles: { create: { role } },
    },
    include: { roles: true },
  })
  trackTestUser(user.id)
  return { token: createSessionToken(user), user }
}

const submit = (app, token, fileBase64, mimeType) =>
  request(app).patch('/api/me/id-document').set('Authorization', `Bearer ${token}`).send({ fileBase64, mimeType })

describe('Phase 3 — private documents on durable object storage', () => {
  let app, admin

  beforeAll(async () => {
    app = testApp()
    admin = await createStaff('ADMIN', 'doc-admin')
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  describe('content validation', () => {
    it('accepts a PDF with a valid signature', async () => {
      const guest = await registerGuest(app, 'doc-pdf')
      const res = await submit(app, guest.token, PDF, 'application/pdf')
      expect(res.status).toBe(200)
      expect(res.body.user.idDocumentStatus).toBe('PENDING_REVIEW')
    })

    it('rejects a MIME/signature mismatch', async () => {
      const guest = await registerGuest(app, 'doc-mismatch')
      const res = await submit(app, guest.token, PDF, 'image/png')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('ID_DOCUMENT_CONTENT_INVALID')
    })

    it('rejects executables and archives however they are declared', async () => {
      const guest = await registerGuest(app, 'doc-exe')
      expect((await submit(app, guest.token, ELF, 'application/pdf')).status).toBe(400)
      expect((await submit(app, guest.token, ZIP, 'application/pdf')).status).toBe(400)
    })

    it('rejects a format outside the document allowlist', async () => {
      const guest = await registerGuest(app, 'doc-webp')
      // WebP is valid for media but is not an accepted document format.
      expect((await submit(app, guest.token, WEBP, 'image/webp')).status).toBe(400)
    })

    it('rejects an empty body and an oversized file', async () => {
      const guest = await registerGuest(app, 'doc-size')
      expect((await submit(app, guest.token, '', 'application/pdf')).status).toBe(400)
      const oversized = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(8 * 1024 * 1024 + 16, 7)]).toString('base64')
      const res = await submit(app, guest.token, oversized, 'application/pdf')
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('ID_DOCUMENT_TOO_LARGE')
    })
  })

  describe('storage placement', () => {
    it('uses a UUID key and stores in the DOCUMENTS bucket, never the media bucket', async () => {
      const guest = await registerGuest(app, 'doc-bucket')
      await submit(app, guest.token, PDF, 'application/pdf')
      const row = await db().user.findUnique({ where: { id: guest.user.id }, select: { idDocumentRef: true } })

      expect(row.idDocumentRef).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/)
      expect(await objectExists({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: row.idDocumentRef })).toBe(true)
      expect(await objectExists({ bucketClass: BUCKET_CLASSES.MEDIA, key: row.idDocumentRef })).toBe(false)
    })

    it('a rejected upload stores no object and leaves the record untouched', async () => {
      const guest = await registerGuest(app, 'doc-reject')
      await submit(app, guest.token, ELF, 'application/pdf')
      const row = await db().user.findUnique({ where: { id: guest.user.id }, select: { idDocumentRef: true, idDocumentStatus: true } })
      expect(row.idDocumentRef).toBeNull()
      expect(row.idDocumentStatus).toBeNull()
    })
  })

  describe('download behaviour — forced attachment, never inline', () => {
    it('serves the owner their own document as an attachment with a sanitised filename', async () => {
      const guest = await registerGuest(app, 'doc-self')
      await submit(app, guest.token, PDF, 'application/pdf')

      const res = await request(app).get('/api/me/id-document/file').set('Authorization', `Bearer ${guest.token}`)
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('application/pdf')
      expect(res.headers['content-disposition']).toBe('attachment; filename="sybnb-identity.pdf"')
      expect(res.headers['cache-control']).toBe('private, no-store')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(Number(res.headers['content-length'])).toBeGreaterThan(0)
      // The filename must not expose the storage key or the owning user.
      expect(res.headers['content-disposition']).not.toContain(guest.user.id)
    })

    it('serves staff the same forced-download headers', async () => {
      const guest = await registerGuest(app, 'doc-staff-dl')
      await submit(app, guest.token, PDF, 'application/pdf')

      const res = await request(app)
        .get(`/api/admin/id-document/${guest.user.id}/file`).set('Authorization', `Bearer ${admin.token}`)
      expect(res.status).toBe(200)
      expect(res.headers['content-disposition']).toMatch(/^attachment;/)
      expect(res.headers['cache-control']).toBe('private, no-store')
    })
  })

  describe('fail-closed authorization', () => {
    it('refuses an unauthenticated read', async () => {
      const res = await request(app).get('/api/me/id-document/file')
      expect(res.status).toBe(401)
    })

    it('refuses one user reading another user document', async () => {
      const owner = await registerGuest(app, 'doc-owner')
      await submit(app, owner.token, PDF, 'application/pdf')
      const outsider = await registerGuest(app, 'doc-outsider')

      // There is no route by which a guest can address another guest's document — /api/me is always
      // scoped to the caller — so the outsider's own call must 404 rather than ever return the owner's.
      const res = await request(app).get('/api/me/id-document/file').set('Authorization', `Bearer ${outsider.token}`)
      expect(res.status).toBe(404)
    })

    it('refuses a non-staff caller on the staff route', async () => {
      const guest = await registerGuest(app, 'doc-nonstaff')
      await submit(app, guest.token, PDF, 'application/pdf')
      const res = await request(app)
        .get(`/api/admin/id-document/${guest.user.id}/file`).set('Authorization', `Bearer ${guest.token}`)
      expect(res.status).toBe(403)
    })

    it('refuses when no document record exists — never an empty success', async () => {
      const guest = await registerGuest(app, 'doc-none')
      const own = await request(app).get('/api/me/id-document/file').set('Authorization', `Bearer ${guest.token}`)
      expect(own.status).toBe(404)

      const staff = await request(app)
        .get(`/api/admin/id-document/${guest.user.id}/file`).set('Authorization', `Bearer ${admin.token}`)
      expect(staff.status).toBe(404)
    })

    it('refuses when the metadata record points at an object that is gone', async () => {
      const guest = await registerGuest(app, 'doc-missing-object')
      await submit(app, guest.token, PDF, 'application/pdf')
      // Simulate a lost object while the reference survives — must fail truthfully, not serve empty.
      await db().user.update({
        where: { id: guest.user.id },
        data: { idDocumentRef: '4d0ea46c-7f62-4345-8be8-42c440c16e63.pdf' },
      })
      const res = await request(app).get('/api/me/id-document/file').set('Authorization', `Bearer ${guest.token}`)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).not.toBe(200)
    })
  })

  describe('staff access audit boundary', () => {
    it('records an audit event for staff access, with metadata only', async () => {
      const guest = await registerGuest(app, 'doc-audit')
      await submit(app, guest.token, PDF, 'application/pdf')

      await request(app)
        .get(`/api/admin/id-document/${guest.user.id}/file`).set('Authorization', `Bearer ${admin.token}`)

      const entry = await db().adminAuditLog.findFirst({
        where: { action: DOCUMENT_ACCESS_ACTION, entityId: guest.user.id },
        orderBy: { createdAt: 'desc' },
      })
      expect(entry).toBeTruthy()
      expect(entry.actorUserId).toBe(admin.user.id)
      expect(entry.entityType).toBe('users')
      expect(entry.after.documentCategory).toBe('identity')
      expect(entry.after.actorRoles).toContain('ADMIN')
      expect(entry.after.result).toBe('ALLOWED')

      // Never the document body, a storage key, a bucket, an endpoint, or a credential.
      const serialized = JSON.stringify(entry)
      expect(serialized).not.toMatch(/%PDF|r2\.cloudflarestorage|sybnb-(test|staging|production)-|accessKey|secretAccess/i)
      expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg)/)
    })

    it('does not audit a worker reading their own document', async () => {
      const guest = await registerGuest(app, 'doc-selfaudit')
      await submit(app, guest.token, PDF, 'application/pdf')
      await request(app).get('/api/me/id-document/file').set('Authorization', `Bearer ${guest.token}`)

      const entry = await db().adminAuditLog.findFirst({
        where: { action: DOCUMENT_ACCESS_ACTION, entityId: guest.user.id },
      })
      expect(entry).toBeNull()
    })
  })

  describe('replacement preserves current approved behaviour', () => {
    it('stores the new object before the reference moves, then removes the superseded one', async () => {
      const guest = await registerGuest(app, 'doc-replace')
      await submit(app, guest.token, PDF, 'application/pdf')
      const first = await db().user.findUnique({ where: { id: guest.user.id }, select: { idDocumentRef: true } })

      await submit(app, guest.token, PNG, 'image/png')
      const second = await db().user.findUnique({ where: { id: guest.user.id }, select: { idDocumentRef: true } })

      expect(second.idDocumentRef).not.toBe(first.idDocumentRef)
      // New object durable and referenced; superseded object removed (current approved behaviour —
      // D-7 retention is a separate, unimplemented decision).
      expect(await objectExists({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: second.idDocumentRef })).toBe(true)
      expect(await objectExists({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: first.idDocumentRef })).toBe(false)
    })
  })

  describe('errors never leak storage internals', () => {
    it('reveals no bucket, endpoint, account id, credential or filesystem path', async () => {
      const guest = await registerGuest(app, 'doc-errleak')
      const responses = [
        await submit(app, guest.token, ELF, 'application/pdf'),
        await submit(app, guest.token, '', 'application/pdf'),
        await request(app).get('/api/me/id-document/file').set('Authorization', `Bearer ${guest.token}`),
      ]
      for (const res of responses) {
        const body = JSON.stringify(res.body)
        expect(body).not.toMatch(/r2\.cloudflarestorage|sybnb-(test|staging|production)-|accessKeyId|secretAccessKey|STORAGE_S3/i)
        expect(body).not.toMatch(/\/uploads\/|server\/uploads/i)
      }
    })
  })
})
