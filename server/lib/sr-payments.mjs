import { idempotencyKey } from './security.mjs'
import { recordWalletEntry } from './finance-ledger.mjs'
import { convertSypMinorToUsd } from './currency.mjs'

// SR commission policy (028): progressive, resets every calendar year, computed on the driver's
// cumulative eligible fares -- not a flat rate. Finalized policy (2026-07-20):
//   $0-$20,000            -> 12%
//   $20,000.01-$40,000    -> 11%
//   $40,000.01-$60,000    -> 10%
//   above $60,000         -> 9%
// Progressive like a tax bracket: only the slice of a driver's cumulative fare that falls inside a
// tier is charged that tier's rate -- a driver crossing from tier 1 into tier 2 mid-ride pays 12%
// on the portion under $20,000 and 11% on the rest of that same ride, not 11% on the whole ride.
// Never retroactive: rides already settled keep the rate that applied when they were charged, even
// if a later refund/fraud exclusion shifts the driver's running total for FUTURE rides.
//
// Thresholds are USD-denominated. SR fares today only ever resolve to SYP or USD (quoteSrRide in
// sr-geocoding.mjs) -- Quebec/CAD isn't wired into fare quoting yet -- so a SYP fare is converted to
// its USD equivalent via the platform's existing fixed SYP_PER_USD rate (currency.mjs, the same rate
// guest-facing USD pricing already uses) purely to place it on the USD tier ladder. The driver and
// platform are still paid in the ride's real currency; only the tier lookup happens in USD.
//
// The commission is a finance/admin figure only — it is derived here and recorded to the ledger,
// and never placed on any rider-facing payload (see the ride handlers, which return the RideRequest
// row whose only money field is the fare the rider actually pays).
export const SR_COMMISSION_TIERS = [
  { ratePercent: 12, minUsd: 0, maxUsd: 20000 },
  { ratePercent: 11, minUsd: 20000, maxUsd: 40000 },
  { ratePercent: 10, minUsd: 40000, maxUsd: 60000 },
  { ratePercent: 9, minUsd: 60000, maxUsd: Infinity },
]

// No commission on tips, cancellation/show-up compensation, referral rewards, or driver bonuses --
// those are separate 100%-to-driver flows elsewhere in this file that never call this function.
// Government contributions and taxes (e.g. Québec's mandatory ride contribution, not yet
// implemented -- Quebec SR isn't live) are likewise never part of the fare this function is given.

function round2(value) {
  return Math.round((value || 0) * 100) / 100
}

// Tax-bracket-style progressive split: given how much of the driver's annual threshold is already
// used (priorYtdUsd) and this ride's USD-equivalent fare, returns the commission plus which tier(s)
// it landed in (a ride can straddle a boundary and owe two different rates on two different slices).
// tierTable defaults to the hardcoded SR_COMMISSION_TIERS -- callers that resolved a jurisdiction
// override (server/lib/jurisdiction-pricing.mjs) pass their own table; this function itself stays
// jurisdiction-agnostic and fully backward compatible with every existing call site/test.
export function computeProgressiveCommissionUsd(priorYtdUsd, fareUsd, tierTable = SR_COMMISSION_TIERS) {
  const prior = Math.max(0, priorYtdUsd || 0)
  const fare = Math.max(0, fareUsd || 0)
  if (fare <= 0) return { commissionUsd: 0, tiers: [] }

  let remaining = fare
  let cursor = prior
  let commissionUsd = 0
  const tiers = []

  for (const tier of tierTable) {
    if (remaining <= 0) break
    if (cursor >= tier.maxUsd) continue // this driver is already past this tier for the year

    const roomInTier = tier.maxUsd - Math.max(cursor, tier.minUsd)
    const amountInTier = Math.min(remaining, roomInTier)
    if (amountInTier <= 0) continue

    const tierCommissionUsd = amountInTier * (tier.ratePercent / 100)
    commissionUsd += tierCommissionUsd
    tiers.push({
      ratePercent: tier.ratePercent,
      minUsd: tier.minUsd,
      maxUsd: Number.isFinite(tier.maxUsd) ? tier.maxUsd : null,
      amountUsd: round2(amountInTier),
      commissionUsd: round2(tierCommissionUsd),
    })
    remaining -= amountInTier
    cursor += amountInTier
  }

  return { commissionUsd, tiers }
}

