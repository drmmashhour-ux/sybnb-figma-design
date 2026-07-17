import { db } from './prisma.mjs'

// No plan-duration numbers existed anywhere in the product before this — divisions.ts claimed
// "listings expire by plan duration" with nothing backing it. These are reasonable marketplace
// defaults (basic vs premium listing lifespan), not a value specified elsewhere in the app.
export const PLAN_DURATION_DAYS = {
  plus: 30,
  premium: 60,
}

// The divisions that require a paid, admin-approved seller plan (as opposed to the commission/
// contact-based STAYS/RENTALS/BUY). Single source of truth, imported by both the listing create
// route (gate) and the admin approval route (which starts the paid clock).
export const PAID_PLAN_DIVISIONS = new Set(['CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION'])

export function listingExpiryDate(planCode) {
  const days = PLAN_DURATION_DAYS[planCode] ?? PLAN_DURATION_DAYS.plus
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

// Same opportunistic-expiry pattern as completeExpiredBookings(): run on read instead of a cron,
// so a lapsed paid-plan listing stops appearing in browse/host views without needing a scheduler.
export async function expireOldListings(where = {}) {
  await db().listing.updateMany({
    where: { ...where, status: 'APPROVED', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })
}
