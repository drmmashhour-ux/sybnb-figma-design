import { MEDIA_SIGNATURE_TYPES, assertContentMatchesDeclaredType } from './content-signature.mjs'
import {
  BUCKET_CLASSES,
  assertSafeObjectKey,
  buildObjectKey,
  deleteObject,
  getObject,
  putObject,
} from './object-storage.mjs'

// Real listing photos. Bytes now go to durable object storage (Cloudflare R2, EU jurisdiction) via
// the governed service in object-storage.mjs, instead of the local filesystem — on the serverless
// deployment target local disk is per-instance and ephemeral, so uploaded photos did not survive a
// cold start, a deploy, or a request landing elsewhere. See ADR-0010.
//
// What deliberately did NOT change: this module's public interface, its error codes, its size and
// type limits, and the authorization performed by routes/listings.mjs. The bucket is private and no
// object is ever served directly — every read still goes through the authz-gated /file route
// (public once the listing is APPROVED, owner/admin-only while it is a draft).
export const ALLOWED_LISTING_MEDIA_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export const MAX_LISTING_MEDIA_BYTES = 8 * 1024 * 1024 // 8MB
// A hard ceiling so a single listing can't be used to fill the store. The submit guard only needs
// one real photo; this is the upper bound, not the requirement.
export const MAX_LISTING_PHOTOS = 20

// storageKey shape: <uuid>.<ext> — used both at read time (tamper guard) and by the route layer to
// recognise its own serve URLs. Validation lives in object-storage.mjs so every subsystem shares it.
export function isValidListingMediaKey(storageKey) {
  if (typeof storageKey !== 'string') return false
  if (!/\.(jpg|png|webp)$/.test(storageKey)) return false
  try {
    assertSafeObjectKey(storageKey)
    return true
  } catch {
    return false
  }
}

function mediaError(message, code) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

export async function saveListingMedia(base64Data, mimeType) {
  const extension = ALLOWED_LISTING_MEDIA_TYPES[mimeType]
  if (!extension) {
    throw mediaError('Listing photo must be a JPEG, PNG, or WebP image.', 'LISTING_MEDIA_TYPE_INVALID')
  }

  const buffer = Buffer.from(base64Data || '', 'base64')
  if (!buffer.length) {
    throw mediaError('Listing photo file is empty.', 'LISTING_MEDIA_EMPTY')
  }
  if (buffer.length > MAX_LISTING_MEDIA_BYTES) {
    throw mediaError('Listing photo must be smaller than 8MB.', 'LISTING_MEDIA_TOO_LARGE')
  }

  // The declared mimeType comes from the request body and is attacker-controlled. Confirm the actual
  // bytes agree before anything is stored — a PDF, executable, or script announced as an image is
  // rejected here rather than being written and served later with an image content-type.
  try {
    assertContentMatchesDeclaredType(buffer, mimeType, MEDIA_SIGNATURE_TYPES)
  } catch (error) {
    // Preserve this module's error vocabulary so route-level handling and existing tests are
    // unaffected, while keeping the specific reason in the message.
    throw mediaError(error.message, 'LISTING_MEDIA_CONTENT_INVALID')
  }

  // Key identity is a random UUID plus an allowlist-derived extension — never the original filename,
  // never the listing id — so a guessed URL cannot enumerate another seller's private draft photos.
  const storageKey = buildObjectKey(extension)
  await putObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: storageKey, body: buffer, contentType: mimeType })
  return { storageKey, mimeType, byteSize: buffer.length }
}

export async function readListingMedia(storageKey) {
  if (!isValidListingMediaKey(storageKey)) {
    throw mediaError('Invalid photo reference.', 'LISTING_MEDIA_REF_INVALID')
  }
  return getObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: storageKey })
}

export async function deleteListingMedia(storageKey) {
  if (!isValidListingMediaKey(storageKey)) return
  // Idempotent by contract: the database reference is cleared before this runs, so a failure here
  // leaves an orphaned object (storage cost) rather than a dangling reference (a broken page).
  await deleteObject({ bucketClass: BUCKET_CLASSES.MEDIA, key: storageKey }).catch(() => {})
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
