import { randomUUID } from 'crypto'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_DIR = path.join(__dirname, '..', 'uploads', 'quebec-documents')

// Québec driver/vehicle compliance documents. Same private, non-web-servable, random-key storage
// discipline as listing-document-storage.mjs / driver-document-storage.mjs -- never the driver's or
// vehicle's own id, never the original filename, served only through an authz-gated endpoint.
//
// No malware-scanning integration exists anywhere in this codebase. Every file saved here is,
// deliberately, effectively quarantined: it is never web-servable, never scanned, and the row that
// references it (QuebecDriverDocument/QuebecVehicleDocument.malwareScanStatus) stays PENDING under
// every current code path. Nothing may ever claim a file was scanned when it wasn't.
export const ALLOWED_QUEBEC_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_QUEBEC_DOCUMENT_BYTES = 8 * 1024 * 1024 // 8MB

export async function saveQuebecDocument(base64Data, mimeType) {
  const extension = ALLOWED_QUEBEC_DOCUMENT_TYPES[mimeType]
  if (!extension) {
    const error = new Error('Document must be a JPEG, PNG, or PDF file.')
    error.statusCode = 400
    error.code = 'QUEBEC_DOCUMENT_TYPE_INVALID'
    error.expose = true
    throw error
  }

  const buffer = Buffer.from(base64Data, 'base64')
  if (!buffer.length) {
    const error = new Error('Document file is empty.')
    error.statusCode = 400
    error.code = 'QUEBEC_DOCUMENT_EMPTY'
    error.expose = true
    throw error
  }
  if (buffer.length > MAX_QUEBEC_DOCUMENT_BYTES) {
    const error = new Error('Document file must be smaller than 8MB.')
    error.statusCode = 400
    error.code = 'QUEBEC_DOCUMENT_TOO_LARGE'
    error.expose = true
    throw error
  }

  await mkdir(STORAGE_DIR, { recursive: true })
  const storageKey = `${randomUUID()}.${extension}`
  await writeFile(path.join(STORAGE_DIR, storageKey), buffer)
  return storageKey
}

export async function readQuebecDocument(storageKey) {
  if (!/^[a-f0-9-]{36}\.(jpg|png|pdf)$/.test(storageKey || '')) {
    const error = new Error('Invalid document reference.')
    error.statusCode = 400
    error.code = 'QUEBEC_DOCUMENT_REF_INVALID'
    error.expose = true
    throw error
  }
  return readFile(path.join(STORAGE_DIR, storageKey))
}

export async function deleteQuebecDocument(storageKey) {
  if (!storageKey || !/^[a-f0-9-]{36}\.(jpg|png|pdf)$/.test(storageKey)) return
  await unlink(path.join(STORAGE_DIR, storageKey)).catch(() => {})
}
