import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// H8 (location-R7) — the exact pin + street address are revealed ONLY through the guest's own CONFIRMED
// booking. Every pre-booking guest surface (listing detail, search, quote) exposes an approximate area
// only; the exact coordinates/address must appear NOWHERE in those responses.

const EXACT_LAT = '33.51383'
const EXACT_LNG = '36.27652'
const EXACT_ADDRESS = '17 Rue Secrète, Bâtiment B, Apt 4'

function isoDay(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

describe('H8 — location-R7 reveal gating', () => {
  let app, guest, listing
  beforeAll(async () => {
    app = testApp()
    const host = await db().user.create({ data: { email: uniqueTestEmail('r7-host'), passwordHash: hashPassword('correct-horse-battery'), displayName: 'Host', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'HOST' } } } })
    trackTestUser(host.id)
    const g = await db().user.create({ data: { email: uniqueTestEmail('r7-guest'), passwordHash: hashPassword('correct-horse-battery'), displayName: 'Guest', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'GUEST' } } } })
    trackTestUser(g.id)
    guest = { token: createSessionToken(g), id: g.id }
    const accommodation = await db().accommodation.create({ data: { ownerId: host.id, titleAr: 'شقة', governorate: 'damascus', city: 'damascus', area: 'mazzeh', address: EXACT_ADDRESS, metadata: { country: 'SY', mapLocation: { latitude: Number(EXACT_LAT), longitude: Number(EXACT_LNG), pinConfirmed: true } } } })
    listing = await db().listing.create({ data: { ownerId: host.id, accommodationId: accommodation.id, division: 'STAYS', titleAr: 'شقة', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', metadata: { country: 'SY', governorate: 'damascus', city: 'damascus', area: 'mazzeh' } } })
  })
  afterAll(async () => {
    await db().booking.deleteMany({ where: { listingId: listing.id } }).catch(() => {})
    await db().listing.deleteMany({ where: { id: listing.id } })
    await db().accommodation.deleteMany({ where: { governorate: 'damascus', address: EXACT_ADDRESS } }).catch(() => {})
    await cleanupTestUsers()
  })

  function leaksExact(body) {
    const s = JSON.stringify(body)
    return s.includes(EXACT_LAT) || s.includes(EXACT_LNG) || s.includes(EXACT_ADDRESS)
  }

  it('listing detail shows an APPROXIMATE area, never the exact pin/address', async () => {
    const res = await request(app).get(`/api/listings/${listing.id}`)
    expect(res.status).toBe(200)
    expect(res.body.approximateLocation.approximate).toBe(true)
    expect(res.body.approximateLocation.latitude).toBe(33.51) // blurred to a ~1km grid
    expect(res.body.approximateLocation.longitude).toBe(36.28)
    expect(res.body.approximateLocation.area).toBe('mazzeh')
    expect(leaksExact(res.body)).toBe(false) // no exact coords/address anywhere in the response
  })

  it('search + quote never leak the exact coords/address', async () => {
    const search = await request(app).get('/api/listings').query({ division: 'STAYS' })
    expect(leaksExact(search.body)).toBe(false)
    const quote = await request(app).get(`/api/listings/${listing.id}/quote`).query({ checkIn: isoDay(10), checkOut: isoDay(12), currency: 'USD' })
    expect(leaksExact(quote.body)).toBe(false)
  })

  it('a NON-confirmed booking still shows only the approximate area in My Trips', async () => {
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'PAYMENT_PENDING', amountMinor: 100_00, currency: 'USD', checkIn: new Date(isoDay(10)), checkOut: new Date(isoDay(12)) } })
    const res = await request(app).get('/api/me/overview').set('authorization', `Bearer ${guest.token}`)
    const row = res.body.overview.bookings.find((b) => b.id === booking.id)
    expect(row.location.approximate).toBe(true)
    expect(row.location.address).toBeUndefined()
    expect(leaksExact(res.body)).toBe(false)
    await db().booking.deleteMany({ where: { id: booking.id } })
  })

  it('a CONFIRMED booking reveals the exact pin + address to that guest', async () => {
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.id, status: 'CONFIRMED', amountMinor: 100_00, currency: 'USD', checkIn: new Date(isoDay(20)), checkOut: new Date(isoDay(22)) } })
    const res = await request(app).get('/api/me/overview').set('authorization', `Bearer ${guest.token}`)
    const row = res.body.overview.bookings.find((b) => b.id === booking.id)
    expect(row.location.approximate).toBe(false)
    expect(row.location.latitude).toBe(Number(EXACT_LAT)) // exact pin
    expect(row.location.address).toBe(EXACT_ADDRESS)       // exact street address
    await db().booking.deleteMany({ where: { id: booking.id } })
  })
})
