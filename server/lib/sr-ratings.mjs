import { db } from './prisma.mjs'

// Aggregate a user's received ride ratings: average stars + count, PII-free (just numbers).
// Used for a driver's public reputation and, symmetrically, a rider's reputation shown to drivers.
export async function rideRatingSummary(userId, client = db()) {
  const result = await client.rideRating.aggregate({
    where: { ratedUserId: userId },
    _avg: { stars: true },
    _count: { _all: true },
  })
  const count = result._count._all
  return {
    average: count > 0 ? Math.round((result._avg.stars || 0) * 100) / 100 : null,
    count,
  }
}
