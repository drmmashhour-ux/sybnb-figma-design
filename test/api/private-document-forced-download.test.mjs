import request from 'supertest'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'
import { saveListingDocument } from '../../server/lib/listing-document-storage.mjs'
import { saveThreadDocument } from '../../server/lib/thread-document-storage.mjs'
import { saveDriverDocument } from '../../server/lib/driver-document-storage.mjs'

// SYB-004 (Wave 0) — forced download on the remaining UNFROZEN private-document routes.
//
// STG-12 was implemented for the identity-document path only (me.mjs, admin.mjs id-document) and
// recorded as CLOSED generally. Seven further routes served stored private documents with a bare
// content-type, so a PDF rendered INLINE in an authenticated same-origin session. Thread documents
// are the sharpest case: the bytes are uploaded by an arbitrary counterparty.
//
// This file covers the four routes inside the owner's Wave 0 authorization:
//   1. GET /api/listings/:id/documents/:docId/file              listings.mjs
//   2. GET /api/listings/:id/thread/documents/:docId/file       messages.mjs
//   3. GET /api/admin/listing-documents/:docId/file             admin.mjs
//   4. GET /api/admin/driver-documents/:docId/file              admin.mjs
//
// DELIBERATELY NOT COVERED — frozen platform boundaries, no unfreeze authorized:
//   - server/routes/driver.mjs:314                              (Ride)
//   - server/routes/quebec-driver-onboarding.mjs:195, :441       (Québec)
// Those three still serve inline. That is a known, recorded deferral, not an oversight, and it is
// documented in docs/security/STR_STORAGE_THREAT_MODEL.md. No assertion is made about their current
// behaviour, so remediating them later will not break this file.
//
// Authorization logic is out of scope for SYB-004 and is unchanged; it is asserted here only to prove
// the header work did not weaken it. Local storage driver only — NODE_ENV=test forces it.

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

