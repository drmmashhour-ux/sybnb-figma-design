// SYB-008 — STR-only closed-beta division isolation, API-entry layer (the authoritative gate).
//
// The closed beta ships only the Stays (STR) division. Navigation and client routing hide the others,
// but a hidden card is not a control — a direct hash URL or a raw API call must still be refused. This
// module is that refusal, applied at the request dispatcher BEFORE any route handler runs, so it never
// reaches into a frozen Ride/Québec module's internals.
//
// Two gated surfaces:
//   1. Whole gated divisions with their own API families — Ride/SR (`/api/driver`, `/api/sr`). Refused
//      at the dispatcher. Admin routes are intentionally NOT gated: staff oversight must keep working.
//   2. Listing-based divisions sharing `/api/listings` (Rentals/Buy/Cars/Marketplace/New Construction/
//      Sell) — gated by their `division` parameter via isDivisionActive() inside listings.mjs.
//
// Test configuration: the SR test suite drives `/api/driver` and `/api/sr` directly. The gate is
// therefore relaxed only under an EXPLICIT flag (CLOSED_BETA_ALLOW_GATED_ROUTES=1), set for the test
// environment in test/support/setup.env.mjs. Beta and production leave it unset, so the gate enforces.

const DEFAULT_ACTIVE_DIVISIONS = ['STAYS']

// Ride/SR API families. Admin (`/api/admin/...`) is deliberately excluded — staff must retain access.
const GATED_API_PREFIXES = ['/api/driver', '/api/sr']

export const CLOSED_BETA_DIVISION_CODE = 'CLOSED_BETA_DIVISION_UNAVAILABLE'
export const CLOSED_BETA_DIVISION_MESSAGE =
  'This section is not available during the SYBNB closed beta. Only Stays (STR) is active.'

export function activeDivisions(env = process.env) {
  const raw = env.CLOSED_BETA_ACTIVE_DIVISIONS
  if (raw && String(raw).trim()) {
    return new Set(String(raw).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
  }
  return new Set(DEFAULT_ACTIVE_DIVISIONS)
}

export function isDivisionActive(division, env = process.env) {
  return activeDivisions(env).has(String(division || '').toUpperCase())
}

// Gated routes are refused unless the explicit test flag is set.
export function gatedRoutesAllowed(env = process.env) {
  return env.CLOSED_BETA_ALLOW_GATED_ROUTES === '1'
}

// True when a request path belongs to a gated division API family and the gate is enforced.
export function closedBetaRouteBlocked(pathname, env = process.env) {
  if (gatedRoutesAllowed(env)) return false
  return GATED_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

// Throwable form for use inside a route handler that has a division parameter (listings.mjs).
export function assertDivisionActiveForBeta(division, env = process.env) {
  if (isDivisionActive(division, env) || gatedRoutesAllowed(env)) return
  const error = new Error(CLOSED_BETA_DIVISION_MESSAGE)
  error.statusCode = 403
  error.code = CLOSED_BETA_DIVISION_CODE
  error.expose = true
  throw error
}
