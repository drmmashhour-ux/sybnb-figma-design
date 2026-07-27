import { db } from './prisma.mjs'
import { assertAmountWithinLimit } from './currency.mjs'

// Must match server/lib/finance-ledger.mjs's STR_CLEANING_RATE -- this is the same 5% cleaning-share
// convention, duplicated here (rather than imported) so the pre-booking quote preview never has to
// import the settlement module. Both are pure constants; if one changes, change the other.
export const STR_CLEANING_RATE = 0.05

function metadataNumber(metadata, key) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

// DEAD CODE as of the money-model correction (2026-07-22) -- repository audit confirmed zero
// remaining callers anywhere in the codebase (its only real caller, the quote endpoint, now calls
// computeGuestBookingTotalMinor below instead). This used to be a DECOMPOSITION helper: it took an
// already-known total and tried to back out a rent/cleaning split from it via a fixed divisor, which
// was never accurate once a host could set a real cleaningFeeMinor (the divisor guess ignored it).
// Left in place rather than deleted during a bug-fix pass (see docs/architecture/STR_MONEY_MODEL.md,
// Section 17) -- a future cleanup can remove this function outright.
export function splitStayAmountMinor(paidTotalMinor, listingMetadata) {
  const divisor = 1 + STR_CLEANING_RATE
  const rentMinor = metadataNumber(listingMetadata, 'rentMinor') || Math.round(paidTotalMinor / divisor)
  const cleaningFeeMinor = metadataNumber(listingMetadata, 'cleaningFeeMinor') || Math.round(rentMinor * STR_CLEANING_RATE)
  return { rentMinor, cleaningFeeMinor }
}

// Canonical, single source of truth for the STAYS guest-facing booking total (money-model
// correction, 2026-07-22). Every guest-visible total, the stored booking.amountMinor, and the
// payment charge requirement all come from this one function so "what the guest confirmed at
// checkout" and "what the guest is charged" can never diverge again -- see
// docs/architecture/STR_MONEY_MODEL.md, the authoritative spec for every STR money calculation.
//
// The STR price model is additive: nightlySubtotalMinor + cleaningFeeMinor + extraFeesMinor. Both
// fees are flat, per-booking amounts (never scaled by night count) -- the host wizard's UI treats
// them as separate line items on top of the nightly rate, not a decomposition of it (confirmed by
// the actual wizard copy: "USD nightly price" / "Cleaning fee USD (optional)" as two distinct
// inputs). Québec lodging tax is deliberately EXCLUDED here and stays disclosure-only in the quote
// breakdown -- an explicit product decision (2026-07-22), matching the existing, already-tested
// "never added on top of the guest's total" behavior in the quote endpoint. Negative/garbage
// metadata values are clamped to zero by metadataNumber, never subtracted.
export function computeGuestBookingTotalMinor({ nightlySubtotalMinor, listingMetadata }) {
  const cleaningFeeMinor = metadataNumber(listingMetadata, 'cleaningFeeMinor')
  const extraFeesMinor = metadataNumber(listingMetadata, 'extraFeesMinor')
  const amountMinor = Math.max(0, Math.round(nightlySubtotalMinor || 0)) + cleaningFeeMinor + extraFeesMinor
  assertAmountWithinLimit(amountMinor, 'booking total') // F5: reject an over-int4 gross cleanly, before any DB write
  return { nightlySubtotalMinor: Math.max(0, Math.round(nightlySubtotalMinor || 0)), cleaningFeeMinor, extraFeesMinor, amountMinor }
}

// Québec lodging tax (3.5%), for DISCLOSURE purposes only -- never added to amountMinor (see
// computeGuestBookingTotalMinor above). Canonical metadata key is taxFeeMinor (what the host wizard
// writes); taxesMinor is the legacy key older reader code expected and is honored as a fallback for
// any existing record that only has it set. Precedence: taxFeeMinor wins if both are present.
export function metadataLodgingTaxMinor(listingMetadata) {
  return metadataNumber(listingMetadata, 'taxFeeMinor') || metadataNumber(listingMetadata, 'taxesMinor')
}

function toISODate(date) {
  return new Date(date).toISOString().slice(0, 10)
}

// Dates here are calendar dates with no meaningful time-of-day, but checkIn/checkOut arrive as
// UTC-midnight Date objects. Walking the range with local-timezone getters/setters can skip or
// duplicate a night depending on the server's timezone offset, so everything here stays in UTC.
function eachNight(checkIn, checkOut) {
  const nights = []
  let cursorMs = Date.UTC(new Date(checkIn).getUTCFullYear(), new Date(checkIn).getUTCMonth(), new Date(checkIn).getUTCDate())
  const endMs = Date.UTC(new Date(checkOut).getUTCFullYear(), new Date(checkOut).getUTCMonth(), new Date(checkOut).getUTCDate())
  while (cursorMs < endMs) {
    nights.push(toISODate(new Date(cursorMs)))
    cursorMs += 24 * 60 * 60 * 1000
  }
  return nights
}

// Computes what a stay actually costs, night by night: a host's per-date price override
// (weekend/high-season pricing) wins over the listing's base price for that specific night.
// Shared between the booking-quote endpoint and actual booking creation so a guest is never
// charged something different from what they were quoted.
export async function computeStayTotalMinor(listing, checkIn, checkOut) {
  const nights = eachNight(checkIn, checkOut)
  if (!nights.length) {
    return { totalMinor: listing.priceMinor, nights: 0, perNight: [] }
  }

  const overrides = await db().listingAvailability.findMany({
    where: {
      listingId: listing.id,
      date: { gte: new Date(checkIn), lt: new Date(checkOut) },
      priceOverrideMinor: { not: null },
    },
    select: { date: true, priceOverrideMinor: true },
  })
  const overrideByDate = new Map(overrides.map((row) => [toISODate(row.date), row.priceOverrideMinor]))

  const perNight = nights.map((date) => ({
    date,
    priceMinor: overrideByDate.get(date) ?? listing.priceMinor,
  }))
  const totalMinor = perNight.reduce((sum, night) => sum + night.priceMinor, 0)
  assertAmountWithinLimit(totalMinor, 'stay total') // F5: covers the non-short-stay path (amountMinor == this subtotal)

  return { totalMinor, nights: nights.length, perNight }
}
