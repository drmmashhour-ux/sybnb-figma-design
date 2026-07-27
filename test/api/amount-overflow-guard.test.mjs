import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Fix F5 — money columns are int4 (max 2,147,483,647 minor). A booking whose computed GROSS exceeds that used
// to fail as a raw Postgres "integer out of range" (500) when persisted. Guard it at the compute boundary: a
// gross above MAX_SAFE_AMOUNT_MINOR is rejected 422 AMOUNT_EXCEEDS_LIMIT before any DB write. A normal booking
// still succeeds. No schema change (BigInt is a separate scheduled task).

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const iso = (offsetDays) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString().slice(0, 10) }

describe('money amount overflow guard (F5)', () => {
  let app, guestToken, hostId, overCapListingId, normalListingId
  const listingIds = []

  beforeAll(async () => {
    app = testApp()
    const mk = async (role, label) => {
      const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `F5 ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } }, phoneHash: `f5-${Math.random().toString(36).slice(2)}` } })
      trackTestUser(u.id)
      return u.id
    }
    const guestId = await mk('GUEST', 'f5-guest')
    guestToken = createSessionToken({ id: guestId })
    hostId = await mk('HOST', 'f5-host')
    // priceMinor 1.5B (within int4); a 2-night SYP stay = 3B gross -> exceeds int4 max AND the F5 cap.
    const overCap = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'F5-over', priceMinor: 1_500_000_000, currency: 'SYP', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
    overCapListingId = overCap.id
    const normal = await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'F5-ok', priceMinor: 100_00, currency: 'SYP', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } } })
    normalListingId = normal.id
    listingIds.push(overCap.id, normal.id)
  })
  afterAll(async () => {
    await db().booking.deleteMany({ where: { listingId: { in: listingIds } } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: { in: listingIds } } }).catch(() => {})
    await cleanupTestUsers()
  })

  const book = (listingId) => request(app).post('/api/bookings').set(auth(guestToken)).send({ listingId, checkIn: iso(40), checkOut: iso(42), currency: 'SYP' })

  it('a booking whose computed gross exceeds the money limit is REJECTED cleanly (422 AMOUNT_EXCEEDS_LIMIT, no DB write)', async () => {
    const res = await book(overCapListingId)
    expect(res.status, 'an over-limit gross must be a clean 422, not a raw DB error').toBe(422)
    expect(res.body.error?.code).toBe('AMOUNT_EXCEEDS_LIMIT')
    const created = await db().booking.count({ where: { listingId: overCapListingId } })
    expect(created, 'no booking row is persisted for an over-limit amount').toBe(0)
  })

  it('a normal in-bounds booking still SUCCEEDS', async () => {
    const res = await book(normalListingId)
    expect(res.status, 'a normal booking is unaffected by the guard').toBe(201)
    expect(res.body.booking?.amountMinor).toBe(200_00) // 2 nights x 100.00
  })
})
