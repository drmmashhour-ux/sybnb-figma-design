import { db } from './prisma.mjs'
import {
  ACTIVE_PROOF_STATUSES, HOLD_POLICY_VERSION, evaluateHoldEligibility, resolvePaymentMethod,
} from './booking-hold-policy.mjs'
import { notify } from './notifications.mjs'

export const PAYOUT_HOLD_DAYS = 14

export const HOLD_RELEASE_ACTION = 'BOOKING_HOLD_RELEASED'

/**
 * SYB-002 — release a single abandoned PAYMENT_PENDING hold to CANCELLED, atomically and idempotently.
 * Shared by the automatic sweep and the admin manual-release route so both take the exact same governed
 * transition. Returns true if THIS call performed the release, false if it was a no-op (already moved,
 * proof arrived, not eligible) — never throws for a losing race.
 *
 * Safety, in order:
 *  - runs in a transaction and RE-CHECKS active proofs inside it, closing the read-then-write race with
 *    a proof submitted a moment earlier;
 *  - the updateMany carries a `status: 'PAYMENT_PENDING'` guard, so a booking any other transition
 *    already moved (approved -> REQUESTED/CONFIRMED, cancelled, completed) matches zero rows;
 *  - CANCELLED is outside the availability-occupying set, so inventory is restored by the transition
 *    itself with no separate availability write;
 *  - the audit + metadata record who/why/when/policy — never a fabricated payment or refund.
 */
async function releaseHold(booking, { kind, reason, releasedBy, method }) {
  const priorMetadata = booking.metadata && typeof booking.metadata === 'object' ? booking.metadata : {}
  const releasedAt = new Date()

  const performed = await db().$transaction(async (tx) => {
    const activeProofs = await tx.paymentProof.count({
      where: { bookingId: booking.id, status: { in: ACTIVE_PROOF_STATUSES } },
    })
    // A paid booking awaiting review is never an abandoned hold — bail even for a manual release.
    if (activeProofs > 0) return false

    const claim = await tx.booking.updateMany({
      where: { id: booking.id, status: 'PAYMENT_PENDING' },
      data: {
        status: 'CANCELLED',
        metadata: {
          ...priorMetadata,
          // Distinguishes an expired/admin-released hold from an ordinary user cancellation or a refund.
          release: {
            kind, // AUTO_EXPIRED_HOLD | ADMIN_RELEASED_ABANDONED_HOLD
            priorStatus: 'PAYMENT_PENDING',
            reason,
            paymentMethod: method,
            policyVersion: HOLD_POLICY_VERSION,
            releasedAt: releasedAt.toISOString(),
            releasedBy, // 'scheduler' for the sweep, or the admin user id
          },
        },
      },
    })
    return claim.count === 1
  })

  if (!performed) return false

  // Audit is best-effort and OUTSIDE the release transaction: a logging failure must never roll back a
  // legitimate inventory restoration (owner rule). actorUserId is null for the automatic sweep.
  try {
    await db().adminAuditLog.create({
      data: {
        actorUserId: releasedBy === 'scheduler' ? null : releasedBy,
        action: HOLD_RELEASE_ACTION,
        entityType: 'bookings',
        entityId: booking.id,
        after: { kind, priorStatus: 'PAYMENT_PENDING', resultingStatus: 'CANCELLED', reason, paymentMethod: method, policyVersion: HOLD_POLICY_VERSION, releasedBy },
      },
    })
  } catch {
    /* non-blocking: the release already committed */
  }

  // SYB-003: best-effort notification AFTER the release committed. notify() never throws, so a mailer
  // outage cannot affect the already-restored inventory (owner rule: release is independent of delivery).
  try {
    const guest = await db().user.findUnique({ where: { id: booking.guestId }, select: { email: true, locale: true } })
    await notify({
      event: 'PAYMENT_HOLD_EXPIRED',
      to: guest?.email,
      locale: guest?.locale,
      data: { ref: booking.id.slice(0, 12).toUpperCase() },
      entityId: booking.id,
      recipientRef: booking.guestId,
    })
  } catch {
    /* delivery is best-effort */
  }
  return true
}

/**
 * SYB-002 — opportunistic sweep of abandoned PAYMENT_PENDING holds, mirroring completeExpiredBookings():
 * run from read paths (host/admin/guest overviews) since this deployment has no scheduler. Eligibility
 * is computed at call time by the configurable policy; a hold with a proof under review is never touched.
 * Notifications are intentionally NOT called here — inventory restoration must never depend on delivery.
 */
export async function releaseAbandonedHolds(where = {}) {
  const now = Date.now()
  const candidates = await db().booking.findMany({
    where: { status: 'PAYMENT_PENDING', ...where },
    include: { payments: { select: { provider: true, status: true, createdAt: true } } },
  })
  let released = 0
  for (const booking of candidates) {
    const verdict = evaluateHoldEligibility(booking, { now })
    if (!verdict.eligible) continue
    const ok = await releaseHold(booking, {
      kind: 'AUTO_EXPIRED_HOLD',
      reason: verdict.reason,
      releasedBy: 'scheduler',
      method: verdict.method,
    })
    if (ok) released += 1
  }
  return released
}

/**
 * SYB-002 — governed admin manual release of an abandoned hold, with a required reason. Reuses the same
 * atomic transition and proof-state guard as the sweep, so an admin can NEVER release a paid booking
 * awaiting review as if it were abandoned. Returns { released, code }.
 */
export async function adminReleaseHold({ bookingId, adminUserId, reason }) {
  const trimmedReason = String(reason || '').trim()
  if (!trimmedReason) return { released: false, code: 'HOLD_RELEASE_REASON_REQUIRED' }

  const booking = await db().booking.findUnique({
    where: { id: bookingId },
    include: { payments: { select: { provider: true, status: true, createdAt: true } } },
  })
  if (!booking) return { released: false, code: 'BOOKING_NOT_FOUND' }
  if (booking.status !== 'PAYMENT_PENDING') return { released: false, code: 'BOOKING_NOT_A_HOLD' }
  if ((booking.payments || []).some((p) => ACTIVE_PROOF_STATUSES.includes(p.status))) {
    return { released: false, code: 'HOLD_HAS_PROOF_UNDER_REVIEW' }
  }

  const ok = await releaseHold(booking, {
    kind: 'ADMIN_RELEASED_ABANDONED_HOLD',
    reason: trimmedReason,
    releasedBy: adminUserId,
    method: resolvePaymentMethod(booking.payments || []),
  })
  return ok ? { released: true, code: 'RELEASED' } : { released: false, code: 'HOLD_ALREADY_MOVED' }
}

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
