// Premium AI photo enhancement capsule (isolated + provider-swappable, like ai-photo-categorize.mjs).
//
// This is the PAID tier, distinct from the free on-device enhancer (src/shared/photo/). It runs
// server-side and calls an external image API to do work the browser can't: real super-resolution
// upscaling, denoise, and relight so a hotel's photos look professionally shot.
//
// PROVIDER: fal.ai by default (cheapest for faithful enhancement — see pricing research). The provider
// call is isolated in one function so it can be swapped for Replicate / OpenAI gpt-image-1.5 without
// touching callers.
//
// SAFETY / GATING (enforced by callers, documented here):
//   • Only enabled when FAL_KEY is set (isPremiumEnhanceConfigured). Absent → callers must treat the
//     feature as OFF and never surface it; this function throws a clear, exposable error, never crashes.
//   • Intended for the HOTELS / top plans only, and metered per listing — the caller owns that policy.
//   • FAITHFUL enhancement only (upscale / light / sharpness). Generative edits that invent detail are
//     deliberately NOT done here, to protect the platform's honesty/truth-check guarantee.
//
// NOTE: this path is UNTESTED against a live key (none in this environment). The fal.ai request/response
// shape below follows fal's documented sync API and MUST be validated against a real key before launch.

const FAL_SYNC_BASE = 'https://fal.run'
// esrgan = fast, cheap, faithful 2–4x upscaler. Override with FAL_ENHANCE_MODEL for clarity-upscaler etc.
const DEFAULT_MODEL = 'fal-ai/esrgan'
// Must stay UNDER the Vercel function budget (maxDuration 30s in vercel.json) — otherwise the platform
// kills the request mid-call and wastes the whole budget. 25s leaves headroom to return the error cleanly.
const REQUEST_TIMEOUT_MS = 25_000

export function isPremiumEnhanceConfigured() {
  return Boolean(process.env.FAL_KEY)
}

function notConfiguredError() {
  const error = new Error('Premium photo enhancement is not enabled.')
  error.statusCode = 501
  error.code = 'PREMIUM_ENHANCE_NOT_CONFIGURED'
  error.expose = true
  return error
}

function upstreamError(message) {
  const error = new Error(message || 'Photo enhancement failed. Please try again.')
  error.statusCode = 502
  error.code = 'PREMIUM_ENHANCE_UPSTREAM_FAILED'
  error.expose = true
  return error
}

// Enhance a single photo. Input: raw Buffer + mimeType. Output: enhanced Buffer (JPEG/PNG bytes).
// Faithful upscale/denoise only. Throws a clear error when unconfigured or the provider fails.
export async function enhancePhotoBuffer(buffer, { mimeType = 'image/jpeg' } = {}) {
  if (!isPremiumEnhanceConfigured()) throw notConfiguredError()
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    const error = new Error('No image data to enhance.')
    error.statusCode = 400
    error.code = 'PREMIUM_ENHANCE_EMPTY'
    error.expose = true
    throw error
  }

  const model = process.env.FAL_ENHANCE_MODEL || DEFAULT_MODEL
  const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let result
  try {
    const res = await fetch(`${FAL_SYNC_BASE}/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${process.env.FAL_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ image_url: dataUri }),
      signal: controller.signal,
    })
    if (!res.ok) throw upstreamError(`Enhancement provider returned ${res.status}.`)
    result = await res.json()
  } catch (error) {
    if (error?.code === 'PREMIUM_ENHANCE_UPSTREAM_FAILED') throw error
    throw upstreamError(error?.name === 'AbortError' ? 'Photo enhancement timed out.' : undefined)
  } finally {
    clearTimeout(timer)
  }

  // fal returns { image: { url } } (single) or { images: [{ url }] }. Pull the first image URL.
  const outUrl = result?.image?.url || result?.images?.[0]?.url
  if (!outUrl) throw upstreamError('Enhancement provider returned no image.')

  const imgRes = await fetch(outUrl)
  if (!imgRes.ok) throw upstreamError('Could not download the enhanced image.')
  return Buffer.from(await imgRes.arrayBuffer())
}
