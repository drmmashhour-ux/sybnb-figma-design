import { randomUUID } from 'crypto'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_DIR = path.join(__dirname, '..', 'uploads', 'listing-documents')

// Per-listing regulatory documents (e.g. a Quebec CITQ accommodation-registration certificate).
// Same handling as driver-document-storage.mjs: real bytes (base64 in the JSON body) written to a
// private, non-web-servable directory keyed by a random id -- never the listing's own id or the
// original filename -- so a guessed URL can't enumerate other listings' documents. Served only
// through an authz-gated endpoint.
export const ALLOWED_LISTING_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_LISTING_DOCUMENT_BYTES = 8 * 1024 * 1024 // 8MB

export async function saveListingDocument(base64Data, mimeType) {
  const extension = ALLOWED_LISTING_DOCUMENT_TYPES[mimeType]
  if (!extension) {
    const error = new Error('Listing document must be a JPEG, PNG, or PDF file.')
    error.statusCode = 400
    error.code = 'LISTING_DOCUMENT_TYPE_INVALID'
    error.expose = true
    throw error
  }

  const buffer = Buffer.from(base64Data, 'base64')
  if (!buffer.length) {
    const error = new Error('Listing document file is empty.')
    error.statusCode = 400
    error.code = 'LISTING_DOCUMENT_EMPTY'
    error.expose = true
    throw error
  }
  if (buffer.length > MAX_LISTING_DOCUMENT_BYTES) {
    const error = new Error('Listing document file must be smaller than 8MB.')
    error.statusCode = 400
    error.code = 'LISTING_DOCUMENT_TOO_LARGE'
    error.expose = true
    throw error
  }

  await mkdir(STORAGE_DIR, { recursive: true })
  const storageKey = `${randomUUID()}.${extension}`
  await writeFile(path.join(STORAGE_DIR, storageKey), buffer)
  return storageKey
}

export async function readListingDocument(storageKey) {
  // storageKey always comes from randomUUID() at write time, but re-validate the shape before
  // touching the filesystem so a malformed/tampered value can never be used for path traversal.
  if (!/^[a-f0-9-]{36}\.(jpg|png|pdf)$/.test(storageKey || '')) {
    const error = new Error('Invalid document reference.')
    error.statusCode = 400
    error.code = 'LISTING_DOCUMENT_REF_INVALID'
    error.expose = true
    throw error
  }
  return readFile(path.join(STORAGE_DIR, storageKey))
}

// Second compliance-review correction pass: indefinite retention is itself a privacy/security risk,
// not a compliance win. A superseded (replaced) certificate file is deleted immediately (there is no
// reason to keep a document no longer describing the listing's active registration); the CURRENT
// certificate is deleted by the retention purge job (server/lib/listing-document-retention.mjs) one
// year after ITS OWN expiry, unless a legal hold is recorded.
export async function deleteListingDocument(storageKey) {
  if (!storageKey || !/^[a-f0-9-]{36}\.(jpg|png|pdf)$/.test(storageKey)) return
  await unlink(path.join(STORAGE_DIR, storageKey)).catch(() => {})
}
