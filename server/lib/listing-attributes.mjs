import { isValidMarketplaceCategory } from './marketplace-categories.mjs'

// Required structured attributes per division. A listing can be DRAFTed with partial data (the wizard
// saves as you go), but it cannot be SUBMITTED for review — i.e. cannot go live — until the buyer-
// facing facts a real marketplace needs are all present and sane. This is the "truth over appearance"
// guard for the catalog: no car listed without a mileage, no property without an area, etc.
//
// Attribute values live in Listing.metadata (Json). Property fields are read as the same flat keys the
// public search already filters on (metadata.governorate/city/propertyType/bedrooms/bathrooms), so the
// wizard writes one vocabulary end to end. Car fields are read from metadata.vehicle.* first, falling
// back to flat metadata.* so either shape the wizard uses is accepted.

// Divisions that must carry at least one real photo before they can be submitted. STAYS is excluded:
// hotel-style STAYS listings share photos at the parent Accommodation level, and their host wizard has
// its own media flow — this guard governs the marketplace-style catalog divisions only.
export const PHOTO_REQUIRED_DIVISIONS = new Set([
  'CARS',
  'MARKETPLACE',
  'NEW_CONSTRUCTION',
  'RENTALS',
  'BUY',
])

const CONDITION_VALUES = new Set(['NEW', 'USED', 'EXCELLENT', 'GOOD', 'FAIR', 'REFURBISHED'])

function str(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function pick(metadata, key, nested) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {}
  if (nested && meta[nested] && typeof meta[nested] === 'object' && meta[nested][key] !== undefined) {
    return meta[nested][key]
  }
  return meta[key]
}

function isFilledString(value) {
  return str(value).length > 0
}

function isNumberInRange(value, min, max, { integer = false } = {}) {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return false
  if (integer && !Number.isInteger(num)) return false
  return num >= min && num <= max
}

// Each rule: { key, label, valid(metadata) }. `valid` returns true when the attribute is present and
// well-formed. Labels are what the seller sees in the "still missing" list.
function propertyRules() {
  return [
    { key: 'propertyType', label: 'property type', valid: (m) => isFilledString(pick(m, 'propertyType')) },
    { key: 'governorate', label: 'governorate', valid: (m) => isFilledString(pick(m, 'governorate')) },
    { key: 'city', label: 'city', valid: (m) => isFilledString(pick(m, 'city')) },
    { key: 'bedrooms', label: 'number of bedrooms', valid: (m) => isNumberInRange(pick(m, 'bedrooms'), 0, 50, { integer: true }) },
    { key: 'bathrooms', label: 'number of bathrooms', valid: (m) => isNumberInRange(pick(m, 'bathrooms'), 0, 50, { integer: true }) },
    { key: 'areaSqm', label: 'area (m²)', valid: (m) => isNumberInRange(pick(m, 'areaSqm'), 1, 1_000_000) },
  ]
}

function carRules() {
  const currentYear = new Date().getFullYear()
  return [
    { key: 'make', label: 'make', valid: (m) => isFilledString(pick(m, 'make', 'vehicle')) },
    { key: 'model', label: 'model', valid: (m) => isFilledString(pick(m, 'model', 'vehicle')) },
    { key: 'year', label: 'year', valid: (m) => isNumberInRange(pick(m, 'year', 'vehicle'), 1900, currentYear + 1, { integer: true }) },
    { key: 'mileageKm', label: 'mileage (km)', valid: (m) => isNumberInRange(pick(m, 'mileageKm', 'vehicle'), 0, 2_000_000) },
    { key: 'transmission', label: 'transmission', valid: (m) => isFilledString(pick(m, 'transmission', 'vehicle')) },
    { key: 'fuelType', label: 'fuel type', valid: (m) => isFilledString(pick(m, 'fuelType', 'vehicle')) },
    {
      key: 'condition',
      label: 'condition',
      valid: (m) => {
        const v = str(pick(m, 'condition', 'vehicle')).toUpperCase()
        return v.length > 0 && CONDITION_VALUES.has(v)
      },
    },
  ]
}

