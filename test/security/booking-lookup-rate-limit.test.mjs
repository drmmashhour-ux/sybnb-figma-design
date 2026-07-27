import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { hashPassword } from '../../server/lib/security.mjs'
import { __resetRateLimitsForTests } from '../../server/lib/rate-limit.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Fix F6 — the public ref+phone booking lookup has a uniform not-found (no oracle) but NO rate-limit, so a
// leaked confirmation ref lets an attacker brute-force the guest's phone from one IP. Apply the existing
// per-IP fail-closed rate-limiter (Fix A / S3). After N rapid attempts from one IP -> 429; a normal single
// lookup still works; wrong-phone vs unknown-ref stays a uniform 404.

const PHONE = '0999123456'

describe('public booking lookup rate limit (F6)', () => {
  let app, ref, listingId
  const bookingIds = []
  const userIds = []

  const lookup = (r, phone) => request(app).get(`/api/bookings/lookup?ref=${encodeURIComponent(r)}&phone=${encodeURIComponent(phone)}`)

  beforeAll(async () => {
    app = testApp()
    const host = await db().user.create({ data: { email: uniqueTestEmail('f6-host'), passwordHash: hashPassword('correct-horse-battery'), displayName: 'F6 HOST', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'HOST' } } } })
    const guest = await db().user.create({ data: { email: uniqueTestEmail('f6-guest'), passwordHash: hashPassword('correct-horse-battery'), displayName: 'F6 GUEST', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'GUEST' } } } })
    trackTestUser(host.id); trackTestUser(guest.id); userIds.push(host.id, guest.id)
    const listing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'F6', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' } })
    listingId = listing.id
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'CONFIRMED', amountMinor: 100_00, currency: 'USD', metadata: { guestContactPhone: PHONE } } })
    bookingIds.push(booking.id)
    ref = booking.id.replace(/-/g, '').slice(0, 12) // the confirmation ref (normalized to 12 hex)
  })
  afterAll(async () => {
    await db().booking.deleteMany({ where: { id: { in: bookingIds } } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: listingId } }).catch(() => {})
    await cleanupTestUsers()
  })

  beforeEach(() => __resetRateLimitsForTests())
  afterEach(() => __resetRateLimitsForTests())

  it('rapid lookups from one IP are THROTTLED (429) once the limit is exceeded', async () => {
    const statuses = []
    for (let i = 0; i < 14; i += 1) {
      // same ref, a different (wrong) phone each attempt — the brute-force shape
      const res = await lookup(ref, `09990000${String(i).padStart(2, '0')}`) // eslint-disable-line no-await-in-loop
      statuses.push(res.status)
    }
    const throttled = statuses.filter((s) => s === 429).length
    expect(throttled, `some rapid attempts from one IP must be throttled (got statuses ${JSON.stringify(statuses)})`).toBeGreaterThan(0)
  })

  it('a normal single lookup still works (correct ref + phone -> 200)', async () => {
    const res = await lookup(ref, PHONE)
    expect(res.status).toBe(200)
    expect(res.body.trip?.status).toBe('CONFIRMED')
  })

  it('the response stays uniform: wrong-phone and unknown-ref both 404 (no oracle)', async () => {
    const wrongPhone = await lookup(ref, '0988000111')
    const unknownRef = await lookup('abcdef012345', PHONE)
    expect(wrongPhone.status).toBe(404)
    expect(unknownRef.status).toBe(404)
    expect(wrongPhone.body.error?.code).toBe(unknownRef.body.error?.code)
  })
})
