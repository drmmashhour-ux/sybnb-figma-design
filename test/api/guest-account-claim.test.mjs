import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

// GAP 2: an anonymous device-guest can claim a real named account (verified email OTP) and KEEP its
// trip history. The claim only ever upgrades the caller's OWN device row — it can never grab another
// user's bookings, and it rejects an email that already belongs to a different account.
describe('Guest account-claim + booking migration', () => {
  let app
  let listing

  beforeAll(async () => {
    app = testApp()
    const host = await db().user.create({
      data: { email: uniqueTestEmail('claim-host'), displayName: 'claim-host', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'HOST' } } },
    })
    trackTestUser(host.id)
    listing = await db().listing.create({
      data: { ownerId: host.id, division: 'STAYS', titleAr: 'إقامة', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' },
    })
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function deviceGuest(deviceId) {
    const res = await request(app).post('/api/auth/checkout-guest').send({ source: 'guest-checkout', deviceId })
    trackTestUser(res.body.user.id)
    return { id: res.body.user.id, token: res.body.token }
  }

  it('migrates a device guest booking into the claimed named account (same row, id preserved)', async () => {
    const device = await deviceGuest('device-claim-aaaaaaaa')
    const booking = await db().booking.create({
      data: { listingId: listing.id, guestId: device.id, status: 'CONFIRMED', amountMinor: 100_00, currency: 'USD' },
    })

    const email = uniqueTestEmail('claimed')
    const verificationGrant = await verifyEmailForTest(app, email)

    const res = await request(app)
      .post('/api/auth/claim-guest-account')
      .set('Authorization', `Bearer ${device.token}`)
      .send({ email, password: 'correct-horse-battery', displayName: 'Real Guest', verificationGrant })
    expect(res.status).toBe(201)
    expect(res.body.user.id).toBe(device.id) // in-place upgrade — same user row

    // The pre-claim device credential must not survive the identity upgrade. Only the newly minted
    // token returned by the claim may access the named account.
    const staleSession = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${device.token}`)
    expect(staleSession.status).toBe(401)
    const freshSession = await request(app).get('/api/me/overview').set('Authorization', `Bearer ${res.body.token}`)
    expect(freshSession.status).toBe(200)

    const updated = await db().user.findUnique({ where: { id: device.id } })
    expect(updated.email).toBe(email.toLowerCase())
    expect(updated.displayName).toBe('Real Guest')

    // The booking carried over: its guestId still resolves to the (now named) account.
    const carried = await db().booking.findUnique({ where: { id: booking.id } })
    expect(carried.guestId).toBe(device.id)
  })

  it('rejects claiming an email that already belongs to another account (cross-user)', async () => {
    const email = uniqueTestEmail('taken')

    const a = await deviceGuest('device-claim-bbbbbbbb')
    const firstGrant = await verifyEmailForTest(app, email)
    const first = await request(app)
      .post('/api/auth/claim-guest-account')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ email, password: 'correct-horse-battery', verificationGrant: firstGrant })
    expect(first.status).toBe(201)

    const b = await deviceGuest('device-claim-cccccccc')
    const secondGrant = await verifyEmailForTest(app, email)
    const second = await request(app)
      .post('/api/auth/claim-guest-account')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ email, password: 'correct-horse-battery', verificationGrant: secondGrant })
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('ACCOUNT_ALREADY_EXISTS')

    // B's own bookings/row are untouched — its email is still the device address.
    const bRow = await db().user.findUnique({ where: { id: b.id } })
    expect(bRow.email.endsWith('@device.sybnb.local')).toBe(true)
  })

  it('rejects a claim without a verified email OTP', async () => {
    const device = await deviceGuest('device-claim-dddddddd')
    const email = uniqueTestEmail('unverified')
    const res = await request(app)
      .post('/api/auth/claim-guest-account')
      .set('Authorization', `Bearer ${device.token}`)
      .send({ email, password: 'correct-horse-battery' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('rejects an unauthenticated claim', async () => {
    const email = uniqueTestEmail('noauth')
    const verificationGrant = await verifyEmailForTest(app, email)
    const res = await request(app)
      .post('/api/auth/claim-guest-account')
      .send({ email, password: 'correct-horse-battery', verificationGrant })
    expect(res.status).toBe(401)
  })
})
