// SR dynamic pricing — night, traffic (peak-hour), holiday, and high-season multipliers.
// All server-side and configurable. The multiplier and its breakdown are returned so the rider ALWAYS
// sees WHY a fare is higher BEFORE they commit (price-before-commit; transparent, unlike opaque surge).
//
// Amounts are whole currency units (see currency.mjs). The multiplier is applied to the raw fare and the
// result is re-rounded by the caller (quoteSrRide already rounds SYP to the nearest 500 and USD up to $5).

// Syria is UTC+3 year-round. Deriving the local hour/date from a UTC timestamp with a fixed offset avoids
// any dependence on the server's own timezone.
const SYRIA_UTC_OFFSET_HOURS = 3

// TUNE THESE. Multipliers compose (multiply together) and are capped at maxMultiplier so a night+holiday
// fare can't explode. Set the real Syrian public-holiday dates and high-season ranges before launch.
export const SR_PRICING_CONFIG = {
  // Night surcharge: 22:00–05:59 local.
  night: { fromHour: 22, toHour: 6, multiplier: 1.25, label: 'Night' },
  // "Traffic": rush-hour windows (a proxy — SR has no live traffic feed yet; swap for a real factor later).
  peak: [
    { fromHour: 7, toHour: 9, multiplier: 1.2, label: 'Morning traffic' },
    { fromHour: 16, toHour: 19, multiplier: 1.2, label: 'Evening traffic' },
  ],
  // Public holidays (MM-DD, local). REPLACE with the real Syrian holiday calendar each year.
  holidays: { dates: ['01-01', '05-01', '12-25'], multiplier: 1.5, label: 'Holiday' },
  // High-season date ranges (MM-DD .. MM-DD, inclusive; may wrap year-end). e.g. summer / Eid weeks.
  highSeason: { ranges: [{ from: '06-15', to: '09-15' }], multiplier: 1.3, label: 'High season' },
  // Hard ceiling on the combined multiplier so fares never runaway.
  maxMultiplier: 2.5,
}

function syriaLocalParts(date) {
  const local = new Date(date.getTime() + SYRIA_UTC_OFFSET_HOURS * 3600 * 1000)
  return { hour: local.getUTCHours(), month: local.getUTCMonth() + 1, day: local.getUTCDate() }
}

function mmdd(month, day) {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function inHourWindow(hour, fromHour, toHour) {
  // toHour is exclusive. A window that wraps midnight (fromHour > toHour) matches either side.
  if (fromHour <= toHour) return hour >= fromHour && hour < toHour
  return hour >= fromHour || hour < toHour
}

function inDateRange(key, from, to) {
  // Compares MM-DD strings; supports ranges that wrap the year end (from > to).
  if (from <= to) return key >= from && key <= to
  return key >= from || key <= to
}

// Returns { multiplier, factors: [{ label, multiplier }] } for the given instant (defaults handled by
// the caller passing `now`). factors is the transparent breakdown to show the rider.
export function computeFareMultiplier(date, config = SR_PRICING_CONFIG) {
  const { hour, month, day } = syriaLocalParts(date)
  const key = mmdd(month, day)
  const factors = []

  // Night (single time-of-day factor; night and peak windows don't overlap by design).
  if (config.night && inHourWindow(hour, config.night.fromHour, config.night.toHour)) {
    factors.push({ label: config.night.label, multiplier: config.night.multiplier })
  } else if (config.peak) {
    const peak = config.peak.find((w) => inHourWindow(hour, w.fromHour, w.toHour))
    if (peak) factors.push({ label: peak.label, multiplier: peak.multiplier })
  }

  // Holiday.
  if (config.holidays && config.holidays.dates.includes(key)) {
    factors.push({ label: config.holidays.label, multiplier: config.holidays.multiplier })
  }

  // High season.
  if (config.highSeason) {
    const range = config.highSeason.ranges.find((r) => inDateRange(key, r.from, r.to))
    if (range) factors.push({ label: config.highSeason.label, multiplier: config.highSeason.multiplier })
  }

  const combined = factors.reduce((m, f) => m * f.multiplier, 1)
  const multiplier = Math.min(combined, config.maxMultiplier)
  return {
    multiplier: Math.round(multiplier * 1000) / 1000,
    factors, // e.g. [{ label: 'Night', multiplier: 1.25 }, { label: 'Holiday', multiplier: 1.5 }]
    capped: combined > config.maxMultiplier,
  }
}
