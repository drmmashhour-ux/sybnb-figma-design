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

// How long a booking may sit in PAYMENT_PENDING with no payment activity before it is reaped.
// Overridable per-deployment; 60 minutes is generous for a guest who genuinely intends to pay.
export function paymentPendingTtlMinutes() {
  const raw = Number(process.env.BOOKING_PAYMENT_TTL_MINUTES)
  return Number.isFinite(raw) && raw > 0 ? raw : 60
}

// A booking is created PAYMENT_PENDING and immediately holds its dates: the overlap check in the
// create path and the availability read paths all count PAYMENT_PENDING as occupying. If the guest
// never pays, nothing ever releases those dates — a free denial-of-availability where anyone can
// squat a listing's best dates indefinitely. This reaps PENDING bookings older than the payment TTL
// that have NO payment proof at all. A submitted-but-unapproved proof means the guest HAS paid and is
// awaiting admin review — those keep a proof row, so `payments: { none: {} }` deliberately spares them.
// Opportunistic (run from read/create paths), mirroring completeExpiredBookings, since there is no
// scheduler in this deployment. Accepts a tx client so the create path can reap inside its own
// advisory-locked transaction before testing overlap.
export async function expireStalePaymentPendingBookings(where = {}, client = db()) {
  const cutoff = new Date(Date.now() - paymentPendingTtlMinutes() * 60 * 1000)
  // Stripe Checkout sessions are deliberately capped at 30 minutes. Their placeholder proof keeps
  // the booking from being reaped while Checkout is open and gives webhook delivery another 30+
  // minutes of grace. Once the normal booking TTL has elapsed, an uncompleted placeholder is safe to
  // remove and the dates can be released. A real/manual submitted proof never matches this predicate.
  const candidates = await client.booking.findMany({
    where: {
      status: 'PAYMENT_PENDING',
      createdAt: { lt: cutoff },
      payments: {
        every: {
          provider: 'stripe_checkout',
          status: 'PENDING_PROOF',
          createdAt: { lt: cutoff },
        },
      },
      ...where,
    },
    select: { id: true },
  })
  if (candidates.length === 0) return 0
  const ids = candidates.map(({ id }) => id)
  await client.paymentProof.deleteMany({
    where: { bookingId: { in: ids }, provider: 'stripe_checkout', status: 'PENDING_PROOF' },
  })
  const result = await client.booking.updateMany({
    // Re-check the proof predicate after deleting placeholders. A manual proof upload or successful
    // webhook may have raced the candidate read; either creates a non-placeholder payment and must
    // win over expiry.
    where: {
      id: { in: ids },
      status: 'PAYMENT_PENDING',
      payments: { every: { provider: 'stripe_checkout', status: 'PENDING_PROOF' } },
    },
    data: { status: 'CANCELLED' },
  })
  return result.count
}

export function payoutEligibleAt(checkOut) {
  if (!checkOut) return null
  return new Date(new Date(checkOut).getTime() + PAYOUT_HOLD_DAYS * 24 * 60 * 60 * 1000)
}

export function isPayoutEligible(booking) {
  if (booking.status !== 'COMPLETED') return false
  if (Array.isArray(booking.disputes) && booking.disputes.some((dispute) => dispute.status === 'OPEN')) return false
  const eligibleAt = payoutEligibleAt(booking.checkOut)
  if (!eligibleAt) return false
  return eligibleAt.getTime() <= Date.now()
}
