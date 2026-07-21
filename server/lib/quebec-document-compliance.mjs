// Shared versioning/legal-hold/retention logic for Québec driver and vehicle compliance documents.
// One implementation parameterized over the two near-identical Prisma models (QuebecDriverDocument /
// QuebecVehicleDocument) rather than two copies -- the versioning and legal-hold rules are identical,
// only the owning foreign key differs. Mirrors listing-document-retention.mjs's design exactly (same
// "a legal hold preserves the row, a new upload never blocks on it" rule -- see server/routes/
// listings.mjs and the third compliance-review correction pass).
import { retentionDeleteAfter } from './listing-document-retention.mjs'
import { deleteQuebecDocument } from './quebec-document-storage.mjs'

export const QUEBEC_DRIVER_DOCUMENT_TYPES = [
  'DRIVERS_LICENSE', 'DRIVING_RECORD_ABSTRACT', 'POLICE_BACKGROUND_CHECK', 'SAAQ_AUTHORIZED_DRIVER_PERMIT',
  'PROOF_OF_TRAINING_COMPLETION', 'FRENCH_LANGUAGE_ATTESTATION', 'GST_REGISTRATION', 'QST_REGISTRATION',
  'REVENU_QUEBEC_OPERATOR_FILE', 'PROOF_OF_IDENTITY', 'PROOF_OF_ADDRESS',
]

export const QUEBEC_VEHICLE_DOCUMENT_TYPES = [
  'VEHICLE_REGISTRATION', 'PROOF_OF_INSURANCE', 'SAAQ_MECHANICAL_INSPECTION', 'VEHICLE_OWNERSHIP_PROOF',
  'ACCESSIBILITY_CERTIFICATION', 'COMMERCIAL_PLATE_REGISTRATION', 'VEHICLE_PHOTO',
]

const KIND_CONFIG = {
  driver: { delegate: 'quebecDriverDocument', idField: 'onboardingUserId', types: QUEBEC_DRIVER_DOCUMENT_TYPES, auditEntity: 'quebec_driver_documents' },
  vehicle: { delegate: 'quebecVehicleDocument', idField: 'onboardingVehicleId', types: QUEBEC_VEHICLE_DOCUMENT_TYPES, auditEntity: 'quebec_vehicle_documents' },
}

function fail(code, message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}

function configFor(kind) {
  const config = KIND_CONFIG[kind]
  if (!config) fail('QUEBEC_DOCUMENT_KIND_INVALID', `Unknown document kind: ${kind}.`, 500)
  return config
}

// Uploading a new version NEVER blocks on an existing legal hold, and never inherits one -- a hold
// is a decision about one specific file, not the driver/vehicle's document slot. The previous current
// row (if any) simply stops being current; its own file is deleted only when it wasn't under hold
// (a held file's bytes are preserved -- only its own retention/purge job may ever remove them).
export async function uploadQuebecDocument(db, kind, { ownerId, type, assetUrl, mimeType, issuer, issuedAt, expiresAt }) {
  const { delegate, idField, types } = configFor(kind)
  if (!types.includes(type)) fail('QUEBEC_DOCUMENT_TYPE_INVALID', `type must be one of: ${types.join(', ')}.`)

  const model = db[delegate]
  const previous = await model.findFirst({ where: { [idField]: ownerId, type, isCurrent: true } })
  if (previous && !previous.legalHold && previous.assetUrl && previous.assetUrl !== assetUrl) {
    await deleteQuebecDocument(previous.assetUrl)
  }

  const parsedExpiresAt = expiresAt ? new Date(expiresAt) : null
  const validExpiresAt = parsedExpiresAt && !Number.isNaN(parsedExpiresAt.getTime()) ? parsedExpiresAt : null
  const parsedIssuedAt = issuedAt ? new Date(issuedAt) : null
  const validIssuedAt = parsedIssuedAt && !Number.isNaN(parsedIssuedAt.getTime()) ? parsedIssuedAt : null

  return db.$transaction(async (tx) => {
    const txModel = tx[delegate]
    if (previous) await txModel.update({ where: { id: previous.id }, data: { isCurrent: false } })
    return txModel.create({
      data: {
        [idField]: ownerId,
        type,
        assetUrl,
        mimeType,
        status: 'PENDING_REVIEW',
        issuer: issuer || null,
        issuedAt: validIssuedAt,
        expiresAt: validExpiresAt,
        retentionDeleteAfter: retentionDeleteAfter(validExpiresAt),
        version: previous ? previous.version + 1 : 1,
        isCurrent: true,
        replacesId: previous ? previous.id : null,
        // malwareScanStatus defaults to PENDING (no scanner integration exists -- see
        // quebec-document-storage.mjs) and is never set to CLEAN by any code path here.
      },
    })
  })
}

