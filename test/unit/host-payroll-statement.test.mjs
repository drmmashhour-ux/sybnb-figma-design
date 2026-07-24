import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { payrollRowsForPeriod, payrollTotals } from '../../src/modules/host/payrollMath.ts'

// H7 — the bi-weekly payout statement reads the FROZEN M5 records (via fetchHostPayments) and does NO
// recompute. These pin the period selection + total reconciliation, and that printing reuses the FIX 1
// isolation so only the statement prints.

function row(over) {
  return { bookingId: 'b', listingTitle: 'L', checkIn: null, checkOut: null, paymentDate: '2027-02-10', releaseDate: null, grossMinor: 120_00, accommodationMinor: 100_00, cleaningFeeMinor: 20_00, commissionMinor: 15_60, hostPayoutMinor: 104_40, netPayoutMinor: 104_40, currency: 'USD', payoutStatus: 'PENDING_HOLD', ...over }
}

describe('H7 — payroll period + totals (frozen, no recompute)', () => {
  it('selects only rows whose payment date is inside the 2-week window', () => {
    const rows = [
      row({ bookingId: 'in1', paymentDate: '2027-02-01' }),
      row({ bookingId: 'in2', paymentDate: '2027-02-14' }),
      row({ bookingId: 'before', paymentDate: '2027-01-31' }),
      row({ bookingId: 'after', paymentDate: '2027-02-15' }),
      row({ bookingId: 'nodate', paymentDate: null }),
    ]
    const inPeriod = payrollRowsForPeriod(rows, '2027-02-01', '2027-02-14').map((r) => r.bookingId)
    expect(inPeriod).toEqual(['in1', 'in2'])
  })

  it('totals sum straight from the rows and reconcile: gross − commission − cardFee = net', () => {
    const rows = [
      row({ bookingId: 'sham', hostPayoutMinor: 104_40, netPayoutMinor: 104_40 }), // no card fee
      row({ bookingId: 'card', hostPayoutMinor: 104_40, netPayoutMinor: 99_40 }), // $5 card fee withheld
    ]
    const totals = payrollTotals(rows)
    expect(totals.grossMinor).toBe(240_00) // 2 × 120.00
    expect(totals.commissionMinor).toBe(31_20) // 2 × 15.60
    expect(totals.cardFeeMinor).toBe(5_00) // only the card booking
    expect(totals.netMinor).toBe(203_80) // 104.40 + 99.40
    // Reconciliation identity holds in aggregate.
    expect(totals.grossMinor - totals.commissionMinor - totals.cardFeeMinor).toBe(totals.netMinor)
  })

  it('an empty period totals to zero', () => {
    expect(payrollTotals([])).toEqual({ grossMinor: 0, commissionMinor: 0, cardFeeMinor: 0, netMinor: 0 })
  })
})

describe('H7 — statement component reuses FIX 1 print isolation + frozen data', () => {
  const comp = readFileSync(new URL('../../src/modules/host/HostPayrollStatement.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../../src/shared/theme/global.css', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8')

  it('reads the frozen endpoint (fetchHostPayments) and does not recompute', () => {
    expect(comp).toMatch(/fetchHostPayments\(/)
    expect(comp).not.toMatch(/bookingFinanceSplit|computeGuestBookingTotalMinor|platformFee/)
  })

  it('prints via the #statement-print isolation with no-print chrome + window.print', () => {
    expect(comp).toMatch(/id="statement-print"/)
    expect(comp).toMatch(/className="no-print"/)
    expect(comp).toMatch(/window\.print\(\)/)
    // The shared print CSS covers the statement root too.
    expect(css).toMatch(/#statement-print, #statement-print \* \{ visibility: visible; \}/)
  })

  it('has the required header (host + period + generated) and the tax-form disclaimer footer', () => {
    expect(comp).toMatch(/data\.hostName/)
    expect(comp).toMatch(/t\.period/)
    expect(comp).toMatch(/t\.generated/)
    expect(comp).toMatch(/not an official tax form/)
  })

  it('exposes a 2-week period selector and is routed at /host/payroll', () => {
    expect(comp).toMatch(/twoWeeksAgoISO/)
    expect(comp).toMatch(/type="date"/)
    expect(app).toMatch(/path === '\/host\/payroll'/)
  })
})
