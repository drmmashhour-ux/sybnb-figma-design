// Tax-compliance foundation (029) — explicit, admin-approved gates for regulatory behavior that must
// never silently activate. Two flags exist today:
//   RIDE_GOVERNMENT_REMITTANCE_ACTIVE -- a government remittance amount on SYBNB Ride driver
//     statements. No specific Québec/Canadian remittance program, rate, or collector is confirmed as
//     of this writing -- this is a placeholder gate, not a real filed program. It is entirely separate
//     from SYBNB's own progressive ride commission (server/lib/sr-payments.mjs), which is a commercial
//     fee, always active per policy, and never controlled by this flag. Do not enable until a specific
//     program is confirmed by CTQ/Revenu Québec and reviewed by counsel.
//   STAY_TAX_PLATFORM_COLLECTION -- SYBNB collecting GST/QST at Stay checkout for non-registered hosts.
// Both default OFF and CANNOT be turned on without approvedById + approvedAt recorded together --
// enforced here, not left to callers to remember. There is no code path anywhere that activates
// either flag as a side effect of anything else (a deploy, a migration, a schema default).
export const RIDE_GOVERNMENT_REMITTANCE_ACTIVE = 'RIDE_GOVERNMENT_REMITTANCE_ACTIVE'
export const STAY_TAX_PLATFORM_COLLECTION = 'STAY_TAX_PLATFORM_COLLECTION'
export const KNOWN_FLAGS = [RIDE_GOVERNMENT_REMITTANCE_ACTIVE, STAY_TAX_PLATFORM_COLLECTION]

function fail(code, message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}

// Missing row === disabled (fail closed), same principle as JurisdictionComplianceProfile: a flag
// that was never reviewed is not implicitly on.
export async function isFeatureEnabled(db, key) {
  const flag = await db.complianceFeatureFlag.findUnique({ where: { key } })
  return flag?.enabled === true
}

export async function getFeatureFlag(db, key) {
  return db.complianceFeatureFlag.findUnique({ where: { key } })
}

export async function listFeatureFlags(db) {
  const existing = await db.complianceFeatureFlag.findMany({ where: { key: { in: KNOWN_FLAGS } } })
  const byKey = new Map(existing.map((f) => [f.key, f]))
  // Every known flag always appears, even if never explicitly created -- so the admin dashboard shows
  // "not yet configured / disabled" instead of silently omitting a flag that was never touched.
  return KNOWN_FLAGS.map((key) => byKey.get(key) || { id: null, key, enabled: false, note: null, approvedById: null, approvedAt: null })
}

// Enabling REQUIRES an actor and is recorded as an admin audit entry by the caller (the route layer),
// so "who approved this and when" is never just a database timestamp with no accountable actor.
// Disabling never requires approval fields -- turning a regulatory behavior back OFF is always safe.
export async function setFeatureFlag(db, { key, enabled, note, actorId }) {
  if (!KNOWN_FLAGS.includes(key)) fail('COMPLIANCE_FLAG_UNKNOWN', `${key} is not a recognized compliance feature flag.`)
  if (enabled && !actorId) fail('COMPLIANCE_FLAG_APPROVAL_REQUIRED', 'Enabling a compliance feature flag requires a recorded approving admin.')

  return db.complianceFeatureFlag.upsert({
    where: { key },
    create: { key, enabled, note: note || null, approvedById: enabled ? actorId : null, approvedAt: enabled ? new Date() : null },
    update: { enabled, note: note || null, approvedById: enabled ? actorId : null, approvedAt: enabled ? new Date() : null },
  })
}