// This driver's calendar-year eligible fare total so far, in USD, for placing a NEW ride on the
// tier ladder. "Eligible" excludes: rides refunded via a resolved dispute (real, existing mechanism
// -- see disputes.mjs), and rides an admin has flagged FRAUDULENT/CHARGEBACK (RideRequest.metadata,
// see the admin commission-flag endpoint). Bounded to one driver's one-year ride volume, so an
// in-memory filter after one query is simpler and plenty fast -- no need for JSON-path SQL filters.
export async function driverYtdEligibleFareUsd(tx, driverId, { asOf = new Date(), excludeRideId } = {}) {
  if (!driverId) return 0
  const year = asOf.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1))

  const rides = await tx.rideRequest.findMany({
    where: {
      driverId,
      status: 'COMPLETED',
      updatedAt: { gte: yearStart, lt: yearEnd },
      ...(excludeRideId ? { id: { not: excludeRideId } } : {}),
    },
    select: { id: true, fareMinor: true, currency: true, metadata: true },
  })
  if (rides.length === 0) return 0

  const refundedRides = await tx.dispute.findMany({
    where: { rideId: { in: rides.map((r) => r.id) }, status: 'RESOLVED_REFUNDED' },
    select: { rideId: true },
  })
  const refundedIds = new Set(refundedRides.map((d) => d.rideId))

  let totalUsd = 0
  for (const ride of rides) {
    if (refundedIds.has(ride.id)) continue
    const flag = ride.metadata?.commissionFlag
    if (flag === 'FRAUDULENT' || flag === 'CHARGEBACK') continue
    const fare = Math.max(0, Math.round(ride.fareMinor || 0))
    totalUsd += ride.currency === 'USD' ? fare : convertSypMinorToUsd(fare)
  }
  return totalUsd
}

// Splits a whole-currency fare (see currency.mjs — amountMinor is whole units, not cents) into the
// driver's earning and the platform's progressive commission. adminCommissionMinor is the exact
// remainder of the fare so driverEarningMinor + adminCommissionMinor === fareMinor with no rounding
// drift — this is the money-safety invariant "driver credit + platform commission == fare".
//
// priorYtdUsd is the driver's cumulative eligible fare for the calendar year BEFORE this ride (see
// driverYtdEligibleFareUsd) -- the caller resolves it so this function stays a pure, testable split.
// tierTable defaults to SR_COMMISSION_TIERS (see computeProgressiveCommissionUsd above).
export function srRideFinanceSplit(fareMinor, { currency = 'SYP', priorYtdUsd = 0, tierTable = SR_COMMISSION_TIERS } = {}) {
  const fare = Math.max(0, Math.round(fareMinor || 0))
  const fareUsd = currency === 'USD' ? fare : convertSypMinorToUsd(fare)
  const { commissionUsd, tiers } = computeProgressiveCommissionUsd(priorYtdUsd, fareUsd, tierTable)
  const effectiveRate = fareUsd > 0 ? commissionUsd / fareUsd : 0

  const adminCommissionMinor = Math.round(fare * effectiveRate)
  const driverEarningMinor = fare - adminCommissionMinor

  return {
    fareMinor: fare,
    driverEarningMinor,
    adminCommissionMinor,
    breakdown: {
      commissionPolicy: 'sr_progressive_v1',
      year: new Date().getUTCFullYear(),
      currency,
      fareUsd: round2(fareUsd),
      priorYtdUsd: round2(priorYtdUsd),
      commissionUsd: round2(commissionUsd),
      effectiveRatePercent: round2(effectiveRate * 100),
      tiers,
    },
  }
}

// Jurisdiction-config-aware (030): resolves an active JurisdictionCommissionPolicy for (country,
// province, RIDE) via jurisdiction-pricing.mjs; falls back to the hardcoded SR_COMMISSION_TIERS
// when nothing is active there -- which is every driver today (nothing is seeded active), so this
// is a zero-behavior-change wiring today and a real per-jurisdiction override path once activated.
export async function resolveSrCommissionTiers(db, { country, province, asOf = new Date() } = {}) {
  const { resolveCommissionPolicy } = await import('./jurisdiction-pricing.mjs')
  const policy = await resolveCommissionPolicy(db, { country, province, serviceType: 'RIDE', asOf })
  if (policy && policy.policyType === 'PROGRESSIVE' && Array.isArray(policy.tiers) && policy.tiers.length) {
    return policy.tiers
  }
  return SR_COMMISSION_TIERS
}

// A ride is "held" against the rider's wallet while a driver is committed to it. Reservation is
// derived from ride state (see riderReservedMinor) — the source of truth is the ride's own status,
// not a wallet RELEASE entry, because RELEASE credits the wallet and a payer-side hold must never
// hand the rider money back on completion (the fare DEBIT is what settles the hold).
export const SR_HELD_RIDE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']

