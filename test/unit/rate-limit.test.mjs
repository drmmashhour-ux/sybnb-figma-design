import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRateLimitsForTests, checkRateLimit, clientIp } from '../../server/lib/rate-limit.mjs'

describe('rate-limit: checkRateLimit', () => {
  beforeEach(() => {
    __resetRateLimitsForTests()
  })

  it('allows requests up to the configured max, then blocks', async () => {
    const opts = { bucketKey: 'ip:1.1.1.1', name: 'TEST_A', defaultMax: 3, defaultWindowMs: 60_000 }

    const first = await checkRateLimit(opts)
    const second = await checkRateLimit(opts)
    const third = await checkRateLimit(opts)
    const fourth = await checkRateLimit(opts)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third.allowed).toBe(true)
    expect(fourth.allowed).toBe(false)
    expect(fourth.remaining).toBe(0)
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('resets the window after it expires', async () => {
    const opts = { bucketKey: 'ip:2.2.2.2', name: 'TEST_B', defaultMax: 1, defaultWindowMs: 50 }

    expect((await checkRateLimit(opts)).allowed).toBe(true)
    expect((await checkRateLimit(opts)).allowed).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect((await checkRateLimit(opts)).allowed).toBe(true)
  })

  it('does not let unrelated bucket keys share a limit', async () => {
    const base = { name: 'TEST_C', defaultMax: 1, defaultWindowMs: 60_000 }

    expect((await checkRateLimit({ ...base, bucketKey: 'user:alice' })).allowed).toBe(true)
    // alice is now exhausted, but bob is a completely independent bucket
    expect((await checkRateLimit({ ...base, bucketKey: 'user:alice' })).allowed).toBe(false)
    expect((await checkRateLimit({ ...base, bucketKey: 'user:bob' })).allowed).toBe(true)
  })

  it('does not let unrelated rule names share a limit for the same bucket key', async () => {
    const key = 'ip:3.3.3.3'
    expect((await checkRateLimit({ bucketKey: key, name: 'TEST_D1', defaultMax: 1, defaultWindowMs: 60_000 })).allowed).toBe(true)
    expect((await checkRateLimit({ bucketKey: key, name: 'TEST_D1', defaultMax: 1, defaultWindowMs: 60_000 })).allowed).toBe(false)
    // Different rule name, same underlying bucketKey -> independent bucket.
    expect((await checkRateLimit({ bucketKey: key, name: 'TEST_D2', defaultMax: 1, defaultWindowMs: 60_000 })).allowed).toBe(true)
  })

  it('honors RATE_LIMIT_<NAME>_MAX / _WINDOW_MS env overrides at call time', async () => {
    process.env.RATE_LIMIT_TEST_E_MAX = '2'
    process.env.RATE_LIMIT_TEST_E_WINDOW_MS = '60000'
    try {
      const opts = { bucketKey: 'ip:4.4.4.4', name: 'TEST_E', defaultMax: 100, defaultWindowMs: 60_000 }
      expect((await checkRateLimit(opts)).allowed).toBe(true)
      expect((await checkRateLimit(opts)).allowed).toBe(true)
      expect((await checkRateLimit(opts)).allowed).toBe(false)
    } finally {
      delete process.env.RATE_LIMIT_TEST_E_MAX
      delete process.env.RATE_LIMIT_TEST_E_WINDOW_MS
    }
  })

  it('bypasses the limiter entirely when DISABLE_RATE_LIMIT=1', async () => {
    process.env.DISABLE_RATE_LIMIT = '1'
    try {
      const opts = { bucketKey: 'ip:5.5.5.5', name: 'TEST_F', defaultMax: 1, defaultWindowMs: 60_000 }
      for (let i = 0; i < 5; i += 1) {
        expect((await checkRateLimit(opts)).allowed).toBe(true) // eslint-disable-line no-await-in-loop
      }
    } finally {
      delete process.env.DISABLE_RATE_LIMIT
    }
  })

  describe('invalid RATE_LIMIT_<NAME>_MAX / _WINDOW_MS overrides fall back to the default instead of silently breaking', () => {
    afterEach(() => {
      delete process.env.RATE_LIMIT_TEST_G_MAX
      delete process.env.RATE_LIMIT_TEST_G_WINDOW_MS
    })

    it('a non-numeric MAX override is ignored (falls back to the default, not NaN)', async () => {
      process.env.RATE_LIMIT_TEST_G_MAX = 'not-a-number'
      const opts = { bucketKey: 'ip:6.6.6.1', name: 'TEST_G', defaultMax: 2, defaultWindowMs: 60_000 }
      expect((await checkRateLimit(opts)).allowed).toBe(true)
      expect((await checkRateLimit(opts)).allowed).toBe(true)
      expect((await checkRateLimit(opts)).allowed).toBe(false) // still enforces the default of 2, not unlimited
    })

    it('a zero MAX override is ignored (falls back to the default, not "block everything")', async () => {
      process.env.RATE_LIMIT_TEST_G_MAX = '0'
      const opts = { bucketKey: 'ip:6.6.6.2', name: 'TEST_G', defaultMax: 2, defaultWindowMs: 60_000 }
      expect((await checkRateLimit(opts)).allowed).toBe(true) // would be false immediately if 0 were honored
    })

    it('a negative MAX override is ignored', async () => {
      process.env.RATE_LIMIT_TEST_G_MAX = '-5'
      const opts = { bucketKey: 'ip:6.6.6.3', name: 'TEST_G', defaultMax: 2, defaultWindowMs: 60_000 }
      expect((await checkRateLimit(opts)).allowed).toBe(true)
    })

    it('a non-integer MAX override is ignored', async () => {
      process.env.RATE_LIMIT_TEST_G_MAX = '2.5'
      const opts = { bucketKey: 'ip:6.6.6.4', name: 'TEST_G', defaultMax: 2, defaultWindowMs: 60_000 }
      expect((await checkRateLimit(opts)).allowed).toBe(true)
      expect((await checkRateLimit(opts)).allowed).toBe(true)
      expect((await checkRateLimit(opts)).allowed).toBe(false)
    })

    it('a zero or negative WINDOW_MS override is ignored (falls back to the default)', async () => {
      process.env.RATE_LIMIT_TEST_G_WINDOW_MS = '0'
      const opts = { bucketKey: 'ip:6.6.6.5', name: 'TEST_G', defaultMax: 1, defaultWindowMs: 60_000 }
      expect((await checkRateLimit(opts)).allowed).toBe(true)
      // If windowMs=0 were honored, the bucket would expire instantly and this would also be
      // "allowed" — so additionally confirm the *default* window value is really what's active by
      // checking resetAt is far in the future, not "now".
      const result = await checkRateLimit(opts)
      expect(result.allowed).toBe(false)
      expect(result.resetAt - Date.now()).toBeGreaterThan(50_000)
    })

    it('a valid override still works alongside the validation (regression check)', async () => {
      process.env.RATE_LIMIT_TEST_G_MAX = '3'
      const opts = { bucketKey: 'ip:6.6.6.6', name: 'TEST_G', defaultMax: 100, defaultWindowMs: 60_000 }
      expect((await checkRateLimit(opts)).allowed).toBe(true)
      expect((await checkRateLimit(opts)).allowed).toBe(true)
      expect((await checkRateLimit(opts)).allowed).toBe(true)
      expect((await checkRateLimit(opts)).allowed).toBe(false)
    })
  })
})

// Distributed-store failure handling (STR launch blocker P0, 2026-07-22): exercises the real
// Upstash-configured code path in server/lib/rate-limit-store.mjs against a fake Ratelimit
// instance that throws, rather than mocking server/lib/rate-limit.mjs's own import -- this proves
// the failMode branch in checkRateLimit() actually reacts to a real rejected promise coming out of
// the store module, not just a hand-constructed test double of checkRateLimit's internals.
describe('rate-limit: fail-open / fail-closed when the distributed store is unreachable', () => {
  let __setRatelimitFactoryForTests

  beforeEach(async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    vi.resetModules()
    ;({ __setRatelimitFactoryForTests } = await import('../../server/lib/rate-limit-store.mjs'))
    const failingRatelimit = { limit: vi.fn(async () => { throw new Error('upstash unreachable') }) }
    __setRatelimitFactoryForTests(() => failingRatelimit)
  })

  afterEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
  })

  it('failMode "closed" rejects the request when the store is unreachable', async () => {
    const { checkRateLimit: checkRateLimitFresh } = await import('../../server/lib/rate-limit.mjs')
    const result = await checkRateLimitFresh({
      bucketKey: 'ip:7.7.7.1',
      name: 'TEST_H_CLOSED',
      defaultMax: 5,
      defaultWindowMs: 60_000,
      failMode: 'closed',
    })
    expect(result.allowed).toBe(false)
    expect(result.storeError).toBe(true)
  })

  it('failMode "open" (the default) allows the request through when the store is unreachable', async () => {
    const { checkRateLimit: checkRateLimitFresh } = await import('../../server/lib/rate-limit.mjs')
    const result = await checkRateLimitFresh({
      bucketKey: 'ip:7.7.7.2',
      name: 'TEST_H_OPEN',
      defaultMax: 5,
      defaultWindowMs: 60_000,
    })
    expect(result.allowed).toBe(true)
    expect(result.storeError).toBe(true)
  })

  it('DISABLE_RATE_LIMIT=1 still short-circuits before ever touching the store, regardless of failMode', async () => {
    process.env.DISABLE_RATE_LIMIT = '1'
    try {
      const { checkRateLimit: checkRateLimitFresh } = await import('../../server/lib/rate-limit.mjs')
      const result = await checkRateLimitFresh({
        bucketKey: 'ip:7.7.7.3',
        name: 'TEST_H_DISABLED',
        defaultMax: 1,
        defaultWindowMs: 60_000,
        failMode: 'closed',
      })
      expect(result.allowed).toBe(true)
      expect(result.storeError).toBeUndefined()
    } finally {
      delete process.env.DISABLE_RATE_LIMIT
    }
  })
})

