import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendVerificationCodeEmail } from '../../server/lib/mailer.mjs'

// Resend hardening items 3 & 4: the Resend HTTP call must have an explicit AbortController timeout
// and bounded retry for TRANSIENT failures only (network error, timeout, HTTP 429, HTTP 5xx) —
// never for an ordinary 4xx. SMTP path untouched. Mocked global fetch, no network, no DB.
const KEYS = ['EMAIL_PROVIDER', 'RESEND_API_KEY', 'EMAIL_SEND_TIMEOUT_MS', 'EMAIL_MAX_ATTEMPTS', 'EMAIL_RETRY_BASE_MS']

describe('Resend delivery — timeout + transient-only retry', () => {
  const snap = {}
  const realFetch = globalThis.fetch

  beforeEach(() => {
    for (const k of KEYS) { snap[k] = process.env[k]; delete process.env[k] }
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test_key'
    process.env.EMAIL_RETRY_BASE_MS = '0' // fast, deterministic
    process.env.EMAIL_MAX_ATTEMPTS = '3'
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    for (const [k, v] of Object.entries(snap)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  })

  it('resolves on 2xx and sends a single request with a timeout signal + Bearer auth', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'email_1' }) }))
    globalThis.fetch = fetchMock
    await expect(sendVerificationCodeEmail('guest@example.test', '123456')).resolves.toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(options.headers.Authorization).toBe('Bearer re_test_key')
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('does NOT retry an ordinary 4xx — fails after one attempt', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ message: 'invalid recipient' }) }))
    globalThis.fetch = fetchMock
    await expect(sendVerificationCodeEmail('guest@example.test', '123456')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a transient 503 then succeeds', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls += 1
      return calls < 2 ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ id: 'ok' }) }
    })
    await expect(sendVerificationCodeEmail('guest@example.test', '123456')).resolves.toBeDefined()
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('retries a 429 as transient', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls += 1
      return calls < 3 ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ id: 'ok' }) }
    })
    await expect(sendVerificationCodeEmail('guest@example.test', '123456')).resolves.toBeDefined()
    expect(globalThis.fetch).toHaveBeenCalledTimes(3)
  })

  it('gives up after EMAIL_MAX_ATTEMPTS transient failures', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    globalThis.fetch = fetchMock
    await expect(sendVerificationCodeEmail('guest@example.test', '123456')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retries a network error', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNRESET') })
    globalThis.fetch = fetchMock
    await expect(sendVerificationCodeEmail('guest@example.test', '123456')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('aborts and throws a timeout error when Resend hangs past EMAIL_SEND_TIMEOUT_MS', async () => {
    process.env.EMAIL_SEND_TIMEOUT_MS = '20'
    process.env.EMAIL_MAX_ATTEMPTS = '1'
    const fetchMock = vi.fn((url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }))
    globalThis.fetch = fetchMock
    await expect(sendVerificationCodeEmail('guest@example.test', '123456')).rejects.toThrow(/timed out/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
