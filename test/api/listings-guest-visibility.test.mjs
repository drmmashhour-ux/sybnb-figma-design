import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// FIX A-2 — a demo/synthetic or non-Syria listing must never render on ANY guest surface, ever, and never
// as APPROVED. The search list was already fail-closed (FIX A); this covers the by-id paths — the detail
// (/api/listings/:id) and quote (/api/listings/:id/quote) endpoints — plus the default (no-param) list.

describe('FIX A-2 — guest listing surfaces are fail-closed on by-id fetch and default view', () => {
  let app
  const ids = {}

  beforeAll(async () => {
    app = testApp()
    async function host({ demo = false } = {}) {
      const u = await db().user.create({ data: { email: uniqueTestEmail('vis-host'), displayName: 'H', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', isDemo: demo, roles: { create: { role: 'HOST' } } } })
      trackTestUser(u.id)
      return u.id
    }
    async function listing(ownerId, metadata) {
      const l = await db().listing.create({ data: { ownerId, division: 'STAYS', titleAr: 'ت', titleEn: 'V', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', metadata } })
      return l.id
    }
    const realHost = await host()
    const demoHost = await host({ demo: true })
    ids.sy = await listing(realHost, { country: 'SY' })
    ids.ca = await listing(realHost, { country: 'CA' })
    ids.sample = await listing(realHost, { country: 'SY', sybnbDataMode: 'sample' })
    ids.demo = await listing(demoHost, { country: 'SY' })
  })

  afterAll(async () => {
    await db().listing.deleteMany({ where: { id: { in: Object.values(ids) } } })
    await cleanupTestUsers()
  })

  it('detail: a Syria, non-demo listing is served (200)', async () => {
    const res = await request(app).get(`/api/listings/${ids.sy}`)
    expect(res.status).toBe(200)
    expect(res.body.listing.id).toBe(ids.sy)
  })

  it('detail: a non-Syria (CA), demo, or synthetic listing is 404 (never rendered as APPROVED)', async () => {
    for (const key of ['ca', 'sample', 'demo']) {
      const res = await request(app).get(`/api/listings/${ids[key]}`)
      expect(res.status, `detail ${key}`).toBe(404)
      expect(res.body.error.code).toBe('LISTING_NOT_FOUND')
    }
  })

  it('default list view (no division, no country) excludes demo + non-Syria + synthetic', async () => {
    const res = await request(app).get('/api/listings')
    const got = res.body.listings.map((l) => l.id)
    expect(got).not.toContain(ids.ca)
    expect(got).not.toContain(ids.demo)
    expect(got).not.toContain(ids.sample)
  })
})