describe('rate-limit: clientIp (trusted-proxy handling, read at call time)', () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY
  })

  it('a direct connection ignores a spoofed X-Forwarded-For header when TRUST_PROXY is unset', () => {
    delete process.env.TRUST_PROXY
    const req = { headers: { 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '127.0.0.1' } }
    expect(clientIp(req)).toBe('127.0.0.1')
  })

  it('trusted-proxy mode uses the forwarded address, set only just before the call (proves call-time, not import-time, reads)', () => {
    // TRUST_PROXY is deliberately left unset until immediately before this call, in the same
    // process/module instance already used by the tests above — this is only possible because
    // clientIp() reads process.env.TRUST_PROXY at call time, not once at module import.
    process.env.TRUST_PROXY = '1'
    const req = { headers: { 'x-forwarded-for': '203.0.113.7' }, socket: { remoteAddress: '127.0.0.1' } }
    expect(clientIp(req)).toBe('203.0.113.7')
  })

  it('handles a multi-hop X-Forwarded-For list by taking the leftmost (client) entry', () => {
    process.env.TRUST_PROXY = '1'
    const req = { headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1, 10.0.0.2' }, socket: { remoteAddress: '10.0.0.2' } }
    expect(clientIp(req)).toBe('198.51.100.4')
  })

  it('falls back to the socket address when the forwarded header is present but malformed', () => {
    process.env.TRUST_PROXY = '1'
    const req = { headers: { 'x-forwarded-for': '   ' }, socket: { remoteAddress: '127.0.0.1' } }
    expect(clientIp(req)).toBe('127.0.0.1')
  })

  it('falls back to the socket address when the forwarded header is missing entirely, even with TRUST_PROXY=1', () => {
    process.env.TRUST_PROXY = '1'
    const req = { headers: {}, socket: { remoteAddress: '127.0.0.1' } }
    expect(clientIp(req)).toBe('127.0.0.1')
  })

  it('handles an IPv4 socket address directly', () => {
    delete process.env.TRUST_PROXY
    const req = { headers: {}, socket: { remoteAddress: '192.168.1.42' } }
    expect(clientIp(req)).toBe('192.168.1.42')
  })

  it('handles a native IPv6 socket address directly', () => {
    delete process.env.TRUST_PROXY
    const req = { headers: {}, socket: { remoteAddress: '2001:db8::1' } }
    expect(clientIp(req)).toBe('2001:db8::1')
  })

  it('normalizes an IPv4-mapped-IPv6 socket address to plain IPv4', () => {
    delete process.env.TRUST_PROXY
    const req = { headers: {}, socket: { remoteAddress: '::ffff:203.0.113.9' } }
    expect(clientIp(req)).toBe('203.0.113.9')
  })

  it('normalizes an IPv4-mapped-IPv6 forwarded address the same way, under trust-proxy mode', () => {
    process.env.TRUST_PROXY = '1'
    const req = { headers: { 'x-forwarded-for': '::ffff:198.51.100.20' }, socket: { remoteAddress: '10.0.0.1' } }
    expect(clientIp(req)).toBe('198.51.100.20')
  })

  it('falls back to "unknown" when neither a trusted header nor a socket address is available', () => {
    const req = { headers: {}, socket: {} }
    expect(clientIp(req)).toBe('unknown')
  })
})
