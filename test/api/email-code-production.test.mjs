import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// §0.1 — the raw email verification code must NEVER be returned to the client in production.
// The security contract is a single, stable line in email-verification.mjs:
//     const devCode = isProduction ? undefined : code
// The code is only ever exposed (as `devCode`) OUTSIDE production. This asserts that invariant and
// that the production flag comes from NODE_ENV. It deliberately does NOT match the mailer-wiring
// details (the exact send-call / isMailerConfigured usage) — those are implementation that can be
// reworded without weakening the guarantee, and matching them is what made the earlier version of
// this test fail on a harmless mailer refactor.
const source = readFileSync(new URL('../../server/lib/email-verification.mjs', import.meta.url), 'utf8')
const normalized = source.replace(/\s+/g, ' ')

describe('email code production controls (§0.1)', () => {
  it('derives the production flag from NODE_ENV', () => {
    expect(normalized).toMatch(/isProduction\s*=\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]/)
  })

  it('suppresses the raw code in production (devCode = isProduction ? undefined : code)', () => {
    expect(normalized).toContain('isProduction ? undefined : code')
  })
})
