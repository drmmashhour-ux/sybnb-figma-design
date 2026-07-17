// SR fleet policy (020) — vehicle eligibility (Uber-style model-year cap per tier) and driver standing.
// All server-side and tunable here. Modeled on Uber's vehicle requirements: a model-year cap that is
// stricter for premium tiers, plus valid plate/registration and admin approval before a car can work.
//
// The founder rule: standard (Economy) trips require a car no older than 10 years; premium tiers newer.
export const SR_VEHICLE_CATEGORIES = ['SR Economy', 'SR Comfort', 'SR SUV']

export const VEHICLE_AGE_LIMITS = {
  'SR Economy': 10, // standard trips — no older than 10 model years
  'SR Comfort': 7, // premium comfort — newer cars only
  'SR SUV': 7, // premium SUV — newer cars only
}

// A model year older than this is almost certainly a typo / not a real rideshare vehicle.
const OLDEST_PLAUSIBLE_YEAR = 1980

// Throws a 400 the driver can act on if the vehicle can't be admitted to the fleet for its category.
// Uses the real calendar year at call time (server runtime), so the 10-year window rolls forward.
export function assertVehicleEligible(vehicle, now = new Date()) {
  const category = String(vehicle?.category || '')
  if (!SR_VEHICLE_CATEGORIES.includes(category)) {
    fail(`Vehicle category must be one of: ${SR_VEHICLE_CATEGORIES.join(', ')}.`, 'VEHICLE_CATEGORY_INVALID')
  }
  const year = Number(vehicle?.year)
  const currentYear = now.getFullYear()
  if (!Number.isInteger(year) || year < OLDEST_PLAUSIBLE_YEAR || year > currentYear + 1) {
    fail('Vehicle year must be a valid model year.', 'VEHICLE_YEAR_INVALID')
  }
  const maxAge = VEHICLE_AGE_LIMITS[category]
  const age = currentYear - year
  if (age > maxAge) {
    const error = new Error(
      `A ${category} vehicle must be no older than ${maxAge} years. A ${year} model is ${age} years old and cannot be used for these trips.`,
    )
    error.statusCode = 400
    error.code = 'VEHICLE_TOO_OLD'
    error.expose = true
    error.details = { category, year, age, maxAge }
    throw error
  }
  return { category, year, age, maxAge }
}

// Derived driver standing from raw counts (the route does the DB aggregates and passes them in, so this
// stays a pure, unit-testable function). completionRate/cancellationRate are over decided rides only —
// rides the driver either completed or cancelled — which is the denominator a fleet policy acts on.
export function computeDriverStanding({ ratingAvg = null, ratingCount = 0, completedRides = 0, driverCancellations = 0 } = {}) {
  const decided = completedRides + driverCancellations
  const completionRate = decided > 0 ? Math.round((completedRides / decided) * 1000) / 1000 : null
  const cancellationRate = decided > 0 ? Math.round((driverCancellations / decided) * 1000) / 1000 : null
  return {
    rating: { average: ratingCount > 0 ? Math.round((ratingAvg || 0) * 10) / 10 : null, count: ratingCount },
    completedRides,
    cancellations: driverCancellations,
    completionRate,
    cancellationRate,
  }
}

function fail(message, code) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  throw error
}
