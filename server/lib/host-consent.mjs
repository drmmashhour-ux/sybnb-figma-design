// M6 — host commission/contract consent gate. The host must SEE + ACCEPT the current commission contract
// (with the "gross − commission = your payout" preview) before PUBLISHING a listing and before ACCEPTING a
// booking. Consent is USER-level (current version + timestamp), re-affirmed and timestamped at EACH publish
// and EACH acceptance, and every acceptance writes an AdminAuditLog row. Storage is metadata-based — no
// migration. Bumping the version (e.g. for the M2 commission-base change) forces existing hosts to
// re-consent at their next publish/accept; already-issued bookings keep their own recorded terms.

// Bumped whenever host economics change. v2: commission base = accommodation + cleaning. v3: disclose that
// the host bears the Stripe card processing fee (net payout = gross − card fee; local Sham Cash has no fee).
export const STR_HOST_CONTRACT_VERSION = 'str-host-commission-v3-card-fee'
export const HOST_CONTRACT_AUDIT_ACTION = 'HOST_CONTRACT_ACCEPTED'
export const CONTRACT_CONSENT_REQUIRED_CODE = 'HOST_CONTRACT_CONSENT_REQUIRED'

// Hard-block (403) unless the request explicitly accepts the CURRENT contract version. The client always
// shows the contract + payout preview and sends { acceptContract: true, contractVersion } on the action.
export function assertContractConsentAccepted(body) {
  if (body?.acceptContract !== true || body?.contractVersion !== STR_HOST_CONTRACT_VERSION) {
    const error = new Error('Review and accept the current commission contract before continuing.')
    error.statusCode = 403
    error.code = CONTRACT_CONSENT_REQUIRED_CODE
    error.expose = true
    error.expected = { contractVersion: STR_HOST_CONTRACT_VERSION }
    throw error
  }
}

// Record (re-affirm) the host's acceptance of the current contract version at a given action point. The
// User model has no free-form metadata column (only payoutMethod), so the USER-LEVEL consent record IS the
// append-only AdminAuditLog row: actorUserId (the host) + createdAt (the timestamp) + after.version +
// after.rate. `rate` is the RESOLVED commission rate the host consented to for THIS listing's jurisdiction
// (the caller resolves it via resolveStrCommissionRate and passes it in — never a hardcoded default, so a
// jurisdiction with a non-13% JurisdictionCommissionPolicy logs its own rate). Each publish/accept writes a
// fresh row, giving the full re-consent audit trail. Accepts a db or a tx.
export async function recordHostContractConsent(dbOrTx, { userId, action, entityId, rate }) {
  const acceptedAt = new Date().toISOString()
  await dbOrTx.adminAuditLog.create({
    data: { actorUserId: userId, action: HOST_CONTRACT_AUDIT_ACTION, entityType: 'host_contract', entityId: entityId || userId, after: { version: STR_HOST_CONTRACT_VERSION, rate: rate ?? null, acceptedAt, at: action } },
  })
  return acceptedAt
}

// Latest recorded acceptance (version + timestamp) for a host, derived from the audit trail.
export async function latestHostContractConsent(dbOrTx, userId) {
  const row = await dbOrTx.adminAuditLog.findFirst({ where: { action: HOST_CONTRACT_AUDIT_ACTION, actorUserId: userId }, orderBy: { createdAt: 'desc' } })
  return row?.after || null
}
