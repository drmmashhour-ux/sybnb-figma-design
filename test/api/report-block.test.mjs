import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { approveDriverForRides, cleanupTestUsers, fundWallet, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// UGC safety (024): report content + block users. Reports go to an admin queue; a blocked pair can neither
// be SR-matched nor message each other.
describe('Report / block (UGC safety)', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    const legacyVerificationGrant1 = await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1, role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }
  async function registerDriver(label) {
    const email = uniqueTestEmail(label)
    const legacyVerificationGrant2 = await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant2, role: 'DRIVER', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    await approveDriverForRides(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }
  async function bootstrapAdmin(label) {
    const admin = await db().user.create({ data: { email: uniqueTestEmail(label), displayName: 'Report Admin', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'ADMIN' } } }, include: { roles: true } })
    trackTestUser(admin.id)
    return createSessionToken(admin)
  }

  it('a user can report a listing; a non-admin cannot see the queue; admin can action it (audited)', async () => {
    const reporter = await registerGuest('rep-reporter')
    const host = await db().user.create({ data: { email: uniqueTestEmail('rep-host'), displayName: 'Rep Host', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'HOST' } } } })
    trackTestUser(host.id)
    const listing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'مخالف', priceMinor: 50, currency: 'USD', status: 'APPROVED' } })

    const filed = await request(app).post('/api/reports').set('Authorization', `Bearer ${reporter.token}`).send({ subjectType: 'LISTING', subjectId: listing.id, reason: 'Misleading photos' })
    expect(filed.status).toBe(201)
    expect(filed.body.report.status).toBe('OPEN')

    // Non-admin cannot see the admin queue.
    const forbidden = await request(app).get('/api/admin/reports').set('Authorization', `Bearer ${reporter.token}`)
    expect(forbidden.status).toBe(403)

    // Admin sees it and actions it.
    const adminToken = await bootstrapAdmin('rep-admin')
    const queue = await request(app).get('/api/admin/reports').set('Authorization', `Bearer ${adminToken}`)
    expect(queue.status).toBe(200)
    expect(queue.body.reports.some((r) => r.id === filed.body.report.id)).toBe(true)

    const actioned = await request(app).patch(`/api/admin/reports/${filed.body.report.id}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIONED', note: 'removed listing' })
    expect(actioned.status).toBe(200)
    expect(actioned.body.report.status).toBe('ACTIONED')
    const audit = await db().adminAuditLog.findFirst({ where: { entityType: 'reports', entityId: filed.body.report.id, action: 'REPORT_ACTIONED' } })
    expect(audit).not.toBeNull()
  })

  it('you cannot block yourself', async () => {
    const guest = await registerGuest('blk-self')
    const res = await request(app).post('/api/me/blocks').set('Authorization', `Bearer ${guest.token}`).send({ userId: guest.id })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('CANNOT_BLOCK_SELF')
  })

  it('a block prevents messaging between the pair', async () => {
    const guest = await registerGuest('blk-guest')
    const host = await db().user.create({ data: { email: uniqueTestEmail('blk-host'), displayName: 'Blk Host', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'HOST' } } } })
    trackTestUser(host.id)
    const listing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'سكن', priceMinor: 50, currency: 'USD', status: 'APPROVED' } })

    // Messaging works before the block.
    const ok = await request(app).post(`/api/listings/${listing.id}/thread/messages`).set('Authorization', `Bearer ${guest.token}`).send({ body: 'Is this available next week?' })
    expect(ok.status).toBe(201)

    // Guest blocks the host.
    const block = await request(app).post('/api/me/blocks').set('Authorization', `Bearer ${guest.token}`).send({ userId: host.id })
    expect(block.status).toBe(201)

    // Now the guest can no longer message the host.
    const blocked = await request(app).post(`/api/listings/${listing.id}/thread/messages`).set('Authorization', `Bearer ${guest.token}`).send({ body: 'Hello again' })
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('MESSAGE_USER_BLOCK')

    // Unblock re-enables it.
    await request(app).delete(`/api/me/blocks/${host.id}`).set('Authorization', `Bearer ${guest.token}`)
    const reenabled = await request(app).post(`/api/listings/${listing.id}/thread/messages`).set('Authorization', `Bearer ${guest.token}`).send({ body: 'Sorry, still interested' })
    expect(reenabled.status).toBe(201)
  })

  it('a block prevents SR matching (driver cannot claim a blocked rider’s ride)', async () => {
    const rider = await registerGuest('blk-rider')
    await fundWallet(rider.id)
    const driver = await registerDriver('blk-driver')

    const ride = (await request(app).post('/api/sr/rides').set('Authorization', `Bearer ${rider.token}`).send({ pickup: 'Malki', dropoff: 'Mezzeh', category: 'SR Economy' })).body.ride
    expect(ride.id).toBeTruthy()

    // Rider blocks the driver — they must never be matched.
    await request(app).post('/api/me/blocks').set('Authorization', `Bearer ${rider.token}`).send({ userId: driver.id })

    const claim = await request(app).patch(`/api/sr/rides/${ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
    expect(claim.status).toBe(409)
    expect(claim.body.error.code).toBe('RIDE_USER_BLOCK')
  })
})