// Same platform-account resolution the Stripe auto-approval path uses (payments.mjs firstAdminId):
// SR commission is recorded as a CREDIT to the platform's ADMIN wallet, exactly like STR's
// booking_admin_share. Deterministic in production (the platform always has an admin account).
export async function resolvePlatformUserId(client) {
  const admin = await client.userRole.findFirst({ where: { role: 'ADMIN' }, select: { userId: true } })
  return admin?.userId || null
}

// Sum of fares the rider currently has committed to in-flight rides. Because a match-time HOLD entry
// carries a 0 balance delta (recordWalletEntry), the rider's cachedBalanceMinor still shows their
// full credit while a ride is in progress — this is what makes that credit "reserved" so it can't be
// spent on a second ride. A ride leaving the held window (COMPLETED or CANCELLED) drops out of this
// sum automatically, which is how the hold is released without a crediting RELEASE entry.
export async function riderReservedMinor(client, { riderId, currency, excludeRideId }) {
  const held = await client.rideRequest.aggregate({
    where: {
      riderId,
      currency,
      status: { in: SR_HELD_RIDE_STATUSES },
      ...(excludeRideId ? { id: { not: excludeRideId } } : {}),
    },
    _sum: { fareMinor: true },
  })
  return held._sum.fareMinor || 0
}

// Spendable rider balance = cached wallet balance minus fares already reserved by in-flight rides.
export async function riderAvailableBalanceMinor(client, { riderId, currency, excludeRideId }) {
  const wallet = await client.wallet.findUnique({ where: { userId_currency: { userId: riderId, currency } } })
  const cached = wallet?.cachedBalanceMinor || 0
  const reserved = await riderReservedMinor(client, { riderId, currency, excludeRideId })
  return cached - reserved
}

// Uber-style payment-method gate: a ride can't proceed unless the rider's spendable balance covers
// the fare. Called at request time and again at match time (before the hold is placed).
export async function assertRiderCanAfford(client, { riderId, currency, fareMinor, excludeRideId, message }) {
  const needed = Math.max(0, Math.round(fareMinor || 0))
  const available = await riderAvailableBalanceMinor(client, { riderId, currency, excludeRideId })
  if (available < needed) {
    const error = new Error(message || 'Your SYBNB wallet balance is not enough to cover this ride fare.')
    error.statusCode = 402
    error.code = 'INSUFFICIENT_CREDIT'
    error.expose = true
    throw error
  }
}

// Records the match-time HOLD as an auditable reservation marker. Idempotent on the ride id, so an
// admin re-assign / re-claim of the same ride never stacks a second hold. The HOLD carries a 0
// balance delta; the actual reservation is enforced by riderReservedMinor via ride state.
export async function placeRideHold(tx, ride) {
  return recordWalletEntry(tx, {
    userId: ride.riderId,
    type: 'HOLD',
    amountMinor: ride.fareMinor,
    currency: ride.currency,
    referenceType: 'sr_ride_hold',
    referenceId: ride.id,
    keyParts: ['sr-ride-hold', ride.id],
    note: 'Estimated SR fare reserved against the rider wallet at driver match.',
  })
}

