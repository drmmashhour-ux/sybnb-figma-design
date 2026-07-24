import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// AD3 (part 2) — the report view renders /api/admin/daily-report: the authoritative figures (from records)
// plus the narrative. It performs NO math and sources NO number from the model — every figure is read from
// the endpoint's facts. Labeled advisory/admin-reviewed. Source guard.

const comp = readFileSync(new URL('../../src/modules/operations/AdminDailyReport.tsx', import.meta.url), 'utf8')
const page = readFileSync(new URL('../../src/modules/operations/OperationsCalendarPage.tsx', import.meta.url), 'utf8')

describe('AD3 part 2 — daily report UI', () => {
  it('reads the endpoint (fetchAdminDailyReport) and does not recompute or invent numbers', () => {
    expect(comp).toMatch(/fetchAdminDailyReport\(/)
    expect(comp).not.toMatch(/bookingFinanceSplit|\.count\(|aggregate\(|Math\.round/)
  })

  it('renders the record-sourced figures + the narrative with its source tag', () => {
    expect(comp).toMatch(/f\.newBookings24h/)
    expect(comp).toMatch(/f\.openDisputes/)
    expect(comp).toMatch(/report\.narrative\.source === 'ai'/)
    expect(comp).toMatch(/narrative\.message(Ar|En)/)
  })

  it('is labeled advisory / admin-reviewed', () => {
    expect(comp).toMatch(/Advisory — for admin review only/)
  })

  it('is embedded in the admin operations page', () => {
    expect(page).toMatch(/<AdminDailyReport lang=\{lang\} \/>/)
  })
})
