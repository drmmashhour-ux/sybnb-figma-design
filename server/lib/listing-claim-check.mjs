import { isAnthropicConfigured, requireAnthropic } from './ai-insights.mjs'
import { isValidListingMediaKey, mimeForKey, readListingMedia } from './listing-media-storage.mjs'

// AI truth-controller for host-claimed amenities. Policy: WARN only — this never blocks publishing
// and never throws into the submit path. If Anthropic is unconfigured, or any vision call errors or
// times out, the affected result is simply omitted (fail-open → fewer/zero warnings).
//
// Vision-capable, cheap model — the same one the pricing-insight feature uses. Amenity verification
// is a simple yes/no/unclear judgement, not deep reasoning.
const VISION_MODEL = 'claude-haiku-4-5-20251001'
const MAX_PROOF_PHOTOS = 3 // cost bound: at most this many images per vision call
const VISION_TIMEOUT_MS = 15000

const OFFER_PROOF_PREFIX = 'offerProof:'

function metadataOf(listing) {
  return listing && listing.metadata && typeof listing.metadata === 'object' ? listing.metadata : {}
}

// The offer-proof amenities a host has CLAIMED on this listing (each requires proof). Stored by the
// wizard as metadata.selectedOfferProofSlots, e.g. "offerProof:parking".
function claimedSlots(listing) {
  const slots = metadataOf(listing).selectedOfferProofSlots
  return Array.isArray(slots)
    ? slots.filter((slot) => typeof slot === 'string' && slot.startsWith(OFFER_PROOF_PREFIX))
    : []
}

// A stable fingerprint of what would be checked (claimed amenities + the listing's photo set), so
// the endpoint can skip re-running an unchanged listing.
export function claimCheckSignature(listing) {
  const slots = claimedSlots(listing).slice().sort()
  const mediaIds = (listing?.media || []).map((item) => item.id).slice().sort()
  return `${slots.join(',')}|${mediaIds.join(',')}`
}

// storageKey is the last path segment of ListingMedia.url (/api/listings/:id/media/file/<key>).
function storageKeyFromUrl(url) {
  if (typeof url !== 'string') return null
  const key = url.split('/').pop() || ''
  return isValidListingMediaKey(key) ? key : null
}

function labelFor(slotId, clientClaims) {
  const found = clientClaims.find((claim) => claim && claim.slotId === slotId)
  const bare = slotId.slice(OFFER_PROOF_PREFIX.length)
  return {
    ar: (found && found.labelAr) || bare,
    en: (found && found.labelEn) || (found && found.labelAr) || bare,
  }
}

// Load up to MAX_PROOF_PHOTOS of the listing's photos as base64 (shared across all amenity checks,
// since the media rows are not tagged per-amenity). Unreadable files are skipped, never fatal.
async function loadProofPhotos(listing) {
  const photos = []
  for (const media of listing?.media || []) {
    if (photos.length >= MAX_PROOF_PHOTOS) break
    const key = storageKeyFromUrl(media.url)
    if (!key) continue
    try {
      const bytes = await readListingMedia(key)
      if (bytes && bytes.length) {
        photos.push({ data: bytes.toString('base64'), media_type: mimeForKey(key) })
      }
    } catch {
      // Skip a missing/unreadable file — never fail the whole check.
    }
  }
  return photos
}

async function verifyAmenity(client, label, photos) {
  const prompt =
    `You verify a short-term-rental listing. The host claims this amenity is available: "${label.en}"` +
    ` (Arabic: "${label.ar}"). Look ONLY at the attached listing photo(s). Reply with STRICT JSON` +
    ` and nothing else: {"verdict":"yes"|"no"|"unclear","reason":"<max 15 words>"}. Use "yes" only if` +
    ` a photo clearly shows this amenity, "no" if the photos clearly do not show it, and "unclear" if` +
    ` you genuinely cannot tell from the photos.`

  const content = [
    { type: 'text', text: prompt },
    ...photos.map((photo) => ({
      type: 'image',
      source: { type: 'base64', media_type: photo.media_type, data: photo.data },
    })),
  ]

  const response = await client.messages.create(
    { model: VISION_MODEL, max_tokens: 200, messages: [{ role: 'user', content }] },
    { signal: AbortSignal.timeout(VISION_TIMEOUT_MS), maxRetries: 0 },
  )

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) return null
  let parsed
  try {
    parsed = JSON.parse(textBlock.text)
  } catch {
    return null
  }
  const verdict = ['yes', 'no', 'unclear'].includes(parsed.verdict) ? parsed.verdict : null
  if (!verdict) return null
  return { verdict, reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 160) : '' }
}

// Iterate the listing's claimed offer-proof amenities and return [{ slotId, amenityAr, amenityEn,
// verdict, reason }]. Verdicts are real AI outputs or 'missing' (no photo) — never fabricated.
// Never throws.
export async function checkListingClaims(listing, clientClaims = []) {
  // FAIL-OPEN: with no AI configured, produce no warnings at all.
  if (!isAnthropicConfigured()) return []

  const slots = claimedSlots(listing)
  if (!slots.length) return []

  let client
  try {
    client = requireAnthropic()
  } catch {
    return []
  }

  const claims = Array.isArray(clientClaims) ? clientClaims : []
  const photos = await loadProofPhotos(listing).catch(() => [])
  const results = []

  for (const slotId of slots) {
    const label = labelFor(slotId, claims)

    // Claimed but the listing has no usable photo to back it → 'missing' (no AI call).
    if (!photos.length) {
      results.push({ slotId, amenityAr: label.ar, amenityEn: label.en, verdict: 'missing', reason: '' })
      continue
    }

    try {
      const outcome = await verifyAmenity(client, label, photos)
      if (outcome) {
        results.push({
          slotId,
          amenityAr: label.ar,
          amenityEn: label.en,
          verdict: outcome.verdict,
          reason: outcome.reason,
        })
      }
      // outcome === null (bad/empty AI response) → omit this amenity (fail-open).
    } catch {
      // AI error/timeout for this amenity → omit it (fail-open). Other amenities continue.
    }
  }

  return results
}
