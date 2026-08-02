import { deleteSecureDocument, readSecureDocument, saveSecureDocument } from './secure-blob-storage.mjs'

// Guest/host ID documents — sensitive identity PII. Stored ENCRYPTED on Vercel Blob in prod, plaintext
// local dir in dev (see secure-blob-storage.mjs). Served only through the authz-gated /api/me/id-document
// (owner) and /api/admin/id-document (admin) endpoints, which decrypt server-side. This fixes the
// read-only-filesystem bug that silently broke every ID upload in production.
// SALT stays 'sybnb.id-document.v1' so documents encrypted before this refactor still decrypt.
const PREFIX = 'id-documents'
const SALT = 'sybnb.id-document.v1'

export const ALLOWED_ID_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_ID_DOCUMENT_BYTES = 8 * 1024 * 1024 // 8MB

export function saveIdDocument(base64Data, mimeType) {
  return saveSecureDocument({
    prefix: PREFIX,
    salt: SALT,
    base64Data,
    mimeType,
    allowedTypes: ALLOWED_ID_DOCUMENT_TYPES,
    maxBytes: MAX_ID_DOCUMENT_BYTES,
    errorLabel: 'ID document',
    errorCodePrefix: 'ID_DOCUMENT',
  })
}

export function readIdDocument(reference) {
  return readSecureDocument(reference, { prefix: PREFIX, salt: SALT, errorCodePrefix: 'ID_DOCUMENT' })
}

export function deleteIdDocument(reference) {
  return deleteSecureDocument(reference, { prefix: PREFIX })
}
