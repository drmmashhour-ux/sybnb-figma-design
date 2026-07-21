import { assertBoundedString, assertEnum } from './validate.mjs'
import { decryptSensitive, encryptSensitive, lastFour, maskedDisplay } from './tax-encryption.mjs'

export const TAX_SUBJECT_TYPES = ['DRIVER', 'HOST']
export const TAX_IDENTIFIER_TYPES = ['SIN', 'TIN', 'OTHER']
export const TAX_BUSINESS_TYPES = ['INDIVIDUAL', 'BUSINESS']
export const GST_QST_TREATMENTS = ['HOST_REGISTERED', 'PLATFORM_COLLECTS']

function fail(code, message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}

// Never returns taxIdentifierCiphertext / payoutAccountCiphertext -- only the last-4 masked display
// fragments. This is the ONLY shape a tax profile should ever leave the server in, for any caller
// (self-view, admin-view, dashboard aggregation) -- there is no "full identifier" API response path.
export function redactTaxProfile(profile) {
  if (!profile) return null
  const {
    taxIdentifierCiphertext,
    payoutAccountCiphertext,
    ...safe
  } = profile
  return {
    ...safe,
    taxIdentifierMasked: profile.taxIdentifierLast4 ? maskedDisplay(profile.taxIdentifierLast4) : null,
    payoutAccountMasked: profile.payoutAccountLast4 ? maskedDisplay(profile.payoutAccountLast4) : null,
  }
}

// SECURITY: decrypts the real identifier for an authorized reviewer only. Never exposed via a JSON
// route directly -- callers that need this (e.g. a future admin "reveal" action with its own
// audit-logged endpoint) must call it explicitly; the default read path is always redactTaxProfile.
export function revealTaxIdentifier(profile) {
  return decryptSensitive(profile.taxIdentifierCiphertext)
}
export function revealPayoutAccount(profile) {
  if (!profile.payoutAccountCiphertext) return null
  return decryptSensitive(profile.payoutAccountCiphertext)
}

const COMMON_REQUIRED_FIELDS = [
  'legalFirstName', 'legalLastName', 'addressLine1', 'city', 'region', 'postalCode', 'country',
  'taxResidenceCountry', 'taxIdentifierType', 'taxIdentifier', 'payoutAccountIdentifier',
]

function validateTaxProfileInput(subjectType, body) {
  assertEnum(subjectType, TAX_SUBJECT_TYPES, 'subjectType')

  for (const field of COMMON_REQUIRED_FIELDS) {
    if (!body[field] || !String(body[field]).trim()) {
      fail('TAX_PROFILE_FIELD_REQUIRED', `${field} is required.`)
    }
  }
  assertEnum(String(body.taxIdentifierType).toUpperCase(), TAX_IDENTIFIER_TYPES, 'taxIdentifierType')

  const businessType = body.businessType ? String(body.businessType).toUpperCase() : 'INDIVIDUAL'
  assertEnum(businessType, TAX_BUSINESS_TYPES, 'businessType')
  if (businessType === 'INDIVIDUAL' && !body.dateOfBirth) {
    fail('TAX_PROFILE_DOB_REQUIRED', 'dateOfBirth is required for an individual tax profile.')
  }
  if (businessType === 'BUSINESS' && !String(body.legalBusinessName || '').trim()) {
    fail('TAX_PROFILE_BUSINESS_NAME_REQUIRED', 'legalBusinessName is required when businessType is BUSINESS.')
  }

  if (body.consentRegulatoryReporting !== true) {
    fail('TAX_PROFILE_CONSENT_REQUIRED', 'Consent to required regulatory reporting must be given.')
  }
  if (body.certifiedAccurate !== true) {
    fail('TAX_PROFILE_CERTIFICATION_REQUIRED', 'You must certify that the information provided is accurate.')
  }

  const dob = body.dateOfBirth ? new Date(body.dateOfBirth) : null
  if (body.dateOfBirth && Number.isNaN(dob?.getTime())) fail('TAX_PROFILE_DOB_INVALID', 'dateOfBirth is not a valid date.')

  return {
    legalFirstName: assertBoundedString(body.legalFirstName, { fieldName: 'legalFirstName', maxLength: 120, required: true }),
    legalLastName: assertBoundedString(body.legalLastName, { fieldName: 'legalLastName', maxLength: 120, required: true }),
    legalBusinessName: assertBoundedString(body.legalBusinessName, { fieldName: 'legalBusinessName', maxLength: 200 }) || null,
    businessType,
    dateOfBirth: dob,
    addressLine1: assertBoundedString(body.addressLine1, { fieldName: 'addressLine1', maxLength: 200, required: true }),
    addressLine2: assertBoundedString(body.addressLine2, { fieldName: 'addressLine2', maxLength: 200 }) || null,
    city: assertBoundedString(body.city, { fieldName: 'city', maxLength: 120, required: true }),
    region: assertBoundedString(body.region, { fieldName: 'region', maxLength: 120, required: true }),
    postalCode: assertBoundedString(body.postalCode, { fieldName: 'postalCode', maxLength: 20, required: true }),
    country: assertBoundedString(body.country, { fieldName: 'country', maxLength: 2, required: true }).toUpperCase(),
    taxResidenceCountry: assertBoundedString(body.taxResidenceCountry, { fieldName: 'taxResidenceCountry', maxLength: 2, required: true }).toUpperCase(),
    taxResidenceRegion: assertBoundedString(body.taxResidenceRegion, { fieldName: 'taxResidenceRegion', maxLength: 120 }) || null,
    taxIdentifierType: String(body.taxIdentifierType).toUpperCase(),
    taxIdentifierPlain: assertBoundedString(body.taxIdentifier, { fieldName: 'taxIdentifier', maxLength: 64, required: true }),
    gstRegistered: body.gstRegistered === true,
    gstNumber: assertBoundedString(body.gstNumber, { fieldName: 'gstNumber', maxLength: 40 }) || null,
    qstRegistered: body.qstRegistered === true,
    qstNumber: assertBoundedString(body.qstNumber, { fieldName: 'qstNumber', maxLength: 40 }) || null,
    neqNumber: assertBoundedString(body.neqNumber, { fieldName: 'neqNumber', maxLength: 40 }) || null,
    payoutAccountPlain: assertBoundedString(body.payoutAccountIdentifier, { fieldName: 'payoutAccountIdentifier', maxLength: 64, required: true }),
    consentRegulatoryReporting: true,
    certifiedAccurate: true,
    certifiedAccurateAt: new Date(),
  }
}

