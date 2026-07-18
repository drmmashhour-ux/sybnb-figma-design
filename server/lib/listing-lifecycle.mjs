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
// Facebook-style marketplace Phase 1: MARKETPLACE (goods) is now FREE for individual listing — removed
// from the paid-plan gate. CARS and NEW_CONSTRUCTION stay behind an admin-approved paid seller plan.
export const PAID_PLAN_DIVISIONS = new Set(['CARS', 'NEW_CONSTRUCTION'])

export function listingExpiryDate(planCode) {
  const days = PLAN_DURATION_DAYS[planCode] ?? PLAN_DURATION_DAYS.plus
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

// RENTALS/BUY (025): commission-based, no paid plan, so they never had any freshness signal at
// all -- a listing published months ago stayed live forever with no "still available?" nudge.
// FREE_TIER_DIVISIONS get the same opportunistic expireOldListings() flip to EXPIRED as paid
// divisions, but on a single fixed window (no plan tiers to key off), and the host can push the
// clock forward themselves via PATCH /api/host/listings/:id/renew (see server/routes/host.mjs)
// without needing another admin review, since renewal never changes status -- it only extends
// expiresAt on a listing that is still APPROVED.
export const FREE_TIER_EXPIRY_DAYS = 60
export const FREE_TIER_DIVISIONS = new Set(['RENTALS', 'BUY'])

export function freeListingExpiryDate() {
  return new Date(Date.now() + FREE_TIER_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
}

// Same opportunistic-expiry pattern as completeExpiredBookings(): run on read instead of a cron,
// so a lapsed paid-plan listing stops appearing in browse/host views without needing a scheduler.
export async function expireOldListings(where = {}) {
  await db().listing.updateMany({
    where: { ...where, status: 'APPROVED', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  })
}
