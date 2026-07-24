import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// M1 / R7b — the commission rate (platformFeePct) is exposed ONLY on the authenticated host-earnings and
// admin review-queue responses. It must NEVER appear in any guest / unauthenticated response (listings,
// listing detail, quote). Commission is admin/host information, never a guest-facing number.

describe('R7b — platformFeePct present only on authenticated host/admin, absent from guest bodies', () => {
  let app, admin, host, guest, listingId

  async function createUser(role, label) {
    const user = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `Test ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(user.id)
    return { token: createSessionToken(user), user }
  }

  beforeAll(async () => {
    app = testApp()
    admin = await createUser('ADMIN', 'r7b-admin')
    host = await createUser('HOST', 'r7b-host')
    guest = await createUser('GUEST', 'r7b-guest')
    const listing = await db().listing.create({ data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'ت', titleEn: 'R7b Stay', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', metadata: { country: 'SY' } } })
    listingId = listing.id
  })

  afterAll(async () => {
    await db().listing.deleteMany({ where: { id: listingId } })
    await cleanupTestUsers()
  })

  it('guest listings search body contains no platformFeePct', async () => {
    const res = await request(app).get('/api/listings?division=STAYS')
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain('platformFeePct')
  })

  it('guest listing detail body contains no platformFeePct', async () => {
    const res = await request(app).get(`/api/listings/${listingId}`)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain('platformFeePct')
  })

  it('guest quote body contains no platformFeePct', async () => {
    const res = await request(app).get(`/api/listings/${listingId}/quote?checkIn=2026-09-01&checkOut=2026-09-03`)
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain('platformFeePct')
  })

  it('authenticated host earnings exposes platformFeePct (a number)', async () => {
    const res = await request(app).get('/api/host/earnings').set('authorization', `Bearer ${host.token}`)
    expect(res.status).toBe(200)
    expect(typeof res.body.earnings.platformFeePct).toBe('number')
  })

  it('authenticated admin review-queue exposes platformFeePct (a number)', async () => {
    const res = await request(app).get('/api/admin/review-queue').set('authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(typeof res.body.platformFeePct).toBe('number')
  })
})
