// Configurable, in-memory sliding-window rate limiter.
//
// Single-instance only: buckets live in this process's memory. This is documented explicitly
// (see docs/security/SYBNB_V6_RATE_LIMIT_POLICY.md) rather than silently assumed — running more
// than one API process/container behind a load balancer would let a client get a fresh limit per
// instance. A production multi-instance deployment needs a shared store (Redis or equivalent)
// instead of this module; the *policy* (which endpoints, what limits) carries over unchanged.
//
// Client identification: only trusts a proxy-supplied IP (X-Forwarded-For) when explicitly
// configured to via TRUST_PROXY=1, so a client can't just set that header themselves to reset
// their own limit when there's no real proxy in front of this server (e.g. local dev, or a
// direct-exposed deployment).

const buckets = new Map()
const TRUST_PROXY = process.env.TRUST_PROXY === '1'

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

export function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for']
    if (forwarded) return String(forwarded).split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

// windowMs/max are read at call time (not module load time) so tests can override
// process.env.RATE_LIMIT_* per-test without needing to re-import the module.
function limitConfig(name, defaultMax, defaultWindowMs) {
  const max = Number(process.env[`RATE_LIMIT_${name}_MAX`] || defaultMax)
  const windowMs = Number(process.env[`RATE_LIMIT_${name}_WINDOW_MS`] || defaultWindowMs)
  return { max, windowMs }
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

// Test-only: clears all buckets between test cases so one test's limit exhaustion doesn't bleed
// into the next.
export function __resetRateLimitsForTests() {
  buckets.clear()
}
