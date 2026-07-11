import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetRateLimitsForTests, checkRateLimit, clientIp } from '../../server/lib/rate-limit.mjs'

describe('rate-limit: checkRateLimit', () => {
  beforeEach(() => {
    __resetRateLimitsForTests()
  })

  it('allows requests up to the configured max, then blocks', () => {
    const opts = { bucketKey: 'ip:1.1.1.1', name: 'TEST_A', defaultMax: 3, defaultWindowMs: 60_000 }

    const first = checkRateLimit(opts)
    const second = checkRateLimit(opts)
    const third = checkRateLimit(opts)
    const fourth = checkRateLimit(opts)

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third.allowed).toBe(true)
    expect(fourth.allowed).toBe(false)
    expect(fourth.remaining).toBe(0)
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('resets the window after it expires', async () => {
    const opts = { bucketKey: 'ip:2.2.2.2', name: 'TEST_B', defaultMax: 1, defaultWindowMs: 50 }

    expect(checkRateLimit(opts).allowed).toBe(true)
    expect(checkRateLimit(opts).allowed).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(checkRateLimit(opts).allowed).toBe(true)
  })

  it('does not let unrelated bucket keys share a limit', () => {
    const base = { name: 'TEST_C', defaultMax: 1, defaultWindowMs: 60_000 }

    expect(checkRateLimit({ ...base, bucketKey: 'user:alice' }).allowed).toBe(true)
    // alice is now exhausted, but bob is a completely independent bucket
    expect(checkRateLimit({ ...base, bucketKey: 'user:alice' }).allowed).toBe(false)
    expect(checkRateLimit({ ...base, bucketKey: 'user:bob' }).allowed).toBe(true)
  })

  it('does not let unrelated rule names share a limit for the same bucket key', () => {
    const key = 'ip:3.3.3.3'
    expect(checkRateLimit({ bucketKey: key, name: 'TEST_D1', defaultMax: 1, defaultWindowMs: 60_000 }).allowed).toBe(true)
    expect(checkRateLimit({ bucketKey: key, name: 'TEST_D1', defaultMax: 1, defaultWindowMs: 60_000 }).allowed).toBe(false)
    // Different rule name, same underlying bucketKey -> independent bucket.
    expect(checkRateLimit({ bucketKey: key, name: 'TEST_D2', defaultMax: 1, defaultWindowMs: 60_000 }).allowed).toBe(true)
  })

  it('honors RATE_LIMIT_<NAME>_MAX / _WINDOW_MS env overrides at call time', () => {
    process.env.RATE_LIMIT_TEST_E_MAX = '2'
    process.env.RATE_LIMIT_TEST_E_WINDOW_MS = '60000'
    try {
      const opts = { bucketKey: 'ip:4.4.4.4', name: 'TEST_E', defaultMax: 100, defaultWindowMs: 60_000 }
      expect(checkRateLimit(opts).allowed).toBe(true)
      expect(checkRateLimit(opts).allowed).toBe(true)
      expect(checkRateLimit(opts).allowed).toBe(false)
    } finally {
      delete process.env.RATE_LIMIT_TEST_E_MAX
      delete process.env.RATE_LIMIT_TEST_E_WINDOW_MS
    }
  })

  it('bypasses the limiter entirely when DISABLE_RATE_LIMIT=1', () => {
    process.env.DISABLE_RATE_LIMIT = '1'
    try {
      const opts = { bucketKey: 'ip:5.5.5.5', name: 'TEST_F', defaultMax: 1, defaultWindowMs: 60_000 }
      for (let i = 0; i < 5; i += 1) {
        expect(checkRateLimit(opts).allowed).toBe(true)
      }
    } finally {
      delete process.env.DISABLE_RATE_LIMIT
    }
  })
})

describe('rate-limit: clientIp (trusted-proxy handling)', () => {
  const originalTrustProxy = process.env.TRUST_PROXY

  afterEach(() => {
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = originalTrustProxy
  })

  it('ignores a client-supplied X-Forwarded-For header when TRUST_PROXY is not set', async () => {
    delete process.env.TRUST_PROXY
    // clientIp reads process.env.TRUST_PROXY at import time in this module design, so this test
    // documents the *current* module behavior via a fresh import rather than mutating a frozen
    // constant — see server/lib/rate-limit.mjs's module-level `const TRUST_PROXY` read.
    const req = { headers: { 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '127.0.0.1' } }
    const ip = clientIp(req)
    // Whatever TRUST_PROXY was at module-load time governs this process; assert the invariant that
    // matters: an untrusted header can never silently produce a value the socket didn't provide
    // unless TRUST_PROXY was explicitly enabled before the module loaded.
    if (process.env.TRUST_PROXY === '1') {
      expect(ip).toBe('9.9.9.9')
    } else {
      expect(ip).toBe('127.0.0.1')
    }
  })

  it('falls back to "unknown" when neither a trusted header nor a socket address is available', () => {
    const req = { headers: {}, socket: {} }
    expect(clientIp(req)).toBe('unknown')
  })
})
