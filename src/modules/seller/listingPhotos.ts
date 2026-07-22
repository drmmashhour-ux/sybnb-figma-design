// C2 — Real Property Photo Upload: pure, DOM-free logic for STR property-listing photos.
//
// Deliberately free of browser APIs (no canvas / object URLs), React, and any plan-payment state, so
// it is unit-testable in Node and reusable by the thin React shell (ListingPhotoUploader.tsx). The
// constants MIRROR the server contract (server/lib/listing-media-storage.mjs): a mismatch would let
// the client accept a file the server rejects, or vice-versa.

export const ALLOWED_LISTING_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedPhotoType = (typeof ALLOWED_LISTING_PHOTO_TYPES)[number]

export const MAX_LISTING_PHOTO_BYTES = 8 * 1024 * 1024 // mirrors server MAX_LISTING_MEDIA_BYTES (8MB)
export const MIN_LISTING_PHOTOS = 1
export const MAX_LISTING_PHOTOS = 20 // mirrors server MAX_LISTING_PHOTOS

export function isSupportedPhotoType(mime: string): mime is AllowedPhotoType {
  return (ALLOWED_LISTING_PHOTO_TYPES as readonly string[]).includes(mime)
}

export type PhotoRejectionCode = 'UNSUPPORTED_TYPE' | 'EMPTY_FILE'
export type PhotoValidation = { ok: true } | { ok: false; code: PhotoRejectionCode }

// Validate a candidate file by type + emptiness. Oversize is NOT a hard reject here: compression
// (compressionPlan) downscales before upload, and if the result is still over the server's ceiling
// the server returns its own 400 — the client never silently claims success.
export function validatePhotoCandidate(file: { type: string; size: number }): PhotoValidation {
  if (!isSupportedPhotoType(file.type)) return { ok: false, code: 'UNSUPPORTED_TYPE' }
  if (!file.size) return { ok: false, code: 'EMPTY_FILE' }
  return { ok: true }
}

export function canAddPhotos(currentCount: number, adding: number): boolean {
  return currentCount + adding <= MAX_LISTING_PHOTOS
}
export function remainingPhotoSlots(currentCount: number): number {
  return Math.max(0, MAX_LISTING_PHOTOS - currentCount)
}
export function meetsMinimumPhotos(count: number): boolean {
  return count >= MIN_LISTING_PHOTOS
}

// ---------- Compression policy (pure decision; the canvas draw lives in the shell) ----------
export type CompressionPlan = {
  maxDimension: number // longest-edge target
  quality: number // 0..1 (ignored by canvas for PNG)
  outputType: AllowedPhotoType // ALWAYS a server-supported type
}

// The output type is guaranteed server-supported: a supported input keeps its type (PNG stays lossless
// to preserve transparency; JPEG/WebP re-encode lossy). Anything unexpected falls back to JPEG — so
// compression can never silently produce an unsupported MIME.
export function compressionPlan(input: { type: string; width?: number; height?: number; bytes: number }): CompressionPlan {
  const outputType: AllowedPhotoType = isSupportedPhotoType(input.type) ? input.type : 'image/jpeg'
  return {
    maxDimension: 1600, // enough detail for a listing hero, small enough for slow Syrian uplinks
    quality: outputType === 'image/png' ? 1 : 0.82,
    outputType,
  }
}

export function needsDownscale(dim: { width: number; height: number }, plan: CompressionPlan): boolean {
  return Math.max(dim.width, dim.height) > plan.maxDimension
}

export function scaledDimensions(width: number, height: number, maxDimension: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxDimension) return { width, height }
  const scale = maxDimension / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

// ---------- Batch state (pure) ----------
export type PhotoStatus = 'selected' | 'uploading' | 'uploaded' | 'failed'
export type PhotoItem = {
  id: string
  name: string
  mimeType: AllowedPhotoType
  status: PhotoStatus
  previewUrl?: string // object URL — created/revoked by the shell
  mediaUrl?: string // server serve URL after a 201
  error?: string
}

export function addToBatch(
  items: PhotoItem[],
  incoming: PhotoItem[],
): { items: PhotoItem[]; accepted: PhotoItem[]; rejected: number } {
  const slots = remainingPhotoSlots(items.length)
  const accepted = incoming.slice(0, slots)
  return { items: [...items, ...accepted], accepted, rejected: incoming.length - accepted.length }
}

// Returns the removed item so the shell can revoke its object URL (no leaks).
export function removeFromBatch(items: PhotoItem[], id: string): { items: PhotoItem[]; removed?: PhotoItem } {
  return { items: items.filter((i) => i.id !== id), removed: items.find((i) => i.id === id) }
}

// Cover = the FIRST item. setCover moves the chosen item to the front.
export function setCover(items: PhotoItem[], id: string): PhotoItem[] {
  const chosen = items.find((i) => i.id === id)
  if (!chosen) return items
  return [chosen, ...items.filter((i) => i.id !== id)]
}
export function coverItem(items: PhotoItem[]): PhotoItem | undefined {
  return items[0]
}

