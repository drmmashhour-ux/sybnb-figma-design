import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { STR_HOST_CONTRACT_VERSION } from '../../server/lib/host-consent.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// H2 / founder decision #11 — a Daily-Stay host publishes for FREE: the accommodation flow takes a listing
// from creation to PENDING_REVIEW (verify-before-live) with NO plan payment anywhere. The only ALWAYS charge
// is the 13% booking commission (M1). This pins the server-side free-base-publish guarantee so a future
// change can't quietly reintroduce a mandatory plan fee for STR.

describe('H2 — STR free base publish (server)', () => {
  let app, host
  beforeAll(async () => {
    app = testApp()
    const user = await db().user.create({ data: { email: uniqueTestEmail('h2-host'), passwordHash: hashPassword('correct-horse-battery'), displayName: 'H2 Host', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'HOST' } } } })
    trackTestUser(user.id)
    host = { token: createSessionToken(user), user }
  })
  afterAll(async () => {
    await db().listing.deleteMany({ where: { ownerId: host.user.id } })
    await db().accommodation.deleteMany({ where: { ownerId: host.user.id } })
    await cleanupTestUsers()
  })

  it('publishes a STAYS listing to PENDING_REVIEW with no plan payment', async () => {
    // 1) Create the accommodation shell — location + the captured map pin, no plan/payment fields required.
    const acc = await request(app).post('/api/accommodations').set('authorization', `Bearer ${host.token}`).send({
      titleAr: 'شقة دمشق', governorate: 'damascus', city: 'damascus',
      metadata: { country: 'SY', mapLocation: { latitude: '33.5138', longitude: '36.2765', pinConfirmed: true } },
    })
    expect(acc.status).toBe(201)
    const accId = acc.body.accommodation.id
    // The captured map pin is persisted server-side (ready for H8's gated exposure).
    expect(acc.body.accommodation.metadata.mapLocation.pinConfirmed).toBe(true)

    // 2) Add a room-type listing — a real price, still no plan payment.
    const room = await request(app).post(`/api/accommodations/${accId}/room-types`).set('authorization', `Bearer ${host.token}`).send({
      titleAr: 'غرفة مزدوجة', priceMinor: 100_00, currency: 'USD', metadata: { propertyType: 'apartment' },
    })
    expect(room.status).toBe(201)
    expect(room.body.listing.status).toBe('DRAFT') // not live yet — verify-before-live

    // 3) Submit for review with the M6 commission consent — NO plan fee is asked for.
    const submit = await request(app).patch(`/api/accommodations/${accId}/submit`).set('authorization', `Bearer ${host.token}`).send({
      acceptContract: true, contractVersion: STR_HOST_CONTRACT_VERSION,
    })
    expect(submit.status).toBeLessThan(400)

    // The room-type listing is now pending admin approval — published free, awaiting review.
    const listing = await db().listing.findFirst({ where: { accommodationId: accId } })
    expect(listing.status).toBe('PENDING_REVIEW')
  })
})
