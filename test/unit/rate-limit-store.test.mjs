import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// STR launch blocker P0 (distributed rate limiting, 2026-07-22): the in-memory Map in
// server/lib/rate-limit.mjs only works for a single process -- Vercel serverless cold
// starts/concurrent instances each get their own empty Map, so the *effective* limit becomes
// `max x instance count` and an attacker mid-attack gets reset to zero by any cold start. This
// module is the pluggable storage backend checkRateLimit() now delegates to: the existing
// in-memory algorithm for local dev/test (byte-for-byte the same behavior as before), or Upstash
// Redis (via @upstash/ratelimit) when UPSTASH_REDIS_REST_URL/_TOKEN are configured, so a real
// deployment gets one shared, atomic counter regardless of instance count.
//
// No real network access is used anywhere in this file -- the Redis path is exercised entirely
// against __setRedisClientForTests()'s fake client, never a live Upstash connection.

describe('rate-limit-store: backend selection', () => {
  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
  })

  it('selects the in-memory backend when neither Upstash env var is set', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    const { __isUpstashConfiguredForTests } = await import('../../server/lib/rate-limit-store.mjs')
    expect(__isUpstashConfiguredForTests()).toBe(false)
  })

  it('does not select the Redis backend when only one of the two env vars is set', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    const { __isUpstashConfiguredForTests } = await import('../../server/lib/rate-limit-store.mjs')
    expect(__isUpstashConfiguredForTests()).toBe(false)
  })

  it('selects the Redis backend when both Upstash env vars are set', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    const { __isUpstashConfiguredForTests } = await import('../../server/lib/rate-limit-store.mjs')
    expect(__isUpstashConfiguredForTests()).toBe(true)
  })
})

describe('rate-limit-store: in-memory backend (no Upstash env vars set)', () => {
  let checkAndIncrement
  let __resetMemoryStoreForTests

  beforeEach(async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
    ;({ checkAndIncrement, __resetMemoryStoreForTests } = await import('../../server/lib/rate-limit-store.mjs'))
    __resetMemoryStoreForTests()
  })

  it('allows up to max requests, then blocks, for a fixed window', async () => {
    const first = await checkAndIncrement('bucket-a', 3, 60_000)
    const second = await checkAndIncrement('bucket-a', 3, 60_000)
    const third = await checkAndIncrement('bucket-a', 3, 60_000)
    const fourth = await checkAndIncrement('bucket-a', 3, 60_000)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third.allowed).toBe(true)
    expect(fourth.allowed).toBe(false)
    expect(fourth.remaining).toBe(0)
  })

  it('keeps independent keys in independent buckets', async () => {
    expect((await checkAndIncrement('bucket-b', 1, 60_000)).allowed).toBe(true)
    expect((await checkAndIncrement('bucket-b', 1, 60_000)).allowed).toBe(false)
    expect((await checkAndIncrement('bucket-c', 1, 60_000)).allowed).toBe(true)
  })

  it('resets the window after it expires', async () => {
    expect((await checkAndIncrement('bucket-d', 1, 50)).allowed).toBe(true)
    expect((await checkAndIncrement('bucket-d', 1, 50)).allowed).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect((await checkAndIncrement('bucket-d', 1, 50)).allowed).toBe(true)
  })
})

describe('rate-limit-store: Redis backend (fake Ratelimit instance, no real network)', () => {
  let checkAndIncrement
  let __setRatelimitFactoryForTests

  beforeEach(async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    vi.resetModules()
    ;({ checkAndIncrement, __setRatelimitFactoryForTests } = await import('../../server/lib/rate-limit-store.mjs'))
  })

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
  })

  // @upstash/ratelimit's Ratelimit class talks to Redis through its own internal script-eval
  // calls, not a shape this test can easily fake at the Redis-client level without a real
  // connection -- so this exercises the store's *result mapping* by injecting a fake Ratelimit
  // instance factory, rather than faking the lower-level Redis client's eval/multi surface.
  it('maps an allowed Ratelimit result onto {allowed, remaining, resetAt}', async () => {
    const fakeRatelimit = { limit: vi.fn(async () => ({ success: true, limit: 10, remaining: 7, reset: 1_700_000_000_000, pending: Promise.resolve() })) }
    __setRatelimitFactoryForTests(() => fakeRatelimit)
    const result = await checkAndIncrement('user:abc', 10, 60_000)
    expect(result).toEqual({ allowed: true, remaining: 7, resetAt: 1_700_000_000_000 })
  })

  it('maps a denied Ratelimit result onto {allowed: false}', async () => {
    const fakeRatelimit = { limit: vi.fn(async () => ({ success: false, limit: 10, remaining: 0, reset: 1_700_000_060_000, pending: Promise.resolve() })) }
    __setRatelimitFactoryForTests(() => fakeRatelimit)
    const result = await checkAndIncrement('user:abc', 10, 60_000)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.resetAt).toBe(1_700_000_060_000)
  })

  it('propagates a Redis-side failure as a rejected promise (the caller decides fail-open/closed)', async () => {
    const fakeRatelimit = { limit: vi.fn(async () => { throw new Error('upstash unreachable') }) }
    __setRatelimitFactoryForTests(() => fakeRatelimit)
    await expect(checkAndIncrement('user:abc', 10, 60_000)).rejects.toThrow('upstash unreachable')
  })

  it('reuses one Ratelimit instance per distinct (max, windowMs) pair rather than constructing one per call', async () => {
    let constructCount = 0
    const fakeRatelimit = { limit: vi.fn(async () => ({ success: true, limit: 10, remaining: 9, reset: 0, pending: Promise.resolve() })) }
    __setRatelimitFactoryForTests(() => {
      constructCount += 1
      return fakeRatelimit
    })
    await checkAndIncrement('user:a', 10, 60_000)
    await checkAndIncrement('user:b', 10, 60_000) // same (max, windowMs) pair, different key
    await checkAndIncrement('user:a', 5, 60_000) // different max -> new instance expected
    expect(constructCount).toBe(2)
  })
})
