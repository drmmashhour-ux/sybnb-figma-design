// SYB-011 — governed MANUAL host payout support for the closed beta. No external money-movement rail.
//
// Two governed pieces, both without a schema change (owner-approved P-1):
//   1. Registration: the host records WHERE to be paid, into the existing User.payoutMethod Json column.
//      Minimum fields only; sensitive detail is masked on read.
//   2. Disbursement lifecycle: staff move money by hand off-platform and RECORD each state transition as
//      an AdminAuditLog event (append-only), never by mutating the authoritative wallet ledger. The
//      internal RELEASE WalletEntry remains the source of truth for "money owed"; these events record
//      "money actually sent." No event ever claims funds transferred before staff record completion.
//
// The Ride payout path (driverProfile.payoutMethod / SR Sham Cash) is deliberately NOT reused.

export const HOST_PAYOUT_POLICY_VERSION = 'host-payout-v1'

// Approved beta payout methods and their minimum required fields. Sham Cash is the primary method.
export const APPROVED_PAYOUT_METHODS = {
  sham_cash: ['receiverName', 'phone'],
  bank_transfer: ['receiverName', 'accountRef'],
}

// Disbursement lifecycle states. PENDING_REVIEW/READY are derived from ledger state (a RELEASE entry
// exists); the rest are staff-recorded transitions.
export const PAYOUT_LIFECYCLE = ['PENDING_REVIEW', 'READY', 'INITIATED', 'COMPLETED', 'FAILED', 'DISPUTED']
export const PAYOUT_AUDIT_ACTIONS = {
  INITIATED: 'HOST_PAYOUT_INITIATED',
  COMPLETED: 'HOST_PAYOUT_COMPLETED',
  FAILED: 'HOST_PAYOUT_FAILED',
  DISPUTED: 'HOST_PAYOUT_DISPUTED',
}

function payoutError(message, code, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  return error
}

/**
 * Validate and normalize a host-submitted payout destination. Returns the shape to store in
 * User.payoutMethod. Rejects unknown types, missing required fields, and oversized values. Stores only
 * the minimum necessary data — never a password, card number, or government id (those belong behind the
 * deferred production KYC rail, not this beta form).
 */
export function normalizePayoutMethod(input) {
  if (!input || typeof input !== 'object') throw payoutError('A payout method is required.', 'PAYOUT_METHOD_REQUIRED')
  const type = String(input.type || '').toLowerCase()
  const required = APPROVED_PAYOUT_METHODS[type]
  if (!required) throw payoutError('Unsupported payout method type.', 'PAYOUT_METHOD_TYPE_INVALID')

  const out = { type, version: 1 }
  for (const field of required) {
    const value = input[field]
    if (typeof value !== 'string' || !value.trim()) {
      throw payoutError(`"${field}" is required for this payout method.`, 'PAYOUT_METHOD_FIELD_REQUIRED')
    }
    if (value.length > 120) throw payoutError(`"${field}" is too long.`, 'PAYOUT_METHOD_FIELD_TOO_LONG')
    out[field] = value.trim()
  }
  // Reject any field that is not part of the approved minimum for this method (defence-in-depth: no
  // stray sensitive data smuggled into the JSON).
  const allowed = new Set(['type', ...required])
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw payoutError(`Unexpected payout field "${key}".`, 'PAYOUT_METHOD_UNKNOWN_FIELD')
  }
  return out
}

// Mask sensitive detail for host-facing display: keep the type + receiver name, mask phone/account to
// the last 2–4 chars. Never returns the raw phone/account in full.
export function maskPayoutMethod(method) {
  if (!method || typeof method !== 'object') return null
  const maskTail = (v) => {
    const s = String(v || '')
    if (s.length <= 3) return '•••'
    return `••••${s.slice(-3)}`
  }
  const out = { type: method.type, receiverName: method.receiverName }
  if (method.phone) out.phone = maskTail(method.phone)
  if (method.accountRef) out.accountRef = maskTail(method.accountRef)
  return out
}

// F1 — disburse idempotency state machine. Each transition atomically moves Payout.status from a set of
// permitted "from" states to a single "to" state (server/routes/admin.mjs), so a retried/double-clicked
// transition finds the row already moved (updateMany affected 0) and is rejected instead of recording a
// duplicate. INITIATED claims a pre-disburse payout; COMPLETED/FAILED close out an in-progress one.
export const DISBURSE_STATUS_TRANSITIONS = {
  INITIATED: { from: ['PENDING_HOLD', 'ELIGIBLE', 'RELEASED'], to: 'DISBURSING' },
  COMPLETED: { from: ['DISBURSING'], to: 'DISBURSED' },
  FAILED: { from: ['DISBURSING'], to: 'RELEASED' }, // revert so a failed send can be retried
  DISPUTED: { from: ['DISBURSING', 'DISBURSED'], to: 'DISPUTED' },
}

// Validates the transition input WITHOUT writing anything, so the disburse handler can reject a bad request
// (400) before it atomically claims the payout — a validation failure must never advance the payout status.
export function assertPayoutTransitionInput({ transition, reason, reference }) {
  if (!PAYOUT_AUDIT_ACTIONS[transition]) throw payoutError('Unknown payout transition.', 'PAYOUT_TRANSITION_INVALID')
  if (!String(reason || '').trim()) throw payoutError('A reason is required to record a payout transition.', 'PAYOUT_REASON_REQUIRED')
  // COMPLETED must carry the concrete disbursement evidence — reference + method — so it can never claim
  // "paid" without a recorded reference.
  if (transition === 'COMPLETED' && !String(reference || '').trim()) {
    throw payoutError('A payout reference is required to record completion.', 'PAYOUT_REFERENCE_REQUIRED')
  }
}

/**
 * Records one staff disbursement-lifecycle transition as an AdminAuditLog event. Requires actor, role,
 * timestamp, method, reference, reason, reconciliation note and policy version. entityId is the wallet
 * RELEASE entry (or booking) the disbursement settles. Best-effort audit is NOT appropriate here — a
 * payout with no record is indistinguishable from one that never happened — so a failure propagates.
 */
export async function recordPayoutTransition(db, { transition, actorUserId, actorRoles, entityId, hostUserId, method, reference, reason, reconciliationNote }) {
  assertPayoutTransitionInput({ transition, reason, reference })
  const action = PAYOUT_AUDIT_ACTIONS[transition]
  return db.adminAuditLog.create({
    data: {
      actorUserId: actorUserId || null,
      action,
      entityType: 'host_payouts',
      entityId,
      after: {
        transition,
        hostUserId: hostUserId || null,
        method: method || null, // method TYPE only (e.g. 'sham_cash'), never the raw destination
        reference: reference ? String(reference).trim() : null,
        reason: String(reason).trim(),
        reconciliationNote: reconciliationNote ? String(reconciliationNote).trim() : null,
        actorRoles: Array.isArray(actorRoles) ? actorRoles : [],
        policyVersion: HOST_PAYOUT_POLICY_VERSION,
      },
    },
  })
}
