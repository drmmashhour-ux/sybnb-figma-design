import { DOCUMENT_SIGNATURE_TYPES, assertContentMatchesDeclaredType } from './content-signature.mjs'
import {
  BUCKET_CLASSES,
  assertSafeObjectKey,
  buildObjectKey,
  deleteObject,
  getObject,
  putObject,
} from './object-storage.mjs'

// Identity documents — the most sensitive data this platform holds.
//
// Bytes now go to the private DOCUMENTS bucket in durable object storage (Cloudflare R2, EU
// jurisdiction) instead of the local filesystem, which on this deployment target is per-instance and
// ephemeral: a document uploaded for review could be gone before an admin opened the queue. See
// ADR-0010.
//
// Unchanged by design: this module's interface and return shape, its error codes, its 8MB ceiling,
// and — most importantly — the authorization in routes/me.mjs and routes/admin.mjs. No object is
// ever public, every read passes an ownership or staff-role check first, and a storage key by itself
// grants nothing.
//
// SECURITY NOTE: the signature check below proves what a file *is*, not that it is *safe*.
//   PDF signature validation ≠ malware scanning ≠ safe internal document structure.
// Deep parsing, antivirus, sandboxing and content-disarm remain future hardening (STG-11).
export const ALLOWED_ID_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_ID_DOCUMENT_BYTES = 8 * 1024 * 1024 // 8MB

/** Server-chosen category, used only to build a safe download filename. Never caller-supplied. */
export const ID_DOCUMENT_CATEGORY = 'identity'

function idDocumentError(message, code) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

/** Returns the bare storage key (string) — callers persist this verbatim on User.idDocumentRef. */
export async function saveIdDocument(base64Data, mimeType) {
  const extension = ALLOWED_ID_DOCUMENT_TYPES[mimeType]
  if (!extension) {
    throw idDocumentError('ID document must be a JPEG, PNG, or PDF file.', 'ID_DOCUMENT_TYPE_INVALID')
  }

  const buffer = Buffer.from(base64Data || '', 'base64')
  if (!buffer.length) {
    throw idDocumentError('ID document file is empty.', 'ID_DOCUMENT_EMPTY')
  }
  if (buffer.length > MAX_ID_DOCUMENT_BYTES) {
    throw idDocumentError('ID document file must be smaller than 8MB.', 'ID_DOCUMENT_TOO_LARGE')
  }

  // The declared mimeType arrives in the request body and is attacker-controlled. Confirm the actual
  // bytes agree before storing anything — otherwise an executable or archive announced as a PDF
  // would be stored and later handed to a reviewer under a trusted content-type.
  try {
    assertContentMatchesDeclaredType(buffer, mimeType, DOCUMENT_SIGNATURE_TYPES)
  } catch (error) {
    throw idDocumentError(error.message, 'ID_DOCUMENT_CONTENT_INVALID')
  }

  // Random UUID plus an allowlist-derived extension — never the user's id, never the original
  // filename — so a guessed key cannot be used to enumerate other users' documents.
  const storageKey = buildObjectKey(extension)
  await putObject({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: storageKey, body: buffer, contentType: mimeType })
  return storageKey
}

export async function readIdDocument(storageKey) {
  try {
    assertSafeObjectKey(storageKey)
  } catch {
    throw idDocumentError('Invalid document reference.', 'ID_DOCUMENT_REF_INVALID')
  }
  return getObject({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: storageKey })
}

export async function deleteIdDocument(storageKey) {
  try {
    assertSafeObjectKey(storageKey)
  } catch {
    return
  }
  // Idempotent by contract: the database reference is updated before this runs, so a failure here
  // leaves an orphaned object (storage cost) rather than a record pointing at bytes that are gone.
  await deleteObject({ bucketClass: BUCKET_CLASSES.DOCUMENTS, key: storageKey }).catch(() => {})
}