describe('SYB-004 — forced download on unfrozen private-document routes', () => {
  let app, admin, host, guest, driver, outsider
  let listing, listingDocument, threadDocument, driverDocument

  beforeAll(async () => {
    app = testApp()
    admin = await createUser('ADMIN', 'fd-admin')
    host = await createUser('HOST', 'fd-host')
    guest = await createUser('GUEST', 'fd-guest')
    driver = await createUser('DRIVER', 'fd-driver')
    outsider = await createUser('GUEST', 'fd-outsider')

    listing = await db().listing.create({
      data: {
        ownerId: host.user.id, division: 'STAYS', titleAr: 'وثيقة اختبار', titleEn: 'Forced Download Test Stay',
        priceMinor: 50_00, currency: 'USD', status: 'APPROVED',
      },
    })

    listingDocument = await db().listingDocument.create({
      data: {
        listingId: listing.id, type: 'CITQ_CERTIFICATE',
        assetUrl: await saveListingDocument(PDF, 'application/pdf'), mimeType: 'application/pdf',
      },
    })

    const thread = await db().messageThread.create({
      data: { listingId: listing.id, guestId: guest.user.id },
    })
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
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  // Every in-scope route must satisfy the same contract. Asserting it uniformly is the point: the
  // original defect was one route being hardened and the property being claimed for all of them.
  function expectForcedDownload(res, expectedFilename) {
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${expectedFilename}"`)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0)
  }

  describe('1. host reads a listing document — listings.mjs', () => {
    it('forces download with a server-derived filename', async () => {
      const res = await request(app)
        .get(`/api/listings/${listing.id}/documents/${listingDocument.id}/file`)
        .set('Authorization', `Bearer ${host.token}`)
      expectForcedDownload(res, 'sybnb-listing.pdf')
    })

    it('never puts the storage key, document id, listing id or owner id in the filename', async () => {
      const res = await request(app)
        .get(`/api/listings/${listing.id}/documents/${listingDocument.id}/file`)
        .set('Authorization', `Bearer ${host.token}`)
      const disposition = res.headers['content-disposition']
      for (const secret of [listingDocument.assetUrl, listingDocument.id, listing.id, host.user.id]) {
        expect(disposition).not.toContain(secret)
      }
    })

    it('still refuses an unrelated account (authorization unchanged)', async () => {
      const res = await request(app)
        .get(`/api/listings/${listing.id}/documents/${listingDocument.id}/file`)
        .set('Authorization', `Bearer ${outsider.token}`)
      expect(res.status).toBe(403)
      expect(res.headers['content-disposition']).toBeUndefined()
    })
  })

  describe('2. thread document — messages.mjs', () => {
    // The counterparty controls these bytes, so inline rendering was the highest-risk of the four.
    it('forces download for the listing owner', async () => {
      const res = await request(app)
        .get(`/api/listings/${listing.id}/thread/documents/${threadDocument.id}/file`)
        .set('Authorization', `Bearer ${host.token}`)
      expectForcedDownload(res, 'sybnb-thread.pdf')
    })

    it('forces download for the uploading guest', async () => {
      const res = await request(app)
        .get(`/api/listings/${listing.id}/thread/documents/${threadDocument.id}/file`)
        .set('Authorization', `Bearer ${guest.token}`)
      expectForcedDownload(res, 'sybnb-thread.pdf')
    })

    it('never leaks the uploader id or storage key through the filename', async () => {
      const res = await request(app)
        .get(`/api/listings/${listing.id}/thread/documents/${threadDocument.id}/file`)
        .set('Authorization', `Bearer ${host.token}`)
      const disposition = res.headers['content-disposition']
      for (const secret of [threadDocument.assetUrl, threadDocument.id, guest.user.id]) {
        expect(disposition).not.toContain(secret)
      }
    })
  })

  describe('3. staff reads a listing document — admin.mjs', () => {
    it('forces download', async () => {
      const res = await request(app)
        .get(`/api/admin/listing-documents/${listingDocument.id}/file`)
        .set('Authorization', `Bearer ${admin.token}`)
      expectForcedDownload(res, 'sybnb-listing.pdf')
    })

    it('still refuses a non-staff caller (authorization unchanged)', async () => {
      const res = await request(app)
        .get(`/api/admin/listing-documents/${listingDocument.id}/file`)
        .set('Authorization', `Bearer ${host.token}`)
      expect(res.status).toBe(403)
    })
  })

  describe('4. staff reads a driver document — admin.mjs', () => {
    // Admin-surface route over driver-domain data. The Ride module's own route (driver.mjs:314) is
    // frozen and untouched; only this admin-surface handler is in scope.
    it('forces download', async () => {
      const res = await request(app)
        .get(`/api/admin/driver-documents/${driverDocument.id}/file`)
        .set('Authorization', `Bearer ${admin.token}`)
      // The helper's category allowlist has no 'driver' entry and the helper is frozen, so this
      // correctly falls back to the generic name. Safety comes from `attachment`, not the label.
      expectForcedDownload(res, 'sybnb-document.pdf')
    })

    it('still refuses a non-staff caller (authorization unchanged)', async () => {
      const res = await request(app)
        .get(`/api/admin/driver-documents/${driverDocument.id}/file`)
        .set('Authorization', `Bearer ${driver.token}`)
      expect(res.status).toBe(403)
    })
  })

  describe('no unfrozen route may reintroduce inline document delivery', () => {
    // A per-route assertion cannot catch a NEW route added later with the old inline pattern. This
    // one can, and it is the guard that stops STG-12 drifting back out of true a second time.
    it('the three unfrozen route files contain no bare inline document response', async () => {
      for (const file of ['server/routes/admin.mjs', 'server/routes/listings.mjs', 'server/routes/messages.mjs']) {
        const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8')
        expect(source, `${file} serves a stored document inline`).not.toContain("'content-type': document.mimeType")
      }
    })
  })
})
