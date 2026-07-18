import { db } from './prisma.mjs'

// CarGurus-style Deal Rating (025/Carcad Phase E): classifies a CARS listing's price against the
// median of comparable APPROVED listings (same make+model, close year/mileage). Comparable
// matching mirrors the dual-read pattern already used by carRules() (server/lib/listing-attributes.mjs)
// and the search filters (server/routes/listings.mjs) -- metadata.vehicle.<key> first, falling
// back to flat metadata.<key>.

const YEAR_TOLERANCE = 2
const MIN_MILEAGE_TOLERANCE_KM = 20_000
const MILEAGE_TOLERANCE_RATIO = 0.2
const MIN_COMPARABLE_COUNT = 3

// Tier thresholds as a price / median-of-comparables ratio. "Great" requires a materially
// better-than-market price (8%+ under median) so ordinary listing-price noise doesn't trigger it.
// "Fair" extends 10% over median, roughly matching typical negotiation headroom.
const GREAT_DEAL_MAX_RATIO = 0.92
const GOOD_DEAL_MAX_RATIO = 1.0
const FAIR_PRICE_MAX_RATIO = 1.1

function vehicleOf(metadata) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {}
  const vehicle = (meta.vehicle && typeof meta.vehicle === 'object') ? meta.vehicle : {}
  return {
    make: String(vehicle.make ?? meta.make ?? '').trim().toLowerCase(),
    model: String(vehicle.model ?? meta.model ?? '').trim().toLowerCase(),
    year: Number(vehicle.year ?? meta.year),
    mileageKm: Number(vehicle.mileageKm ?? meta.mileageKm),
  }
}

// Fetches every APPROVED CARS listing once so callers can rate many listings (a search results
// page, a dealer's whole inventory) in one request without an N+1 query per listing.
export async function loadCarsComparablePool() {
  const rows = await db().listing.findMany({
    where: { status: 'APPROVED', division: 'CARS' },
    select: { id: true, priceMinor: true, metadata: true },
    take: 1000,
  })
  return rows.map((row) => ({ id: row.id, priceMinor: row.priceMinor, vehicle: vehicleOf(row.metadata) }))
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// subject: { id, priceMinor, metadata }. pool: result of loadCarsComparablePool().
// Returns null when the subject itself has no usable vehicle attributes (shouldn't happen for a
// listing that passed carRules(), but kept defensive), otherwise a rating object with `tier: null`
// when there aren't enough comparables to classify confidently.
export function computeDealRating(subject, pool) {
  const target = vehicleOf(subject.metadata)
  if (!target.make || !target.model || !Number.isFinite(target.year) || !Number.isFinite(target.mileageKm)) return null

  const mileageTolerance = Math.max(MIN_MILEAGE_TOLERANCE_KM, target.mileageKm * MILEAGE_TOLERANCE_RATIO)
  const comparablePrices = pool
    .filter((row) => row.id !== subject.id)
    .filter((row) => row.vehicle.make === target.make && row.vehicle.model === target.model)
    .filter((row) => Number.isFinite(row.vehicle.year) && Math.abs(row.vehicle.year - target.year) <= YEAR_TOLERANCE)
    .filter((row) => Number.isFinite(row.vehicle.mileageKm) && Math.abs(row.vehicle.mileageKm - target.mileageKm) <= mileageTolerance)
    .map((row) => row.priceMinor)

  if (comparablePrices.length < MIN_COMPARABLE_COUNT) {
    return { tier: null, comparableCount: comparablePrices.length, medianPriceMinor: null }
  }

  const medianPriceMinor = median(comparablePrices)
  const ratio = subject.priceMinor / medianPriceMinor
  const tier =
    ratio <= GREAT_DEAL_MAX_RATIO ? 'GREAT_DEAL' :
    ratio <= GOOD_DEAL_MAX_RATIO ? 'GOOD_DEAL' :
    ratio <= FAIR_PRICE_MAX_RATIO ? 'FAIR_PRICE' : 'HIGH_PRICE'

  return {
    tier,
    comparableCount: comparablePrices.length,
    medianPriceMinor,
    priceDeltaMinor: subject.priceMinor - medianPriceMinor,
  }
}