// Charges a ride that has reached COMPLETED. Call inside the same transaction that flips the ride to
// COMPLETED so a ride is never marked complete without settling, nor settled without being complete.
//
// EXACTLY-ONCE: short-circuits if the fare DEBIT already exists (a retried completion), and every
// entry is additionally idempotency-keyed on the ride id — so double-completion can never
// double-charge the rider or double-pay the driver.
//
// MONEY-SAFETY: re-checks the rider's cached balance inside the transaction (last line of defense
// behind the request-time gate and the match-time hold) and throws — rolling back the COMPLETED
// transition — rather than ever letting the wallet go negative.
export async function chargeCompletedRide(tx, ride) {
  const fareMinor = Math.max(0, Math.round(ride?.fareMinor || 0))
  if (!ride || !fareMinor) return { charged: false, reason: 'no_fare' }

  const chargeKey = idempotencyKey(['sr-ride-fare', ride.id])
  const already = await tx.walletEntry.findUnique({ where: { idempotencyKey: chargeKey } })
  if (already) return { charged: false, reason: 'already_charged' }

  const wallet = await tx.wallet.findUnique({
    where: { userId_currency: { userId: ride.riderId, currency: ride.currency } },
  })
  if ((wallet?.cachedBalanceMinor || 0) < fareMinor) {
    const error = new Error('The rider wallet no longer covers this fare; the ride cannot be completed.')
    error.statusCode = 402
    error.code = 'INSUFFICIENT_CREDIT'
    error.expose = true
    throw error
  }

  // Resolve the driver's calendar-year running total BEFORE this ride so the progressive tier
  // applies correctly (see driverYtdEligibleFareUsd/computeProgressiveCommissionUsd doc comments).
  const priorYtdUsd = await driverYtdEligibleFareUsd(tx, ride.driverId, { excludeRideId: ride.id })
  // Jurisdiction-config-aware (030): the driver's own registered country/province decides which
  // commission table applies -- falls back to SR_COMMISSION_TIERS when nothing is active for that
  // jurisdiction (every driver today), so this is a zero-behavior-change wiring today.
  const driverProfile = ride.driverId ? await tx.driverProfile.findUnique({ where: { userId: ride.driverId }, select: { country: true } }) : null
  const tierTable = await resolveSrCommissionTiers(tx, { country: driverProfile?.country || 'SY', province: null })
  const split = srRideFinanceSplit(fareMinor, { currency: ride.currency, priorYtdUsd, tierTable })

  // Same breakdown metadata on all three settlement entries so any one of them is independently
  // auditable (which tier(s) applied, the driver's prior YTD total, the effective rate) without
  // needing to cross-reference the others.
  const settlementMetadata = split.breakdown

  // Immutable pricing snapshot (030): exactly what applied to THIS ride's settlement, never
  // recomputed later even if SR_COMMISSION_TIERS or a jurisdiction override changes afterward.
  const { savePricingSnapshot } = await import('./jurisdiction-pricing.mjs')
  await savePricingSnapshot(tx, {
    subjectType: 'SR_RIDE', subjectId: ride.id, country: driverProfile?.country || 'SY', province: null,
    breakdown: settlementMetadata,
  })

  // 1. DEBIT the rider the full fare. This is also what settles (releases) the match-time hold:
  //    the reservation drops out of riderReservedMinor once the ride leaves the held window, so
  //    there is deliberately no crediting RELEASE entry here (that would refund the rider).
  await recordWalletEntry(tx, {
    userId: ride.riderId,
    type: 'DEBIT',
    amountMinor: split.fareMinor,
    currency: ride.currency,
    referenceType: 'sr_ride_fare',
    referenceId: ride.id,
    keyParts: ['sr-ride-fare', ride.id],
    note: 'SR ride fare charged to rider wallet on completion.',
    metadata: settlementMetadata,
  })

  // 2. CREDIT the driver their earning (fare minus the progressive commission), accrues in the
  //    driver wallet until admin payout.
  if (ride.driverId) {
    await recordWalletEntry(tx, {
      userId: ride.driverId,
      type: 'CREDIT',
      amountMinor: split.driverEarningMinor,
      currency: ride.currency,
      referenceType: 'sr_driver_earning',
      referenceId: ride.id,
      keyParts: ['sr-driver-earning', ride.id],
      note: `SR driver earning accrued on ride completion (${split.breakdown.effectiveRatePercent}% platform commission this ride).`,
      metadata: settlementMetadata,
    })
  }

  // 3. Record the progressive platform commission as a CREDIT to the platform admin wallet (same
  //    shape as STR booking_admin_share). In production an ADMIN always exists; if none does, the
  //    commission simply isn't recorded (matching approvePaymentProof's conditional admin credit).
  const platformUserId = await resolvePlatformUserId(tx)
  if (platformUserId) {
    await recordWalletEntry(tx, {
      userId: platformUserId,
      type: 'CREDIT',
      amountMinor: split.adminCommissionMinor,
      currency: ride.currency,
      referenceType: 'sr_admin_commission',
      referenceId: ride.id,
      keyParts: ['sr-admin-commission', ride.id],
      note: `SYBNB SR progressive platform commission (${split.breakdown.effectiveRatePercent}% effective) collected on ride completion.`,
      metadata: settlementMetadata,
    })
  }

  return { charged: true, ...split, platformUserId }
}

