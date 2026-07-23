import { db } from './prisma.mjs'

// Narrow audit boundary for STAFF access to private documents (threat model STG-24).
//
// AdminAuditLog already records admin *decisions* (approve/reject, payout release). It did not record
// document *views*, so a support agent could open an identity document and leave no trace. This
// module records that one event and nothing more — it is deliberately not a general audit subsystem.
//
// Recorded: actor, role, document category, governed resource reference, action, result, timestamp.
// Never recorded: document bytes, storage keys, bucket names, endpoints, account ids, credentials,
// filenames, or any request header.
//
// Known gap, deliberately not invented here: AdminAuditLog has no column for a purpose or
// support-case reference, so "why did this staff member open this document" is not yet captured.
// Adding it is a schema decision and is left to the owner (see D-7 / STG-24 follow-up).
//
// Worker self-access (a user reading their own document) is intentionally NOT audited through this
// path — it is ordinary self-service, and logging every self-view would add volume without adding
// oversight value.

export const DOCUMENT_ACCESS_ACTION = 'STAFF_DOCUMENT_ACCESSED'

/**
 * Records one staff document-access event.
 *
 * Failure policy: auditing must not block a legitimately authorized read, so a logging failure is
 * swallowed and reported through the return value rather than thrown. The caller decides what to do
 * with that — today nothing does, because there is no alerting to route it to (STG-22). That is an
 * honest gap, not a silent one.
 */
export async function recordStaffDocumentAccess({
  actorUserId,
  actorRoles,
  documentCategory,
  entityType,
  entityId,
  result = 'ALLOWED',
  version,
}) {
  try {
    await db().adminAuditLog.create({
      data: {
        actorUserId,
        action: DOCUMENT_ACCESS_ACTION,
        entityType,
        entityId,
        after: {
          documentCategory,
          // Roles, not the document. Enough to answer "who, in what capacity, saw what record".
          actorRoles: Array.isArray(actorRoles) ? actorRoles : [],
          result,
          ...(version === undefined ? {} : { version }),
        },
      },
    })
    return { recorded: true }
  } catch (error) {
    return { recorded: false, reason: error?.code || 'AUDIT_WRITE_FAILED' }
  }
}
