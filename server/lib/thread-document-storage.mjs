import { readSecureDocument, saveSecureDocument } from './secure-blob-storage.mjs'

// Chat/thread attachments (guest↔host booking messages). May contain personal info, so stored ENCRYPTED
// on Vercel Blob in prod, plaintext local dir in dev (see secure-blob-storage.mjs). Served only through
// an authz-gated endpoint. Fixes the same read-only-filesystem bug that broke it in production.
const PREFIX = 'thread-documents'
const SALT = 'sybnb.thread-document.v1'

export const ALLOWED_THREAD_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_THREAD_DOCUMENT_BYTES = 8 * 1024 * 1024 // 8MB

export function saveThreadDocument(base64Data, mimeType) {
  return saveSecureDocument({
    prefix: PREFIX,
    salt: SALT,
    base64Data,
    mimeType,
    allowedTypes: ALLOWED_THREAD_DOCUMENT_TYPES,
    maxBytes: MAX_THREAD_DOCUMENT_BYTES,
    errorLabel: 'Document',
    errorCodePrefix: 'THREAD_DOCUMENT',
  })
}

export function readThreadDocument(reference) {
  return readSecureDocument(reference, { prefix: PREFIX, salt: SALT, errorCodePrefix: 'THREAD_DOCUMENT' })
}
