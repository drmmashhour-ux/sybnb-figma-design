import { describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_LISTING_PHOTO_TYPES,
  MAX_LISTING_PHOTOS,
  MIN_LISTING_PHOTOS,
  isSupportedPhotoType,
  validatePhotoCandidate,
  canAddPhotos,
  remainingPhotoSlots,
  meetsMinimumPhotos,
  compressionPlan,
  scaledDimensions,
  addToBatch,
  removeFromBatch,
  setCover,
  coverItem,
  selectCoverUrl,
  uploadBatchThenSubmit,
  uploadPhotosSequentially,
  listingPhotoCopy,
} from '../../src/modules/seller/listingPhotos'

// C2 — Real Property Photo Upload. Pure, DOM-free logic (no browser APIs, no React, no plan-payment).
// The canvas compression and object-URL rendering live in the thin React shell and are verified
// manually; everything decision/orchestration is covered here.

const item = (id: string, over: Partial<Record<string, unknown>> = {}) => ({
  id, name: `${id}.jpg`, mimeType: 'image/jpeg' as const, status: 'selected' as const, ...over,
})

describe('C2 listing photos — types & validation (mirrors server contract)', () => {
  it('allows exactly jpeg, png, webp', () => {
    expect([...ALLOWED_LISTING_PHOTO_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp'])
    expect(isSupportedPhotoType('image/jpeg')).toBe(true)
    expect(isSupportedPhotoType('image/png')).toBe(true)
    expect(isSupportedPhotoType('image/webp')).toBe(true)
  })

  it('rejects unsupported types (pdf, gif, svg, heic) and empty files', () => {
    expect(validatePhotoCandidate({ type: 'application/pdf', size: 10 })).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(validatePhotoCandidate({ type: 'image/gif', size: 10 })).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(validatePhotoCandidate({ type: 'image/svg+xml', size: 10 })).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(validatePhotoCandidate({ type: 'image/heic', size: 10 })).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(validatePhotoCandidate({ type: 'image/png', size: 0 })).toEqual({ ok: false, code: 'EMPTY_FILE' })
  })

  it('accepts a supported non-empty file', () => {
    expect(validatePhotoCandidate({ type: 'image/webp', size: 1234 })).toEqual({ ok: true })
  })
})

describe('C2 listing photos — count rules (min 1, max 20)', () => {
  it('exposes the agreed bounds', () => {
    expect(MIN_LISTING_PHOTOS).toBe(1)
    expect(MAX_LISTING_PHOTOS).toBe(20)
  })
  it('enforces the 20-photo ceiling', () => {
    expect(canAddPhotos(19, 1)).toBe(true)
    expect(canAddPhotos(20, 1)).toBe(false)
    expect(remainingPhotoSlots(18)).toBe(2)
    expect(remainingPhotoSlots(20)).toBe(0)
  })
  it('requires at least one photo', () => {
    expect(meetsMinimumPhotos(0)).toBe(false)
    expect(meetsMinimumPhotos(1)).toBe(true)
  })
})

describe('C2 listing photos — compression policy never yields an unsupported MIME', () => {
  it('keeps the input server-supported type; PNG stays lossless', () => {
    expect(compressionPlan({ type: 'image/jpeg', bytes: 5_000_000 }).outputType).toBe('image/jpeg')
    expect(compressionPlan({ type: 'image/webp', bytes: 5_000_000 }).outputType).toBe('image/webp')
    const png = compressionPlan({ type: 'image/png', bytes: 5_000_000 })
    expect(png.outputType).toBe('image/png')
    expect(png.quality).toBe(1) // lossless, preserves transparency
  })
  it('falls back to a SUPPORTED type for any unexpected input (never unsupported)', () => {
    const plan = compressionPlan({ type: 'image/tiff', bytes: 100 })
    expect([...ALLOWED_LISTING_PHOTO_TYPES]).toContain(plan.outputType)
  })
  it('downscales the longest edge while preserving aspect ratio', () => {
    expect(scaledDimensions(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(scaledDimensions(1200, 3000, 1600)).toEqual({ width: 640, height: 1600 })
    expect(scaledDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 }) // already small
  })
})

describe('C2 listing photos — batch add / remove / cover', () => {
  it('adds up to the remaining slots and reports rejected overflow', () => {
    const start = Array.from({ length: 19 }, (_v, i) => item(`p${i}`))
    const incoming = [item('a'), item('b'), item('c')]
    const res = addToBatch(start as any, incoming as any)
    expect(res.items).toHaveLength(20)
    expect(res.accepted).toHaveLength(1)
    expect(res.rejected).toBe(2)
  })

  it('remove returns the removed item so the shell can revoke its object URL', () => {
    const items = [item('a', { previewUrl: 'blob:a' }), item('b')]
    const res = removeFromBatch(items as any, 'a')
    expect(res.items.map((i) => i.id)).toEqual(['b'])
    expect(res.removed?.previewUrl).toBe('blob:a')
  })

  it('the first item is the default cover; setCover moves the chosen one to the front', () => {
    const items = [item('a'), item('b'), item('c')]
    expect(coverItem(items as any)?.id).toBe('a')
    const recovered = setCover(items as any, 'c')
    expect(recovered.map((i) => i.id)).toEqual(['c', 'a', 'b'])
    expect(coverItem(recovered)?.id).toBe('c')
  })
})

describe('C2 listing photos — display cover selection (real cover vs stock art)', () => {
  it('picks the lowest-sortOrder real url (first uploaded = cover)', () => {
    const media = [
      { url: '/api/listings/x/media/file/2.jpg', sortOrder: 1 },
      { url: '/api/listings/x/media/file/1.jpg', sortOrder: 0 },
    ]
    expect(selectCoverUrl(media, '/stock.webp')).toBe('/api/listings/x/media/file/1.jpg')
  })
  it('falls back to stock art when there is no media', () => {
    expect(selectCoverUrl([], '/stock.webp')).toBe('/stock.webp')
    expect(selectCoverUrl(undefined, '/stock.webp')).toBe('/stock.webp')
  })
  it('ignores media rows without a usable url', () => {
    expect(selectCoverUrl([{ kind: 'photo' }], '/stock.webp')).toBe('/stock.webp')
  })
})

describe('C2 listing photos — orchestration: create → sequential upload → submit', () => {
  const encoded = { fileBase64: 'QUJD', mimeType: 'image/jpeg' as const }
  const makeIo = (over: Partial<Record<string, any>> = {}) => ({
    createListing: vi.fn(async () => ({ id: 'listing-1' })),
    encodePhoto: vi.fn(async () => encoded),
    uploadPhoto: vi.fn(async (_id: string, _enc: any) => ({ url: '/served.jpg' })),
    submitListing: vi.fn(async () => ({ ok: true })),
    ...over,
  })

  it('uploads every photo sequentially, in order, then submits once', async () => {
    const io = makeIo()
    const order: string[] = []
    io.uploadPhoto = vi.fn(async (_id: string, enc: any) => { order.push(enc.fileBase64); return { url: '/u' } })
    const items = [item('a'), item('b'), item('c')]
    const res = await uploadBatchThenSubmit(items as any, io as any)
    expect(io.createListing).toHaveBeenCalledTimes(1)
    expect(io.uploadPhoto).toHaveBeenCalledTimes(3)
    expect(io.submitListing).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(true)
    expect(res.submitted).toBe(true)
    expect(res.items.every((i) => i.status === 'uploaded')).toBe(true)
  })

  it('sends real base64 bytes to the uploader, never a filename', async () => {
    const io = makeIo()
    await uploadBatchThenSubmit([item('a')] as any, io as any)
    const [, enc] = io.uploadPhoto.mock.calls[0]
    expect(enc.fileBase64).toBe('QUJD')
    expect(JSON.stringify(enc)).not.toContain('.jpg') // no filename leaked into the payload
  })

  it('does NOT submit if any upload fails; preserves the batch and flags the failed photo', async () => {
    const io = makeIo()
    let n = 0
    io.uploadPhoto = vi.fn(async () => { n += 1; if (n === 2) throw new Error('network'); return { url: '/u' } })
    const items = [item('a'), item('b'), item('c')]
    const res = await uploadBatchThenSubmit(items as any, io as any)
    expect(res.ok).toBe(false)
    expect(res.submitted).toBe(false)
    expect(io.submitListing).not.toHaveBeenCalled()
    expect(res.failedId).toBe('b')
    expect(res.items[0].status).toBe('uploaded') // a succeeded, preserved
    expect(res.items[1].status).toBe('failed')
    expect(res.items[2].status).toBe('selected') // c never attempted, still in the batch
    expect(io.uploadPhoto).toHaveBeenCalledTimes(2) // stopped at the failure
  })

  it('retry re-runs ONLY the not-yet-uploaded photos against the same listing (no re-create)', async () => {
    const io = makeIo()
    // Simulate a prior partial run: a uploaded, b failed, c pending.
    const priorItems = [
      item('a', { status: 'uploaded', mediaUrl: '/a' }),
      item('b', { status: 'failed', error: 'network' }),
      item('c', { status: 'selected' }),
    ]
    const res = await uploadBatchThenSubmit(priorItems as any, io as any, 'listing-1')
    expect(io.createListing).not.toHaveBeenCalled() // reused existing draft
    expect(io.uploadPhoto).toHaveBeenCalledTimes(2) // only b and c
    expect(io.submitListing).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(true)
    expect(res.items.every((i) => i.status === 'uploaded')).toBe(true)
  })

  it('refuses to start with zero photos (min 1) and never creates a listing', async () => {
    const io = makeIo()
    const res = await uploadBatchThenSubmit([] as any, io as any)
    expect(res.ok).toBe(false)
    expect(res.submitted).toBe(false)
    expect(io.createListing).not.toHaveBeenCalled()
  })
})

describe('C2 listing photos — uploadPhotosSequentially (upload-only, for the accommodation/room-type flow)', () => {
  const encoded = { fileBase64: 'QUJD', mimeType: 'image/jpeg' as const }
  const makeIo = (over: Partial<Record<string, any>> = {}) => ({
    encodePhoto: vi.fn(async () => encoded),
    uploadPhoto: vi.fn(async (_id: string, _enc: any) => ({ url: '/served.jpg' })),
    ...over,
  })

  it('uploads every photo sequentially to the given room-type listing id (no create/submit here)', async () => {
    const io = makeIo()
    const res = await uploadPhotosSequentially([item('a'), item('b')] as any, io as any, 'room-listing-9')
    expect(io.uploadPhoto).toHaveBeenCalledTimes(2)
    expect(io.uploadPhoto.mock.calls.every((c: any[]) => c[0] === 'room-listing-9')).toBe(true)
    expect(res.ok).toBe(true)
    expect(res.items.every((i) => i.status === 'uploaded')).toBe(true)
  })

  it('sends real base64 bytes, never a filename', async () => {
    const io = makeIo()
    await uploadPhotosSequentially([item('a')] as any, io as any, 'room-1')
    const [, enc] = io.uploadPhoto.mock.calls[0]
    expect(enc.fileBase64).toBe('QUJD')
    expect(JSON.stringify(enc)).not.toContain('.jpg')
  })

  it('stops on the first failure, preserves the batch, flags the failed photo', async () => {
    const io = makeIo()
    let n = 0
    io.uploadPhoto = vi.fn(async () => { n += 1; if (n === 2) throw new Error('network'); return { url: '/u' } })
    const res = await uploadPhotosSequentially([item('a'), item('b'), item('c')] as any, io as any, 'room-1')
    expect(res.ok).toBe(false)
    expect(res.failedId).toBe('b')
    expect(res.items[0].status).toBe('uploaded')
    expect(res.items[1].status).toBe('failed')
    expect(res.items[2].status).toBe('selected')
    expect(io.uploadPhoto).toHaveBeenCalledTimes(2)
  })

  it('retry re-uploads ONLY the not-yet-uploaded photos', async () => {
    const io = makeIo()
    const prior = [
      item('a', { status: 'uploaded', mediaUrl: '/a' }),
      item('b', { status: 'failed', error: 'network' }),
    ]
    const res = await uploadPhotosSequentially(prior as any, io as any, 'room-1')
    expect(io.uploadPhoto).toHaveBeenCalledTimes(1) // only b
    expect(res.ok).toBe(true)
    expect(res.items.every((i) => i.status === 'uploaded')).toBe(true)
  })
})

describe('C2 listing photos — bilingual copy', () => {
  it('has matching non-empty AR and EN keys', () => {
    const ar = Object.keys(listingPhotoCopy.ar)
    const en = Object.keys(listingPhotoCopy.en)
    expect(ar.sort()).toEqual(en.sort())
    for (const k of ar) {
      expect((listingPhotoCopy.ar as any)[k].length).toBeGreaterThan(0)
      expect((listingPhotoCopy.en as any)[k].length).toBeGreaterThan(0)
    }
  })
})
