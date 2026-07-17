// SR cancellation policy (019) — Uber-style, all server-side and tunable here.
//
// Rider cancels:
//   - FREE before a driver is matched, or within the grace window after matching.
//   - After the grace window (driver assigned / en route, trip NOT started): a fee is charged and paid
//     100% to the assigned driver as compensation for showing up. The platform takes no commission on a
//     cancellation (no completed service), consistent with the driver-friendly tip model.
//   - NOT allowed once the trip is IN_PROGRESS (the ride must complete, or SOS is used).
// Driver cancels: no rider charge; the ride is re-dispatched to the pool and the cancellation is recorded.
//
// Amounts are whole currency units (see currency.mjs). Tune these before/after launch as real usage lands.
export const SR_CANCELLATION_CONFIG = {
  graceWindowSeconds: 120, // 2 minutes after a driver is matched — a free change-of-mind window.
  feeRate: 0.25, // rider late-cancel fee = 25% of the quoted fare...
  minFeeMinor: 5000, // ...but at least 5,000 SYP (roughly the driver's minimum show-up compensation)...
  maxFeeMinor: 20000, // ...and never more than 20,000 SYP.
  roundToMinor: 500, // rounded to the nearest 500, matching the fare rounding in sr-geocoding.
}

// Statuses where a driver is committed but the trip has not started — the window a late-cancel fee lives in.
const DRIVER_MATCHED_PRETRIP = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING']

// The late-cancel fee for a given fare: feeRate of the fare, clamped to [min, max], rounded to roundToMinor.
export function computeRiderCancelFee(fareMinor, config = SR_CANCELLATION_CONFIG) {
  const fare = Math.max(0, Math.round(fareMinor || 0))
  const raw = fare * config.feeRate
  const clamped = Math.min(config.maxFeeMinor, Math.max(config.minFeeMinor, raw))
  const rounded = Math.round(clamped / config.roundToMinor) * config.roundToMinor
  // Never charge more than the fare itself for a very short ride.
  return Math.min(rounded, fare || rounded)
}

// Decide what happens when a RIDER cancels `ride` at time `now`.
// Returns one of:
//   { allowed:false, code, statusCode, message }                          -> reject the cancel
//   { allowed:true, free:true, feeMinor:0 }                               -> cancel, no charge
//   { allowed:true, free:false, feeMinor:N }                              -> cancel, charge N to the driver
export function riderCancelOutcome(ride, now = new Date(), config = SR_CANCELLATION_CONFIG) {
  const status = ride.status
  if (status === 'REQUESTED' || status === 'MATCHING') {
    return { allowed: true, free: true, feeMinor: 0 } // no driver committed yet
  }
  if (status === 'IN_PROGRESS') {
    return {
      allowed: false,
      statusCode: 400,
      code: 'RIDE_ALREADY_STARTED',
      message: 'The trip has already started and can no longer be cancelled.',
    }
  }
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return {
      allowed: false,
      statusCode: 409,
      code: 'RIDE_NOT_CANCELLABLE',
      message: 'This ride can no longer be cancelled.',
    }
  }
  if (DRIVER_MATCHED_PRETRIP.includes(status)) {
    const matchedAt = ride.driverMatchedAt ? new Date(ride.driverMatchedAt).getTime() : null
    const withinGrace = matchedAt !== null && now.getTime() - matchedAt < config.graceWindowSeconds * 1000
    if (withinGrace) return { allowed: true, free: true, feeMinor: 0 }
    return { allowed: true, free: false, feeMinor: computeRiderCancelFee(ride.fareMinor, config) }
  }
  // Any other (unexpected) status: refuse rather than guess.
  return { allowed: false, statusCode: 409, code: 'RIDE_NOT_CANCELLABLE', message: 'This ride can no longer be cancelled.' }
}