// TIP (founder: "keep space for tips"). A rider may tip the driver after a completed ride. Tips are
// paid from the rider's wallet credit and go 100% to the driver — NO platform commission on tips
// (Uber/Lyft standard, and driver-friendly). One tip per ride: idempotency-keyed on the ride id, so
// a retried/duplicate tip is a no-op rather than a second charge. Re-checks the rider's spendable
// balance inside the transaction so a tip can never drive the wallet negative.
export async function tipCompletedRide(tx, ride, tipMinor) {
  const amount = Math.max(0, Math.round(tipMinor || 0))
  if (!ride || !ride.driverId) {
    const error = new Error('This ride cannot be tipped.')
    error.statusCode = 400
    error.code = 'RIDE_NOT_TIPPABLE'
    error.expose = true
    throw error
  }
  if (ride.status !== 'COMPLETED') {
    const error = new Error('You can only tip after the ride is completed.')
    error.statusCode = 400
    error.code = 'RIDE_NOT_COMPLETED'
    error.expose = true
    throw error
  }
  if (amount <= 0) {
    const error = new Error('Tip amount must be greater than zero.')
    error.statusCode = 400
    error.code = 'TIP_AMOUNT_INVALID'
    error.expose = true
    throw error
  }

  // one tip per ride
  const tipKey = idempotencyKey(['sr-ride-tip', ride.id])
  const already = await tx.walletEntry.findUnique({ where: { idempotencyKey: tipKey } })
  if (already) {
    const error = new Error('You have already tipped this ride.')
    error.statusCode = 409
    error.code = 'RIDE_ALREADY_TIPPED'
    error.expose = true
    throw error
  }

  // MONEY-SAFETY: the tip is spendable-balance gated inside the transaction; never let it overdraw.
  const wallet = await tx.wallet.findUnique({
    where: { userId_currency: { userId: ride.riderId, currency: ride.currency } },
  })
  const reserved = await riderReservedMinor(tx, { riderId: ride.riderId, currency: ride.currency })
  if (((wallet?.cachedBalanceMinor || 0) - reserved) < amount) {
    const error = new Error('Your SYBNB wallet balance is not enough to add this tip.')
    error.statusCode = 402
    error.code = 'INSUFFICIENT_CREDIT'
    error.expose = true
    throw error
  }

  await recordWalletEntry(tx, {
    userId: ride.riderId,
    type: 'DEBIT',
    amountMinor: amount,
    currency: ride.currency,
    referenceType: 'sr_ride_tip',
    referenceId: ride.id,
    keyParts: ['sr-ride-tip', ride.id],
    note: 'SR rider tip charged to rider wallet.',
  })
  await recordWalletEntry(tx, {
    userId: ride.driverId,
    type: 'CREDIT',
    amountMinor: amount, // 100% to the driver — no commission on tips
    currency: ride.currency,
    referenceType: 'sr_driver_tip',
    referenceId: ride.id,
    keyParts: ['sr-driver-tip', ride.id],
    note: 'SR driver tip (100%, no platform commission) credited on rider tip.',
  })

  return { tipped: true, tipMinor: amount }
}

// SR cancellation fee (019): a rider who cancels after the grace window (driver already committed, trip
// not started) pays a fee that goes 100% to the assigned driver as show-up compensation — no platform
// commission on a cancellation. Idempotency-keyed on the ride id so a retried cancel never double-charges.
// Re-checks the rider's cached balance inside the transaction so the fee can never overdraw the wallet.
export async function chargeRiderCancellationFee(tx, ride, feeMinor) {
  const amount = Math.max(0, Math.round(feeMinor || 0))
  if (!ride || !ride.driverId || amount <= 0) return { charged: false, reason: 'no_fee' }

  const key = idempotencyKey(['sr-cancel-fee', ride.id])
  const already = await tx.walletEntry.findUnique({ where: { idempotencyKey: key } })
  if (already) return { charged: false, reason: 'already_charged' }

  const wallet = await tx.wallet.findUnique({
    where: { userId_currency: { userId: ride.riderId, currency: ride.currency } },
  })
  if ((wallet?.cachedBalanceMinor || 0) < amount) {
    const error = new Error('Your SYBNB wallet balance is not enough to cover the cancellation fee.')
    error.statusCode = 402
    error.code = 'INSUFFICIENT_CREDIT'
    error.expose = true
    throw error
  }

  await recordWalletEntry(tx, {
    userId: ride.riderId,
    type: 'DEBIT',
    amountMinor: amount,
    currency: ride.currency,
    referenceType: 'sr_cancellation_fee',
    referenceId: ride.id,
    keyParts: ['sr-cancel-fee', ride.id],
    note: 'SR rider late-cancellation fee charged to rider wallet.',
  })
  await recordWalletEntry(tx, {
    userId: ride.driverId,
    type: 'CREDIT',
    amountMinor: amount, // 100% to the driver — show-up compensation, no platform commission on a cancel.
    currency: ride.currency,
    referenceType: 'sr_cancellation_payout',
    referenceId: ride.id,
    keyParts: ['sr-cancel-payout', ride.id],
    note: 'SR driver compensation (100% of the rider cancellation fee).',
  })

  return { charged: true, feeMinor: amount }
}
