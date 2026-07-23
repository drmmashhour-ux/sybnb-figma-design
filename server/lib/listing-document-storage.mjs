import { DOCUMENT_SIGNATURE_TYPES, assertContentMatchesDeclaredType } from './content-signature.mjs'
import {
  BUCKET_CLASSES,
  assertSafeObjectKey,
  buildObjectKey,
  deleteObject,
  getObject,
  putObject,
} from './object-storage.mjs'

// Listing compliance certificates — private documents.
//
// Bytes now go to the private DOCUMENTS bucket in durable object storage (Cloudflare R2, EU
// jurisdiction) instead of the local filesystem, which is per-instance and ephemeral on this
// deployment target. See ADR-0010. The module interface, error codes, size ceiling and — critically —
// the authorization performed by the route layer are unchanged. No object is public; a storage key
// alone grants nothing.
//
// SECURITY NOTE: the signature check proves what a file *is*, not that it is *safe*.
//   PDF signature validation ≠ malware scanning ≠ safe internal document structure.
// Deep parsing, antivirus, sandboxing and content-disarm remain future hardening (STG-11).
//
// Retention: a superseded certificate is deleted immediately; the CURRENT certificate is deleted by
// the retention purge job (listing-document-retention.mjs) one year after its own expiry, unless a
// legal hold is recorded. That governance is unchanged by this migration.
export const ALLOWED_LISTING_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_LISTING_DOCUMENT_BYTES = 8 * 1024 * 1024 // 8MB

/** Server-chosen category, used only to build a safe download filename. Never caller-supplied. */
export const LISTING_DOCUMENT_CATEGORY = 'listing'

function docError(message, code) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

/** Returns the bare storage key (string) — callers persist this verbatim on assetUrl. */
export async function saveListingDocument(base64Data, mimeType) {
  const extension = ALLOWED_LISTING_DOCUMENT_TYPES[mimeType]
  if (!extension) {
    throw docError('Document must be a JPEG, PNG, or PDF file.', 'LISTING_DOCUMENT_TYPE_INVALID')
  }

  const buffer = Buffer.from(base64Data || '', 'base64')
  if (!buffer.length) throw docError('Document file is empty.', 'LISTING_DOCUMENT_EMPTY')
  if (buffer.length > MAX_LISTING_DOCUMENT_BYTES) {
    throw docError('Document must be smaller than 8MB.', 'LISTING_DOCUMENT_TOO_LARGE')
  }

  // The declared mimeType is attacker-controlled request data — confirm the bytes agree first.
  try {
    assertContentMatchesDeclaredType(buffer, mimeType, DOCUMENT_SIGNATURE_TYPES)
  } catch (error) {
    throw docError(error.message, 'LISTING_DOCUMENT_CONTENT_INVALID')
  }

  const storageKey = buildObjectKey(extension)
  await putObject({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: storageKey, body: buffer, contentType: mimeType })
  return storageKey
}

export async function readListingDocument(storageKey) {
  try {
    assertSafeObjectKey(storageKey)
  } catch {
    throw docError('Invalid document reference.', 'LISTING_DOCUMENT_REF_INVALID')
  }
  return getObject({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: storageKey })
}

export async function deleteListingDocument(storageKey) {
  try {
    assertSafeObjectKey(storageKey)
  } catch {
    return
  }
  // Idempotent: the database reference is cleared before this runs, so a failure leaves an orphaned
  // object rather than a record pointing at bytes that are gone.
  await deleteObject({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: storageKey }).catch(() => {})
}
