import { db } from './prisma.mjs'

// Synitres module — Property valuation. Classifies a real-estate (BUY/RENTALS) listing's price against
// the median PRICE-PER-M² of comparable APPROVED listings in the same division + city + property type.
// Per-m² (not absolute price) so a big villa and a small apartment in the same area compare fairly.
// Mirrors the car deal-rating engine's shape (comparable pool + median + ratio tiers) and the same
// dual-read metadata pattern the search uses (metadata.<key>, with propertyType also under visualFilters).

const SIZE_TOLERANCE_RATIO = 0.4 // comparables within ±40% of the subject's size
const MIN_COMPARABLE_COUNT = 3

// Ratio of the subject's price-per-m² to the comparable median. A symmetric ~8% band reads as
// "at market"; materially under/over that is below/above market.
const BELOW_MARKET_MAX_RATIO = 0.92
const AT_MARKET_MAX_RATIO = 1.08

function attrsOf(metadata) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {}
  const visual = (meta.visualFilters && typeof meta.visualFilters === 'object') ? meta.visualFilters : {}
  return {
    city: String(meta.city ?? '').trim().toLowerCase(),
    propertyType: String(meta.propertyType ?? visual.propertyType ?? '').trim().toLowerCase(),
    sizeSqm: Number(meta.sizeSqm ?? meta.areaSqm),
  }
}

// Fetch every APPROVED listing of a real-estate division once, so a results page can be valued in a
// single query (no N+1). Only listings with a usable size feed the per-m² comparison.
export async function loadPropertyComparablePool(division) {
  const rows = await db().listing.findMany({
    where: { status: 'APPROVED', division },
    select: { id: true, priceMinor: true, metadata: true },
    take: 1000,
  })
  return rows.map((row) => ({ id: row.id, priceMinor: row.priceMinor, attrs: attrsOf(row.metadata) }))
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// subject: { id, priceMinor, metadata }. pool: result of loadPropertyComparablePool(division).
// Returns null when the subject lacks a usable city/type/size (can't value it), else a valuation object
// with `tier: null` when there aren't enough comparables to classify confidently.
export function computePropertyValuation(subject, pool) {
  const target = attrsOf(subject.metadata)
  if (!target.city || !target.propertyType || !Number.isFinite(target.sizeSqm) || target.sizeSqm <= 0) return null

  const sizeTolerance = target.sizeSqm * SIZE_TOLERANCE_RATIO
  const comparablePerSqm = pool
    .filter((row) => row.id !== subject.id)
    .filter((row) => row.attrs.city === target.city && row.attrs.propertyType === target.propertyType)
    .filter((row) => Number.isFinite(row.attrs.sizeSqm) && row.attrs.sizeSqm > 0 && Math.abs(row.attrs.sizeSqm - target.sizeSqm) <= sizeTolerance)
    .map((row) => row.priceMinor / row.attrs.sizeSqm)

  if (comparablePerSqm.length < MIN_COMPARABLE_COUNT) {
    return { tier: null, comparableCount: comparablePerSqm.length, medianPricePerSqmMinor: null }
  }

  const medianPerSqm = median(comparablePerSqm)
  const subjectPerSqm = subject.priceMinor / target.sizeSqm
  const ratio = subjectPerSqm / medianPerSqm
  const tier =
    ratio <= BELOW_MARKET_MAX_RATIO ? 'BELOW_MARKET' :
    ratio <= AT_MARKET_MAX_RATIO ? 'AT_MARKET' : 'ABOVE_MARKET'

  return {
    tier,
    comparableCount: comparablePerSqm.length,
    medianPricePerSqmMinor: Math.round(medianPerSqm),
    subjectPricePerSqmMinor: Math.round(subjectPerSqm),
    // A fair-value estimate for the subject = median per-m² × its size.
    estimatedValueMinor: Math.round(medianPerSqm * target.sizeSqm),
  }
}
