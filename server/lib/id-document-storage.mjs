import { randomUUID } from 'crypto'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_DIR = path.join(__dirname, '..', 'uploads', 'id-documents')

// Real ID documents used to never leave the browser — the frontend only sent a filename string,
// so nothing was ever actually stored or reviewable. These accept the real file bytes (base64 in
// the JSON body, matching this server's hand-rolled JSON-only request handling) and write them to
// a private, non-web-servable directory keyed by a random id, not the user's own id or filename,
// so a guessed URL can't be used to enumerate other users' documents.
export const ALLOWED_ID_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_ID_DOCUMENT_BYTES = 8 * 1024 * 1024 // 8MB

export async function saveIdDocument(base64Data, mimeType) {
  const extension = ALLOWED_ID_DOCUMENT_TYPES[mimeType]
  if (!extension) {
    const error = new Error('ID document must be a JPEG, PNG, or PDF file.')
    error.statusCode = 400
    error.code = 'ID_DOCUMENT_TYPE_INVALID'
    error.expose = true
    throw error
  }

  const buffer = Buffer.from(base64Data, 'base64')
  if (!buffer.length) {
    const error = new Error('ID document file is empty.')
    error.statusCode = 400
    error.code = 'ID_DOCUMENT_EMPTY'
    error.expose = true
    throw error
  }
  if (buffer.length > MAX_ID_DOCUMENT_BYTES) {
    const error = new Error('ID document file must be smaller than 8MB.')
    error.statusCode = 400
    error.code = 'ID_DOCUMENT_TOO_LARGE'
    error.expose = true
    throw error
  }

  await mkdir(STORAGE_DIR, { recursive: true })
  const storageKey = `${randomUUID()}.${extension}`
  await writeFile(path.join(STORAGE_DIR, storageKey), buffer)
  return storageKey
}

export async function readIdDocument(storageKey) {
  // storageKey always comes from randomUUID() at write time, but re-validate the shape before
  // touching the filesystem so a malformed/tampered value can never be used for path traversal.
  if (!/^[a-f0-9-]{36}\.(jpg|png|pdf)$/.test(storageKey || '')) {
    const error = new Error('Invalid document reference.')
    error.statusCode = 400
    error.code = 'ID_DOCUMENT_REF_INVALID'
    error.expose = true
    throw error
  }
  return readFile(path.join(STORAGE_DIR, storageKey))
}

export async function deleteIdDocument(storageKey) {
  if (!storageKey || !/^[a-f0-9-]{36}\.(jpg|png|pdf)$/.test(storageKey)) return
  await unlink(path.join(STORAGE_DIR, storageKey)).catch(() => {})
}
