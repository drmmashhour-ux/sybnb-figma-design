import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../server/lib/email-verification.mjs', import.meta.url), 'utf8')

describe('email code production controls', () => {
  it('does not expose devCode in production', () => {
    expect(source).toContain("process.env.NODE_ENV === 'production'")
    expect(source).toContain('const devCode = isProduction ? undefined : code')
  })

  it('only sends real email in production when mailer is configured', () => {
    expect(source).toContain('isProduction && isMailerConfigured()')
    expect(source).toContain('sendVerificationCodeEmail(normalized, code)')
  })
})