// Admin review of ONE document row. Deliberately touches only the document -- never the parent
// onboarding record's status. A rejected/expired document replacement must never auto-reactivate a
// suspended or rejected driver/vehicle; that always requires a separate, explicit admin transition
// through transitionDriverOnboardingStatus/transitionVehicleOnboardingStatus.
export async function reviewQuebecDocument(db, kind, documentId, { status, reviewerId, rejectionReason }) {
  const { delegate } = configFor(kind)
  if (!reviewerId) fail('QUEBEC_DOCUMENT_REVIEWER_REQUIRED', 'A recorded admin/reviewer is required to review a document.')
  if (!['ADMIN_REVIEWED_TEST', 'REJECTED'].includes(status)) {
    fail('QUEBEC_DOCUMENT_REVIEW_STATUS_INVALID', 'status must be ADMIN_REVIEWED_TEST or REJECTED.')
  }
  if (status === 'REJECTED' && !String(rejectionReason || '').trim()) {
    fail('QUEBEC_DOCUMENT_REJECTION_REASON_REQUIRED', 'A reason is required when rejecting a document.')
  }

  return db.$transaction(async (tx) => {
    const model = tx[delegate]
    const before = await model.findUnique({ where: { id: documentId } })
    if (!before) fail('QUEBEC_DOCUMENT_NOT_FOUND', 'Document not found.', 404)
    if (before.status !== 'PENDING_REVIEW') fail('QUEBEC_DOCUMENT_NOT_REVIEWABLE', `Document status is ${before.status}, not PENDING_REVIEW.`, 409)

    const after = await model.update({
      where: { id: documentId },
      data: {
        status,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        rejectionReason: status === 'REJECTED' ? rejectionReason.trim() : null,
      },
    })
    await tx.adminAuditLog.create({
      data: {
        actorUserId: reviewerId,
        action: `${configFor(kind).auditEntity.toUpperCase()}_${status}`,
        entityType: configFor(kind).auditEntity,
        entityId: documentId,
        before: { status: before.status },
        after: { status: after.status, rejectionReason: after.rejectionReason },
      },
    })
    return after
  })
}

// Same "requires a recorded reason and admin, clearing never requires a reason" discipline as
// setListingDocumentLegalHold.
export async function setQuebecDocumentLegalHold(db, kind, documentId, { hold, reason, actorId }) {
  const { delegate, auditEntity } = configFor(kind)
  if (hold && !String(reason || '').trim()) fail('QUEBEC_DOCUMENT_LEGAL_HOLD_REASON_REQUIRED', 'A legal hold requires a documented reason.')
  if (hold && !actorId) fail('QUEBEC_DOCUMENT_LEGAL_HOLD_ACTOR_REQUIRED', 'A legal hold requires a recorded admin.')

  return db.$transaction(async (tx) => {
    const model = tx[delegate]
    const before = await model.findUnique({ where: { id: documentId }, select: { legalHold: true, legalHoldReason: true } })
    if (!before) fail('QUEBEC_DOCUMENT_NOT_FOUND', 'Document not found.', 404)
    const after = await model.update({
      where: { id: documentId },
      data: hold
        ? { legalHold: true, legalHoldReason: reason.trim(), legalHoldSetById: actorId, legalHoldSetAt: new Date() }
        : { legalHold: false, legalHoldReason: null, legalHoldSetById: null, legalHoldSetAt: null },
    })
    await tx.adminAuditLog.create({
      data: {
        actorUserId: actorId,
        action: hold ? `${auditEntity.toUpperCase()}_LEGAL_HOLD_SET` : `${auditEntity.toUpperCase()}_LEGAL_HOLD_CLEARED`,
        entityType: auditEntity,
        entityId: documentId,
        before,
        after: { legalHold: after.legalHold, legalHoldReason: after.legalHoldReason },
      },
    })
    return after
  })
}

