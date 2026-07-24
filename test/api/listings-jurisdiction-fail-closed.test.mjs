import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// FIX A — the guest Syria surface must be jurisdiction fail-closed: GET /api/listings with no country
// param must default to the active jurisdiction (Syria) and NEVER return out-of-jurisdiction (e.g.
// Quebec/CA) listings, nor demo (owner.isDemo) or synthetic (metadata.sybnbDataMode='sample') listings.
// It must also surface a fail-closed legalReviewStatus so the surface never presents Syria as licensed.

describe('FIX A — guest listings query is jurisdiction fail-closed + excludes demo/synthetic', () => {
  let app
  const created = { sy: null, ca: null, sample: null, demo: null }

  beforeAll(async () => {
    app = await testApp()

    async function makeHost({ demo = false } = {}) {
      const u = await db().user.create({
        data: {
          email: uniqueTestEmail('fixa-host'),
          displayName: 'FixA Host',
          referralCode: uniqueTestReferralCode(),
          status: 'ACTIVE',
          isDemo: demo,
          roles: { create: [{ role: 'HOST' }] },
        },
      })
      trackTestUser(u.id)
      return u.id
    }

    const realHost = await makeHost()
    const demoHost = await makeHost({ demo: true })

    async function makeListing(ownerId, metadata) {
      const l = await db().listing.create({
        data: { ownerId, division: 'STAYS', titleAr: 'إعلان اختبار', titleEn: 'FixA Listing', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', metadata },
      })
      return l.id
    }

    created.sy = await makeListing(realHost, { country: 'SY' })
    created.ca = await makeListing(realHost, { country: 'CA' })
    created.sample = await makeListing(realHost, { country: 'SY', sybnbDataMode: 'sample' })
    created.demo = await makeListing(demoHost, { country: 'SY' })
  })

  afterAll(async () => {
    await db().listing.deleteMany({ where: { id: { in: Object.values(created).filter(Boolean) } } })
    await cleanupTestUsers()
  })

  it('with no country param, returns the Syria listing but not the Quebec (CA) listing', async () => {
    const res = await request(app).get('/api/listings?division=STAYS')
    expect(res.status).toBe(200)
    const ids = res.body.listings.map((l) => l.id)
    expect(ids).toContain(created.sy)
    expect(ids).not.toContain(created.ca)
  })

  it('excludes demo (owner.isDemo) and synthetic (sybnbDataMode=sample) listings', async () => {
    const res = await request(app).get('/api/listings?division=STAYS')
    const ids = res.body.listings.map((l) => l.id)
    expect(ids).not.toContain(created.sample)
    expect(ids).not.toContain(created.demo)
  })

  it('surfaces a fail-closed legalReviewStatus (Syria = unreviewed)', async () => {
    const res = await request(app).get('/api/listings?division=STAYS')
    expect(res.body.legalReviewStatus).toBe('unreviewed')
  })
})
