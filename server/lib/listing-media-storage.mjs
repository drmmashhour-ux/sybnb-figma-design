import { randomUUID } from 'crypto'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { del as blobDel, put as blobPut } from '@vercel/blob'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_DIR = path.join(__dirname, '..', 'uploads', 'listing-media')

// Real listing photos. DUAL-MODE storage:
//   • PRODUCTION (Vercel): when BLOB_READ_WRITE_TOKEN is present, photos go to Vercel Blob — durable,
//     shared across every serverless instance, and served straight from the CDN. Vercel's function
//     filesystem is read-only + ephemeral, so local writes there would be lost; Blob is the fix and it
//     scales to any traffic. The public Blob URL is stored directly in ListingMedia.url and the client
//     renders it as-is (no proxy hop). The random-uuid key means a URL can't enumerate other listings.
//   • LOCAL DEV (no token): falls back to writing the bytes into a private dir and serving them through
//     the authz-gated /file endpoint (draft photos stay owner/admin-only until the listing is APPROVED).
const BLOB_ENABLED = Boolean(process.env.BLOB_READ_WRITE_TOKEN)
const BLOB_PREFIX = 'listing-media'
// A Vercel Blob public URL — used by deleteListingMedia to tell a CDN url apart from a dev serve path.
const BLOB_URL_RE = /^https?:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//i
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

// Persist one listing photo. Returns { url, storageKey, mimeType } where `url` is READY to store in
// ListingMedia.url: a Vercel Blob CDN url in production, or the authz-gated serve path in local dev.
export async function saveListingMedia(base64Data, mimeType, listingId) {
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

  const storageKey = `${randomUUID()}.${extension}`

  if (BLOB_ENABLED) {
    // addRandomSuffix:false keeps the pathname exactly our uuid key; access:'public' serves via CDN.
    const blob = await blobPut(`${BLOB_PREFIX}/${storageKey}`, buffer, {
      access: 'public',
      addRandomSuffix: false,
      contentType: mimeType,
      cacheControlMaxAge: 31536000,
    })
    return { url: blob.url, storageKey, mimeType }
  }

  await mkdir(STORAGE_DIR, { recursive: true })
  await writeFile(path.join(STORAGE_DIR, storageKey), buffer)
  return { url: mediaServeUrl(listingId, storageKey), storageKey, mimeType }
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

// Accepts the full ListingMedia.url. A Vercel Blob CDN url is deleted from Blob; a dev serve path
// (…/media/file/<uuid>.<ext>) has its key extracted and the local file removed. Best-effort — a failed
// delete never blocks removing the DB row.
export async function deleteListingMedia(mediaUrl) {
  const value = String(mediaUrl || '')
  if (!value) return
  if (BLOB_URL_RE.test(value)) {
    await blobDel(value).catch(() => {})
    return
  }
  const storageKey = value.split('/').pop() || ''
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
