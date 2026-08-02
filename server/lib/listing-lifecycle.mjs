import { db } from './prisma.mjs'
import { deleteListingMedia } from './listing-media-storage.mjs'

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

// Reclaim photo storage from dead listings. A REJECTED or EXPIRED listing keeps its photos for a grace
// window (so the host can fix & resubmit, or renew) — but after that they are pure waste, and over a
// year of traffic they are the main source of orphaned-photo growth. This deletes the stored files AND
// their ListingMedia rows once the listing has sat untouched past the grace window.
//
// Same opportunistic "run on read" pattern as expireOldListings, but THROTTLED: deleting files is a
// network call (Blob), so it runs at most once every few hours and only a small batch per run — it must
// never slow a normal request. Callers fire-and-forget it; if a run is cut short it simply resumes next
// time (idempotent). If everything is already clean it costs one indexed COUNT-style query.
const MEDIA_PURGE_GRACE_DAYS = 30
const MEDIA_PURGE_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000
const MEDIA_PURGE_BATCH = 25
let lastMediaPurgeAt = 0

export async function purgeStaleListingMedia() {
  const now = Date.now()
  if (now - lastMediaPurgeAt < MEDIA_PURGE_MIN_INTERVAL_MS) return { skipped: true }
  lastMediaPurgeAt = now

  const cutoff = new Date(now - MEDIA_PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000)
  const media = await db().listingMedia.findMany({
    where: { listing: { status: { in: ['REJECTED', 'EXPIRED'] }, updatedAt: { lt: cutoff } } },
    select: { id: true, url: true },
    take: MEDIA_PURGE_BATCH,
  })
  if (!media.length) return { purged: 0 }

  for (const row of media) {
    await deleteListingMedia(row.url)
  }
  await db().listingMedia.deleteMany({ where: { id: { in: media.map((m) => m.id) } } })
  return { purged: media.length }
}
