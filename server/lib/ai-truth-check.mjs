// ─────────────────────────────────────────────────────────────────────────────
// AI LISTING TRUTH-CHECK CAPSULE (server side)
//
// Honesty guard: cross-checks the amenities/features a host CLAIMED (from the filter system) against
// the listing PHOTOS, using Claude's vision. If a visible claim isn't evidenced — or is contradicted —
// it raises a plain host-facing warning. Policy is WARN, NOT BLOCK: the host can still submit; the
// warnings also travel to admin review so a human sees the AI's honesty note before approving.
//
//   • Uses Claude (multimodal) when ANTHROPIC_API_KEY is set (shares the client in ai-insights.mjs).
//   • Without a key it returns status "unavailable" — it never fakes a verdict.
//
// Fairness: many real amenities aren't photographable (Wi-Fi, generator, breakfast). Those must NOT be
// treated as lies — only clearly visual claims (pool, sea view, parking, balcony, garden…) or direct
// contradictions raise a warning.
// ─────────────────────────────────────────────────────────────────────────────
import { isAnthropicConfigured, requireAnthropic, MODEL } from './ai-insights.mjs'

const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_PHOTOS = 6

const SYSTEM_PROMPT = `You are a listing honesty checker for SYBNB (short-term rentals in Syria). You are given the features a host CLAIMED for their listing, and the listing PHOTOS. For each claimed feature, judge ONLY from the photos whether it is:
- "evidenced": clearly visible in a photo,
- "not_evidenced": not shown, but not contradicted either,
- "contradicted": the photos clearly show the opposite.
Be fair and cautious: many real features are NOT photographable (e.g. Wi-Fi, fast internet, generator, breakfast/meals, pet friendly, halal). Mark those "not_evidenced" — NEVER "contradicted" — unless a photo truly contradicts them. Only clearly VISUAL claims that are missing (e.g. Pool, Sea view, Mountain view, Garden, Balcony, Parking, BBQ, Wheelchair access) or any "contradicted" claim should produce a short, polite host-facing warning telling them to add a photo or remove the claim. Never invent. Reply with STRICT JSON only: {"items":[{"claim":"<feature>","verdict":"evidenced|not_evidenced|contradicted","note":"<short reason>"}],"warnings":["<short host-facing warning>"]}.`

// Public entry. Returns { status, items, warnings }. status: ok | skipped | unavailable.
export async function checkListingHonesty({ claims = [], photos = [], locale = 'en' } = {}) {
  const features = (Array.isArray(claims) ? claims : []).map((c) => String(c || '').trim()).filter(Boolean).slice(0, 40)
  const images = (Array.isArray(photos) ? photos : [])
    .filter((p) => p && typeof p.data === 'string' && p.data.length > 0 && ALLOWED_MEDIA.has(p.mediaType))
    .slice(0, MAX_PHOTOS)

  if (!features.length || !images.length) return { status: 'skipped', items: [], warnings: [] }
  if (!isAnthropicConfigured()) return { status: 'unavailable', items: [], warnings: [] }

  try {
    const client = requireAnthropic()
    const content = [
      { type: 'text', text: JSON.stringify({ language: locale === 'ar' ? 'Arabic' : 'English', claimedFeatures: features }) },
      ...images.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } })),
    ]
    const response = await client.messages.create({ model: MODEL, max_tokens: 900, system: SYSTEM_PROMPT, messages: [{ role: 'user', content }] })
    const block = response.content.find((b) => b.type === 'text')
    if (!block?.text) return { status: 'unavailable', items: [], warnings: [] }
    let parsed
    try {
      parsed = JSON.parse(block.text)
    } catch {
      return { status: 'unavailable', items: [], warnings: [] }
    }
    return {
      status: 'ok',
      items: Array.isArray(parsed.items) ? parsed.items.slice(0, 60) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((w) => typeof w === 'string').slice(0, 20) : [],
      model: MODEL,
    }
  } catch {
    return { status: 'unavailable', items: [], warnings: [] }
  }
}
