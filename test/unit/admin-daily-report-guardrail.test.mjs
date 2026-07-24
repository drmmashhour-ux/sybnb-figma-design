import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dailyReportTemplateNarrative } from '../../server/lib/admin-daily-report.mjs'

// AD3 — the AI-guardrail: numbers come from the data layer (real record counts), the model may only phrase.
// Source-level pins so the guardrail can't silently erode.

const dataLayer = readFileSync(new URL('../../server/lib/admin-daily-report.mjs', import.meta.url), 'utf8')
const ai = readFileSync(new URL('../../server/lib/ai-insights.mjs', import.meta.url), 'utf8')

describe('AD3 — daily report AI guardrail', () => {
  it('every figure is a real DB count/aggregate — no model or estimate in the data layer', () => {
    expect(dataLayer).toMatch(/db\.booking\.count/)
    expect(dataLayer).toMatch(/db\.payout\.aggregate/)
    expect(dataLayer).toMatch(/db\.dispute\.count/)
    // The data layer must not IMPORT the AI at all — numbers never originate from the model.
    expect(dataLayer).not.toMatch(/from '\.[^']*ai-insights/)
    expect(dataLayer).not.toMatch(/@anthropic-ai/)
    expect(dataLayer).toMatch(/source: 'records'/)
  })

  it('the AI prompt forbids inventing/estimating any number', () => {
    expect(ai).toMatch(/DAILY_REPORT_SYSTEM_PROMPT/)
    expect(ai).toMatch(/never invent, round, estimate, or add a number/)
  })

  it('the template narrative restates only the given facts (deterministic, no invented numbers)', () => {
    const msg = dailyReportTemplateNarrative({ newBookings24h: 3, pendingReviewsTotal: 5, payoutsPendingHoldCount: 2, openDisputes: 1 }, 'en')
    expect(msg).toContain('3 new bookings')
    expect(msg).toContain('5 items awaiting review')
    expect(msg).toContain('2 payouts in hold')
    expect(msg).toContain('1 open disputes')
  })
})
