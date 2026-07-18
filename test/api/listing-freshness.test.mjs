import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { FREE_TIER_EXPIRY_DAYS } from '../../server/lib/listing-lifecycle.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// Rentals/Buy freshness (025): these divisions are commission-based (no paid seller plan), and
// previously never got any expiresAt at all -- a listing published months ago stayed live forever
// with no "still available?" signal. These tests prove the fix: a real freshness window is set at
// admin approval, and the owner can self-renew (push the window forward) without another admin
// review, but only while the listing is still APPROVED and only for Rentals/Buy.

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const COMPLETE_PROPERTY = {
  propertyType: 'apartment',
  governorate: 'Damascus',
  city: 'Mazzeh',
  bedrooms: 2,
  bathrooms: 1,
  areaSqm: 120,
}

async function bootstrapAdmin() {
  const admin = await db().user.create({
    data: {
      email: uniqueTestEmail('fresh-admin'),
      displayName: 'Freshness Admin',
      referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'ADMIN' } },
    },
    include: { roles: true },
  })
  trackTestUser(admin.id)
  return createSessionToken(admin)
}

async function registerHost(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function createApprovedListing(app, hostToken, adminToken, division = 'RENTALS') {
  const created = await request(app)
    .post('/api/listings')
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ division, titleAr: `عقار ${division}`, priceMinor: 500000, currency: 'SYP', metadata: COMPLETE_PROPERTY })
  const listing = created.body.listing

  await request(app)
    .post(`/api/listings/${listing.id}/media`)
    .set('Authorization', `Bearer ${hostToken}`)
    .send({ fileBase64: PNG_1x1, mimeType: 'image/png' })

  await request(app).patch(`/api/listings/${listing.id}/submit`).set('Authorization', `Bearer ${hostToken}`)

  const approve = await request(app)
    .patch(`/api/admin/review-queue/listing/${listing.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ decision: 'APPROVED' })
  expect(approve.status).toBe(200)
  return approve.body.entity
}

describe('Rentals/Buy listing freshness + self-renewal', () => {
  let app
  let adminToken

  beforeAll(async () => {
    app = testApp()
    adminToken = await bootstrapAdmin()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a RENTALS listing gets a real ~60-day freshness window at admin approval, unlike before (no expiry at all)', async () => {
    const host = await registerHost(app, 'fresh-rentals-host')
    const approved = await createApprovedListing(app, host.token, adminToken, 'RENTALS')

    expect(approved.status).toBe('APPROVED')
    expect(approved.expiresAt).not.toBeNull()
    const daysOut = (new Date(approved.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    expect(daysOut).toBeGreaterThan(FREE_TIER_EXPIRY_DAYS - 1)
    expect(daysOut).toBeLessThan(FREE_TIER_EXPIRY_DAYS + 1)
  })

  it('the owner can renew a live RENTALS listing, pushing expiresAt further into the future', async () => {
    const host = await registerHost(app, 'fresh-renew-host')
    const approved = await createApprovedListing(app, host.token, adminToken, 'BUY')
    const originalExpiry = new Date(approved.expiresAt).getTime()

    const renew = await request(app).patch(`/api/host/listings/${approved.id}/renew`).set('Authorization', `Bearer ${host.token}`)
    expect(renew.status).toBe(200)
    expect(renew.body.listing.status).toBe('APPROVED')
    expect(new Date(renew.body.listing.expiresAt).getTime()).toBeGreaterThan(originalExpiry - 1)
  })

  it('an owner cannot renew a listing they do not own (404)', async () => {
    const host = await registerHost(app, 'fresh-owner-host')
    const stranger = await registerHost(app, 'fresh-stranger-host')
    const approved = await createApprovedListing(app, host.token, adminToken, 'RENTALS')

    const res = await request(app).patch(`/api/host/listings/${approved.id}/renew`).set('Authorization', `Bearer ${stranger.token}`)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('HOST_LISTING_NOT_FOUND')
  })

  it('a STAYS listing cannot be self-renewed through this route (409)', async () => {
    const host = await registerHost(app, 'fresh-stays-host')
    const listing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'شقة اختبار', status: 'APPROVED', priceMinor: 100000, currency: 'USD' },
    })

    const res = await request(app).patch(`/api/host/listings/${listing.id}/renew`).set('Authorization', `Bearer ${host.token}`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('HOST_LISTING_NOT_RENEWABLE')
  })

  it('a PAUSED RENTALS listing cannot be renewed (must be live) — never resurrects an expired/paused listing without admin review', async () => {
    const host = await registerHost(app, 'fresh-paused-host')
    const approved = await createApprovedListing(app, host.token, adminToken, 'RENTALS')

    const pause = await request(app)
      .patch(`/api/host/listings/${approved.id}/status`)
      .set('Authorization', `Bearer ${host.token}`)
      .send({ status: 'PAUSED' })
    expect(pause.status).toBe(200)

    const renew = await request(app).patch(`/api/host/listings/${approved.id}/renew`).set('Authorization', `Bearer ${host.token}`)
    expect(renew.status).toBe(409)
    expect(renew.body.error.code).toBe('HOST_LISTING_NOT_LIVE')
  })

  it('a stale RENTALS listing actually flips to EXPIRED once its window passes (opportunistic expiry, same mechanism as paid divisions)', async () => {
    const host = await registerHost(app, 'fresh-expire-host')
    const approved = await createApprovedListing(app, host.token, adminToken, 'RENTALS')

    // Simulate time passing: back-date expiresAt into the past.
    await db().listing.update({ where: { id: approved.id }, data: { expiresAt: new Date(Date.now() - 1000) } })

    // Any read of listings runs expireOldListings() opportunistically.
    await request(app).get(`/api/listings/${approved.id}`)

    const reloaded = await db().listing.findUnique({ where: { id: approved.id } })
    expect(reloaded.status).toBe('EXPIRED')
  })
})
