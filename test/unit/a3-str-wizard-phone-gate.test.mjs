import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A3.2 (Finding 3) — the STR wizard must surface + enforce the host-phone requirement BEFORE submit:
// it reads whether the host has a phone on file (/api/me/overview → hasPhone), shows a proactive notice
// in the review step when missing, and blocks the publish. Source guard on the wizard wiring.

const wizard = readFileSync(new URL('../../src/modules/seller/SellerListingWizard.tsx', import.meta.url), 'utf8')

describe('A3.2 — STR wizard host-phone gate (Finding 3)', () => {
  it('reads the host phone-on-file from the overview API', () => {
    expect(wizard).toMatch(/fetchSellerOverview\(\)/)
    expect(wizard).toMatch(/setHostHasPhone\(Boolean\(o\.user\.hasPhone\)\)/)
  })

  it('blocks publish (finishAccommodation) when the host has no phone on file', () => {
    // the submit guard must return early when hostHasPhone === false, with a surfaced message
    expect(wizard).toMatch(/hostHasPhone === false[\s\S]{0,200}setSubmitError/)
  })

  it('surfaces the requirement proactively in the review step (not only as a submit error)', () => {
    expect(wizard).toMatch(/hostHasPhone === false && \(/)
    expect(wizard).toMatch(/Add a phone number to your account before publishing/)
  })
})
