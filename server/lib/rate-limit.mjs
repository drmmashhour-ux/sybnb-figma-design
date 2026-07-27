// Configurable rate limiter with two interchangeable stores:
//   - default: in-memory (this process only) — fast, zero-dependency, used for local/dev and tests.
//   - RATE_LIMIT_STORE=db: a shared Postgres counter (checkRateLimitDb) so limits hold across every
//     API instance. REQUIRED on serverless/multi-instance (e.g. Vercel), where each function instance
//     has its own memory and the in-memory buckets would give a client a fresh limit per instance.
// Both stores share the same config/validation helpers and return the exact same result shape; the
// caller (server/index.mjs) picks the store once from RATE_LIMIT_STORE. See
// docs/security/SYBNB_V6_RATE_LIMIT_POLICY.md. The policy (which endpoints, what limits) is unchanged.
//
// Client identification: only trusts a proxy-supplied IP (X-Forwarded-For) when explicitly
// configured to via TRUST_PROXY=1, so a client can't just set that header themselves to reset
// their own limit when there's no real proxy in front of this server (e.g. local dev, or a
// direct-exposed deployment). The production origin must reject direct public traffic (only
// accept connections from the trusted proxy/load balancer) whenever TRUST_PROXY=1 is set —
// otherwise an external client could still forge X-Forwarded-For directly against the origin.

import { db } from './prisma.mjs'

const buckets = new Map()

// Read at call time (isTrustProxyEnabled(), not a module-level const captured at import time).
// server/index.mjs calls loadEnv() to populate process.env from .env *after* its own import
// statements (including this module's) have already executed — a module-level
// `const TRUST_PROXY = process.env.TRUST_PROXY === '1'` would freeze in whatever value was
// present at import time (usually undefined/false), silently ignoring a TRUST_PROXY set only in
// .env. Reading it lazily, on every call, means it always reflects the real current environment.
function isTrustProxyEnabled() {
  return process.env.TRUST_PROXY === '1'
}

// Bounds memory growth: buckets older than this are swept periodically rather than kept forever.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
let sweepTimer = null

function startSweeper() {
  if (sweepTimer || process.env.NODE_ENV === 'test') return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) buckets.delete(key)
    }
  }, SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()
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
      // X-Forwarded-For can carry a comma-separated hop list (client, proxy1, proxy2, ...); Node
      // also joins repeated header instances with ", " before exposing them here, so a single
      // split covers both shapes. The leftmost entry is the original client only under the
      // single-trusted-reverse-proxy topology this flag is designed for — exactly the deployment
      // TRUST_PROXY=1 is meant to describe.
      const first = String(forwardedHeader).split(',')[0]
      const candidate = normalizeIp(first)
      if (isPlausibleIp(candidate)) return candidate
      // Malformed/empty first hop: fall through to the raw socket address rather than trusting it.
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
export function checkRateLimit({ bucketKey, name, defaultMax, defaultWindowMs }) {
  if (process.env.DISABLE_RATE_LIMIT === '1') {
    return { allowed: true, remaining: Infinity, resetAt: 0, retryAfterSeconds: 0 }
  }

  startSweeper()
  const { max, windowMs } = limitConfig(name, defaultMax, defaultWindowMs)
  const now = Date.now()
  const key = `${name}:${bucketKey}`
  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs, retryAfterSeconds: 0 }
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  existing.count += 1
  return { allowed: true, remaining: max - existing.count, resetAt: existing.resetAt, retryAfterSeconds: 0 }
}

// DB-backed fixed-window limiter (RATE_LIMIT_STORE=db). Same interface and return shape as
// checkRateLimit, but the counter lives in a shared table so the limit is enforced across every API
// instance. A SINGLE atomic upsert both resets an expired window and increments within a live one, so
// concurrent requests across instances can't miscount (no read-then-write race). Async, so the caller
// awaits it. The in-memory path stays synchronous and unchanged for local/dev/tests.
export async function checkRateLimitDb({ bucketKey, name, defaultMax, defaultWindowMs }, client = db()) {
  if (process.env.DISABLE_RATE_LIMIT === '1') {
    return { allowed: true, remaining: Infinity, resetAt: 0, retryAfterSeconds: 0 }
  }

  const { max, windowMs } = limitConfig(name, defaultMax, defaultWindowMs)
  const key = `${name}:${bucketKey}`

  // secondsToReset is computed in-DB against now() so it never depends on the DB session timezone
  // (reset_at is a naive `timestamp`; comparing/subtracting via now()::timestamp keeps both operands
  // in the same frame). resetAt is then derived in JS as an offset from local now, so both fields are
  // correct regardless of the server's / database's timezone.
  const rows = await client.$queryRaw`
    INSERT INTO rate_limit_hits ("key", "count", "reset_at")
    VALUES (${key}, 1, now() + (${windowMs}::int * interval '1 millisecond'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN rate_limit_hits."reset_at" <= now() THEN 1 ELSE rate_limit_hits."count" + 1 END,
      "reset_at" = CASE WHEN rate_limit_hits."reset_at" <= now()
                        THEN now() + (${windowMs}::int * interval '1 millisecond')
                        ELSE rate_limit_hits."reset_at" END
    RETURNING "count" AS "count",
              CEIL(EXTRACT(EPOCH FROM ("reset_at" - now()::timestamp)))::int AS "secondsToReset"
  `
  const row = rows[0]
  const count = Number(row.count)
  const secondsToReset = Math.max(0, Number(row.secondsToReset) || 0)
  const resetAt = Date.now() + secondsToReset * 1000

  if (count > max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(1, secondsToReset),
    }
  }

  // Opportunistic cleanup (~1% of allowed calls) so one-off IP keys don't accumulate forever without
  // a scheduler — mirrors the in-memory sweeper's intent. Cheap and best-effort; never blocks a hit.
  if (Math.random() < 0.01) {
    client
      .$executeRaw`DELETE FROM rate_limit_hits WHERE "reset_at" < now() - interval '1 hour'`
      .catch(() => {})
  }

  return { allowed: true, remaining: Math.max(0, max - count), resetAt, retryAfterSeconds: 0 }
}

// Test-only: clears all buckets between test cases so one test's limit exhaustion doesn't bleed
// into the next.
export function __resetRateLimitsForTests() {
  buckets.clear()
}
