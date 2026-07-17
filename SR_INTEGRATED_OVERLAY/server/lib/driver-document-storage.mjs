import { randomUUID } from 'crypto'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_DIR = path.join(__dirname, '..', 'uploads', 'driver-documents')

// Driver vetting documents (license, vehicle registration, insurance). Same handling as ID
// documents: real bytes (base64 in the JSON body) written to a private, non-web-servable directory
// keyed by a random id — never the driver's own id or the original filename — so a guessed URL
// can't enumerate other drivers' documents. Served only through an authz-gated endpoint.
export const ALLOWED_DRIVER_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_DRIVER_DOCUMENT_BYTES = 8 * 1024 * 1024 // 8MB

export async function saveDriverDocument(base64Data, mimeType) {
  const extension = ALLOWED_DRIVER_DOCUMENT_TYPES[mimeType]
  if (!extension) {
    const error = new Error('Driver document must be a JPEG, PNG, or PDF file.')
    error.statusCode = 400
    error.code = 'DRIVER_DOCUMENT_TYPE_INVALID'
    error.expose = true
    throw error
  }

  const buffer = Buffer.from(base64Data, 'base64')
  if (!buffer.length) {
    const error = new Error('Driver document file is empty.')
    error.statusCode = 400
    error.code = 'DRIVER_DOCUMENT_EMPTY'
    error.expose = true
    throw error
  }
  if (buffer.length > MAX_DRIVER_DOCUMENT_BYTES) {
    const error = new Error('Driver document file must be smaller than 8MB.')
    error.statusCode = 400
    error.code = 'DRIVER_DOCUMENT_TOO_LARGE'
    error.expose = true
    throw error
  }

  await mkdir(STORAGE_DIR, { recursive: true })
  const storageKey = `${randomUUID()}.${extension}`
  await writeFile(path.join(STORAGE_DIR, storageKey), buffer)
  return storageKey
}

export async function readDriverDocument(storageKey) {
  // storageKey always comes from randomUUID() at write time, but re-validate the shape before
  // touching the filesystem so a malformed/tampered value can never be used for path traversal.
  if (!/^[a-f0-9-]{36}\.(jpg|png|pdf)$/.test(storageKey || '')) {
    const error = new Error('Invalid document reference.')
    error.statusCode = 400
    error.code = 'DRIVER_DOCUMENT_REF_INVALID'
    error.expose = true
    throw error
  }
  return readFile(path.join(STORAGE_DIR, storageKey))
}

export async function deleteDriverDocument(storageKey) {
  if (!storageKey || !/^[a-f0-9-]{36}\.(jpg|png|pdf)$/.test(storageKey)) return
  await unlink(path.join(STORAGE_DIR, storageKey)).catch(() => {})
}
