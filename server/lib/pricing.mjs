import { db } from './prisma.mjs'

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
