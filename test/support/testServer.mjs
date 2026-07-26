import request from 'supertest'
import { server } from '../../server/index.mjs'
import { db } from '../../server/lib/prisma.mjs'
import { recordWalletEntry } from '../../server/lib/finance-ledger.mjs'

// SR cashless (016): the ride balance gate rejects a 0-credit rider. Test riders that will request/complete
// a ride must be funded first. Generous default covers many rides + holds + the completion charge.
export async function fundWallet(userId, amountMinor = 1_000_000_000, currency = 'SYP') {
  await db().$transaction(async (tx) => {
    await recordWalletEntry(tx, {
      userId, type: 'CREDIT', amountMinor, currency,
      referenceType: 'wallet_topup', referenceId: `test-fund-${userId}-${currency}`,
      keyParts: ['test-fund', userId, currency], note: 'test funding',
    })
  })
}

// Fix E (Slice 2): disburse now requires a MATCHED ReconciliationRecord for the booking's frozen Payment.
// This seeds that runtime precondition for disburse tests — it find-or-creates a minimal Payment (settled
// flows already have one) and appends a MATCHED reconciliation. `matchedById` must differ from the disbursing
// admin so the maker!=checker (D2) gate still passes. Returns the created reconciliation row.
export async function seedMatchedReconciliation({ bookingId, matchedById, grossMinor = 100_00, currency = 'USD', settlementRef }) {
  let payment = await db().payment.findUnique({ where: { bookingId } })
  if (!payment) {
    payment = await db().payment.create({
      data: { bookingId, grossMinor, commissionBaseMinor: grossMinor, commissionRateParts: 0, commissionAmountMinor: 0, hostPayoutMinor: grossMinor, currency, settlementRef: settlementRef || `SEED-${bookingId.slice(0, 8)}`, baseVersion: 'test' },
    })
  }
  return db().reconciliationRecord.create({
    data: { bookingId, paymentId: payment.id, statementRef: payment.settlementRef, amountMinor: payment.grossMinor, currency: payment.currency, source: 'manual', status: 'MATCHED', matchedById, matchedAt: new Date() },
  })
}

// SR trust (015): claiming/working a ride now requires requireRoadReadyDriver — ID + license + vehicle
// registration all APPROVED. Test drivers that will claim a ride must be made road-ready first.
export async function approveDriverForRides(userId) {
  await db().user.update({ where: { id: userId }, data: { idDocumentStatus: 'APPROVED' } })
  for (const type of ['LICENSE', 'VEHICLE_REGISTRATION']) {
    await db().driverDocument.upsert({
      where: { driverUserId_type: { driverUserId: userId, type } },
      create: { driverUserId: userId, type, assetUrl: `${type}.pdf`, status: 'APPROVED' },
      update: { status: 'APPROVED' },
    })
  }
}

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

// User.referralCode is required + unique (server/lib/referrals.mjs normally generates a
// collision-checked one at registration) -- tests that create a User row directly via Prisma,
// bypassing /api/auth/register entirely (e.g. to bootstrap an ADMIN, which cannot self-register),
// need to supply one by hand. Uniqueness within a test run is all that matters here.
export function uniqueTestReferralCode() {
  counter += 1
  return `T${RUN_ID}${counter}`.toUpperCase().slice(0, 12)
}

// GUEST self-registration now requires a real, server-verified email code (see
// server/lib/email-verification.mjs) — this drives the actual send+verify endpoints exactly as a
// real client must, using the dev-only devCode response instead of a mailbox. Fixture setup for
// non-GUEST roles (HOST/SELLER/DRIVER) is unaffected; only GUEST is gated.
// purpose defaults to 'guest-signup' (matches the server's own default) -- pass 'staff-login' for
// HOST/DRIVER/ADMIN test accounts, which now require the same real email-OTP gate at
// registration/sign-in as guests do (see server/routes/auth.mjs STAFF_ROLES_REQUIRING_OTP).
export async function verifyEmailForTest(app, email, purpose = 'guest-signup') {
  const sendRes = await request(app).post('/api/auth/email-code/send').send({ email, purpose })
  const code = sendRes.body.devCode
  if (!code) {
    throw new Error('Test email-code send did not return a devCode — is NODE_ENV=production set?')
  }
  const verifyRes = await request(app).post('/api/auth/email-code/verify').send({ email, code, purpose })
  if (!verifyRes.body.ok) {
    throw new Error(`Test email-code verify failed: ${JSON.stringify(verifyRes.body)}`)
  }
}

