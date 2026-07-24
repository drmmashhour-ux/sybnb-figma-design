// USD is a fully-supported guest-facing currency alongside SYP (the platform default), not a
// replacement for it. Listings/rides are priced in SYP by the host/platform; a guest who chooses
// to pay in USD gets that SYP price converted at this fixed, manually-configured rate — there is
// no live market-rate feed. Update this constant when the platform operator wants to reflect a
// new rate; it is deliberately not fetched from any external source.
export const SYP_PER_USD = 15000

// All amountMinor fields in this codebase already store whole currency units, not true cents
// (a 4,500,000 SYP/night listing is 4.5M SYP, not 45,000) — see moneyText() in
// src/shared/i18n/display.ts, which never divides by 100. Cash and card payments alike round UP
// to the nearest $5 so guests are never asked for change/coins the platform can't reliably give
// (e.g. $18.99 -> $20, $18.80 -> $20) — requested explicitly by the platform operator. This is
// only ever applied to USD; SYP amounts are untouched.
export const USD_ROUNDING_STEP = 5

export function convertSypMinorToUsd(sypAmountMinor) {
  return Math.max(0, sypAmountMinor || 0) / SYP_PER_USD
}

export function roundUsdUpToStep(amountUsd) {
  const value = Math.max(0, amountUsd || 0)
  return Math.ceil(value / USD_ROUNDING_STEP) * USD_ROUNDING_STEP
}

// Converts a SYP-denominated minor amount to a guest-facing, change-friendly whole-dollar USD
// amount in one step: convert at the fixed rate, then round up to the nearest $5.
export function sypMinorToRoundedUsdMinor(sypAmountMinor) {
  return roundUsdUpToStep(convertSypMinorToUsd(sypAmountMinor))
}

// A multi-night stay quote (computeStayTotalMinor's SYP-denominated { totalMinor, perNight })
// converted to USD for display/charging. Each night is rounded up to the $5 step individually and
// the total is the SUM of those rounded nights -- not the raw SYP total rounded once as a single
// lump sum. Rounding the lump sum instead would collapse a stay's price to the same $5 floor
// regardless of night count for any listing priced low enough that the whole multi-night SYP total
// still sits under one $5-equivalent step (e.g. a 2-night stay costing the same as 1 night), which
// silently under-charges the guest and under-pays the host. Summing pre-rounded nights guarantees
// the total scales monotonically with nights while still landing on a clean $5 multiple overall.
export function sypStayQuoteToRoundedUsd(quote) {
  return roundStayQuoteNightly(quote, sypMinorToRoundedUsdMinor)
}

function roundStayQuoteNightly(quote, roundNightMinor) {
  const perNight = quote.perNight.map((night) => ({
    ...night,
    priceMinor: roundNightMinor(night.priceMinor),
  }))
  const totalMinor = perNight.reduce((sum, night) => sum + night.priceMinor, 0)
  return { totalMinor, perNight }
}

// Same per-night-then-sum rounding as sypStayQuoteToRoundedUsd, but currency-aware: a listing whose
// OWN currency is already USD must NOT be run through the SYP->USD conversion (dividing an
// already-dollar amount by SYP_PER_USD=15000 before rounding up to $5 collapses any real price down
// to the $5 floor -- e.g. a genuine $80/night listing quoted as ~$5/night, a >90% price collapse).
// It still gets the same $5-step rounding applied directly, so every guest-facing USD total is
// change-friendly regardless of which currency the host priced in.
export function stayQuoteToRoundedUsd(quote, listingCurrency) {
  return listingCurrency === 'USD'
    ? roundStayQuoteNightly(quote, roundUsdUpToStep)
    : sypStayQuoteToRoundedUsd(quote)
}

// Single-amount counterpart of stayQuoteToRoundedUsd, for listings with a flat price and no
// per-night breakdown (RENTALS/BUY/CARS/MARKETPLACE/NEW_CONSTRUCTION). Same currency-awareness:
// skip the SYP conversion for an already-USD amount, apply the $5-step rounding directly instead.
export function amountToRoundedUsd(amountMinor, listingCurrency) {
  return listingCurrency === 'USD' ? roundUsdUpToStep(amountMinor) : sypMinorToRoundedUsdMinor(amountMinor)
}

// R6 (12-rule safety-net) — convert one {amountMinor, currency} money value to a target currency via the
// single admin rate. Same currency passes through; SYP<->USD use SYP_PER_USD; anything else throws rather
// than silently mis-adding.
export function toCurrencyMinor(amountMinor, fromCurrency, toCurrency) {
  const from = String(fromCurrency || '').toUpperCase()
  const to = String(toCurrency || '').toUpperCase()
  const value = Math.round(amountMinor || 0)
  if (from === to) return value
  if (from === 'SYP' && to === 'USD') return sypMinorToRoundedUsdMinor(value)
  if (from === 'USD' && to === 'SYP') return Math.round(value * SYP_PER_USD)
  const error = new Error(`Unsupported currency conversion ${from} -> ${to}.`)
  error.code = 'UNSUPPORTED_CURRENCY_CONVERSION'
  throw error
}

// R6 — the ONE safe way to add money. Refuses to add raw mixed-currency minor units as a single number:
// with no targetCurrency, every input must already share one currency; otherwise it THROWS. With a
// targetCurrency, each input is converted to it (via the single admin rate) before summing. Returns
// { amountMinor, currency }.
export function sumMoney(amounts, targetCurrency) {
  const list = (amounts || []).filter((m) => m && Number.isFinite(m.amountMinor))
  if (!list.length) return { amountMinor: 0, currency: String(targetCurrency || 'USD').toUpperCase() }
  if (!targetCurrency) {
    const currencies = new Set(list.map((m) => String(m.currency || '').toUpperCase()))
    if (currencies.size > 1) {
      const error = new Error('Cannot add mixed-currency amounts without a target currency.')
      error.code = 'MIXED_CURRENCY_SUM'
      throw error
    }
    return { amountMinor: list.reduce((sum, m) => sum + Math.round(m.amountMinor), 0), currency: [...currencies][0] }
  }
  const to = String(targetCurrency).toUpperCase()
  return { amountMinor: list.reduce((sum, m) => sum + toCurrencyMinor(m.amountMinor, m.currency, to), 0), currency: to }
}
