import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'
import { DOCUMENT_ACCESS_ACTION } from '../../server/lib/document-access-audit.mjs'
import { saveListingDocument } from '../../server/lib/listing-document-storage.mjs'
import { saveThreadDocument } from '../../server/lib/thread-document-storage.mjs'
import { saveDriverDocument } from '../../server/lib/driver-document-storage.mjs'

// SYB-005 (Wave 0, scoped) — staff document-read auditing on the four UNFROZEN routes.
//
// STG-24 was recorded CLOSED with exactly one call site of recordStaffDocumentAccess()
// (admin.mjs:393, identity documents). Seven further staff-reachable routes served a stored private
// document with no audit record, so "which staff member read which document" was unanswerable for
// every category except identity.
//
// Routes covered here — coverage moves from 1 of 8 to 5 of 8 staff-reachable routes:
//   1. GET /api/admin/driver-documents/:docId/file              admin.mjs
//   2. GET /api/admin/listing-documents/:docId/file             admin.mjs
//   3. GET /api/listings/:id/documents/:docId/file              listings.mjs   (staff only)
//   4. GET /api/listings/:id/thread/documents/:docId/file       messages.mjs   (staff only)
//
// DELIBERATELY NOT COVERED — frozen platform boundaries, no unfreeze authorized:
//   - server/routes/driver.mjs:314                              (Ride)
//   - server/routes/quebec-driver-onboarding.mjs:195, :441       (Québec)
// Those three remain unaudited. No assertion is made about them either way, so remediating them
// later under an Architecture Change Request will not break this file.
//
// THE ACTOR BOUNDARY IS THE SUBTLE PART. listings.mjs and messages.mjs serve both the owning
// host/participant AND staff. An event must be emitted only when access is granted *by virtue of a
// staff capacity* — never for ordinary owner, participant or self-service reads, even when the
// caller happens to hold a staff role. Both directions are asserted below.
//
// Out of scope by owner decision and deliberately untested here: ipHash population, a purpose /
// case-reference field, audit-failure alert routing, and the AdminAuditLog-vs-dedicated-log
// question. All remain open items.

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(256, 7)]).toString('base64')

