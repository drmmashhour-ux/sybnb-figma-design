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
import { isAnthropicConfigured, requireAnthropic, parseJsonLoose, MODEL } from './ai-insights.mjs'

const SYSTEM_PROMPT = `You write a short, warm, honest listing title and description for a short-term rental on the SYBNB platform (Syria). You are given ONLY real facts a host selected: property type, room type(s), bed type(s), amenities, views/outdoors, accessibility features, meals, hotel star rating, city/area, guest capacity, bedrooms, bathrooms, nightly price in USD, and the payment methods the host accepts (e.g. Sham Cash, credit card, local wallet). Write in BOTH Arabic and English. Rules: use ONLY the given facts — never invent an amenity, view, distance, or number that is not given; mention the accepted payment method(s) in the description with a short natural phrase (e.g. "Pay easily by Sham Cash."); the TITLE is a short catchy name of 3 to 7 words (typically property type + area, optionally one standout amenity), no price and no payment method; the DESCRIPTION is 2 to 4 sentences; inviting but not exaggerated; no markdown, no emojis. Reply with strict JSON: {"titleAr":"...","titleEn":"...","descriptionAr":"...","descriptionEn":"..."}.`

// Public entry: AI when configured, template otherwise. Never throws for a normal request.
export async function generateOrTemplate(attributes) {
  if (!isAnthropicConfigured()) return templateListingDescription(attributes)
  try {
    return await generateWithAi(attributes)
  } catch (err) {
    // Never hard-fail the host — but don't swallow silently either, or a broken key / model / parse
    // looks identical to "no key" and we ship the template forever without knowing why.
    console.error('[ai-listing-description] Claude call failed, using template fallback:', err?.status ?? err?.statusCode, err?.message)
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
  const parsed = parseJsonLoose(textBlock.text)
  if (!parsed) {
    console.error('[ai-listing-description] Claude returned non-JSON, using template. First 120 chars:', String(textBlock.text).slice(0, 120))
    return templateListingDescription(attributes)
  }
  if (!parsed.descriptionAr && !parsed.descriptionEn) return templateListingDescription(attributes)
  // Fall back to the template's title if the model omitted one, so callers always get a title.
  const fallbackTitle = templateListingDescription(attributes)
  return {
    titleAr: parsed.titleAr || fallbackTitle.titleAr,
    titleEn: parsed.titleEn || fallbackTitle.titleEn,
    descriptionAr: parsed.descriptionAr || '',
    descriptionEn: parsed.descriptionEn || '',
    source: 'ai',
    model: MODEL,
  }
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
  const viewsAr = list(attributes.viewsAr).slice(0, 4).join('، ')
  const viewsEn = list(attributes.viewsEn).slice(0, 4).join(', ')
  const accessAr = list(attributes.accessAr).slice(0, 4).join('، ')
  const accessEn = list(attributes.accessEn).slice(0, 4).join(', ')
  const mealsAr = list(attributes.mealsAr).join('، ')
  const mealsEn = list(attributes.mealsEn).join(', ')
  const payAr = list(attributes.paymentMethodsAr).join('، ')
  const payEn = list(attributes.paymentMethodsEn).join(', ')
  const stars = attributes.hotelStars ? String(attributes.hotelStars).replace(/\D/g, '') : ''
  const price = Number(attributes.priceUsd) || 0

  const ar = [
    `${propAr}${placeAr ? ` في ${placeAr}` : ''}${stars ? ` بتصنيف ${stars} نجوم` : ''}.`,
    guests || bedrooms ? `يتّسع لـ ${guests || 1} ضيوف${bedrooms ? ` مع ${bedrooms} غرفة نوم` : ''}${bathrooms ? ` و${bathrooms} حمام` : ''}${bedsAr ? ` (${bedsAr})` : ''}.` : '',
    amenAr ? `يوفّر: ${amenAr}.` : '',
    viewsAr ? `إطلالات وأماكن خارجية: ${viewsAr}.` : '',
    accessAr ? `تسهيلات الوصول: ${accessAr}.` : '',
    mealsAr ? `الوجبات: ${mealsAr}.` : '',
    payAr ? `طرق الدفع: ${payAr}.` : '',
    price ? `السعر ${price} دولار في الليلة. احجز الآن لتجربة إقامة مريحة.` : 'احجز الآن لتجربة إقامة مريحة.',
  ].filter(Boolean).join(' ')

  const en = [
    `${propEn.charAt(0).toUpperCase()}${propEn.slice(1)}${placeEn ? ` in ${placeEn}` : ''}${stars ? `, ${stars}-star` : ''}.`,
    guests || bedrooms ? `Sleeps ${guests || 1}${bedrooms ? ` with ${bedrooms} bedroom(s)` : ''}${bathrooms ? ` and ${bathrooms} bathroom(s)` : ''}${bedsEn ? ` (${bedsEn})` : ''}.` : '',
    amenEn ? `Amenities: ${amenEn}.` : '',
    viewsEn ? `Views & outdoors: ${viewsEn}.` : '',
    accessEn ? `Accessibility: ${accessEn}.` : '',
    mealsEn ? `Meals: ${mealsEn}.` : '',
    payEn ? `Payment: ${payEn}.` : '',
    price ? `Priced at $${price} per night. Book now for a comfortable stay.` : 'Book now for a comfortable stay.',
  ].filter(Boolean).join(' ')

  // Short catchy title from the same facts: property type + area/city (no price, no invented detail).
  const titleAr = `${propAr}${placeAr ? ` في ${placeAr}` : ''}`.trim()
  const titleEn = `${propEn.charAt(0).toUpperCase()}${propEn.slice(1)}${placeEn ? ` in ${placeEn}` : ''}`.trim()

  return { titleAr, titleEn, descriptionAr: ar, descriptionEn: en, source: 'template', model: null }
}
