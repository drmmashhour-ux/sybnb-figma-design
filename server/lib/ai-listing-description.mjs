// ─────────────────────────────────────────────────────────────────────────────
// AI LISTING-DESCRIPTION CAPSULE (server side)
//
// Isolated, reusable helper that turns the attributes a host selected in the filter system
// (property/room/bed type, amenities, meals, hotel stars, location, capacity, nightly price) into a
// warm bilingual listing description.
//
//   • Uses Claude when ANTHROPIC_API_KEY is set (shares the one client in ai-insights.mjs).
//   • Falls back to a deterministic template when no key — so the feature ALWAYS works, free.
//
// Reuse in another platform: copy this file + wire one endpoint that calls generateOrTemplate().
// Depends only on the shared Anthropic client accessor — no platform/DB code.
// ─────────────────────────────────────────────────────────────────────────────
import { isAnthropicConfigured, requireAnthropic, MODEL } from './ai-insights.mjs'

const SYSTEM_PROMPT = `You write a short, warm, honest listing description for a short-term rental on the SYBNB platform (Syria). You are given ONLY real facts a host selected: property type, room type(s), bed type(s), amenities, meals, hotel star rating, city/area, guest capacity, bedrooms, bathrooms, and nightly price in USD. Write in BOTH Arabic and English. Rules: use ONLY the given facts — never invent an amenity, view, distance, or number that is not given; 2 to 4 sentences each; inviting but not exaggerated; no markdown, no emojis. Reply with strict JSON: {"descriptionAr":"...","descriptionEn":"..."}.`

// Public entry: AI when configured, template otherwise. Never throws for a normal request.
export async function generateOrTemplate(attributes) {
  if (!isAnthropicConfigured()) return templateListingDescription(attributes)
  try {
    return await generateWithAi(attributes)
  } catch {
    return templateListingDescription(attributes)
  }
}

async function generateWithAi(attributes) {
  const client = requireAnthropic()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(attributes) }],
  })
  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) return templateListingDescription(attributes)
  let parsed
  try {
    parsed = JSON.parse(textBlock.text)
  } catch {
    return templateListingDescription(attributes)
  }
  if (!parsed.descriptionAr && !parsed.descriptionEn) return templateListingDescription(attributes)
  return { descriptionAr: parsed.descriptionAr || '', descriptionEn: parsed.descriptionEn || '', source: 'ai', model: MODEL }
}

// Deterministic fallback — no API key needed. Same attributes, clean bilingual output.
export function templateListingDescription(attributes = {}) {
  const list = (arr) => (Array.isArray(arr) ? arr.filter(Boolean) : [])
  const propAr = attributes.propertyTypeAr || attributes.propertyType || 'إقامة'
  const propEn = attributes.propertyTypeEn || attributes.propertyType || 'stay'
  const cityAr = attributes.cityAr || attributes.city || ''
  const cityEn = attributes.cityEn || attributes.city || ''
  const areaAr = attributes.areaAr || attributes.area || ''
  const areaEn = attributes.areaEn || attributes.area || ''
  const placeAr = [areaAr, cityAr].filter(Boolean).join('، ')
  const placeEn = [areaEn, cityEn].filter(Boolean).join(', ')
  const guests = Number(attributes.guests) || 0
  const bedrooms = Number(attributes.bedrooms) || 0
  const bathrooms = Number(attributes.bathrooms) || 0
  const bedsAr = list(attributes.bedTypesAr).join(' و')
  const bedsEn = list(attributes.bedTypesEn).join(' & ')
  const amenAr = list(attributes.amenitiesAr).slice(0, 6).join('، ')
  const amenEn = list(attributes.amenitiesEn).slice(0, 6).join(', ')
  const mealsAr = list(attributes.mealsAr).join('، ')
  const mealsEn = list(attributes.mealsEn).join(', ')
  const stars = attributes.hotelStars ? String(attributes.hotelStars).replace(/\D/g, '') : ''
  const price = Number(attributes.priceUsd) || 0

  const ar = [
    `${propAr}${placeAr ? ` في ${placeAr}` : ''}${stars ? ` بتصنيف ${stars} نجوم` : ''}.`,
    guests || bedrooms ? `يتّسع لـ ${guests || 1} ضيوف${bedrooms ? ` مع ${bedrooms} غرفة نوم` : ''}${bathrooms ? ` و${bathrooms} حمام` : ''}${bedsAr ? ` (${bedsAr})` : ''}.` : '',
    amenAr ? `يوفّر: ${amenAr}.` : '',
    mealsAr ? `الوجبات: ${mealsAr}.` : '',
    price ? `السعر ${price} دولار في الليلة. احجز الآن لتجربة إقامة مريحة.` : 'احجز الآن لتجربة إقامة مريحة.',
  ].filter(Boolean).join(' ')

  const en = [
    `${propEn.charAt(0).toUpperCase()}${propEn.slice(1)}${placeEn ? ` in ${placeEn}` : ''}${stars ? `, ${stars}-star` : ''}.`,
    guests || bedrooms ? `Sleeps ${guests || 1}${bedrooms ? ` with ${bedrooms} bedroom(s)` : ''}${bathrooms ? ` and ${bathrooms} bathroom(s)` : ''}${bedsEn ? ` (${bedsEn})` : ''}.` : '',
    amenEn ? `Amenities: ${amenEn}.` : '',
    mealsEn ? `Meals: ${mealsEn}.` : '',
    price ? `Priced at $${price} per night. Book now for a comfortable stay.` : 'Book now for a comfortable stay.',
  ].filter(Boolean).join(' ')

  return { descriptionAr: ar, descriptionEn: en, source: 'template', model: null }
}
