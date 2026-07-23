import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { seedDemoAccounts, DEMO_CUSTOMER_EMAIL, DEMO_DRIVER_EMAIL, DEMO_HOST_EMAIL } from '../../scripts/seed-demo-accounts.mjs'

// SYB-006 — the demo seed publishes a real APPROVED, instant-bookable STAYS listing that appears in the
// live public catalogue. In production that is fabricated inventory, so it must be gated OFF there. The
// demo accounts themselves (needed for store review) remain; only the published listing is withheld.

const DEMO_EMAILS = [DEMO_CUSTOMER_EMAIL, DEMO_DRIVER_EMAIL, DEMO_HOST_EMAIL]

async function cleanupDemo() {
  const users = await db().user.findMany({ where: { email: { in: DEMO_EMAILS } }, select: { id: true } })
  const ids = users.map((u) => u.id)
  if (!ids.length) return
  // Remove child records that reference these users before deleting the users themselves.
  await db().driverVehicle.deleteMany({ where: { driverId: { in: ids } } })
  await db().driverDocument.deleteMany({ where: { driverUserId: { in: ids } } })
  await db().driverProfile.deleteMany({ where: { userId: { in: ids } } })
  await db().listing.deleteMany({ where: { ownerId: { in: ids } } })
  await db().userRole.deleteMany({ where: { userId: { in: ids } } })
  await db().user.deleteMany({ where: { id: { in: ids } } })
}

describe('SYB-006 — demo seed gates its fabricated listing against production', () => {
  beforeEach(async () => { await cleanupDemo() })
  afterEach(async () => { await cleanupDemo() })

  it('creates the demo accounts but NOT a published listing when NODE_ENV=production', async () => {
    const prior = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    delete process.env.ALLOW_DEMO_LISTING
    try {
      const result = await seedDemoAccounts({ password: 'demo-password-123' })
      expect(result.listingSeeded).toBe(false)
      const host = await db().user.findUnique({ where: { email: DEMO_HOST_EMAIL }, select: { id: true } })
      expect(host).toBeTruthy() // accounts still seeded for store review
      const listings = await db().listing.count({ where: { ownerId: host.id } })
      expect(listings).toBe(0) // but no fabricated inventory in the live catalogue
    } finally {
      if (prior === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prior
    }
  })

  it('an explicit ALLOW_DEMO_LISTING=1 opt-in re-enables the listing for a controlled store-review env', async () => {
    const prior = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_DEMO_LISTING = '1'
    try {
      const result = await seedDemoAccounts({ password: 'demo-password-123' })
      expect(result.listingSeeded).toBe(true)
      const host = await db().user.findUnique({ where: { email: DEMO_HOST_EMAIL }, select: { id: true } })
      expect(await db().listing.count({ where: { ownerId: host.id } })).toBe(1)
    } finally {
      delete process.env.ALLOW_DEMO_LISTING
      if (prior === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prior
    }
  })

  it('seeds the listing normally in a non-production (dev/test) environment', async () => {
    const result = await seedDemoAccounts({ password: 'demo-password-123' })
    expect(result.listingSeeded).toBe(true)
  })
})
