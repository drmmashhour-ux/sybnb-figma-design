import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const listingRoutes = readFileSync(new URL('../../server/routes/listings.mjs', import.meta.url), 'utf8')
const paymentRoutes = readFileSync(new URL('../../server/routes/payments.mjs', import.meta.url), 'utf8')
const financeLedger = readFileSync(new URL('../../server/lib/finance-ledger.mjs', import.meta.url), 'utf8')

describe('guest-facing money protocol controls', () => {
  it('guest listing quote returns guest totals without platform commission fields', () => {
    const quoteBlock = listingRoutes.slice(listingRoutes.indexOf("if (quoteMatch)"), listingRoutes.indexOf("if (url.pathname === '/api/listings')"))
    expect(quoteBlock).toContain('totalMinor')
    expect(quoteBlock).not.toMatch(/commission|platformFee|hostPayout/i)
  })

  it('commission remains finance/admin logic, not guest quote logic', () => {
    expect(financeLedger).toMatch(/commission|platform/i)
    expect(paymentRoutes).toContain('expectedTotalMinor')
  })
})