// Phone/SMS OTP (022): drives the real send+verify endpoints using the dev-only devCode, mirroring
// verifyEmailForTest. purpose 'guest-signup' or 'staff-login'.
export async function verifyPhoneForTest(app, phone, purpose = 'guest-signup') {
  const sendRes = await request(app).post('/api/auth/phone-code/send').send({ phone, purpose })
  const code = sendRes.body.devCode
  if (!code) throw new Error('Test phone-code send did not return a devCode — is NODE_ENV=production set?')
  const verifyRes = await request(app).post('/api/auth/phone-code/verify').send({ phone, code, purpose })
  if (!verifyRes.body.ok) throw new Error(`Test phone-code verify failed: ${JSON.stringify(verifyRes.body)}`)
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
//
// A test user that ever acted as an admin/support/driver (approving a review, claiming a ride,
// etc.) leaves an admin_audit_logs row behind, and this fine-grained cleanup deliberately leaves
// that user in place rather than deleting their audit rows first (admin_audit_logs.actorUserId
// has no cascade). Historically (when this suite ran against the shared development database)
// this was load-bearing: the security order this suite was built under prohibits deleting real
// audit history, and there was no way to tell "real" from "test" audit rows except by leaving
// every referenced user alone. Now that tests run against the isolated `sybnb_v6_test` database
// (see docs/testing/SYBNB_V6_TEST_DATABASE_SETUP.md), that constraint no longer applies here —
// every row in this database is synthetic and disposable — but the fine-grained cleanup is left
// as-is anyway since it's harmless and keeps each test file's own footprint small between runs.
// For a guaranteed-clean slate (e.g. proving repeatability across two full suite runs), use
// test/support/resetTestDatabase.mjs's full TRUNCATE-based reset instead, which is what
// test/support/setup.env.mjs calls once at the start of every db-backed Vitest run.
const createdUserIds = new Set()

export function trackTestUser(id) {
  if (id) createdUserIds.add(id)
}

export async function cleanupTestUsers() {
  const ids = Array.from(createdUserIds)
  if (!ids.length) return

  await db().paymentProof.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
  // Consumer-protection disputes (021) reference the opener without cascade — clear before user deletes.
  await db().dispute.deleteMany({ where: { openedByUserId: { in: ids } } }).catch(() => {})
  // SR safety/trust models reference users without cascade — clear them before the ride/user deletes.
  await db().rideRating.deleteMany({ where: { OR: [{ raterUserId: { in: ids } }, { ratedUserId: { in: ids } }] } }).catch(() => {})
  await db().rideMessage.deleteMany({ where: { senderUserId: { in: ids } } }).catch(() => {})
  await db().sosEvent.deleteMany({ where: { OR: [{ raisedByUserId: { in: ids } }, { resolvedById: { in: ids } }] } }).catch(() => {})
  await db().driverCancellation.deleteMany({ where: { driverId: { in: ids } } }).catch(() => {})
  await db().driverVehicle.deleteMany({ where: { driverId: { in: ids } } }).catch(() => {})
  await db().driverDocument.deleteMany({ where: { OR: [{ driverUserId: { in: ids } }, { reviewedById: { in: ids } }] } }).catch(() => {})
  await db().rideRequest.deleteMany({ where: { OR: [{ riderId: { in: ids } }, { driverId: { in: ids } }] } }).catch(() => {})
  // Seller reputation (Block 3): reviews reference seller+buyer without cascade, sales reference
  // seller+buyer+listing — clear reviews, then sales, before the listing/user deletes below.
  await db().sellerReview.deleteMany({ where: { OR: [{ sellerId: { in: ids } }, { buyerId: { in: ids } }] } }).catch(() => {})
  await db().sellerSale.deleteMany({ where: { OR: [{ sellerId: { in: ids } }, { buyerId: { in: ids } }] } }).catch(() => {})
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
