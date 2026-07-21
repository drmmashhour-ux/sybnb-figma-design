// Second compliance-review correction pass: "keep every certificate forever" is not a compliance
// win, it's unnecessary privacy/security exposure. This module implements the configurable
// retention policy instead: retain a certificate until one year after ITS OWN expiry, then queue it
// for secure deletion -- unless a documented legal hold applies. Deletion removes the file from disk
// and clears the row's file fields, but the ListingDocument row and an AdminAuditLog entry survive
// as the audit record: "preserve a record of deletion without retaining the certificate itself."
import { deleteListingDocument } from './listing-document-storage.mjs'

export const RETENTION_PERIOD_AFTER_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000

// Environment-specific activation (third compliance-review correction pass). Local/test mode may
// treat a human admin's test-mode review (ADMIN_REVIEWED_TEST) as sufficient to let a listing
// publish/take bookings. Production must NEVER accept that -- only DIGITALLY_VERIFIED (a real
// verification integration) counts there. No such integration exists yet, so this function is what
// makes production correctly default to BLOCKED for every certificate until one ships: nothing in
// this codebase ever sets DIGITALLY_VERIFIED today. Every certificate-gating check must call this
// function rather than hold its own copy of the allowed-statuses list, so the production rule can
// never silently drift back to the permissive test default.
export function getOperationalDocumentStatuses() {
  return process.env.NODE_ENV === 'production' ? ['DIGITALLY_VERIFIED'] : ['ADMIN_REVIEWED_TEST', 'DIGITALLY_VERIFIED']
}

function fail(code, message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}

// Pure function: one year after the certificate's own expiry date, or null if no expiry is on file.
export function retentionDeleteAfter(expiresAt) {
  if (!expiresAt) return null
  const expiryMs = new Date(expiresAt).getTime()
  if (Number.isNaN(expiryMs)) return null
  return new Date(expiryMs + RETENTION_PERIOD_AFTER_EXPIRY_MS)
}

// Certificate-status housekeeping: a document an admin reviewed (or a future DIGITALLY_VERIFIED one)
// moves to EXPIRED once its own expiresAt has passed -- this is the "the certificate itself is stale"
// signal, separate from and earlier than the later retention-deletion step below. Never touches
// PENDING_REVIEW/REJECTED/already-EXPIRED/already-deleted rows. Called inline at the top of the
// relevant read paths (same pattern as expireOldListings() in listing-lifecycle.mjs) -- there is no
// cron in this codebase, so housekeeping runs on the next relevant request instead.
export async function markExpiredListingDocuments(db) {
  const now = new Date()
  const result = await db.listingDocument.updateMany({
    where: { status: { in: ['ADMIN_REVIEWED_TEST', 'DIGITALLY_VERIFIED'] }, expiresAt: { lte: now }, deletedAt: null },
    data: { status: 'EXPIRED' },
  })
  return result.count
}

// The secure-deletion queue itself: any document whose retentionDeleteAfter has passed, with no
// legal hold, not already deleted. Runs the same "call it inline on the next relevant read" way as
// markExpiredListingDocuments -- see server/routes/compliance.mjs's compliance-dashboard handler.
export async function purgeExpiredListingDocuments(db, { actorId = null } = {}) {
  const now = new Date()
  const eligible = await db.listingDocument.findMany({
    where: { retentionDeleteAfter: { lte: now }, legalHold: false, deletedAt: null, assetUrl: { not: null } },
    select: { id: true, listingId: true, type: true, assetUrl: true, expiresAt: true, retentionDeleteAfter: true },
  })

  let purgedCount = 0
  for (const doc of eligible) {
    await deleteListingDocument(doc.assetUrl)
    await db.listingDocument.update({
      where: { id: doc.id },
      data: { assetUrl: null, mimeType: null, deletedAt: now },
    })
    await db.adminAuditLog.create({
      data: {
        actorUserId: actorId,
        action: 'LISTING_DOCUMENT_RETENTION_PURGED',
        entityType: 'listing_documents',
        entityId: doc.id,
        before: { listingId: doc.listingId, type: doc.type, expiresAt: doc.expiresAt, retentionDeleteAfter: doc.retentionDeleteAfter },
        after: { deletedAt: now.toISOString(), reason: 'Retention period (one year past certificate expiry) elapsed with no legal hold on file.' },
      },
    })
    purgedCount += 1
  }
  return purgedCount
}

// Legal hold requires a recorded reason and a recording admin, the same "activation requires an
// accountable actor" discipline used elsewhere in this codebase (compliance-feature-flags.mjs,
// jurisdiction-pricing.mjs). Clearing a hold never requires a reason -- turning a hold off is safe.
export async function setListingDocumentLegalHold(db, documentId, { hold, reason, actorId }) {
  if (hold && !String(reason || '').trim()) fail('LISTING_DOCUMENT_LEGAL_HOLD_REASON_REQUIRED', 'A legal hold requires a documented reason.')
  if (hold && !actorId) fail('LISTING_DOCUMENT_LEGAL_HOLD_ACTOR_REQUIRED', 'A legal hold requires a recorded admin.')

  return db.listingDocument.update({
    where: { id: documentId },
    data: hold
      ? { legalHold: true, legalHoldReason: reason.trim(), legalHoldSetById: actorId, legalHoldSetAt: new Date() }
      : { legalHold: false, legalHoldReason: null, legalHoldSetById: null, legalHoldSetAt: null },
  })
}
