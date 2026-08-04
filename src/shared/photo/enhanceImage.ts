// On-device photo enhancement capsule (isolated + reusable, like the map / AI / payment capsules).
//
// WHY on-device: hosts in Syria are often non-technical and on slow connections. This runs entirely in
// the browser on canvas pixels — no network, no API keys, no per-image cost, works offline, and the
// photo never leaves the device until the host chooses to upload it. A one-tap "Enhance" gives good
// results automatically (auto white-balance + auto-contrast + gentle saturation + light sharpen), and
// manual sliders let the host fine-tune brightness / contrast / saturation / warmth.
//
// The pixel math (`applyAdjustments`, `computeAutoAdjustments`) is PURE — it takes a plain
// { data, width, height } buffer, so it is unit-testable in Node without a DOM/canvas. The File/Canvas
// wrappers at the bottom are browser-only and used by the wizard's photo editor UI.

export type PhotoAdjustments = {
  brightness: number // -100..100  (add light)
  contrast: number //   -100..100
  saturation: number // -100..100  (0 = grayscale-ish at -100, punchy at +100)
  warmth: number //     -100..100  (+ warmer/orange, - cooler/blue)
  sharpen: number //     0..100
}

export const NEUTRAL_ADJUSTMENTS: PhotoAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  sharpen: 0,
}

export type PixelBuffer = { data: Uint8ClampedArray; width: number; height: number }

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

// Apply brightness / contrast / saturation / warmth in one pass, then an optional unsharp-mask sharpen.
// Mutates `buffer.data` in place. Pure w.r.t. the DOM so it can run in tests.
export function applyAdjustments(buffer: PixelBuffer, adj: PhotoAdjustments): PixelBuffer {
  const { data } = buffer
  const brightness = (adj.brightness / 100) * 80 // ±80 levels
  // Standard contrast factor centered on 128.
  const c = (adj.contrast / 100) * 128
  const contrastF = (259 * (c + 255)) / (255 * (259 - c))
  const satF = 1 + adj.saturation / 100
  const warm = (adj.warmth / 100) * 40 // ±40 to R, mirrored on B

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    // brightness
    r += brightness
    g += brightness
    b += brightness

    // contrast (around mid-gray)
    r = contrastF * (r - 128) + 128
    g = contrastF * (g - 128) + 128
    b = contrastF * (b - 128) + 128

    // saturation (toward luma)
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    r = luma + (r - luma) * satF
    g = luma + (g - luma) * satF
    b = luma + (b - luma) * satF

    // warmth (white balance nudge)
    r += warm
    b -= warm

    data[i] = clamp8(r)
    data[i + 1] = clamp8(g)
    data[i + 2] = clamp8(b)
    // alpha (i+3) untouched
  }

  if (adj.sharpen > 0) sharpen(buffer, adj.sharpen / 100)
  return buffer
}

// 3x3 unsharp-style sharpen. `amount` 0..1. Works on a copy of the source so neighbours aren't polluted.
function sharpen(buffer: PixelBuffer, amount: number): void {
  const { data, width, height } = buffer
  if (width < 3 || height < 3) return
  const src = new Uint8ClampedArray(data)
  const k = amount // center weight boost
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const o = (y * width + x) * 4
      for (let ch = 0; ch < 3; ch += 1) {
        const p = o + ch
        const center = src[p]
        const neighbours =
          src[p - 4] + src[p + 4] + src[p - width * 4] + src[p + width * 4]
        // center*(1+4k) - k*neighbours  → emphasises edges
        data[p] = clamp8(center * (1 + 4 * k) - k * neighbours)
      }
    }
  }
}

