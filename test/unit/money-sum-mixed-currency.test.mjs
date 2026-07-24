import { describe, expect, it } from 'vitest'
import { sumMoney, toCurrencyMinor, sypMinorToRoundedUsdMinor, SYP_PER_USD } from '../../server/lib/currency.mjs'

// R6 (12-rule safety-net) — money must never be added across currencies as raw minor units. sumMoney
// throws on a mixed-currency add unless a target currency is given, in which case it converts first via the
// single admin rate (currency.mjs).

describe('R6 — sumMoney refuses raw mixed-currency addition', () => {
  it('sums same-currency amounts', () => {
    expect(sumMoney([{ amountMinor: 100, currency: 'USD' }, { amountMinor: 250, currency: 'USD' }])).toEqual({ amountMinor: 350, currency: 'USD' })
  })

  it('THROWS on mixed currencies with no target', () => {
    expect(() => sumMoney([{ amountMinor: 100, currency: 'USD' }, { amountMinor: 15_000, currency: 'SYP' }])).toThrow(/mixed-currency/i)
  })

  it('converts to a target currency, then sums', () => {
    const out = sumMoney([{ amountMinor: 100, currency: 'USD' }, { amountMinor: 30_000, currency: 'SYP' }], 'USD')
    expect(out.currency).toBe('USD')
    expect(out.amountMinor).toBe(100 + sypMinorToRoundedUsdMinor(30_000))
  })

  it('toCurrencyMinor uses the single admin rate and throws on unsupported pairs', () => {
    expect(toCurrencyMinor(100, 'USD', 'USD')).toBe(100)
    expect(toCurrencyMinor(100, 'USD', 'SYP')).toBe(100 * SYP_PER_USD)
    expect(toCurrencyMinor(30_000, 'SYP', 'USD')).toBe(sypMinorToRoundedUsdMinor(30_000))
    expect(() => toCurrencyMinor(100, 'USD', 'EUR')).toThrow()
  })
})
