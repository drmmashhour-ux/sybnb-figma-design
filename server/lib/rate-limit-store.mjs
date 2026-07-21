// Pluggable rate-limit counter storage (STR launch blocker P0, distributed rate limiting,
// 2026-07-22). server/lib/rate-limit.mjs's checkRateLimit() delegates here for the actual "has
// this bucket exceeded its limit" decision -- this module owns ONLY the storage backend choice,
// never the rule table, limits, or byUser/IP keying policy (server/index.mjs, unchanged).
//
// Backend selection: Upstash Redis (via @upstash/ratelimit + @upstash/redis) when
// UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are both set -- the exact two env vars
// @upstash/redis's Redis.fromEnv() reads, auto-injected by the Vercel Marketplace Upstash
// integration. Otherwise, the original in-memory Map algorithm, so local dev and the existing
// test suite need no live Redis connection at all -- this is a straight extraction of what
// server/lib/rate-limit.mjs used to do inline, not a behavior change for that path.
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const memoryBuckets = new Map()
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
let sweepTimer = null

function startSweeper() {
  if (sweepTimer || process.env.NODE_ENV === 'test') return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of memoryBuckets) {
      if (bucket.resetAt < now) memoryBuckets.delete(key)
    }
  }, SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()
}

// Fixed-window counter -- identical algorithm to what server/lib/rate-limit.mjs ran directly
// before this migration (the bucket resets fully at its boundary rather than sliding). Kept
// exactly as-is rather than switched to a stricter sliding-window algorithm, since this migration
// is scoped to the storage backend only, not a policy change.
function checkMemory(key, max, windowMs) {
  startSweeper()
  const now = Date.now()
  const existing = memoryBuckets.get(key)

  if (!existing || existing.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs }
  }
  if (existing.count >= max) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt }
  }
  existing.count += 1
  return { allowed: true, remaining: max - existing.count, resetAt: existing.resetAt }
}

export function __resetMemoryStoreForTests() {
  memoryBuckets.clear()
}

function isUpstashConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
}

export function __isUpstashConfiguredForTests() {
  return isUpstashConfigured()
}

let redisClient = null
function getRedisClient() {
  if (!redisClient) redisClient = Redis.fromEnv()
  return redisClient
}

// server/index.mjs's RATE_LIMIT_RULES carries fixed max/windowMs per rule, and
// RATE_LIMIT_<NAME>_MAX/_WINDOW_MS env overrides are read once per process (they don't change
// mid-process) -- so one Ratelimit instance per distinct (max, windowMs) pair actually used is
// exactly equivalent to one per rule, without this module needing to know rule names at all.
const ratelimitInstances = new Map()

// Overridable in tests so the Redis-backed path can be exercised against a fake Ratelimit
// instance -- @upstash/ratelimit talks to Redis via its own internal Lua/eval calls, not a shape
// that's practical to fake at the raw Redis-client level without a real connection.
let ratelimitFactory = (max, windowMs) =>
  new Ratelimit({
    redis: getRedisClient(),
    // fixedWindow, not slidingWindow: matches checkMemory()'s exact boundary behavior above, so
    // switching backends doesn't silently also change the limiting algorithm's characteristics.
    limiter: Ratelimit.fixedWindow(max, `${windowMs} ms`),
    prefix: 'sybnb-rate-limit',
  })

export function __setRatelimitFactoryForTests(factory) {
  ratelimitFactory = factory
  ratelimitInstances.clear()
}

function getRatelimitInstance(max, windowMs) {
  const cacheKey = `${max}:${windowMs}`
  let instance = ratelimitInstances.get(cacheKey)
  if (!instance) {
    instance = ratelimitFactory(max, windowMs)
    ratelimitInstances.set(cacheKey, instance)
  }
  return instance
}

async function checkRedis(key, max, windowMs) {
  const ratelimit = getRatelimitInstance(max, windowMs)
  const result = await ratelimit.limit(key)
  // pending: background work (multi-region sync/analytics) -- not needed for the allow/deny
  // decision itself; observed, not awaited, so a slow background sync never adds latency to the
  // request path. Errors here are swallowed deliberately: they reflect Upstash's own optional
  // analytics plumbing, not this application's rate-limit decision.
  result.pending?.catch?.(() => {})
  return { allowed: result.success, remaining: result.remaining, resetAt: result.reset }
}

// Single entry point server/lib/rate-limit.mjs calls. Returns { allowed, remaining, resetAt } --
// the exact shape the in-memory implementation always returned. Can reject (e.g. Upstash
// unreachable) -- the caller (checkRateLimit) decides fail-open vs fail-closed per rule, this
// module never swallows a real storage failure into a false "allowed".
export async function checkAndIncrement(key, max, windowMs) {
  if (isUpstashConfigured()) return checkRedis(key, max, windowMs)
  return checkMemory(key, max, windowMs)
}