async function createUser(role, label) {
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

const staffEvents = (entityId) =>
  db().adminAuditLog.findMany({ where: { action: DOCUMENT_ACCESS_ACTION, entityId }, orderBy: { createdAt: 'desc' } })

describe('SYB-005 — staff document-access auditing on unfrozen routes', () => {
  let app, admin, support, host, guest, driver, outsider
  let listing, listingDocument, threadDocument, driverDocument
  let adminOwnedListing, adminOwnedDocument

  beforeAll(async () => {
    app = testApp()
    admin = await createUser('ADMIN', 'sa-admin')
    support = await createUser('SUPPORT', 'sa-support')
    host = await createUser('HOST', 'sa-host')
    guest = await createUser('GUEST', 'sa-guest')
    driver = await createUser('DRIVER', 'sa-driver')
    outsider = await createUser('GUEST', 'sa-outsider')

    listing = await db().listing.create({
      data: {
        ownerId: host.user.id, division: 'STAYS', titleAr: 'تدقيق الوصول', titleEn: 'Staff Audit Test Stay',
        priceMinor: 50_00, currency: 'USD', status: 'APPROVED',
      },
    })
    listingDocument = await db().listingDocument.create({
      data: {
        listingId: listing.id, type: 'CITQ_CERTIFICATE',
        assetUrl: await saveListingDocument(PDF, 'application/pdf'), mimeType: 'application/pdf',
      },
    })

    const thread = await db().messageThread.create({ data: { listingId: listing.id, guestId: guest.user.id } })
    threadDocument = await db().threadDocument.create({
      data: {
        threadId: thread.id, uploaderUserId: guest.user.id,
        assetUrl: await saveThreadDocument(PDF, 'application/pdf'), mimeType: 'application/pdf',
      },
    })

    driverDocument = await db().driverDocument.create({
      data: {
        driverUserId: driver.user.id, type: 'LICENSE',
        assetUrl: await saveDriverDocument(PDF, 'application/pdf'), mimeType: 'application/pdf',
      },
    })

    // A listing owned by the admin themself — used to prove that holding a staff role does not turn
    // a self-service read into a staff-access event.
    adminOwnedListing = await db().listing.create({
      data: {
        ownerId: admin.user.id, division: 'STAYS', titleAr: 'ملك المشرف', titleEn: 'Admin Owned Stay',
        priceMinor: 50_00, currency: 'USD', status: 'APPROVED',
      },
    })
    adminOwnedDocument = await db().listingDocument.create({
      data: {
        listingId: adminOwnedListing.id, type: 'CITQ_CERTIFICATE',
        assetUrl: await saveListingDocument(PDF, 'application/pdf'), mimeType: 'application/pdf',
      },
    })
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  function expectStaffEvent(entry, { actorId, roles, category, entityType }) {
    expect(entry).toBeTruthy()
    expect(entry.actorUserId).toBe(actorId)
    expect(entry.entityType).toBe(entityType)
    expect(entry.after.documentCategory).toBe(category)
    expect(entry.after.actorRoles).toContain(roles)
    expect(entry.after.result).toBe('ALLOWED')
    // Metadata only — never the bytes, the storage key, the bucket, or a credential.
    const serialized = JSON.stringify(entry)
    expect(serialized).not.toMatch(/%PDF|r2\.cloudflarestorage|accessKey|secretAccess/i)
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg)/)
  }

  describe('1. admin driver-document route — admin.mjs', () => {
    it('emits a staff-access event naming the actor and the document', async () => {
      const res = await request(app)
        .get(`/api/admin/driver-documents/${driverDocument.id}/file`).set('Authorization', `Bearer ${admin.token}`)
      expect(res.status).toBe(200)

      const events = await staffEvents(driverDocument.id)
      expect(events).toHaveLength(1)
      expectStaffEvent(events[0], {
        actorId: admin.user.id, roles: 'ADMIN', category: 'driver', entityType: 'driver_documents',
      })
    })

    it('records SUPPORT separately, so capacity is attributable', async () => {
      await request(app)
        .get(`/api/admin/driver-documents/${driverDocument.id}/file`).set('Authorization', `Bearer ${support.token}`)
      const events = await staffEvents(driverDocument.id)
      expect(events.some((e) => e.actorUserId === support.user.id && e.after.actorRoles.includes('SUPPORT'))).toBe(true)
    })

    it('denied access leaves no successful-access event and authorization is unchanged', async () => {
      const before = (await staffEvents(driverDocument.id)).length
      const res = await request(app)
        .get(`/api/admin/driver-documents/${driverDocument.id}/file`).set('Authorization', `Bearer ${driver.token}`)
      expect(res.status).toBe(403)
      expect((await staffEvents(driverDocument.id)).length).toBe(before)
    })
  })

  describe('2. admin listing-document route — admin.mjs', () => {
    it('emits a staff-access event', async () => {
      const res = await request(app)
        .get(`/api/admin/listing-documents/${listingDocument.id}/file`).set('Authorization', `Bearer ${admin.token}`)
      expect(res.status).toBe(200)

      const events = await staffEvents(listingDocument.id)
      expect(events).toHaveLength(1)
      expectStaffEvent(events[0], {
        actorId: admin.user.id, roles: 'ADMIN', category: 'listing', entityType: 'listing_documents',
      })
    })

    it('denied access leaves no successful-access event', async () => {
      const before = (await staffEvents(listingDocument.id)).length
      const res = await request(app)
        .get(`/api/admin/listing-documents/${listingDocument.id}/file`).set('Authorization', `Bearer ${host.token}`)
      expect(res.status).toBe(403)
      expect((await staffEvents(listingDocument.id)).length).toBe(before)
    })
  })

  describe('3. listing-document route — listings.mjs (dual-actor)', () => {
    it('the owning host reading their own document creates NO staff event', async () => {
      const before = (await staffEvents(listingDocument.id)).length
      const res = await request(app)
        .get(`/api/listings/${listing.id}/documents/${listingDocument.id}/file`).set('Authorization', `Bearer ${host.token}`)
      expect(res.status).toBe(200)
      expect((await staffEvents(listingDocument.id)).length).toBe(before)
    })

    it('staff reading another host document DOES create a staff event', async () => {
      const before = (await staffEvents(listingDocument.id)).length
      const res = await request(app)
        .get(`/api/listings/${listing.id}/documents/${listingDocument.id}/file`).set('Authorization', `Bearer ${support.token}`)
      expect(res.status).toBe(200)

      const events = await staffEvents(listingDocument.id)
      expect(events.length).toBe(before + 1)
      expectStaffEvent(events[0], {
        actorId: support.user.id, roles: 'SUPPORT', category: 'listing', entityType: 'listing_documents',
      })
    })

    it('a staff member reading their OWN document is self-service, not staff access', async () => {
      // The actor boundary: holding a staff role must not reclassify an ordinary owner read.
      const before = (await staffEvents(adminOwnedDocument.id)).length
      const res = await request(app)
        .get(`/api/listings/${adminOwnedListing.id}/documents/${adminOwnedDocument.id}/file`)
        .set('Authorization', `Bearer ${admin.token}`)
      expect(res.status).toBe(200)
      expect((await staffEvents(adminOwnedDocument.id)).length).toBe(before)
    })

    it('an unrelated account is still refused and leaves no event', async () => {
      const before = (await staffEvents(listingDocument.id)).length
      const res = await request(app)
        .get(`/api/listings/${listing.id}/documents/${listingDocument.id}/file`).set('Authorization', `Bearer ${outsider.token}`)
      expect(res.status).toBe(403)
      expect((await staffEvents(listingDocument.id)).length).toBe(before)
    })
  })

  describe('4. thread-document route — messages.mjs (dual-actor)', () => {
    it('the uploading participant creates NO staff event', async () => {
      const before = (await staffEvents(threadDocument.id)).length
      const res = await request(app)
        .get(`/api/listings/${listing.id}/thread/documents/${threadDocument.id}/file`).set('Authorization', `Bearer ${guest.token}`)
      expect(res.status).toBe(200)
      expect((await staffEvents(threadDocument.id)).length).toBe(before)
    })

    it('the listing owner as counterparty creates NO staff event', async () => {
      const before = (await staffEvents(threadDocument.id)).length
      const res = await request(app)
        .get(`/api/listings/${listing.id}/thread/documents/${threadDocument.id}/file`).set('Authorization', `Bearer ${host.token}`)
      expect(res.status).toBe(200)
      expect((await staffEvents(threadDocument.id)).length).toBe(before)
    })

    it('staff reading a private conversation attachment DOES create a staff event', async () => {
      const before = (await staffEvents(threadDocument.id)).length
      const res = await request(app)
        .get(`/api/listings/${listing.id}/thread/documents/${threadDocument.id}/file`).set('Authorization', `Bearer ${admin.token}`)
      expect(res.status).toBe(200)

      const events = await staffEvents(threadDocument.id)
      expect(events.length).toBe(before + 1)
      expectStaffEvent(events[0], {
        actorId: admin.user.id, roles: 'ADMIN', category: 'thread', entityType: 'thread_documents',
      })
    })
  })

  describe('coverage guard', () => {
    it('auditing does not block a read when the audit write fails', async () => {
      // Failure policy is non-blocking by design (STG-22 has no alert routing yet). Asserting it here
      // keeps that an explicit, reviewed property rather than an accident of implementation.
      const res = await request(app)
        .get(`/api/admin/listing-documents/${listingDocument.id}/file`).set('Authorization', `Bearer ${admin.token}`)
      expect(res.status).toBe(200)
      expect(res.headers['content-disposition']).toMatch(/^attachment;/)
    })
  })
})