// Create-or-update a driver/host tax profile. Any resubmission resets verificationStatus back to
// PENDING_REVIEW (mirrors the existing ID-document pattern: a changed submission always needs a
// fresh human look, never silently keeps a prior APPROVED against new data).
export async function upsertTaxProfile(tx, { userId, subjectType, body }) {
  const validated = validateTaxProfileInput(subjectType, body)
  const { taxIdentifierPlain, payoutAccountPlain, ...rest } = validated

  const data = {
    ...rest,
    subjectType,
    taxIdentifierCiphertext: encryptSensitive(taxIdentifierPlain),
    taxIdentifierLast4: lastFour(taxIdentifierPlain),
    payoutAccountCiphertext: encryptSensitive(payoutAccountPlain),
    payoutAccountLast4: lastFour(payoutAccountPlain),
    verificationStatus: 'PENDING_REVIEW',
    verificationSource: null,
    verifiedAt: null,
    verifiedById: null,
  }

  return tx.taxProfile.upsert({
    where: { userId_subjectType: { userId, subjectType } },
    create: { userId, ...data },
    update: data,
  })
}

// HOST only. Explicit, never-inferred decision of which GST/QST tax treatment applies (server/lib/
// quebec-stay-tax.mjs) -- recorded with who decided it, when, and the date it takes effect, so a
// Stay statement generated for a booking can look up "what was the decision in effect on this
// booking's date" rather than always using whatever the CURRENT decision is (never retroactive).
export async function recordGstQstTreatment(tx, { taxProfileId, treatment, effectiveAt, decidedById }) {
  assertEnum(treatment, GST_QST_TREATMENTS, 'treatment')
  const profile = await tx.taxProfile.findUnique({ where: { id: taxProfileId } })
  if (!profile || profile.subjectType !== 'HOST') fail('TAX_PROFILE_NOT_HOST', 'Only a host tax profile can record a GST/QST treatment decision.', 404)

  return tx.taxProfile.update({
    where: { id: taxProfileId },
    data: {
      gstQstTreatment: treatment,
      gstQstTreatmentEffectiveAt: effectiveAt ? new Date(effectiveAt) : new Date(),
      gstQstTreatmentDecidedById: decidedById,
      gstQstTreatmentDecidedAt: new Date(),
    },
  })
}

// Revenu Québec requires a rideshare driver to be GST/QST-registered before their first paid
// Quebec ride. Quebec SR cannot actually go live yet
// (resolveDriverJurisdiction() in jurisdiction-compliance.mjs hardcodes Syria, and ride creation is
// geofenced to Syria coordinates), so this can never fire today -- it exists so the gate is real and
// tested the moment a driver's country is ever something other than 'SY'.
export async function assertDriverGstQstRegisteredForQuebec(tx, driverId) {
  const driverProfile = await tx.driverProfile.findUnique({ where: { userId: driverId }, select: { country: true } })
  if (driverProfile?.country !== 'CA') return // gate only applies to Quebec-registered drivers

  const taxProfile = await tx.taxProfile.findUnique({ where: { userId_subjectType: { userId: driverId, subjectType: 'DRIVER' } } })
  if (!taxProfile || !taxProfile.gstRegistered || !taxProfile.qstRegistered || taxProfile.verificationStatus !== 'APPROVED') {
    const error = new Error('Quebec drivers must have a verified, GST/QST-registered tax profile before accepting paid rides.')
    error.statusCode = 403
    error.code = 'DRIVER_GST_QST_REGISTRATION_REQUIRED'
    error.expose = true
    throw error
  }
}
