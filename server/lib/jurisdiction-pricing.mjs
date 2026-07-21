// Jurisdiction-based pricing engine (030) — the resolver behind "never hardcode one Canadian tax
// rate for every province." A JurisdictionTaxRate/JurisdictionCommissionPolicy row is only ever
// applied when active=true; every existing hardcoded constant (SR_COMMISSION_TIERS,
// quebec-stay-tax.mjs's rates, STR_ADMIN_COMMISSION_RATE) remains the fallback default a caller
// uses when the resolver finds nothing active for that jurisdiction -- so seeding these tables does
// NOT change any existing booking/ride's math until a human explicitly activates a row.

function fail(code, message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}

// Integer, parts-per-million (1% = 10,000 parts) -- exact for Quebec's real rates, including the
// fractional 9.975% QST (997,500 parts), with no float-storage ambiguity.
export function partsToRatio(rateParts) {
  return (rateParts || 0) / 1_000_000
}

export function computeTaxAmountMinor(baseMinor, rateParts) {
  const base = Math.max(0, Math.round(baseMinor || 0))
  return Math.round(base * partsToRatio(rateParts))
}

// Most-specific-first: an exact municipality match beats a province-wide row, which beats a
// country-wide row. Only ever considers active=true rows whose effective window covers asOf.
function specificityScore(row, { province, municipality }) {
  let score = 0
  if (row.municipality && row.municipality === municipality) score += 4
  else if (row.municipality) score -= 100 // a row scoped to a DIFFERENT municipality never matches
  if (row.province && row.province === province) score += 2
  else if (row.province) score -= 100
  return score
}

function withinWindow(row, asOf) {
  if (row.effectiveFrom > asOf) return false
  if (row.effectiveTo && row.effectiveTo <= asOf) return false
  return true
}

// Returns every active, in-window tax row for this (country, province, municipality, serviceType)
// -- one entry per taxType, picking the most specific match when more than one row could apply
// (e.g. a province-wide QST row and a municipality-specific one).
export async function resolveTaxRates(db, { country, province, municipality, serviceType, asOf = new Date() }) {
  const candidates = await db.jurisdictionTaxRate.findMany({
    where: {
      country,
      serviceType,
      active: true,
      OR: [{ province: null }, { province }],
      effectiveFrom: { lte: asOf },
    },
  })
  const inWindow = candidates.filter((row) => withinWindow(row, asOf) && (row.municipality == null || row.municipality === municipality))

  const byTaxType = new Map()
  for (const row of inWindow) {
    const existing = byTaxType.get(row.taxType)
    if (!existing || specificityScore(row, { province, municipality }) > specificityScore(existing, { province, municipality })) {
      byTaxType.set(row.taxType, row)
    }
  }
  return Array.from(byTaxType.values())
}

// Most-specific active commission policy for (country, province, serviceType). Returns null if
// none is active -- the caller then uses its own hardcoded default (SR_COMMISSION_TIERS /
// STR_ADMIN_COMMISSION_RATE), which is exactly what happens today since nothing is seeded active.
export async function resolveCommissionPolicy(db, { country, province, serviceType, asOf = new Date() }) {
  const candidates = await db.jurisdictionCommissionPolicy.findMany({
    where: {
      serviceType,
      active: true,
      OR: [{ country: null }, { country }],
      effectiveFrom: { lte: asOf },
    },
  })
  const inWindow = candidates.filter((row) => withinWindow(row, asOf) && (row.province == null || row.province === province))
  if (!inWindow.length) return null

  inWindow.sort((a, b) => {
    const scoreA = (a.province ? 2 : 0) + (a.country ? 1 : 0)
    const scoreB = (b.province ? 2 : 0) + (b.country ? 1 : 0)
    return scoreB - scoreA
  })
  return inWindow[0]
}

// ---- Admin write path: mirrors compliance-feature-flags.mjs's approval discipline. A row can be
// created inactive freely; flipping active=true (or creating one already active) requires a
// recorded actor -- there is no path to activate a jurisdiction anonymously. ----
export async function upsertTaxRate(db, { id, active, legallyReviewedById, ...fields }) {
  if (active && !legallyReviewedById) {
    fail('JURISDICTION_ACTIVATION_REQUIRES_REVIEWER', 'Activating a jurisdiction tax rate requires a recorded legally-reviewing admin.')
  }
  const data = {
    ...fields,
    active: active === true,
    legallyReviewedById: active ? legallyReviewedById : null,
    legallyReviewedAt: active ? new Date() : null,
  }
  if (id) return db.jurisdictionTaxRate.update({ where: { id }, data })
  return db.jurisdictionTaxRate.create({ data })
}

export async function upsertCommissionPolicy(db, { id, active, legallyReviewedById, ...fields }) {
  if (active && !legallyReviewedById) {
    fail('JURISDICTION_ACTIVATION_REQUIRES_REVIEWER', 'Activating a jurisdiction commission policy requires a recorded legally-reviewing admin.')
  }
  const data = {
    ...fields,
    active: active === true,
    legallyReviewedById: active ? legallyReviewedById : null,
    legallyReviewedAt: active ? new Date() : null,
  }
  if (id) return db.jurisdictionCommissionPolicy.update({ where: { id }, data })
  return db.jurisdictionCommissionPolicy.create({ data })
}

// Immutable pricing snapshot -- called once, at the moment a quote/ride/booking is priced. Never
// updated afterward. subjectType is 'SR_QUOTE' | 'SR_RIDE' | 'STR_BOOKING'.
export async function savePricingSnapshot(db, { subjectType, subjectId, country, province, breakdown }) {
  return db.pricingSnapshot.create({
    data: { subjectType, subjectId, country, province: province || null, breakdown },
  })
}
