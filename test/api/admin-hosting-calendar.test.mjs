import { readFileSync } from 'node:fs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// AD1 — the admin "Hosting" calendar shows what is booked/blocked across ALL hosts, read from the SAME
// single availability source as H4/H5 (ListingAvailability BLOCKED + active Booking rows). Admin-only.

function isoDay(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

describe('AD1 — admin hosting calendar (cross-host, single source)', () => {
  let app, admin, guest, hostA, hostB, listingA, listingB
  async function createUser(role, label) {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `T ${role} ${label}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(u.id)
    return { token: createSessionToken(u), id: u.id }
  }
  beforeAll(async () => {
    app = testApp()
    admin = await createUser('ADMIN', 'ad1-admin'); guest = await createUser('GUEST', 'ad1-guest')
    hostA = await createUser('HOST', 'ad1-hostA'); hostB = await createUser('HOST', 'ad1-hostB')
    listingA = await db().listing.create({ data: { ownerId: hostA.id, division: 'STAYS', titleAr: 'شقة أ', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', metadata: { country: 'SY' } } })
    listingB = await db().listing.create({ data: { ownerId: hostB.id, division: 'STAYS', titleAr: 'شقة ب', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', metadata: { country: 'SY' } } })
    // hostA's listing gets an active booking; hostB's listing gets a host-blocked date.
    await request(app).post('/api/bookings').set('authorization', `Bearer ${guest.token}`).send({ listingId: listingA.id, checkIn: isoDay(30), checkOut: isoDay(33) })
    await request(app).patch(`/api/host/listings/${listingB.id}/availability`).set('authorization', `Bearer ${hostB.token}`).send({ dates: [{ date: isoDay(31), status: 'BLOCKED' }] })
  })
  afterAll(async () => {
    await db().listingAvailability.deleteMany({ where: { listingId: { in: [listingA.id, listingB.id] } } }).catch(() => {})
    await db().booking.deleteMany({ where: { listingId: { in: [listingA.id, listingB.id] } } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: { in: [listingA.id, listingB.id] } } })
    await cleanupTestUsers()
  })

  it('reflects booked + blocked dates across all hosts from the single source', async () => {
    const res = await request(app).get('/api/admin/hosting-calendar').query({ from: isoDay(0), to: isoDay(60) }).set('authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    const rowA = res.body.hosting.listings.find((l) => l.listingId === listingA.id)
    const rowB = res.body.hosting.listings.find((l) => l.listingId === listingB.id)
    // Host A: the guest booking appears as a booked range, attributed to host A.
    expect(rowA.hostId).toBe(hostA.id)
    expect(rowA.bookedRanges.some((r) => r.checkIn === isoDay(30) && r.checkOut === isoDay(33))).toBe(true)
    // Host B: the host-blocked date appears, attributed to host B.
    expect(rowB.hostId).toBe(hostB.id)
    expect(rowB.blockedDates).toContain(isoDay(31))
  })

  it('a non-admin cannot reach the admin hosting calendar', async () => {
    const asGuest = await request(app).get('/api/admin/hosting-calendar').set('authorization', `Bearer ${guest.token}`)
    expect(asGuest.status).toBe(403)
    const asHost = await request(app).get('/api/admin/hosting-calendar').set('authorization', `Bearer ${hostA.token}`)
    expect(asHost.status).toBe(403)
  })

  it('reads the SAME single-source status set as H4/H5 (no divergent path)', () => {
    const admin = readFileSync(new URL('../../server/routes/admin.mjs', import.meta.url), 'utf8')
    const block = admin.slice(admin.indexOf("/api/admin/hosting-calendar"), admin.indexOf("/api/admin/payouts"))
    expect(block).toMatch(/status: 'BLOCKED'/)
    expect(block).toMatch(/\[\s*'REQUESTED',\s*'PAYMENT_PENDING',\s*'CONFIRMED'\s*\]/)
  })
})
