import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  addToBatch,
  compressionPlan,
  coverItem,
  listingPhotoCopy,
  MAX_LISTING_PHOTOS,
  removeFromBatch,
  scaledDimensions,
  setCover,
  validatePhotoCandidate,
  type PhotoItem,
} from './listingPhotos'

// C2 — thin React shell over the pure logic in listingPhotos.ts. Browser-only concerns live here
// (file input, canvas compression, object-URL previews) and are verified manually; all decisions come
// from the tested pure module. Controlled component: the wizard owns the batch and drives upload.
export type PhotoDraft = { item: PhotoItem; blob: Blob }

let draftSeq = 0
const nextDraftId = () => `photo-${(draftSeq += 1)}`

// Compress + correctly orient an image entirely in the browser. Uses createImageBitmap with
// imageOrientation:'from-image' so EXIF-rotated phone photos are drawn upright; downscales the longest
// edge and re-encodes to a SERVER-SUPPORTED type (compressionPlan guarantees this). Never converts to
// an unsupported MIME.
async function compressImage(file: File): Promise<{ blob: Blob; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }> {
  const plan = compressionPlan({ type: file.type, bytes: file.size })
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    bitmap = await createImageBitmap(file)
  }
  const { width, height } = scaledDimensions(bitmap.width, bitmap.height, plan.maxDimension)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not available')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not process the image'))),
      plan.outputType,
      plan.quality,
    ),
  )
  return { blob, mimeType: plan.outputType }
}

type Props = {
  lang: Lang
  photos: PhotoDraft[]
  onChange: (next: PhotoDraft[]) => void
  onRetry?: () => void
  busy?: boolean
}

export function ListingPhotoUploader({ lang, photos, onChange, onRetry, busy = false }: Props) {
  const isAr = lang === 'ar'
  const t = listingPhotoCopy[isAr ? 'ar' : 'en']
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [notice, setNotice] = useState<string>('')

  // Revoke every object URL when the component unmounts (no leaks).
  useEffect(() => {
    return () => {
      for (const p of photosRef.current) if (p.item.previewUrl) URL.revokeObjectURL(p.item.previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const photosRef = useRef<PhotoDraft[]>(photos)
  photosRef.current = photos

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setNotice('')
    const accepted: PhotoDraft[] = []
    let rejectedType = false
    let rejectedEmpty = false
    for (const file of Array.from(fileList)) {
      const check = validatePhotoCandidate({ type: file.type, size: file.size })
      if (!check.ok) {
        if (check.code === 'UNSUPPORTED_TYPE') rejectedType = true
        else rejectedEmpty = true
        continue
      }
      try {
        const { blob, mimeType } = await compressImage(file)
        const previewUrl = URL.createObjectURL(blob)
        accepted.push({
          item: { id: nextDraftId(), name: file.name, mimeType, status: 'selected', previewUrl },
          blob,
        })
      } catch {
        rejectedEmpty = true
      }
    }
    const merged = addToBatch(
      photos.map((p) => p.item),
      accepted.map((p) => p.item),
    )
    // addToBatch caps at MAX; drop the object URLs of any rejected overflow so they don't leak.
    const acceptedIds = new Set(merged.accepted.map((i) => i.id))
    for (const draft of accepted) if (!acceptedIds.has(draft.item.id) && draft.item.previewUrl) URL.revokeObjectURL(draft.item.previewUrl)
    const keptDrafts = accepted.filter((d) => acceptedIds.has(d.item.id))
    onChange([...photos, ...keptDrafts])
    if (rejectedType) setNotice(t.unsupportedType)
    else if (rejectedEmpty) setNotice(t.emptyFile)
    else if (merged.rejected > 0) setNotice(t.maxReached)
    if (inputRef.current) inputRef.current.value = '' // allow re-selecting the same file
  }

  function remove(id: string) {
    const { removed } = removeFromBatch(
      photos.map((p) => p.item),
      id,
    )
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
    onChange(photos.filter((p) => p.item.id !== id))
  }

  function makeCover(id: string) {
    const orderedItems = setCover(
      photos.map((p) => p.item),
      id,
    )
    const byId = new Map(photos.map((p) => [p.item.id, p]))
    onChange(orderedItems.map((i) => byId.get(i.id)!).filter(Boolean))
  }

  const cover = coverItem(photos.map((p) => p.item))
  const anyFailed = photos.some((p) => p.item.status === 'failed')

  return (
    <div className="listing-photo-uploader" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="lpu-head">
        <strong>{t.title}</strong>
        <span>{t.hint}</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => void handleFiles(e.target.files)}
      />

      <div className="lpu-grid">
        {photos.map((p) => (
          <figure key={p.item.id} className={`lpu-cell status-${p.item.status}`}>
            {p.item.previewUrl ? (
              <img src={p.item.previewUrl} alt="" loading="lazy" />
            ) : (
              <div className="lpu-noimg" />
            )}
            {cover?.id === p.item.id && <span className="lpu-cover-badge">{t.cover}</span>}
            {p.item.status === 'uploading' && <span className="lpu-status">{t.uploading}</span>}
            {p.item.status === 'uploaded' && <span className="lpu-status ok">{t.uploaded}</span>}
            {p.item.status === 'failed' && <span className="lpu-status err">{t.failed}</span>}
            <figcaption>
              {cover?.id !== p.item.id && (
                <button type="button" disabled={busy} onClick={() => makeCover(p.item.id)}>
                  {t.setCover}
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => remove(p.item.id)}>
                {t.remove}
              </button>
            </figcaption>
          </figure>
        ))}

        {photos.length < MAX_LISTING_PHOTOS && (
          <button type="button" className="lpu-add" disabled={busy} onClick={() => inputRef.current?.click()}>
            + {t.addPhotos}
          </button>
        )}
      </div>

      <div className="lpu-foot">
        <span>
          {t.counter}: {photos.length}/{MAX_LISTING_PHOTOS}
        </span>
        {photos.length === 0 && <em className="lpu-min">{t.minOne}</em>}
        {notice && (
          <em className="lpu-notice" role="alert">
            {notice}
          </em>
        )}
      </div>

      {anyFailed && (
        <div className="lpu-retry" role="alert">
          <span>{t.someFailed}</span>
          {onRetry && (
            <button type="button" disabled={busy} onClick={onRetry}>
              {t.retry}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