// Housekeeping (same "run inline on the next relevant read, no cron in this codebase" pattern as
// markExpiredListingDocuments): flag ADMIN_REVIEWED_TEST/DIGITALLY_VERIFIED documents whose own
// expiresAt has passed as EXPIRED. Runs for both kinds; returns the combined count.
export async function markExpiredQuebecDocuments(db) {
  const now = new Date()
  const [driverCount, vehicleCount] = await Promise.all([
    db.quebecDriverDocument.updateMany({
      where: { status: { in: ['ADMIN_REVIEWED_TEST', 'DIGITALLY_VERIFIED'] }, expiresAt: { lte: now }, deletedAt: null },
      data: { status: 'EXPIRED' },
    }),
    db.quebecVehicleDocument.updateMany({
      where: { status: { in: ['ADMIN_REVIEWED_TEST', 'DIGITALLY_VERIFIED'] }, expiresAt: { lte: now }, deletedAt: null },
      data: { status: 'EXPIRED' },
    }),
  ])
  return driverCount.count + vehicleCount.count
}

// Secure-deletion queue: same one-year-post-expiry retention window as ListingDocument, never
// touching a row under legal hold. Deletes the file from disk and clears assetUrl/mimeType, but the
// row and an AdminAuditLog entry survive as the audit record.
export async function purgeExpiredQuebecDocuments(db, { actorId = null } = {}) {
  const now = new Date()
  let purgedCount = 0
  for (const kind of ['driver', 'vehicle']) {
    const { delegate, auditEntity } = KIND_CONFIG[kind]
    const model = db[delegate]
    const eligible = await model.findMany({
      where: { retentionDeleteAfter: { lte: now }, legalHold: false, deletedAt: null, assetUrl: { not: null } },
      select: { id: true, type: true, assetUrl: true, expiresAt: true, retentionDeleteAfter: true },
    })
    for (const doc of eligible) {
      await deleteQuebecDocument(doc.assetUrl)
      await model.update({ where: { id: doc.id }, data: { assetUrl: null, mimeType: null, deletedAt: now } })
      await db.adminAuditLog.create({
        data: {
          actorUserId: actorId,
          action: `${auditEntity.toUpperCase()}_RETENTION_PURGED`,
          entityType: auditEntity,
          entityId: doc.id,
          before: { type: doc.type, expiresAt: doc.expiresAt, retentionDeleteAfter: doc.retentionDeleteAfter },
          after: { deletedAt: now.toISOString(), reason: 'Retention period (one year past document expiry) elapsed with no legal hold on file.' },
        },
      })
      purgedCount += 1
    }
  }
  return purgedCount
}

export async function listCurrentQuebecDocuments(db, kind, ownerId) {
  const { delegate, idField } = configFor(kind)
  return db[delegate].findMany({ where: { [idField]: ownerId, isCurrent: true }, orderBy: { type: 'asc' } })
}

export async function listQuebecDocumentHistory(db, kind, ownerId, type) {
  const { delegate, idField } = configFor(kind)
  return db[delegate].findMany({ where: { [idField]: ownerId, type }, orderBy: { version: 'desc' } })
}
