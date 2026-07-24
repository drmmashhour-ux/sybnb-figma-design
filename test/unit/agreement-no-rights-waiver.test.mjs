import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// FIX CP-1 (Customer Protection) — the STR booking agreement must not waive statutory rights. The old
// clause required "disputes go to the SYBNB team before any outside action". It is replaced by a
// non-binding request plus an explicit carve-out preserving the right to a regulator or court.

const page = readFileSync(new URL('../../src/modules/bookings/BookingReviewPage.tsx', import.meta.url), 'utf8')

describe('FIX CP-1 — STR agreement preserves statutory dispute rights', () => {
  it('removes the rights-waiving dispute clause (EN/AR/FR)', () => {
    expect(page).not.toMatch(/disputes go to the SYBNB team before any outside action/)
    expect(page).not.toMatch(/تحويل أي نزاع إلى فريق SYBNB قبل أي تصرف خارجي/)
    expect(page).not.toMatch(/tout litige soit transmis à l'équipe SYBNB avant toute autre action/)
  })

  it('adds the non-binding request + statutory carve-out (EN/AR/FR)', () => {
    expect(page).toMatch(/does not limit your right to contact a consumer-protection regulator or a court/)
    expect(page).toMatch(/لا يحدّ من حقك في التواصل مع جهة حماية المستهلك أو اللجوء إلى القضاء/)
    expect(page).toMatch(/ne limite pas votre droit de contacter un organisme de protection du consommateur ou un tribunal/)
  })
})
