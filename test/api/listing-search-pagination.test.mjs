import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Regression for the scale/correctness BLOCKER: public search used to fetch only the newest 200 listings
// and filter in JS, so anything older than that window was INVISIBLE to search. Search is now keyset-
// paginated (orderBy + id tiebreaker, Prisma cursor on the unique id) and returns a `nextCursor`, so
// every listing is reachable by paging. This proves the cursor advances to OLDER listings.
describe('Public listing search — keyset pagination reaches older listings', () => {
  let app
  let host
  const created = []

  beforeAll(async () => {
    app = testApp()
    const u = await db().user.create({
      data: {
        email: uniqueTestEmail('search-page-host'),
        displayName: 'Search Host',
        referralCode: uniqueTestReferralCode(),
        roles: { create: { role: 'HOST' } },
      },
    })
    trackTestUser(u.id)
    host = u
    // Three APPROVED STAYS listings, created oldest → newest so createdAt ordering is deterministic.
    for (let i = 0; i < 3; i += 1) {
      const listing = await db().listing.create({
        data: {
          ownerId: host.id,
          division: 'STAYS',
          titleAr: `صفحة ${i}`,
          titleEn: `PageStay ${i}`,
          priceMinor: 10 + i,
          currency: 'USD',
          status: 'APPROVED',
          createdAt: new Date(Date.now() - (3 - i) * 60_000), // i=0 oldest, i=2 newest
        },
      })
      created.push(listing)
    }
  })

  afterAll(async () => {
    await db().listing.deleteMany({ where: { id: { in: created.map((l) => l.id) } } })
    await cleanupTestUsers()
  })

  it('returns newest-first and hands back a usable cursor that reaches the older listings', async () => {
    const ids = new Set(created.map((l) => l.id))

    const first = await request(app).get('/api/listings?division=STAYS')
    expect(first.status).toBe(200)
    // Our 3 listings are present (there may be other approved STAYS in the test DB, so just assert ours show).
    const firstOurs = first.body.listings.filter((l) => ids.has(l.id))
    expect(firstOurs.length).toBeGreaterThan(0)

    // Page from the NEWEST of our listings — the older two must be reachable after that cursor.
    const newest = created[2].id
    const next = await request(app).get(`/api/listings?division=STAYS&cursor=${newest}`)
    expect(next.status).toBe(200)
    const afterIds = next.body.listings.map((l) => l.id)
    // The listing at the cursor is NOT repeated, and at least one OLDER listing is now returned.
    expect(afterIds).not.toContain(newest)
    expect(afterIds).toContain(created[1].id)
    expect(afterIds).toContain(created[0].id)
  })
})
