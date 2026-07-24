import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// AD4 (UI) — the admin host-ledger tax-slip reads the frozen endpoint (no recompute) and prints via the FIX 1
// isolation (#statement-print), with the "not an official tax form" footer. Source guard.

const comp = readFileSync(new URL('../../src/modules/admin/AdminHostLedgerPage.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8')

describe('AD4 — admin host-ledger tax-slip UI', () => {
  it('reads the frozen endpoint (fetchAdminHostLedger), no recompute', () => {
    expect(comp).toMatch(/fetchAdminHostLedger\(/)
    expect(comp).not.toMatch(/bookingFinanceSplit|computeGuestBookingTotalMinor|platformFee/)
  })

  it('searches by host + date range and shows commission + plan fee as separate revenue lines', () => {
    expect(comp).toMatch(/setHostId/)
    expect(comp).toMatch(/type="date"/)
    expect(comp).toMatch(/revenue\.commissionMinor/)
    expect(comp).toMatch(/revenue\.planFeeMinor/)
  })

  it('prints via #statement-print (FIX 1 isolation) with no-print controls + tax-form disclaimer', () => {
    expect(comp).toMatch(/id="statement-print"/)
    expect(comp).toMatch(/className="no-print"/)
    expect(comp).toMatch(/window\.print\(\)/)
    expect(comp).toMatch(/not an official tax form/)
  })

  it('is routed at /admin/host-ledger', () => {
    expect(app).toMatch(/path === '\/admin\/host-ledger'/)
  })
})
