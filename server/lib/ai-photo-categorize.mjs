// ─────────────────────────────────────────────────────────────────────────────
// AI PHOTO ROOM-CATEGORIZE CAPSULE (server side)
//
// "Photo tour" helper: looks at each listing photo with Claude's vision and labels which room/space it
// shows (bedroom, bathroom, kitchen, living room, view…), so the wizard can auto-group photos by room
// and the guest listing can show an Airbnb-style photo tour. AI SUGGESTS — the host can re-tag any photo,
// same warn-don't-block philosophy as the truth-check capsule.
//
//   • Uses Claude (multimodal) when ANTHROPIC_API_KEY is set (shares the client in ai-insights.mjs).
//   • Without a key it returns status "unavailable" — it never guesses a category.
//   • Every returned category is validated against ROOM_CATEGORIES; anything else becomes "other".
// ─────────────────────────────────────────────────────────────────────────────
import { isAnthropicConfigured, requireAnthropic, parseJsonLoose, MODEL } from './ai-insights.mjs'

const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp'])
// One vision call per categorize; cap the batch so a 30-photo listing stays fast/affordable. Photos
// beyond the cap simply come back uncategorized ("other") for the host to tag by hand.
const MAX_PHOTOS = 16

// The fixed room/space vocabulary. Keep in sync with the client (platformApi PHOTO_ROOM_CATEGORIES).
export const ROOM_CATEGORIES = [
  'bedroom',
  'bathroom',
  'living_room',
  'kitchen',
  'dining',
  'balcony',
  'exterior',
  'view',
  'pool',
  'entrance',
  'other',
]
const CATEGORY_SET = new Set(ROOM_CATEGORIES)

const SYSTEM_PROMPT = `You label short-term-rental listing photos by which room or space each one shows. You are given photos IN ORDER; the first image is index 0, the next index 1, and so on. For EACH image choose exactly ONE category from this list:
- "bedroom": a room with a bed
- "bathroom": toilet, shower, sink, bathtub
- "living_room": sofa / seating / lounge area
- "kitchen": stove, counters, cooking area
- "dining": dining table set for eating
- "balcony": balcony or terrace of the unit
- "exterior": the building/entrance from outside, facade, street
- "view": the scenery seen from the property (sea, city, mountains) — the subject is the view, not a room
- "pool": swimming pool
- "entrance": hallway, entryway, corridor, stairs inside
- "other": anything that fits none of the above (close-ups, amenities, documents, people)
Judge only from the image. If unsure, use "other". Reply with STRICT JSON only, no prose:
{"items":[{"index":<0-based image number>,"category":"<one of the categories>","confidence":<0..1>}]}`

// Public entry. Returns { status, items }. status: ok | skipped | unavailable.
// items: [{ index, category, confidence }] — one per photo the model classified.
export async function categorizeListingPhotos({ photos = [], locale = 'en' } = {}) {
  const images = (Array.isArray(photos) ? photos : [])
    .filter((p) => p && typeof p.data === 'string' && p.data.length > 0 && ALLOWED_MEDIA.has(p.mediaType))
    .slice(0, MAX_PHOTOS)

  if (!images.length) return { status: 'skipped', items: [] }
  if (!isAnthropicConfigured()) return { status: 'unavailable', items: [] }

  try {
    const client = requireAnthropic()
    const content = [
      {
        type: 'text',
        text: JSON.stringify({
          language: locale === 'ar' ? 'Arabic' : 'English',
          photoCount: images.length,
          task: 'Label each photo by room/space, in the order given.',
        }),
      },
      ...images.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } })),
    ]
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    })
    const block = response.content.find((b) => b.type === 'text')
    if (!block?.text) return { status: 'unavailable', items: [] }
    const parsed = parseJsonLoose(block.text)
    if (!parsed || !Array.isArray(parsed.items)) {
      console.error('[ai-photo-categorize] Claude returned non-JSON. First 120 chars:', String(block.text).slice(0, 120))
      return { status: 'unavailable', items: [] }
    }
    const items = parsed.items
      .map((it) => {
        const index = Number(it?.index)
        const category = String(it?.category || '').trim().toLowerCase()
        const confidence = Number(it?.confidence)
        if (!Number.isInteger(index) || index < 0 || index >= images.length) return null
        return {
          index,
          category: CATEGORY_SET.has(category) ? category : 'other',
          confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
        }
      })
      .filter(Boolean)
    return { status: 'ok', items, model: MODEL }
  } catch (err) {
    console.error('[ai-photo-categorize] Claude call failed:', err?.status ?? err?.statusCode, err?.message)
    return { status: 'unavailable', items: [] }
  }
}
