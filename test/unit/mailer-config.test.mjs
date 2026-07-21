import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isMailerConfigured } from '../../server/lib/mailer.mjs'

// Resend hardening item 2: mailer configuration detection must read process.env at CALL time, not
// capture it as a module-level constant at import. On Vercel, platform env is present before import
// so a const would work; but for local `node server/index.mjs` (loadEnv runs AFTER imports) and for
// the production boot-guard (item 1) to be reliable and unit-testable, detection must be call-time.
const KEYS = ['EMAIL_PROVIDER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']

describe('isMailerConfigured — call-time env reads', () => {
  const snap = {}
  beforeEach(() => { for (const k of KEYS) { snap[k] = process.env[k]; delete process.env[k] } })
  afterEach(() => { for (const [k, v] of Object.entries(snap)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

  it('false when nothing is configured', () => {
    expect(isMailerConfigured()).toBe(false)
  })

  it('flips to true after RESEND_API_KEY is set AFTER import (proves call-time read)', () => {
    expect(isMailerConfigured()).toBe(false)
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test_key'
    expect(isMailerConfigured()).toBe(true)
  })

  it('resend provider requires the API key', () => {
    process.env.EMAIL_PROVIDER = 'resend'
    expect(isMailerConfigured()).toBe(false)
  })

  it('detects SMTP by SMTP_HOST at call time', () => {
    process.env.SMTP_HOST = 'smtp.example.test'
    expect(isMailerConfigured()).toBe(true)
  })
})
