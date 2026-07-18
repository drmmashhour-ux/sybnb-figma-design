import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_DIR = path.join(__dirname, '..', 'uploads', 'thread-documents')

// Same pattern as id-document-storage.mjs / driver-document-storage.mjs: real file bytes (base64
// in the JSON body, matching this server's hand-rolled JSON-only request handling), written to a
// private, non-web-servable directory keyed by a random id, not the uploader's id or filename, so
// a guessed URL can't be used to enumerate other threads' documents.
export const ALLOWED_THREAD_DOCUMENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_THREAD_DOCUMENT_BYTES = 8 * 1024 * 1024 // 8MB

export async function saveThreadDocument(base64Data, mimeType) {
  const extension = ALLOWED_THREAD_DOCUMENT_TYPES[mimeType]
  if (!extension) {
    const error = new Error('Document must be a JPEG, PNG, or PDF file.')
    error.statusCode = 400
    error.code = 'THREAD_DOCUMENT_TYPE_INVALID'
    error.expose = true
    throw error
  }

  const buffer = Buffer.from(base64Data, 'base64')
  if (!buffer.length) {
    const error = new Error('Document file is empty.')
    error.statusCode = 400
    error.code = 'THREAD_DOCUMENT_EMPTY'
    error.expose = true
    throw error
  }
  if (buffer.length > MAX_THREAD_DOCUMENT_BYTES) {
    const error = new Error('Document file must be smaller than 8MB.')
    error.statusCode = 400
    error.code = 'THREAD_DOCUMENT_TOO_LARGE'
    error.expose = true
    throw error
  }

  await mkdir(STORAGE_DIR, { recursive: true })
  const storageKey = `${randomUUID()}.${extension}`
  await writeFile(path.join(STORAGE_DIR, storageKey), buffer)
  return storageKey
}

export async function readThreadDocument(storageKey) {
  // storageKey always comes from randomUUID() at write time, but re-validate the shape before
  // touching the filesystem so a malformed/tampered value can never be used for path traversal.
  if (!/^[a-f0-9-]{36}\.(jpg|png|pdf)$/.test(storageKey || '')) {
    const error = new Error('Invalid document reference.')
    error.statusCode = 400
    error.code = 'THREAD_DOCUMENT_REF_INVALID'
    error.expose = true
    throw error
  }
  return readFile(path.join(STORAGE_DIR, storageKey))
}
