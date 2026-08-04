import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'crypto'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { del as blobDel, put as blobPut } from '@vercel/blob'

// Shared storage for SENSITIVE documents (ID cards, driver licenses/registrations, chat attachments).
// DUAL-MODE:
//   • PRODUCTION (Vercel): Vercel's function filesystem is read-only, so local writes silently fail —
//     that broke every document upload in prod. Documents now go to Vercel Blob. The store is "public",
//     so the bytes are ENCRYPTED (AES-256-GCM, key from AUTH_SECRET) before upload: a leaked (unguessable)
//     URL yields only ciphertext. Documents are streamed to a client ONLY through an authz-gated endpoint
//     that decrypts server-side. The stored reference is the blob URL.
//   • LOCAL DEV (no token): plaintext in a private local dir; reference is the legacy `<uuid>.<ext>` key.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BLOB_ENABLED = Boolean(process.env.BLOB_READ_WRITE_TOKEN)
const BLOB_URL_RE = /^https?:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//i
const KEY_RE = /^[a-f0-9-]{36}\.(jpg|png|pdf)$/
const ALG = 'aes-256-gcm'

function deriveKey(salt) {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    const error = new Error('AUTH_SECRET is required for this operation.')
    error.statusCode = 500
    error.code = 'MISSING_SECRET'
    error.expose = true
    throw error
  }
  return scryptSync(secret, salt, 32)
}
// Envelope layout: [12-byte IV][16-byte GCM tag][ciphertext].
function encrypt(buffer, salt) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, deriveKey(salt), iv)
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
}
function decrypt(envelope, salt) {
  const decipher = createDecipheriv(ALG, deriveKey(salt), envelope.subarray(0, 12))
  decipher.setAuthTag(envelope.subarray(12, 28))
  return Buffer.concat([decipher.update(envelope.subarray(28)), decipher.final()])
}
function localDir(prefix) {
  return path.join(__dirname, '..', 'uploads', prefix)
}

export async function saveSecureDocument({ prefix, salt, base64Data, mimeType, allowedTypes, maxBytes, errorLabel, errorCodePrefix }) {
  const extension = allowedTypes[mimeType]
  if (!extension) {
    const error = new Error(`${errorLabel} must be a JPEG, PNG, or PDF file.`)
    error.statusCode = 400
    error.code = `${errorCodePrefix}_TYPE_INVALID`
    error.expose = true
    throw error
  }
  const buffer = Buffer.from(base64Data || '', 'base64')
  if (!buffer.length) {
    const error = new Error(`${errorLabel} file is empty.`)
    error.statusCode = 400
    error.code = `${errorCodePrefix}_EMPTY`
    error.expose = true
    throw error
  }
  if (buffer.length > maxBytes) {
    const error = new Error(`${errorLabel} file must be smaller than 8MB.`)
    error.statusCode = 400
    error.code = `${errorCodePrefix}_TOO_LARGE`
    error.expose = true
    throw error
  }

  const storageKey = `${randomUUID()}.${extension}`
  if (BLOB_ENABLED) {
    const blob = await blobPut(`${prefix}/${storageKey}`, encrypt(buffer, salt), {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'application/octet-stream',
    })
    return blob.url
  }
  await mkdir(localDir(prefix), { recursive: true })
  await writeFile(path.join(localDir(prefix), storageKey), buffer)
  return storageKey
}

export async function readSecureDocument(reference, { prefix, salt, errorCodePrefix }) {
  const ref = String(reference || '')
  if (BLOB_URL_RE.test(ref)) {
    // Bound the blob read so a slow fetch can't hang the request up to the whole function budget.
    const res = await fetch(ref, { signal: AbortSignal.timeout(8000) }).catch((error) => {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        const timeout = new Error('Document read timed out.')
        timeout.statusCode = 504
        timeout.code = `${errorCodePrefix}_READ_TIMEOUT`
        timeout.expose = true
        throw timeout
      }
      throw error
    })
    if (!res.ok) {
      const error = new Error('Document not found.')
      error.statusCode = 404
      error.code = `${errorCodePrefix}_NOT_FOUND`
      error.expose = true
      throw error
    }
    return decrypt(Buffer.from(await res.arrayBuffer()), salt)
  }
  if (!KEY_RE.test(ref)) {
    const error = new Error('Invalid document reference.')
    error.statusCode = 400
    error.code = `${errorCodePrefix}_REF_INVALID`
    error.expose = true
    throw error
  }
  return readFile(path.join(localDir(prefix), ref))
}

export async function deleteSecureDocument(reference, { prefix }) {
  const ref = String(reference || '')
  if (BLOB_URL_RE.test(ref)) {
    await blobDel(ref).catch(() => {})
    return
  }
  if (!KEY_RE.test(ref)) return
  await unlink(path.join(localDir(prefix), ref)).catch(() => {})
}