// ---------- Guest-side cover selection (real cover vs stock art) ----------
// Choose the real cover URL from a listing's media (lowest sortOrder = first uploaded), else fall back
// to the provided stock/division image.
export function selectCoverUrl(media: Array<Record<string, unknown>> | undefined, fallback: string): string {
  if (!media || media.length === 0) return fallback
  const withUrl = media
    .map((m) => ({
      url: [m.url, m.src, m.assetUrl].find((v) => typeof v === 'string') as string | undefined,
      sortOrder: typeof m.sortOrder === 'number' ? (m.sortOrder as number) : Number.MAX_SAFE_INTEGER,
    }))
    .filter((m): m is { url: string; sortOrder: number } => typeof m.url === 'string')
    .sort((a, b) => a.sortOrder - b.sortOrder)
  return withUrl[0]?.url ?? fallback
}

// ---------- Upload orchestration (pure control flow; all I/O injected) ----------
export type EncodedPhoto = { fileBase64: string; mimeType: AllowedPhotoType }
export type UploadOrchestration = {
  createListing: () => Promise<{ id: string }>
  encodePhoto: (item: PhotoItem) => Promise<EncodedPhoto>
  uploadPhoto: (listingId: string, encoded: EncodedPhoto) => Promise<{ url: string }>
  submitListing: (listingId: string) => Promise<unknown>
}
export type OrchestrationResult = {
  ok: boolean
  listingId?: string
  items: PhotoItem[]
  submitted: boolean
  failedId?: string
}

export type SequentialUploadResult = { ok: boolean; items: PhotoItem[]; failedId?: string }

// Upload each not-yet-uploaded photo SEQUENTIALLY to an EXISTING listing id — no create, no submit.
// This is the reusable primitive for both the single-listing path and the STAYS accommodation/room-
// type flow (where the room-type Listing is created by addAccommodationRoomType and photos attach to
// it). On the first failure it stops, marks that photo 'failed', and preserves the batch (already-
// uploaded photos keep their mediaUrl, so a retry re-attempts only the ones not yet done).
export async function uploadPhotosSequentially(
  items: PhotoItem[],
  io: Pick<UploadOrchestration, 'encodePhoto' | 'uploadPhoto'>,
  listingId: string,
): Promise<SequentialUploadResult> {
  const working = items.map((i) => ({ ...i }))
  for (let idx = 0; idx < working.length; idx += 1) {
    if (working[idx].status === 'uploaded') continue // already done (retry path)
    working[idx] = { ...working[idx], status: 'uploading', error: undefined }
    try {
      const encoded = await io.encodePhoto(working[idx])
      const { url } = await io.uploadPhoto(listingId, encoded)
      working[idx] = { ...working[idx], status: 'uploaded', mediaUrl: url }
    } catch (err) {
      working[idx] = { ...working[idx], status: 'failed', error: err instanceof Error ? err.message : 'upload failed' }
      return { ok: false, items: working, failedId: working[idx].id }
    }
  }
  return { ok: true, items: working }
}

// create draft → upload each photo SEQUENTIALLY → submit ONLY if all succeed. Retained for the
// single-listing path; the STAYS flow uses uploadPhotosSequentially directly against the room-type
// listing. Passing an existingListingId (retry) reuses the draft.
export async function uploadBatchThenSubmit(
  items: PhotoItem[],
  io: UploadOrchestration,
  existingListingId?: string,
): Promise<OrchestrationResult> {
  if (!meetsMinimumPhotos(items.length)) {
    return { ok: false, items, submitted: false }
  }
  const listingId = existingListingId ?? (await io.createListing()).id
  const result = await uploadPhotosSequentially(items, io, listingId)
  if (!result.ok) {
    return { ok: false, listingId, items: result.items, submitted: false, failedId: result.failedId }
  }
  await io.submitListing(listingId)
  return { ok: true, listingId, items: result.items, submitted: true }
}

// ---------- Bilingual copy (AR/EN) for the thin shell ----------
export const listingPhotoCopy = {
  ar: {
    title: 'صور العقار',
    addPhotos: 'أضف صوراً',
    hint: 'أضف صورة واحدة على الأقل حتى يرى الضيوف مكانك (بحد أقصى 20 صورة).',
    cover: 'الصورة الرئيسية',
    setCover: 'اجعلها الرئيسية',
    remove: 'حذف',
    counter: 'الصور',
    uploading: 'جارٍ الرفع…',
    uploaded: 'تم الرفع',
    failed: 'فشل الرفع',
    retry: 'إعادة المحاولة',
    minOne: 'أضف صورة واحدة على الأقل قبل الإرسال.',
    maxReached: 'الحد الأقصى 20 صورة.',
    unsupportedType: 'يُسمح فقط بصور JPEG أو PNG أو WebP.',
    emptyFile: 'الملف فارغ.',
    someFailed: 'تعذّر رفع بعض الصور. أعد المحاولة للصور المتعثرة قبل الإرسال.',
  },
  en: {
    title: 'Property photos',
    addPhotos: 'Add photos',
    hint: 'Add at least one photo so guests can see your place (up to 20).',
    cover: 'Cover photo',
    setCover: 'Set as cover',
    remove: 'Remove',
    counter: 'Photos',
    uploading: 'Uploading…',
    uploaded: 'Uploaded',
    failed: 'Upload failed',
    retry: 'Retry',
    minOne: 'Add at least one photo before submitting.',
    maxReached: 'Maximum of 20 photos.',
    unsupportedType: 'Only JPEG, PNG, or WebP images are allowed.',
    emptyFile: 'That file is empty.',
    someFailed: 'Some photos failed to upload. Retry the failed ones before submitting.',
  },
} as const
