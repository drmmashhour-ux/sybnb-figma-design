// Jurisdiction compliance (026) — shared helpers around JurisdictionComplianceProfile. Nothing in a
// market can go live until its profile is APPROVED: a STR listing cannot be admin-approved, an SR
// driver document cannot be admin-approved, and an already-approved SR driver cannot claim/work a
// ride, unless the (division, country, region) row here says APPROVED. A missing row fails closed the
// same as a BLOCKED one — a market that was never reviewed is not implicitly allowed.

export const JURISDICTION_REQUIREMENT_CATEGORIES = [
  { key: 'tourism', label: 'tourism accommodation registration' },
  { key: 'transport', label: 'transport / ride-hailing authorization' },
  { key: 'tax', label: 'tax registration' },
  { key: 'platform', label: 'platform operator registration' },
]

// SR has no per-driver country field yet (see prisma/schema.prisma DriverProfile) and rides are
// already server-side geofenced to Syria (assertSyriaCoords in this same lib) — so every SR driver
// today is, by construction, operating in one single jurisdiction. Once SR ever onboards drivers
// outside Syria this must read a real per-driver country instead of a constant.
export function resolveDriverJurisdiction() {
  return { division: 'SR', countryCode: 'SY', regionCode: '' }
}

// STR jurisdiction lives in Listing.metadata (there is no typed country/governorate column on
// Listing itself) — metadata.country is 'SY'|'CA' (absent on legacy listings predating the Quebec
// work, which default to 'SY'), metadata.governorate is the province/governorate key (e.g. 'quebec').
export function resolveListingJurisdiction(listing) {
  const metadata = listing?.metadata && typeof listing.metadata === 'object' ? listing.metadata : {}
  const countryCode = typeof metadata.country === 'string' && metadata.country ? metadata.country : 'SY'
  const regionCode = countryCode === 'CA' && typeof metadata.governorate === 'string' ? metadata.governorate : ''
  return { division: 'STR', countryCode, regionCode }
}

export async function getJurisdictionProfile(db, { division, countryCode, regionCode }) {
  return db.jurisdictionComplianceProfile.findUnique({
    where: { division_countryCode_regionCode: { division, countryCode, regionCode: regionCode || '' } },
  })
}

// Labels of every requirement the profile marks required but not yet satisfied. A profile can be
// APPROVED with some requirements not "satisfied" in the checklist sense (e.g. an owner-level manual
// override) — this is informational for the admin panel, not itself a gate.
export function missingJurisdictionRequirements(profile) {
  if (!profile) return JURISDICTION_REQUIREMENT_CATEGORIES.map((c) => c.label)
  return JURISDICTION_REQUIREMENT_CATEGORIES
    .filter((c) => profile[`${c.key}Required`] && !profile[`${c.key}Satisfied`])
    .map((c) => c.label)
}

// Throws a 403 an admin/host/driver can act on. Called at the moment something would "go live":
// a listing/driver-document approval, or an already-approved driver claiming/working a ride.
export async function assertJurisdictionApproved(db, jurisdiction, { subject = 'This market' } = {}) {
  const profile = await getJurisdictionProfile(db, jurisdiction)
  if (profile?.status === 'APPROVED') return profile

  const missing = missingJurisdictionRequirements(profile)
  const error = new Error(
    profile?.status === 'BLOCKED'
      ? `${subject} is currently paused pending legal/compliance review (${jurisdiction.countryCode}${jurisdiction.regionCode ? '/' + jurisdiction.regionCode : ''}).`
      : `${subject} is not yet approved to go live (${jurisdiction.countryCode}${jurisdiction.regionCode ? '/' + jurisdiction.regionCode : ''}) — still needed: ${missing.join(', ')}.`,
  )
  error.statusCode = 403
  error.code = 'JURISDICTION_NOT_APPROVED'
  error.expose = true
  error.details = { division: jurisdiction.division, countryCode: jurisdiction.countryCode, regionCode: jurisdiction.regionCode, status: profile?.status || 'NOT_REVIEWED', missing }
  throw error
}
