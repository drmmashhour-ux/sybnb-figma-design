import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A7 (Finding 3) — the partner signup form must surface the phone-required rule at the POINT OF ENTRY,
// before submit. Today the requirement is only revealed post-failure via t.signUpRequired. This locks a
// pre-submit signal: an inline required hint (rendered as a static help element next to the phone input,
// not the submit-time error) plus a visible required marker on the phone field.

const src = readFileSync(new URL('../../src/modules/account/StaffAccessPage.tsx', import.meta.url), 'utf8')

describe('A7 — partner signup surfaces phone-required BEFORE submit (Finding 3)', () => {
  it('defines an inline phone-required hint string for both languages', () => {
    const count = (src.match(/phoneRequiredHelp:/g) || []).length
    expect(count, 'phoneRequiredHelp defined for ar + en').toBeGreaterThanOrEqual(2)
  })

  it('renders the phone-required hint as a static help element at the point of entry (not the post-submit error)', () => {
    // Rendered like emailHelp — a <small> help element tied to the phone input, so it shows whenever the
    // phone field is shown, independent of the isErrorMessage/message submit-failure path.
    expect(src).toMatch(/<small style=\{styles\.helpText\}>\{t\.phoneRequiredHelp\}<\/small>/)
  })

  it('shows a visible required marker on the phone field', () => {
    expect(src, 'a requiredMark indicator is rendered on the phone label').toMatch(/styles\.requiredMark/)
    expect(src, 'requiredMark style is defined').toMatch(/requiredMark:\s*\{/)
  })
})
