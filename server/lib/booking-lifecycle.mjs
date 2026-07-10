import { db } from './prisma.mjs'

export const PAYOUT_HOLD_DAYS = 14

// A confirmed stay has no natural "it's over" signal in this system (no cleaning-crew check-out
// scan, no guest confirmation step) — checkout date passing is the only real signal available.
// Called opportunistically from read paths (host/admin/guest overviews) instead of a cron job,
// since there is no scheduler in this deployment.
export async function completeExpiredBookings(where = {}) {
  const now = new Date()
  const result = await db().booking.updateMany({
    where: {
      status: 'CONFIRMED',
      checkOut: { not: null, lt: now },
      ...where,
    },
    data: { status: 'COMPLETED' },
  })
  return result.count
}

export function payoutEligibleAt(checkOut) {
  if (!checkOut) return null
  return new Date(new Date(checkOut).getTime() + PAYOUT_HOLD_DAYS * 24 * 60 * 60 * 1000)
}

export function isPayoutEligible(booking) {
  if (booking.status !== 'COMPLETED') return false
  const eligibleAt = payoutEligibleAt(booking.checkOut)
  if (!eligibleAt) return false
  return eligibleAt.getTime() <= Date.now()
}
