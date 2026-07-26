// Configurable rate limiter. Storage is now pluggable (server/lib/rate-limit-store.mjs): the
// original in-memory Map for local dev/test, or distributed Upstash Redis in any deployment where
// UPSTASH_REDIS_REST_URL/_TOKEN are configured (STR launch blocker P0, distributed rate limiting,
// 2026-07-22). See docs/security/SYBNB_V6_RATE_LIMIT_POLICY.md for the full architecture,
// including why the in-memory-only version was a real defect under Vercel serverless (each cold
// start / concurrent instance got its own empty Map, so the effective limit became
// `max x instance count`, and any cold start reset an in-progress attacker to zero for free).
//
// Client identification: only trusts a proxy-supplied IP (X-Forwarded-For) when explicitly
// configured to via TRUST_PROXY=1, so a client can't just set that header themselves to reset
// their own limit when there's no real proxy in front of this server (e.g. local dev, or a
// direct-exposed deployment). The production origin must reject direct public traffic (only
// accept connections from the trusted proxy/load balancer) whenever TRUST_PROXY=1 is set —
// otherwise an external client could still forge X-Forwarded-For directly against the origin.
import { checkAndIncrement, __resetMemoryStoreForTests } from './rate-limit-store.mjs'

// Read at call time (isTrustProxyEnabled(), not a module-level const captured at import time).
// server/index.mjs calls loadEnv() to populate process.env from .env *after* its own import
// statements (including this module's) have already executed — a module-level
// `const TRUST_PROXY = process.env.TRUST_PROXY === '1'` would freeze in whatever value was
// present at import time (usually undefined/false), silently ignoring a TRUST_PROXY set only in
// .env. Reading it lazily, on every call, means it always reflects the real current environment.
function isTrustProxyEnabled() {
  return process.env.TRUST_PROXY === '1'
}

// Number of TRUSTED proxy hops between the client and this origin. Default 1 (the single Vercel/Cloudflare
// edge — the topology TRUST_PROXY=1 describes). Each trusted proxy APPENDS the address it received the
// connection from to X-Forwarded-For, so the real client is the Nth entry FROM THE RIGHT; everything to its
// left is client-supplied and untrustworthy. Override with TRUST_PROXY_HOPS only if the real deployment puts
// more than one trusted proxy in front of the origin (e.g. Cloudflare → Vercel = 2).
function trustedProxyHopCount() {
  return safePositiveInt(process.env.TRUST_PROXY_HOPS, 1)
}

// Strips the IPv4-mapped-IPv6 prefix (::ffff:x.x.x.x -> x.x.x.x) so the same real client always
// buckets identically regardless of whether the server is bound IPv4-only or dual-stack. See
// docs/security/SYBNB_V6_RATE_LIMIT_POLICY.md's IPv4/IPv6 section for why this matters.
function normalizeIp(value) {
  if (!value) return value
  const trimmed = String(value).trim()
  if (trimmed.toLowerCase().startsWith('::ffff:')) return trimmed.slice(7)
  return trimmed
}

// Very loose shape check on a client-controlled header value before trusting it as an IP — just
// enough to reject obviously-garbage input (e.g. an empty string, or something that clearly isn't
// an IPv4/IPv6 literal), not a full RFC validator.
function isPlausibleIp(value) {
  if (!value) return false
  if (value.length > 45) return false
  return /^[0-9a-fA-F:.]+$/.test(value)
}

export function clientIp(req) {
  if (isTrustProxyEnabled()) {
    const forwardedHeader = req.headers['x-forwarded-for']
    if (forwardedHeader) {
      // X-Forwarded-For is a hop list (client, proxy1, proxy2, ...); Node also joins repeated header
      // instances with ", " before exposing them here, so a single split covers both shapes. Take the
      // RIGHT-anchored trusted hop — the Nth entry from the right for `trustedProxyHopCount()` trusted
      // proxies (1 for the Vercel/Cloudflare edge) — NOT the leftmost. The trusted edge appends the real
      // client IP as the last hop; anything the client PREPENDS sits to the left and is ignored, so an
      // attacker can't rotate a spoofed leftmost value to mint a fresh per-IP bucket and evade the limit.
      const parts = String(forwardedHeader).split(',')
      const trusted = parts[parts.length - trustedProxyHopCount()] // undefined if fewer hops than expected
      const candidate = normalizeIp(trusted !== undefined ? trusted : '')
      if (isPlausibleIp(candidate)) return candidate
      // Malformed/empty/absent trusted hop: fall through to the raw socket address rather than trusting it.
    }
  }
  return normalizeIp(req.socket?.remoteAddress) || 'unknown'
}

