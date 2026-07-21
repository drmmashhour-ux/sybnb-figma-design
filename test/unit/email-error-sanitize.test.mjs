import { describe, expect, it } from 'vitest'
import { sanitizeEmailError } from '../../server/lib/mailer.mjs'

// Resend hardening item 5: production email-failure responses must never expose Resend URLs, status
// text, provider messages, API details, or stack traces. In dev/staging the detail is retained for
// debugging. sanitizeEmailError builds the user-facing message string used by the thrown 502.

describe('sanitizeEmailError', () => {
  it('returns a generic message in production with no provider detail', () => {
    const raw = 'Resend request failed (401) at https://api.resend.com/emails: invalid api key'
    const out = sanitizeEmailError(raw, { isProduction: true })
    expect(out).not.toMatch(/resend/i)
    expect(out).not.toContain('https://')
    expect(out).not.toContain('401')
    expect(out).not.toContain('api key')
    expect(out.length).toBeGreaterThan(0)
  })

  it('preserves the detailed message outside production', () => {
    const raw = 'Resend request failed (503)'
    expect(sanitizeEmailError(raw, { isProduction: false })).toBe(raw)
  })

  it('still produces a non-empty generic message when the raw detail is missing', () => {
    expect(sanitizeEmailError(undefined, { isProduction: true }).length).toBeGreaterThan(0)
  })
})
