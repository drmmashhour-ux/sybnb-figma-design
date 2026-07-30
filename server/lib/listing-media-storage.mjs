import { randomUUID } from 'crypto'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_DIR = path.join(__dirname, '..', 'uploads', 'listing-media')

// Real listing photos. Same handling pattern as driver documents: the actual bytes (base64 in the
// JSON body) are written to a private, non-web-servable directory keyed by a random id — never the
// listing id or the original filename — so a guessed URL can't enumerate another seller's private
// draft photos. Files are served only through the authz-gated /file endpoint in routes/listings.mjs
// (public once the listing is APPROVED, owner/admin-only while it is still a draft).
export const ALLOWED_LISTING_MEDIA_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export const MAX_LISTING_MEDIA_BYTES = 8 * 1024 * 1024 // 8MB
// A hard ceiling so a single listing can't be used to fill the disk. The submit guard only needs
// one real photo; this is the upper bound, not the requirement.
export const MAX_LISTING_PHOTOS = 30

// storageKey shape: <uuid>.<ext> — used both at read time (path-traversal guard) and by the route
// layer to recognise its own serve URLs.
const STORAGE_KEY_RE = /^[a-f0-9-]{36}\.(jpg|png|webp)$/

export function isValidListingMediaKey(storageKey) {
  return STORAGE_KEY_RE.test(storageKey || '')
}

export async function saveListingMedia(base64Data, mimeType) {
  const extension = ALLOWED_LISTING_MEDIA_TYPES[mimeType]
  if (!extension) {
    const error = new Error('Listing photo must be a JPEG, PNG, or WebP image.')
    error.statusCode = 400
    error.code = 'LISTING_MEDIA_TYPE_INVALID'
    error.expose = true
    throw error
  }

  const buffer = Buffer.from(base64Data || '', 'base64')
  if (!buffer.length) {
    const error = new Error('Listing photo file is empty.')
    error.statusCode = 400
    error.code = 'LISTING_MEDIA_EMPTY'
    error.expose = true
    throw error
  }
  if (buffer.length > MAX_LISTING_MEDIA_BYTES) {
    const error = new Error('Listing photo must be smaller than 8MB.')
    error.statusCode = 400
    error.code = 'LISTING_MEDIA_TOO_LARGE'
    error.expose = true
    throw error
  }

  await mkdir(STORAGE_DIR, { recursive: true })
  const storageKey = `${randomUUID()}.${extension}`
  await writeFile(path.join(STORAGE_DIR, storageKey), buffer)
  return { storageKey, mimeType }
}

export async function readListingMedia(storageKey) {
  // storageKey always comes from randomUUID() at write time, but re-validate the shape before
  // touching the filesystem so a malformed/tampered value can never be used for path traversal.
  if (!isValidListingMediaKey(storageKey)) {
    const error = new Error('Invalid photo reference.')
    error.statusCode = 400
    error.code = 'LISTING_MEDIA_REF_INVALID'
    error.expose = true
    throw error
  }
  return readFile(path.join(STORAGE_DIR, storageKey))
}

export async function deleteListingMedia(storageKey) {
  if (!isValidListingMediaKey(storageKey)) return
  await unlink(path.join(STORAGE_DIR, storageKey)).catch(() => {})
}

// The ListingMedia.url column stores a stable, directly-usable serve path (so the frontend can put
// it straight into an <img src>), NOT the raw storage key. This builds that path, and the pair below
// reads the key back out of it for the file-serve handler.
export function mediaServeUrl(listingId, storageKey) {
  return `/api/listings/${listingId}/media/file/${storageKey}`
}

export function mimeForKey(storageKey) {
  if (storageKey.endsWith('.jpg')) return 'image/jpeg'
  if (storageKey.endsWith('.png')) return 'image/png'
  if (storageKey.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}
