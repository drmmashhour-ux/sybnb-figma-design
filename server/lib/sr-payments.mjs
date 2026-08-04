import { idempotencyKey } from './security.mjs'
import { recordWalletEntry, lockWalletForSpend } from './finance-ledger.mjs'

// Platform keeps 15% of every SR ride; the driver keeps 85%. The commission is a finance/admin
// figure only — it is derived here and recorded to the ledger, and never placed on any rider-facing
// payload (see the ride handlers, which return the RideRequest row whose only money field is the
// fare the rider actually pays).
export const SR_ADMIN_COMMISSION_RATE = 0.15

// A ride is "held" against the rider's wallet while a driver is committed to it. Reservation is
// derived from ride state (see riderReservedMinor) — the source of truth is the ride's own status,
// not a wallet RELEASE entry, because RELEASE credits the wallet and a payer-side hold must never
// hand the rider money back on completion (the fare DEBIT is what settles the hold).
export const SR_HELD_RIDE_STATUSES = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS']

// Splits a whole-currency fare (see currency.mjs — amountMinor is whole units, not cents) into the
// driver's 85% and the platform's 15%. adminCommissionMinor is the exact remainder of the fare so
// driverEarningMinor + adminCommissionMinor === fareMinor with no rounding drift — this is the
// money-safety invariant "driver credit + platform commission == fare".
export function srRideFinanceSplit(fareMinor) {
  const fare = Math.max(0, Math.round(fareMinor || 0))
  const driverEarningMinor = Math.round(fare * (1 - SR_ADMIN_COMMISSION_RATE))
  const adminCommissionMinor = fare - driverEarningMinor
  return { fareMinor: fare, driverEarningMinor, adminCommissionMinor }
}

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

  // Serialize concurrent spends on this rider's wallet before the balance re-check below.
  await lockWalletForSpend(tx, ride.riderId, ride.currency)

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

  const split = srRideFinanceSplit(fareMinor)

  // Resolve accounting before moving any money. If the platform account is missing, completing
  // the ride would otherwise debit 100% from the rider and credit only 85% to the driver, leaving
  // the commission unaccounted for. Throwing rolls back the surrounding status transition too.
  const platformUserId = await resolvePlatformUserId(tx)
  if (!platformUserId) {
    const error = new Error('Platform accounting account is not configured.')
    error.statusCode = 503
    error.code = 'PLATFORM_ACCOUNT_MISSING'
    error.expose = true
    throw error
  }

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
  })

  // 2. CREDIT the driver their 85% earning (accrues in the driver wallet until admin payout).
  if (ride.driverId) {
    await recordWalletEntry(tx, {
      userId: ride.driverId,
      type: 'CREDIT',
      amountMinor: split.driverEarningMinor,
      currency: ride.currency,
      referenceType: 'sr_driver_earning',
      referenceId: ride.id,
      keyParts: ['sr-driver-earning', ride.id],
      note: 'SR driver earning (85%) accrued on ride completion.',
    })
  }

  // 3. Record the 15% platform commission as a CREDIT to the platform admin wallet (same shape as
  //    STR booking_admin_share). In production an ADMIN always exists; if none does, the commission
  //    simply isn't recorded (matching approvePaymentProof's conditional admin credit).
  await recordWalletEntry(tx, {
    userId: platformUserId,
    type: 'CREDIT',
    amountMinor: split.adminCommissionMinor,
    currency: ride.currency,
    referenceType: 'sr_admin_commission',
    referenceId: ride.id,
    keyParts: ['sr-admin-commission', ride.id],
    note: 'SYBNB SR platform commission (15%) collected on ride completion.',
  })

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
  // Sanity ceiling so a malformed/fat-finger amountMinor from a direct API call can't record an absurd
  // tip: at most 5× the fare, with a floor so tiny fares still allow a normal tip. (The wallet-balance
  // gate below already prevents an overdraw; this is a defence-in-depth bound on intent.)
  const tipCeiling = Math.max((ride.fareMinor || 0) * 5, 500_000)
  if (amount > tipCeiling) {
    const error = new Error('That tip is unusually large. Please enter a smaller amount.')
    error.statusCode = 400
    error.code = 'TIP_AMOUNT_TOO_LARGE'
    error.expose = true
    throw error
  }

  // Serialize concurrent spends on this rider's wallet before the balance re-check below.
  await lockWalletForSpend(tx, ride.riderId, ride.currency)

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

  // Serialize concurrent spends on this rider's wallet before the balance re-check below.
  await lockWalletForSpend(tx, ride.riderId, ride.currency)

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