// windowMs/max are read at call time (not module load time) so tests can override
// process.env.RATE_LIMIT_* per-test without needing to re-import the module.
//
// Non-numeric, zero, or negative overrides are rejected in favor of the caller's default rather
// than silently accepted — Number('') is 0, Number('abc') is NaN, and either passed straight
// through would previously have produced a limiter with max=0 (blocks every request) or max=NaN
// (every comparison against NaN is false, so the limiter would allow unlimited requests) purely
// from a typo in an environment variable.
function limitConfig(name, defaultMax, defaultWindowMs) {
  const max = safePositiveInt(process.env[`RATE_LIMIT_${name}_MAX`], defaultMax)
  const windowMs = safePositiveInt(process.env[`RATE_LIMIT_${name}_WINDOW_MS`], defaultWindowMs)
  return { max, windowMs }
}

// Exported so validateProductionConfig() (server/lib/env.mjs) can apply the exact same
// numeric-validity rule when checking every configured RATE_LIMIT_* override at startup, instead
// of duplicating a slightly different definition of "valid" in two places.
export function safePositiveInt(rawValue, fallback) {
  if (rawValue === undefined || rawValue === '') return fallback
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

// Returns { allowed, remaining, resetAt, retryAfterSeconds }. Does not throw — callers decide how
// to respond, matching this codebase's existing error-shape conventions instead of a middleware
// framework's throw-to-reject-request pattern.
//
// failMode ('open' | 'closed', default 'open'): what to do if the distributed store itself is
// unreachable (e.g. Upstash outage) -- a decision made once per rule in server/index.mjs's
// RATE_LIMIT_RULES, not here. 'closed' rejects the request when the store can't be reached
// (used for pre-auth abuse-prone endpoints: login, register, OTP send/verify); 'open' allows it
// through (used for already-authenticated business actions and public browsing/search), so a
// storage-layer outage degrades into "temporarily unlimited" rather than "site down" for those
// routes. See docs/security/SYBNB_V6_RATE_LIMIT_POLICY.md for the full policy and rationale.
// This can never happen on the in-memory backend (a plain Map read/write does not fail), so it is
// only ever exercised when UPSTASH_REDIS_REST_URL/_TOKEN are configured.
export async function checkRateLimit({ bucketKey, name, defaultMax, defaultWindowMs, failMode = 'open' }) {
  if (process.env.DISABLE_RATE_LIMIT === '1') {
    return { allowed: true, remaining: Infinity, resetAt: 0, retryAfterSeconds: 0 }
  }

  const { max, windowMs } = limitConfig(name, defaultMax, defaultWindowMs)
  const now = Date.now()
  const key = `${name}:${bucketKey}`

  let result
  try {
    result = await checkAndIncrement(key, max, windowMs)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[rate-limit] store unreachable for rule "${name}" (failMode=${failMode}):`, error)
    if (failMode === 'closed') {
      return {
        allowed: false,
        remaining: 0,
        resetAt: now + windowMs,
        retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
        storeError: true,
      }
    }
    return { allowed: true, remaining: max, resetAt: now + windowMs, retryAfterSeconds: 0, storeError: true }
  }

  if (!result.allowed) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: result.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt - now) / 1000)),
    }
  }
  return { allowed: true, remaining: result.remaining, resetAt: result.resetAt, retryAfterSeconds: 0 }
}

// Test-only: clears all buckets between test cases so one test's limit exhaustion doesn't bleed
// into the next. Delegates to the store module since the in-memory Map now lives there.
export function __resetRateLimitsForTests() {
  __resetMemoryStoreForTests()
}
