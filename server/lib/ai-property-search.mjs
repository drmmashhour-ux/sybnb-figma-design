// ─────────────────────────────────────────────────────────────────────────────
// AI PROPERTY-SEARCH CAPSULE (Synitres module — server side)
//
// Turns a free-text real-estate query ("3 bedroom apartment under 25 million with elevator") into the
// structured filters GET /api/listings already understands. Fixed vocabularies (property type, amenities)
// so it maps to the SAME values the search compares — location stays on the manual picker for accuracy.
//
//   • Uses Claude when ANTHROPIC_API_KEY is set (shares the one client in ai-insights.mjs).
//   • Falls back to a deterministic keyword+number parser when no key — so it ALWAYS works, free.
//
// Returns a partial { propertyType?, bedrooms?, minPrice?, maxPrice?, amenities? } — never throws.
// ─────────────────────────────────────────────────────────────────────────────
import { isAnthropicConfigured, requireAnthropic, parseJsonLoose, MODEL } from './ai-insights.mjs'

// The seller taxonomy the search compares against (metadata.propertyType, lowercased).
const PROPERTY_TYPES = ['apartment', 'family house', 'villa', 'commercial', 'land', 'new project']
// Amenity ids the search compares against metadata.visualFilters.amenities.
const AMENITIES = ['wifi', 'parking', 'elevator', 'balcony', 'garden', 'pool', 'ac', 'heating', 'furnished', 'generator', 'kitchen']

// English + Arabic synonyms → canonical value. Kept small and high-precision for the fallback parser.
const TYPE_SYNONYMS = [
  [['apartment', 'flat', 'شقة'], 'apartment'],
  [['villa', 'فيلا'], 'villa'],
  [['family house', 'house', 'منزل', 'بيت'], 'family house'],
  [['commercial', 'shop', 'office', 'store', 'محل', 'مكتب', 'تجاري'], 'commercial'],
  [['land', 'plot', 'أرض'], 'land'],
  [['new project', 'new construction', 'مشروع'], 'new project'],
]
const AMENITY_SYNONYMS = [
  [['wifi', 'internet', 'واي فاي', 'انترنت'], 'wifi'],
  [['parking', 'garage', 'موقف', 'كراج'], 'parking'],
  [['elevator', 'lift', 'مصعد'], 'elevator'],
  [['balcony', 'شرفة', 'بلكون'], 'balcony'],
  [['garden', 'yard', 'حديقة'], 'garden'],
  [['pool', 'swimming', 'مسبح'], 'pool'],
  [['ac', 'air conditioning', 'مكيف', 'تكييف'], 'ac'],
  [['heating', 'تدفئة'], 'heating'],
  [['furnished', 'مفروش'], 'furnished'],
  [['generator', 'مولد'], 'generator'],
  [['kitchen', 'مطبخ'], 'kitchen'],
]

const SYSTEM_PROMPT = `You extract structured real-estate search filters from a user's free-text query (Arabic or English) for a Syria property portal. Reply with STRICT JSON only, no prose. Shape: {"propertyType": <one of ${JSON.stringify(PROPERTY_TYPES)} or null>, "bedrooms": <minimum integer or null>, "minPrice": <integer in SYP or null>, "maxPrice": <integer in SYP or null>, "amenities": <array from ${JSON.stringify(AMENITIES)}, or []>}. Rules: only include a field when the query clearly implies it; prices are in Syrian Pounds — expand "million"/"مليون" and "k" (e.g. "25 million" -> 25000000); "under/below/less than X" -> maxPrice X; "over/above/at least X" -> minPrice X; "3 bedroom"/"3 bed"/"3 غرف" -> bedrooms 3; map amenity words to the closest id; NEVER invent a value not in the query.`

export async function parsePropertyQuery(query) {
  const text = String(query || '').trim()
  if (!text) return {}
  if (!isAnthropicConfigured()) return fallbackParse(text)
  try {
    const client = requireAnthropic()
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    })
    const block = response.content.find((b) => b.type === 'text')
    const parsed = block ? parseJsonLoose(block.text) : null
    if (!parsed) return fallbackParse(text)
    return sanitize(parsed)
  } catch (err) {
    console.error('[ai-property-search] Claude call failed, using keyword fallback:', err?.status ?? err?.statusCode, err?.message)
    return fallbackParse(text)
  }
}

// Clamp/whitelist whatever the model returned to values the search actually accepts.
function sanitize(raw) {
  const out = {}
  if (typeof raw.propertyType === 'string' && PROPERTY_TYPES.includes(raw.propertyType.toLowerCase())) out.propertyType = raw.propertyType.toLowerCase()
  const bedrooms = Number(raw.bedrooms)
  if (Number.isFinite(bedrooms) && bedrooms > 0) out.bedrooms = Math.round(bedrooms)
  const minPrice = Number(raw.minPrice)
  if (Number.isFinite(minPrice) && minPrice > 0) out.minPrice = Math.round(minPrice)
  const maxPrice = Number(raw.maxPrice)
  if (Number.isFinite(maxPrice) && maxPrice > 0) out.maxPrice = Math.round(maxPrice)
  if (Array.isArray(raw.amenities)) {
    const amenities = raw.amenities.filter((a) => typeof a === 'string' && AMENITIES.includes(a.toLowerCase())).map((a) => a.toLowerCase())
    if (amenities.length) out.amenities = Array.from(new Set(amenities))
  }
  return out
}

// Deterministic parser — no API key needed. High-precision keyword + number extraction.
export function fallbackParse(query) {
  const text = String(query || '').toLowerCase()
  const out = {}

  for (const [words, canonical] of TYPE_SYNONYMS) {
    if (words.some((w) => text.includes(w))) { out.propertyType = canonical; break }
  }

  const amenities = []
  for (const [words, canonical] of AMENITY_SYNONYMS) {
    if (words.some((w) => text.includes(w))) amenities.push(canonical)
  }
  if (amenities.length) out.amenities = Array.from(new Set(amenities))

  // Bedrooms: "3 bed", "3 bedroom", "3 غرف".
  const bed = text.match(/(\d+)\s*(?:bed|bedroom|bedrooms|br|غرف|غرفة)/)
  if (bed) out.bedrooms = Number(bed[1])

  // Prices: find "<number>[ k|m|million|مليون|ألف]" with an optional under/over qualifier.
  const priceMatches = [...text.matchAll(/(under|below|less than|max|أقل من|over|above|more than|at least|min|أكثر من|from|بدءا?ً? من)?\s*(\d[\d,.]*)\s*(m|million|مليون|k|thousand|ألف|الف)?/g)]
  for (const m of priceMatches) {
    const qualifier = (m[1] || '').trim()
    let amount = Number(String(m[2]).replace(/[,]/g, ''))
    const unit = (m[3] || '').trim()
    if (!Number.isFinite(amount) || amount <= 0) continue
    if (['m', 'million', 'مليون'].includes(unit)) amount *= 1_000_000
    else if (['k', 'thousand', 'ألف', 'الف'].includes(unit)) amount *= 1_000
    // A bare small number with no unit next to "bed" is bedrooms, not price — skip unit-less < 1000.
    if (!unit && amount < 1000) continue
    if (['under', 'below', 'less than', 'max', 'أقل من'].includes(qualifier)) out.maxPrice = amount
    else if (['over', 'above', 'more than', 'at least', 'min', 'أكثر من', 'from', 'بدءا من', 'بدءاً من'].includes(qualifier)) out.minPrice = amount
    else if (out.maxPrice === undefined && out.minPrice === undefined) out.maxPrice = amount // a lone price reads as a ceiling
  }

  return out
}
