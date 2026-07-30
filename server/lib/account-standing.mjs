import { db } from './prisma.mjs'

// Loyalty / fidelity standing (admin Phase 2). Pure, deterministic signal computation + a rule-based
// tier baseline. The AI capsule (ai-loyalty.mjs) refines the baseline into a suggestion, and an admin
// approves it before it ever becomes a user's live tier (finance/trust-sensitive → never auto-applied).

export const HOST_TIERS = ['NEW', 'VERIFIED', 'TRUSTED', 'ELITE']
export const GUEST_TIERS = ['NEW', 'RELIABLE', 'VIP']

export function validTiersFor(kind) {
  return kind === 'GUEST' ? GUEST_TIERS : HOST_TIERS
}

function daysSince(date) {
  if (!date) return 0
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
}

// Gather the real behavioural signals that drive a user's standing.
export async function computeStandingStats(userId, kind) {
  const user = await db().user.findUnique({
    where: { id: userId },
    select: { id: true, createdAt: true, idDocumentStatus: true },
  })
  if (!user) return null
  const tenureDays = daysSince(user.createdAt)

  if (kind === 'GUEST') {
    const [completedBookings, disputes] = await Promise.all([
      db().booking.count({ where: { guestId: userId, status: 'COMPLETED' } }),
      db().dispute.count({ where: { booking: { guestId: userId } } }),
    ])
    return { kind, tenureDays, completedBookings, disputes }
  }

  // HOST
  const [ratingAgg, completedBookings, listings] = await Promise.all([
    db().listingReview.aggregate({
      where: { listing: { ownerId: userId }, hiddenAt: null },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    db().booking.count({ where: { listing: { ownerId: userId }, status: 'COMPLETED' } }),
    db().listing.findMany({ where: { ownerId: userId }, select: { metadata: true }, take: 200 }),
  ])
  // Open honesty flags: listings the AI truth-check warned on and that still carry warnings.
  const openTruthWarnings = listings.filter((l) => {
    const w = l.metadata && typeof l.metadata === 'object' ? l.metadata.truthCheckWarnings : null
    return Array.isArray(w) && w.length > 0
  }).length

  return {
    kind,
    tenureDays,
    verifiedId: user.idDocumentStatus === 'APPROVED',
    ratingAvg: ratingAgg._avg.rating ? Number(ratingAgg._avg.rating.toFixed(2)) : null,
    ratingCount: ratingAgg._count._all,
    completedBookings,
    openTruthWarnings,
  }
}

// Deterministic tier baseline. The AI may only pick a tier from this same ladder; this is also the
// fallback when AI is unavailable, so a suggestion is always well-defined.
export function ruleTier(kind, stats) {
  if (!stats) return 'NEW'
  if (kind === 'GUEST') {
    if (stats.completedBookings >= 10 && stats.disputes === 0) return 'VIP'
    if (stats.completedBookings >= 3 && stats.disputes === 0) return 'RELIABLE'
    return 'NEW'
  }
  // HOST
  const rating = stats.ratingAvg ?? 0
  if (stats.verifiedId && stats.openTruthWarnings === 0 && rating >= 4.7 && stats.ratingCount >= 5 && stats.completedBookings >= 20) {
    return 'ELITE'
  }
  if (stats.verifiedId && rating >= 4.3 && stats.ratingCount >= 3 && stats.completedBookings >= 5) return 'TRUSTED'
  if (stats.verifiedId) return 'VERIFIED'
  return 'NEW'
}
