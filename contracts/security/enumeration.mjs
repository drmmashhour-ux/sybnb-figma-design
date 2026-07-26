// Platform Contract Kit — security check: account-enumeration resistance + rate limiting.
//
// An enumeration oracle leaks whether an identifier (email/phone/username) EXISTS by making the response
// differ for an existing vs non-existent one. Compare only the STATUS + the SET of top-level body keys
// (never values) — that is exactly what an oracle would expose. A pre-auth endpoint (code-send,
// password-reset, login) is enumeration-safe when a seeded and a fresh identifier produce the same shape.
//
// Pair with a rate-limit assertion: past the per-identifier / per-IP limit the endpoint returns 429 (a
// fail-CLOSED limiter), so brute force and enumeration are both throttled. When you probe existence, use a
// FRESH identifier each time and control for the rate limit, or a 429 from a reused identifier will mask
// the signal (that confound is what made SYBNB's first enumeration probe inconclusive).

export function bodyShape(res) {
  return { status: res.status, keys: Object.keys(res.body || {}).sort() }
}

// True when two responses are indistinguishable at the shape level (same status + same top-level key set).
export function sameResponseShape(a, b) {
  const sa = bodyShape(a)
  const sb = bodyShape(b)
  return sa.status === sb.status && JSON.stringify(sa.keys) === JSON.stringify(sb.keys)
}
