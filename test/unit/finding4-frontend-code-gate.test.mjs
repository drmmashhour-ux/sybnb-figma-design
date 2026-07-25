import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Finding 4 (frontend) — the dev "Test code" / "DEV CODE" inline display MUST be gated by the
// build-time flag import.meta.env.DEV, not merely by a truthy devCode. Data-only gating
// ({devCode && ...}) makes the backend's response-gating the SINGLE point of failure: if a code ever
// reached the client (a regressed gate, a proxy/cache, a misconfig), a production build would render
// it. Gating on import.meta.env.DEV makes the block dead code in a production build — it can never
// render — which is the defense-in-depth this finding requires.

const sources = {
  'AccountGateCapsule.tsx': readFileSync(new URL('../../src/shared/capsules/AccountGateCapsule.tsx', import.meta.url), 'utf8'),
  'StaffAccessPage.tsx': readFileSync(new URL('../../src/modules/account/StaffAccessPage.tsx', import.meta.url), 'utf8'),
}

describe('Finding 4 — frontend dev-code display is env-gated so a prod build cannot render it', () => {
  for (const [name, src] of Object.entries(sources)) {
    it(`${name}: renders the devCode block only under import.meta.env.DEV`, () => {
      // The render condition must require the DEV build flag alongside devCode.
      expect(src, `${name} should gate the devCode display on import.meta.env.DEV`).toMatch(
        /import\.meta\.env\.DEV\s*&&\s*devCode/,
      )
      // No un-gated `{devCode && (` render may remain (that renders in any build).
      expect(src, `${name} still has an un-gated {devCode && (…)} render`).not.toMatch(/\{\s*devCode\s*&&\s*\(/)
    })
  }
})