function marketplaceRules() {
  return [
    // Category must be one of the marketplace category tree's top-level ids (Facebook-style catalog).
    { key: 'category', label: 'category', valid: (m) => isValidMarketplaceCategory(pick(m, 'category')) },
    {
      key: 'condition',
      label: 'condition',
      valid: (m) => {
        const v = str(pick(m, 'condition')).toUpperCase()
        return v.length > 0 && CONDITION_VALUES.has(v)
      },
    },
  ]
}

// Quebec law requires a tourist accommodation registration number (CITQ) and liability insurance
// before a unit is offered for stays of 31 days or less -- see the seller wizard's Quebec compliance
// step (src/modules/seller/SellerListingWizard.tsx). Client-side checks alone can be bypassed by a
// direct API call, so this mirrors the same two requirements server-side. Only applies when the
// listing's own metadata.country is 'CA' -- Syria (and any other market) STAYS listings are untouched.
function quebecStrRules(metadata) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {}
  if (meta.country !== 'CA') return []
  return [
    {
      key: 'citqRegistrationNumber',
      label: 'Quebec tourist accommodation registration number (CITQ)',
      valid: (m) => isFilledString(pick(m, 'citqRegistrationNumber')),
    },
    {
      // Jurisdiction pricing engine (030): a CITQ certificate expires and must be renewed. Missing
      // or already-expired blocks approval the same as a missing registration number -- re-verified
      // here (not just in the wizard) so a direct API call can't submit an expired/absent date.
      key: 'citqCertificateExpiresAt',
      label: 'CITQ certificate expiry date (must be a future date)',
      valid: (m) => {
        const raw = pick(m, 'citqCertificateExpiresAt')
        if (!isFilledString(raw)) return false
        const expiry = new Date(raw)
        return !Number.isNaN(expiry.getTime()) && expiry.getTime() > Date.now()
      },
    },
    {
      key: 'insuranceProof',
      label: 'liability insurance proof ($2M CAD)',
      valid: (m) => !Array.isArray(m.missingQuebecComplianceSlots) || m.missingQuebecComplianceSlots.length === 0,
    },
    {
      key: 'residencyType',
      label: 'property residency type (principal residence or investment property)',
      valid: (m) => ['principal', 'investment'].includes(str(pick(m, 'residencyType'))),
    },
    {
      // The wizard computes and locks this client-side (SellerListingWizard.tsx's
      // QUEBEC_LODGING_TAX_RATE effect) so it can't drift from Revenu Québec's real 3.5% Tax on
      // Lodging -- re-verified here so a direct API call can't submit an arbitrary tax figure instead.
      key: 'lodgingTax',
      label: "Revenu Québec's 3.5% Tax on Lodging, calculated on the nightly rate",
      valid: (m) => {
        const nightlyPriceMinor = Number(m.guestVisibleFees?.nightlyPriceMinor ?? m.priceMinor)
        const taxFeeMinor = Number(m.taxFeeMinor)
        if (!Number.isFinite(nightlyPriceMinor) || nightlyPriceMinor <= 0 || !Number.isFinite(taxFeeMinor)) return false
        const expectedMinor = Math.round(nightlyPriceMinor * 0.035)
        return Math.abs(taxFeeMinor - expectedMinor) <= 1
      },
    },
  ]
}

export function requiredAttributeRules(division, metadata) {
  switch (division) {
    case 'CARS':
      return carRules()
    case 'MARKETPLACE':
      return marketplaceRules()
    case 'NEW_CONSTRUCTION':
    case 'RENTALS':
    case 'BUY':
      return propertyRules()
    case 'STAYS':
      return quebecStrRules(metadata)
    default:
      return []
  }
}

// Returns the human labels of every required attribute that is missing or malformed. Empty array = ok.
export function missingListingAttributes(division, metadata) {
  return requiredAttributeRules(division, metadata)
    .filter((rule) => !rule.valid(metadata || {}))
    .map((rule) => rule.label)
}

// Throws a 400 the seller can act on, listing exactly which fields still need filling. Called at submit
// time only — never at draft-create, so a half-finished draft can still be saved.
export function assertListingAttributes(division, metadata) {
  const missing = missingListingAttributes(division, metadata)
  if (missing.length) {
    const error = new Error(`This listing can't be submitted yet — still needed: ${missing.join(', ')}.`)
    error.statusCode = 400
    error.code = 'LISTING_ATTRIBUTES_INCOMPLETE'
    error.expose = true
    error.details = { missing }
    throw error
  }
}
