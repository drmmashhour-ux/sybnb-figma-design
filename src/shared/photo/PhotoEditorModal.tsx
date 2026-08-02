import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  applyAdjustmentsToFile,
  computeAutoAdjustments,
  loadEditableImage,
  NEUTRAL_ADJUSTMENTS,
  renderAdjustedPreview,
  type PhotoAdjustments,
} from './enhanceImage'

// On-device photo editor. Live preview + one-tap "Auto enhance" + manual sliders. All pixel work is
// local (see enhanceImage.ts) — nothing is uploaded until the host applies and later submits.
type Props = {
  file: File
  isAr: boolean
  onApply: (edited: File) => void
  onClose: () => void
}

type Loaded = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; source: ImageData }

const T = {
  ar: {
    title: 'تعديل الصورة',
    auto: '✨ تحسين تلقائي',
    brightness: 'السطوع',
    contrast: 'التباين',
    saturation: 'تشبّع الألوان',
    warmth: 'الدفء',
    sharpen: 'الحدة',
    reset: 'إعادة تعيين',
    apply: 'حفظ التعديلات',
    cancel: 'إلغاء',
    working: 'جارٍ التطبيق…',
    loading: 'جارٍ تحميل الصورة…',
  },
  en: {
    title: 'Edit photo',
    auto: '✨ Auto enhance',
    brightness: 'Brightness',
    contrast: 'Contrast',
    saturation: 'Saturation',
    warmth: 'Warmth',
    sharpen: 'Sharpness',
    reset: 'Reset',
    apply: 'Save changes',
    cancel: 'Cancel',
    working: 'Applying…',
    loading: 'Loading photo…',
  },
}

export function PhotoEditorModal({ file, isAr, onApply, onClose }: Props) {
  const t = isAr ? T.ar : T.en
  const loadedRef = useRef<Loaded | null>(null)
  const [ready, setReady] = useState(false)
  const [preview, setPreview] = useState<string>('')
  const [adj, setAdj] = useState<PhotoAdjustments>({ ...NEUTRAL_ADJUSTMENTS })
  const [working, setWorking] = useState(false)

  // Load once.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await loadEditableImage(file)
      if (cancelled) return
      loadedRef.current = loaded
      if (loaded) {
        setPreview(renderAdjustedPreview(loaded.canvas, loaded.ctx, loaded.source, NEUTRAL_ADJUSTMENTS))
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file])

  // Re-render preview whenever sliders change.
  useEffect(() => {
    const loaded = loadedRef.current
    if (!loaded) return
    setPreview(renderAdjustedPreview(loaded.canvas, loaded.ctx, loaded.source, adj))
  }, [adj])

  function runAuto() {
    const loaded = loadedRef.current
    if (!loaded) return
    setAdj(computeAutoAdjustments(loaded.source))
  }

  async function apply() {
    setWorking(true)
    try {
      const edited = await applyAdjustmentsToFile(file, adj)
      onApply(edited)
    } finally {
      setWorking(false)
    }
  }

  const slider = (label: string, key: keyof PhotoAdjustments, min: number, max: number) => (
    <label style={styles.sliderRow}>
      <span style={styles.sliderLabel}>
        {label}
        <em style={styles.sliderVal}>{adj[key]}</em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={adj[key]}
        onChange={(e) => setAdj((cur) => ({ ...cur, [key]: Number(e.target.value) }))}
        style={styles.slider}
      />
    </label>
  )

  return (
    <div style={styles.overlay} dir={isAr ? 'rtl' : 'ltr'} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.head}>
          <strong style={styles.title}>{t.title}</strong>
          <button type="button" style={styles.close} onClick={onClose} aria-label={t.cancel}>
            ×
          </button>
        </div>

        <div style={styles.previewWrap}>
          {ready && preview ? (
            <img src={preview} alt="" style={styles.previewImg} />
          ) : (
            <div style={styles.loading}>{t.loading}</div>
          )}
        </div>

        <button type="button" style={styles.auto} onClick={runAuto} disabled={!ready}>
          {t.auto}
        </button>

        <div style={styles.sliders}>
          {slider(t.brightness, 'brightness', -100, 100)}
          {slider(t.contrast, 'contrast', -100, 100)}
          {slider(t.saturation, 'saturation', -100, 100)}
          {slider(t.warmth, 'warmth', -100, 100)}
          {slider(t.sharpen, 'sharpen', 0, 100)}
        </div>

        <div style={styles.actions}>
          <button type="button" style={styles.reset} onClick={() => setAdj({ ...NEUTRAL_ADJUSTMENTS })} disabled={!ready || working}>
            {t.reset}
          </button>
          <button type="button" style={styles.apply} onClick={() => void apply()} disabled={!ready || working}>
            {working ? t.working : t.apply}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(4,6,12,.78)', backdropFilter: 'blur(6px)', display: 'grid', placeItems: 'center', padding: 16, overflowY: 'auto' },
  panel: { position: 'relative', width: '100%', maxWidth: 440, background: '#12151a', border: '1px solid #2a3140', borderRadius: 18, padding: 16, color: '#fff', boxShadow: '0 30px 80px rgba(0,0,0,.5)', display: 'grid', gap: 12 },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: 900 },
  close: { width: 34, height: 34, borderRadius: 999, border: '1px solid #2a3140', background: '#171b22', color: '#fff', fontSize: 20, cursor: 'pointer', lineHeight: 1 },
  previewWrap: { borderRadius: 12, overflow: 'hidden', background: '#0b0d10', display: 'grid', placeItems: 'center', minHeight: 200 },
  previewImg: { width: '100%', maxHeight: 340, objectFit: 'contain', display: 'block' },
  loading: { color: '#9aa6ba', fontSize: 14, padding: 40 },
  auto: { minHeight: 46, border: '1px solid #d5a915', borderRadius: 12, background: '#1a1608', color: '#f4d772', fontWeight: 900, fontSize: 15, cursor: 'pointer' },
  sliders: { display: 'grid', gap: 10 },
  sliderRow: { display: 'grid', gap: 4 },
  sliderLabel: { display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: '#cfd6e4' },
  sliderVal: { color: '#8ea0ff', fontStyle: 'normal' },
  slider: { width: '100%', accentColor: '#20d29b' },
  actions: { display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginTop: 2 },
  reset: { minHeight: 48, border: '1px solid #30384d', borderRadius: 12, background: '#0d1320', color: '#cfd6e4', fontWeight: 800, cursor: 'pointer' },
  apply: { minHeight: 48, border: 0, borderRadius: 12, background: '#20d29b', color: '#06110e', fontWeight: 950, fontSize: 16, cursor: 'pointer' },
}
