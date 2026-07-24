import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// M1 (money-panel addition) — the 0.13 default on bookingFinanceSplit must never silently mask an un-wired
// call site. Every caller must pass an explicit, resolved commission rate. Guard: no call site may use the
// 2-argument form (…amountMinor) with no third argument). A 3-arg call ends in the resolved rate
// (…await rateFor(booking)) / …await strCommissionRateForBooking(tx, x)) / …commissionRate)), whose inner
// close-paren means the 2-arg pattern below can't match it.

const FILES = [
  'server/lib/finance-ledger.mjs',
  'server/lib/stay-statements.mjs',
  'server/routes/admin.mjs',
  'server/routes/bookings.mjs',
  'server/routes/host.mjs',
]

// Matches a bookingFinanceSplit(...) call that CLOSES immediately after a `…amountMinor` argument — i.e.
// the old 2-arg shape. `[^)]*` stops at the first ), so a 3-arg call with a nested helper paren
// (rateFor(booking)) closes on the helper's arg, not on amountMinor, and is not matched.
const TWO_ARG = /bookingFinanceSplit\([^)]*amountMinor\)/

describe('M1 — every bookingFinanceSplit caller passes an explicit resolved rate', () => {
  for (const file of FILES) {
    it(`${file} has no un-wired 2-arg bookingFinanceSplit call`, () => {
      const src = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
      expect(src).not.toMatch(TWO_ARG)
    })
  }

  it('there is at least one wired call site (sanity — the guard isn’t vacuous)', () => {
    const ledger = readFileSync(new URL('../../server/lib/finance-ledger.mjs', import.meta.url), 'utf8')
    expect(ledger).toMatch(/bookingFinanceSplit\([^)]*commissionRate\)/) // buildPayoutRow passes the rate
    expect(ledger).toMatch(/strCommissionRateForBooking/)
  })
})
