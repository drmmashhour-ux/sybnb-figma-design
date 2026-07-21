import { db } from './prisma.mjs'

// Must match server/lib/finance-ledger.mjs's STR_CLEANING_RATE -- this is the same 5% cleaning-share
// convention, duplicated here (rather than imported) so the pre-booking quote preview never has to
// import the settlement module. Both are pure constants; if one changes, change the other.
export const STR_CLEANING_RATE = 0.05

function metadataNumber(metadata, key) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

// Decomposes a single all-inclusive STAYS amount into rent/cleaning components, honoring any
// explicit host-entered listing metadata override before falling back to the standard divisor --
// the same math server/lib/finance-ledger.mjs's bookingFinanceSplit uses at settlement, so a guest's
// pre-booking quote preview is never contradicted by what actually gets recorded after payment.
export function splitStayAmountMinor(paidTotalMinor, listingMetadata) {
  const divisor = 1 + STR_CLEANING_RATE
  const rentMinor = metadataNumber(listingMetadata, 'rentMinor') || Math.round(paidTotalMinor / divisor)
  const cleaningFeeMinor = metadataNumber(listingMetadata, 'cleaningFeeMinor') || Math.round(rentMinor * STR_CLEANING_RATE)
  return { rentMinor, cleaningFeeMinor }
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

  return { totalMinor, nights: nights.length, perNight }
}
