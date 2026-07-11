import { server } from '../../server/index.mjs'
import { db } from '../../server/lib/prisma.mjs'

// The server module exports the raw http.Server without auto-listening when imported (see
// server/index.mjs's isMainModule guard) — Supertest binds it to an ephemeral port itself, so
// tests never collide with a real running dev server on 3051.
export function testApp() {
  return server
}

const TEST_EMAIL_SUFFIX = '@sybnb.test'
let counter = 0

// Deterministic-enough unique identifiers per test run without a shared sequence file: process
// start time + an in-process counter. Not cryptographically unique, only "unique enough to not
// collide within one test run against the shared local dev database."
const RUN_ID = Date.now().toString(36)

export function uniqueTestEmail(label) {
  counter += 1
  return `t-${RUN_ID}-${counter}-${label}${TEST_EMAIL_SUFFIX}`
}

export function uniqueTestPhone() {
  counter += 1
  // +963 9XX XXXXXX shaped, deterministically derived from the run id + counter so it stays
  // inside a plausible Syrian mobile range without needing real numbers.
  const suffix = String(900000000 + (Number(`${Date.now()}`.slice(-6)) + counter) % 99999999).padStart(9, '0')
  return `+963${suffix}`
}

// Tracks every user id this test run created, for cleanup. Domain rows (bookings, payment
// proofs, ride requests, listings) referencing these users are deleted in cleanupTestUsers().
// A test user that ever acted as an admin/support/driver (approving a review, claiming a ride,
// etc.) leaves an admin_audit_logs row behind, and is deliberately NOT deleted here or by any
// other tooling: the security-hardening order this test suite was built under explicitly
// prohibits audit-history deletion, and admin_audit_logs.actorUserId has no cascade — the only
// way to delete such a user is to delete their audit rows first, which is exactly what's
// prohibited. These rows are permanent, harmless test artifacts, clearly identifiable by their
// @sybnb.test email domain; see docs/security/SYBNB_V6_TEST_STRATEGY.md for the accepted
// trade-off (no automated or human-run cleanup path is provided for them by design).
const createdUserIds = new Set()

export function trackTestUser(id) {
  if (id) createdUserIds.add(id)
}

export async function cleanupTestUsers() {
  const ids = Array.from(createdUserIds)
  if (!ids.length) return

  await db().paymentProof.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
  await db().rideRequest.deleteMany({ where: { OR: [{ riderId: { in: ids } }, { driverId: { in: ids } }] } }).catch(() => {})
  await db().booking.deleteMany({ where: { guestId: { in: ids } } }).catch(() => {})
  await db().listing.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => {})

  // Only delete users with zero remaining admin_audit_logs references (see comment above) —
  // anything else is left for the manual maintenance script.
  const blocked = await db().adminAuditLog.findMany({
    where: { actorUserId: { in: ids } },
    select: { actorUserId: true },
    distinct: ['actorUserId'],
  })
  const blockedIds = new Set(blocked.map((row) => row.actorUserId))
  const deletable = ids.filter((id) => !blockedIds.has(id))
  if (deletable.length) {
    await db().user.deleteMany({ where: { id: { in: deletable } } }).catch(() => {})
  }
  createdUserIds.clear()
}
