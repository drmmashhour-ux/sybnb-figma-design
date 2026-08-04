import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// The office-tablet dashboard endpoint: ADMIN/SUPPORT only, returns a curated snapshot (security,
// bookings, revenue, pending) the admin can watch live or download for offline use.
describe('GET /api/admin/office-dashboard', () => {
  let app
  let admin

  beforeAll(async () => {
    app = testApp()
    admin = await makeStaff('office-admin', 'ADMIN')
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function makeStaff(label, role) {
    const u = await db().user.create({
      data: { email: uniqueTestEmail(label), displayName: label, referralCode: uniqueTestReferralCode(), roles: { create: { role } } },
      include: { roles: true },
    })
    trackTestUser(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    const legacyVerificationGrant1 = await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/admin/office-dashboard')
    expect(res.status).toBe(401)
  })

  it('rejects a non-admin (guest) token', async () => {
    const guest = await registerGuest('office-guest')
    const res = await request(app).get('/api/admin/office-dashboard').set('Authorization', `Bearer ${guest.token}`)
    expect(res.status).toBe(403)
  })

  it('returns the four-panel snapshot for an admin', async () => {
    const res = await request(app).get('/api/admin/office-dashboard').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.generatedAt).toBe('string')

    // Security panel
    expect(res.body.security).toBeTruthy()
    expect(typeof res.body.security.activeLocks).toBe('number')
    expect(typeof res.body.security.lockouts24h).toBe('number')
    expect(Array.isArray(res.body.security.recentEvents)).toBe(true)

    // Bookings panel
    expect(typeof res.body.bookings.total).toBe('number')
    expect(typeof res.body.bookings.checkInsToday).toBe('number')
    expect(res.body.bookings.byStatus).toBeTruthy()

    // Revenue panel (USD, whole-unit minor)
    expect(res.body.revenue.currency).toBe('USD')
    expect(typeof res.body.revenue.grossApprovedMinor).toBe('number')

    // Pending-work panel
    expect(typeof res.body.pending.listingsAwaitingReview).toBe('number')
    expect(typeof res.body.pending.openDisputes).toBe('number')
    expect(typeof res.body.pending.payoutsReady).toBe('number')
    expect(typeof res.body.pending.idChecksPending).toBe('number')
  })
})