// Analyse a photo and return the adjustments that make it "pop" the way a one-tap auto-enhance would:
//  • white balance: gray-world — push the average of R/G/B back toward neutral (drives `warmth`)
//  • contrast: stretch the luma histogram's 2nd..98th percentile toward full range
//  • plus a gentle fixed saturation + sharpen lift
// Pure: reads the buffer, returns numbers, mutates nothing.
export function computeAutoAdjustments(buffer: PixelBuffer): PhotoAdjustments {
  const { data } = buffer
  const hist = new Array(256).fill(0)
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    sumR += r
    sumG += g
    sumB += b
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) | 0
    hist[luma < 0 ? 0 : luma > 255 ? 255 : luma] += 1
    n += 1
  }
  if (n === 0) return { ...NEUTRAL_ADJUSTMENTS }

  // Percentile black/white points (ignore the extreme 2% tails).
  const lowCut = n * 0.02
  const highCut = n * 0.98
  let acc = 0
  let lowP = 0
  let highP = 255
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v]
    if (acc <= lowCut) lowP = v
    if (acc <= highCut) highP = v
  }
  const span = Math.max(1, highP - lowP)
  // Map a stretch factor (255/span) into the contrast slider's response. contrastF≈255/span when
  // contrast≈ solving; approximate: more stretch needed → more contrast, capped so it stays natural.
  const stretch = 255 / span // >1 when the image is low-contrast
  const contrast = Math.round(Math.max(0, Math.min(45, (stretch - 1) * 90)))

  // gray-world white balance: if red dominates, cool it (negative warmth); if blue dominates, warm it.
  const avgR = sumR / n
  const avgG = sumG / n
  const avgB = sumB / n
  const gray = (avgR + avgG + avgB) / 3
  // warmth slider units: difference between blue-cast and red-cast, scaled. Positive => warm up.
  const warmth = Math.round(Math.max(-35, Math.min(35, ((gray - avgR) - (gray - avgB)) * 0.6)))

  // brightness: if the midtone is dark, lift a little.
  const midtone = lowP + span / 2
  const brightness = Math.round(Math.max(0, Math.min(20, (118 - midtone) * 0.25)))

  return {
    brightness,
    contrast,
    saturation: 12, // gentle, consistent pop
    warmth,
    sharpen: 22,
  }
}

export function hasVisibleEffect(adj: PhotoAdjustments): boolean {
  return adj.brightness !== 0 || adj.contrast !== 0 || adj.saturation !== 0 || adj.warmth !== 0 || adj.sharpen !== 0
}

// ---------------------------------------------------------------------------
// Browser-only wrappers (canvas + File). Not exercised by Node tests.
// ---------------------------------------------------------------------------

async function fileToCanvas(file: File, maxEdge = 2200): Promise<HTMLCanvasElement | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    return canvas
  } catch {
    return null
  }
}

function canvasToFile(canvas: HTMLCanvasElement, name: string, quality = 0.9): Promise<File | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? new File([blob], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : null),
      'image/jpeg',
      quality,
    )
  })
}

// Load a photo File into a reusable source buffer (for a live-preview editor: analyse/adjust repeatedly
// without re-decoding). Returns the base canvas + its pristine ImageData.
export async function loadEditableImage(
  file: File,
): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; source: ImageData } | null> {
  const canvas = await fileToCanvas(file)
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const source = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { canvas, ctx, source }
}

// Render `source` with `adj` applied onto `canvas` and return a data URL (for the live preview <img>).
export function renderAdjustedPreview(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  source: ImageData,
  adj: PhotoAdjustments,
): string {
  const working = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
  applyAdjustments(working, adj)
  ctx.putImageData(working, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.9)
}

// One-tap auto-enhance: analyse then apply, returning a new JPEG File. Non-images / decode failures are
// returned untouched so a bad file never blocks the flow.
export async function enhanceImageFile(file: File): Promise<File> {
  const canvas = await fileToCanvas(file)
  if (!canvas) return file
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  const buffer = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const adj = computeAutoAdjustments(buffer)
  applyAdjustments(buffer, adj)
  ctx.putImageData(buffer, 0, 0)
  return (await canvasToFile(canvas, file.name)) || file
}

// Apply explicit manual adjustments (from the editor sliders) and return a new JPEG File.
export async function applyAdjustmentsToFile(file: File, adj: PhotoAdjustments): Promise<File> {
  if (!hasVisibleEffect(adj)) return file
  const canvas = await fileToCanvas(file)
  if (!canvas) return file
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  const buffer = ctx.getImageData(0, 0, canvas.width, canvas.height)
  applyAdjustments(buffer, adj)
  ctx.putImageData(buffer, 0, 0)
  return (await canvasToFile(canvas, file.name)) || file
}
