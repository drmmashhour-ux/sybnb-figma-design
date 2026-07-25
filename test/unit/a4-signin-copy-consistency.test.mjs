import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A4 (Finding 2) — the gate COPY must match the sign-in BEHAVIOR. The server requires a 'staff-login'
// OTP for every non-guest (staff) sign-in (asserted in test/api/a4-signin-otp-behavior.test.mjs), so
// the AccountGateCapsule must: (a) require the verification/code step on sign-in for staff actors, and
// (b) only ever show the "no verification code" note to a guest (where it is true). This guards the
// copy↔behavior alignment so a future edit can't reintroduce the contradiction.

const capsule = readFileSync(new URL('../../src/shared/capsules/AccountGateCapsule.tsx', import.meta.url), 'utf8')

describe('A4 — sign-in gate copy matches behavior (staff sign-in shows the code step; guest sees "no code")', () => {
  it('the code/verification step is required on sign-in for staff (non-guest) actors', () => {
    expect(capsule).toMatch(/signInNeedsCode\s*=\s*actor\s*!==\s*'guest'/)
    expect(capsule).toMatch(/needsVerification\s*=\s*mode === 'signup'\s*\|\|\s*\(mode === 'signin'\s*&&\s*signInNeedsCode\)/)
  })

  it('the "no verification code" note is only shown when no code is needed (guest sign-in), not universally', () => {
    // the note is rendered in the else branch of the needsVerification ternary (i.e. code NOT needed)
    expect(capsule).toMatch(/\)\s*:\s*\(\s*<p[^>]*>\{t\.signInNoCodeNote\}<\/p>/)
    // and the copy text itself still exists (correct for a guest)
    expect(capsule).toMatch(/signInNoCodeNote:/)
  })
})
