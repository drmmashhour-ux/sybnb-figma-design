import { deleteSecureDocument, readSecureDocument, saveSecureDocument } from './secure-blob-storage.mjs'

// Driver vetting documents (license, vehicle registration, insurance) — sensitive PII. Stored ENCRYPTED
// on Vercel Blob in prod, plaintext local dir in dev (see secure-blob-storage.mjs). Served only through
// an authz-gated endpoint. (SR division is currently frozen, but the upload path had the same
// read-only-filesystem bug as the ID/listing docs, so it is fixed the same way.)
const PREFIX = 'driver-documents'
const SALT = 'sybnb.driver-document.v1'

export const ALLOWED_DRIVER_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_DRIVER_DOCUMENT_BYTES = 8 * 1024 * 1024 // 8MB

export function saveDriverDocument(base64Data, mimeType) {
  return saveSecureDocument({
    prefix: PREFIX,
    salt: SALT,
    base64Data,
    mimeType,
    allowedTypes: ALLOWED_DRIVER_DOCUMENT_TYPES,
    maxBytes: MAX_DRIVER_DOCUMENT_BYTES,
    errorLabel: 'Driver document',
    errorCodePrefix: 'DRIVER_DOCUMENT',
  })
}

export function readDriverDocument(reference) {
  return readSecureDocument(reference, { prefix: PREFIX, salt: SALT, errorCodePrefix: 'DRIVER_DOCUMENT' })
}

export function deleteDriverDocument(reference) {
  return deleteSecureDocument(reference, { prefix: PREFIX })
}
