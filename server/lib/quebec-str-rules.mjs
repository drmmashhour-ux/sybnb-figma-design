// Montreal municipal STR bylaw (027): principal-residence short-term rental is legal only June 10 -
// September 10, capped at 90 nights per calendar year; investment/secondary properties are banned
// almost everywhere except specific named streets (not tracked here -- see residencyType flag surfaced
// to the admin instead, server/lib/listing-attributes.mjs). This module is the single place that
// enforces the seasonal window and night cap, applied at both the host's availability-setting step and
// the guest's booking-creation step so neither side can create an out-of-window or over-cap night.

const SEASON_START = { month: 6, day: 10 } // June 10
const SEASON_END = { month: 9, day: 10 } // September 10
export const MONTREAL_STR_MAX_NIGHTS_PER_YEAR = 90

export function isMontrealPrincipalResidenceStr(metadata) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {}
  return meta.country === 'CA' && meta.city === 'montreal' && meta.residencyType === 'principal'
}

function dayNumber(date) {
  return (date.getUTCMonth() + 1) * 100 + date.getUTCDate()
}

const SEASON_START_NUM = SEASON_START.month * 100 + SEASON_START.day
const SEASON_END_NUM = SEASON_END.month * 100 + SEASON_END.day

// Ignores year -- true for June 10 through September 10 of any year.
export function isWithinMontrealStrSeason(date) {
  const num = dayNumber(date)
  return num >= SEASON_START_NUM && num <= SEASON_END_NUM
}

function seasonError(message) {
  const error = new Error(message)
  error.statusCode = 403
  error.code = 'MONTREAL_STR_SEASON_BLOCKED'
  error.expose = true
  return error
}

// Called when a host tries to mark date(s) AVAILABLE. `dates` is the normalized array already
// validated by normalizeAvailabilityDates (server/routes/host.mjs) -- each entry has a real Date
// object and an uppercased status.
export function assertAvailabilityWithinSeason(metadata, dates) {
  if (!isMontrealPrincipalResidenceStr(metadata)) return
  const outOfSeason = dates.some((entry) => entry.status === 'AVAILABLE' && !isWithinMontrealStrSeason(entry.date))
  if (outOfSeason) {
    throw seasonError(
      "Montreal permits principal-residence short-term rental only June 10–September 10. This listing can't be marked available outside that window.",
    )
  }
}

// Called at booking-create time (server/routes/bookings.mjs) with the listing's own metadata and the
// requested [checkIn, checkOut) range. Rejects any night outside the season, and rejects if this
// booking would push the listing's confirmed/completed nights for checkIn's calendar year over the cap.
export async function assertBookingWithinMontrealSeasonAndCap(db, listing, checkIn, checkOut) {
  if (!isMontrealPrincipalResidenceStr(listing.metadata)) return

  if (checkIn.getUTCFullYear() !== checkOut.getUTCFullYear() && !(checkOut.getUTCMonth() === 0 && checkOut.getUTCDate() === 1)) {
    throw seasonError('This booking cannot span across the Montreal seasonal window.')
  }
  const lastNight = new Date(checkOut.getTime() - 24 * 60 * 60 * 1000)
  if (!isWithinMontrealStrSeason(checkIn) || !isWithinMontrealStrSeason(lastNight)) {
    throw seasonError(
      "Montreal permits principal-residence short-term rental only June 10–September 10 each year. Choose dates within that window.",
    )
  }

  const requestedNights = Math.round((checkOut.getTime() - checkIn.getTime()) / (24 * 60 * 60 * 1000))
  const yearStart = new Date(Date.UTC(checkIn.getUTCFullYear(), 0, 1))
  const yearEnd = new Date(Date.UTC(checkIn.getUTCFullYear() + 1, 0, 1))
  const existingBookings = await db.booking.findMany({
    where: {
      listingId: listing.id,
      status: { in: ['CONFIRMED', 'COMPLETED'] },
      checkIn: { gte: yearStart, lt: yearEnd },
    },
    select: { checkIn: true, checkOut: true },
  })
  const existingNights = existingBookings.reduce((sum, booking) => {
    if (!booking.checkIn || !booking.checkOut) return sum
    return sum + Math.round((booking.checkOut.getTime() - booking.checkIn.getTime()) / (24 * 60 * 60 * 1000))
  }, 0)

  if (existingNights + requestedNights > MONTREAL_STR_MAX_NIGHTS_PER_YEAR) {
    const error = new Error(
      `Montreal caps principal-residence short-term rental at ${MONTREAL_STR_MAX_NIGHTS_PER_YEAR} nights per calendar year. This listing has ${existingNights} confirmed nights in ${checkIn.getUTCFullYear()} already -- only ${Math.max(0, MONTREAL_STR_MAX_NIGHTS_PER_YEAR - existingNights)} remain.`,
    )
    error.statusCode = 409
    error.code = 'MONTREAL_STR_NIGHT_CAP_EXCEEDED'
    error.expose = true
    throw error
  }
}
