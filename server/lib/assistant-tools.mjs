import { db } from './prisma.mjs'
import { computeStayTotalMinor } from './pricing.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OCCUPYING = ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED', 'DISPUTED']
const ALLOWED_AMENITIES = ['wifi', 'parking', 'elevator', 'balcony', 'garden', 'pool', 'ac', 'heating', 'furnished', 'generator', 'kitchen']
const ALLOWED_TYPES = ['apartment', 'family house', 'villa', 'commercial', 'land', 'new project', 'room', 'house']

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = 'ASSISTANT_TOOL_INVALID'
  error.expose = true
  throw error
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Tool arguments must be an object.')
  return value
}

function exact(value, allowed) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length) invalid(`Unknown tool argument: ${unknown[0]}.`)
}

function text(value, name, max = 120, required = false) {
  if (value == null || value === '') {
    if (required) invalid(`${name} is required.`)
    return undefined
  }
  if (typeof value !== 'string' || value.trim().length > max) invalid(`${name} is invalid.`)
  return value.trim()
}

function uuid(value, name) {
  const result = text(value, name, 36, true)
  if (!UUID_RE.test(result)) invalid(`${name} is invalid.`)
  return result
}

function integer(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null) return undefined
  if (!Number.isInteger(value) || value < min || value > max) invalid(`${name} is invalid.`)
  return value
}

function dateOnly(value, name) {
  const raw = text(value, name, 10, true)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) invalid(`${name} must be YYYY-MM-DD.`)
  const result = new Date(`${raw}T00:00:00.000Z`)
  if (Number.isNaN(result.getTime()) || result.toISOString().slice(0, 10) !== raw) invalid(`${name} is invalid.`)
  return result
}

function dateRange(args) {
  const checkIn = dateOnly(args.checkIn, 'checkIn')
  const checkOut = dateOnly(args.checkOut, 'checkOut')
  if (checkOut <= checkIn) invalid('checkOut must be after checkIn.')
  const nights = Math.round((checkOut - checkIn) / 86_400_000)
  if (nights > 90) invalid('A stay may not exceed 90 nights.')
  return { checkIn, checkOut, nights }
}

function metadataOf(listing) {
  return listing?.metadata && typeof listing.metadata === 'object' && !Array.isArray(listing.metadata) ? listing.metadata : {}
}

function publicCard(listing, available, quote) {
  const metadata = metadataOf(listing)
  const reviewCount = listing._count?.reviews || 0
  const rating = reviewCount ? Number((listing.reviews.reduce((sum, review) => sum + review.rating, 0) / reviewCount).toFixed(1)) : null
  const media = [...(listing.media || [])].sort((a, b) => a.sortOrder - b.sortOrder)[0]
  const locationParts = [listing.accommodation?.area, listing.accommodation?.city, listing.accommodation?.governorate, listing.location?.area, listing.location?.city, listing.location?.governorate]
  return {
    id: listing.id,
    title: { ar: listing.titleAr, en: listing.titleEn || listing.titleAr, fr: metadata.titleFr || listing.titleEn || listing.titleAr },
    price: { amountMinor: quote?.totalMinor ?? listing.priceMinor, currency: listing.currency, basis: quote ? 'stay_total' : 'nightly_base' },
    availability: available,
    locationSummary: [...new Set(locationParts.filter(Boolean))].join(', ') || null,
    rating,
    reviewCount,
    image: media?.url || null,
    link: `#/listing/${listing.id}`,
    propertyType: typeof metadata.propertyType === 'string' ? metadata.propertyType : null,
    amenities: Array.isArray(metadata.amenities) ? metadata.amenities.filter((item) => typeof item === 'string').slice(0, 30) : [],
  }
}

async function approvedStay(listingId) {
  const listing = await db().listing.findFirst({
    where: { id: listingId, division: 'STAYS', status: 'APPROVED' },
    include: { location: true, accommodation: true, media: true, reviews: { where: { hiddenAt: null }, select: { rating: true } }, _count: { select: { reviews: { where: { hiddenAt: null } } } } },
  })
  if (!listing) {
    const error = new Error('Listing is unavailable.')
    error.statusCode = 404
    error.code = 'ASSISTANT_LISTING_UNAVAILABLE'
    error.expose = true
    throw error
  }
  return listing
}

async function availability(listingId, checkIn, checkOut) {
  const [blocked, overlap] = await Promise.all([
    db().listingAvailability.count({ where: { listingId, status: 'BLOCKED', date: { gte: checkIn, lt: checkOut } } }),
    db().booking.count({ where: { listingId, status: { in: OCCUPYING }, checkIn: { lt: checkOut }, checkOut: { gt: checkIn } } }),
  ])
  return blocked === 0 && overlap === 0
}

export const ASSISTANT_TOOL_DEFINITIONS = [
  ['searchListings', 'Search approved SYBNB stays. Returns public listing cards and verified availability/pricing when dates are supplied.', { destination: { type: 'string' }, checkIn: { type: 'string' }, checkOut: { type: 'string' }, guests: { type: 'integer' }, budgetMaxMinor: { type: 'integer' }, propertyType: { type: 'string', enum: ALLOWED_TYPES }, amenities: { type: 'array', items: { type: 'string', enum: ALLOWED_AMENITIES } } }],
  ['getListingDetails', 'Get public stored details, amenities, rules, cancellation policy, fees and taxes for one approved stay.', { listingId: { type: 'string' } }, ['listingId']],
  ['checkAvailability', 'Check current availability for one approved stay and date range.', { listingId: { type: 'string' }, checkIn: { type: 'string' }, checkOut: { type: 'string' } }, ['listingId', 'checkIn', 'checkOut']],
  ['calculateBookingTotal', 'Calculate the verified stored total through the existing pricing engine.', { listingId: { type: 'string' }, checkIn: { type: 'string' }, checkOut: { type: 'string' }, guests: { type: 'integer' } }, ['listingId', 'checkIn', 'checkOut']],
  ['getBookingStatus', 'Get only the signed-in guest own booking status.', { bookingId: { type: 'string' } }, ['bookingId']],
  ['createSupportHandoff', 'Create a privacy-minimized support handoff audit event when the assistant cannot safely help.', { reason: { type: 'string' } }, ['reason']],
].map(([name, description, properties, required = []]) => ({ type: 'function', name, description, parameters: { type: 'object', additionalProperties: false, properties, required }, strict: name !== 'searchListings' }))

export async function executeAssistantTool(name, rawArgs, context) {
  const args = object(rawArgs)
  let result
  let entityId = context.user.id
  if (name === 'searchListings') result = await searchListings(args)
  else if (name === 'getListingDetails') { entityId = uuid(args.listingId, 'listingId'); result = await getListingDetails(args) }
  else if (name === 'checkAvailability') { entityId = uuid(args.listingId, 'listingId'); result = await checkAvailability(args) }
  else if (name === 'calculateBookingTotal') { entityId = uuid(args.listingId, 'listingId'); result = await calculateBookingTotal(args) }
  else if (name === 'createBookingDraft') { requireGuest(context); entityId = uuid(args.listingId, 'listingId'); result = await createBookingDraft(args, context) }
  else if (name === 'getBookingStatus') { requireGuest(context); entityId = uuid(args.bookingId, 'bookingId'); result = await getBookingStatus(args, context) }
  else if (name === 'createSupportHandoff') result = await createSupportHandoff(args, context)
  else invalid('Tool is not approved.')

  await db().adminAuditLog.create({ data: { actorUserId: context.user.id, action: 'AI_ASSISTANT_SERVER_FACT_RETRIEVED', entityType: 'ai_assistant', entityId, after: { tool: name, ok: true } } })
  return result
}

function requireGuest(context) {
  if (!Array.isArray(context.roles) || !context.roles.includes('GUEST')) {
    const error = new Error('Guest authorization is required.')
    error.statusCode = 403
    error.code = 'ASSISTANT_GUEST_REQUIRED'
    error.expose = true
    throw error
  }
}

export async function searchListings(raw) {
  const args = object(raw); exact(args, ['destination', 'checkIn', 'checkOut', 'guests', 'budgetMaxMinor', 'propertyType', 'amenities'])
  const destination = text(args.destination, 'destination', 120)?.toLowerCase()
  const guests = integer(args.guests, 'guests', { min: 1, max: 30 })
  const budget = integer(args.budgetMaxMinor, 'budgetMaxMinor', { min: 1 })
  const propertyType = args.propertyType == null ? undefined : text(args.propertyType, 'propertyType', 40, true).toLowerCase()
  if (propertyType && !ALLOWED_TYPES.includes(propertyType)) invalid('propertyType is invalid.')
  const amenities = args.amenities == null ? [] : args.amenities
  if (!Array.isArray(amenities) || amenities.length > 20 || amenities.some((item) => !ALLOWED_AMENITIES.includes(item))) invalid('amenities are invalid.')
  let range
  if (args.checkIn != null || args.checkOut != null) {
    if (!args.checkIn || !args.checkOut) invalid('Both checkIn and checkOut are required together.')
    range = dateRange(args)
  }
  const rows = await db().listing.findMany({
    where: { division: 'STAYS', status: 'APPROVED', ...(budget ? { priceMinor: { lte: budget } } : {}) },
    include: { location: true, accommodation: true, media: true, reviews: { where: { hiddenAt: null }, select: { rating: true } }, _count: { select: { reviews: { where: { hiddenAt: null } } } } },
    orderBy: { createdAt: 'desc' }, take: 40,
  })
  const filtered = rows.filter((listing) => {
    const metadata = metadataOf(listing)
    const haystack = [listing.titleAr, listing.titleEn, listing.location?.city, listing.location?.governorate, listing.accommodation?.city, listing.accommodation?.governorate, metadata.city, metadata.area].filter(Boolean).join(' ').toLowerCase()
    const storedAmenities = Array.isArray(metadata.amenities) ? metadata.amenities.map((item) => String(item).toLowerCase()) : []
    return (!destination || haystack.includes(destination)) && (!propertyType || String(metadata.propertyType || '').toLowerCase() === propertyType) && amenities.every((item) => storedAmenities.includes(item)) && (!guests || !Number.isInteger(metadata.maxGuests) || metadata.maxGuests >= guests)
  }).slice(0, 12)
  const cards = []
  for (const listing of filtered) {
    const available = range ? await availability(listing.id, range.checkIn, range.checkOut) : null
    if (range && !available) continue
    const quote = range ? await computeStayTotalMinor(listing, range.checkIn, range.checkOut) : null
    if (budget && quote && quote.totalMinor > budget) continue
    cards.push(publicCard(listing, available, quote))
  }
  return { listings: cards.slice(0, 8), criteriaComplete: Boolean(destination && range && guests), missing: [!destination && 'destination', !range && 'dates', !guests && 'guests'].filter(Boolean) }
}

export async function getListingDetails(raw) {
  const args = object(raw); exact(args, ['listingId']); const listing = await approvedStay(uuid(args.listingId, 'listingId')); const metadata = metadataOf(listing)
  return { listing: publicCard(listing, null, null), description: listing.description || null, houseRules: metadata.houseRules || null, cancellationPolicy: metadata.cancellationPolicy || null, fees: metadata.fees || null, taxes: metadata.taxes || null }
}

export async function checkAvailability(raw) {
  const args = object(raw); exact(args, ['listingId', 'checkIn', 'checkOut']); const listingId = uuid(args.listingId, 'listingId'); await approvedStay(listingId); const range = dateRange(args)
  return { listingId, checkIn: args.checkIn, checkOut: args.checkOut, available: await availability(listingId, range.checkIn, range.checkOut), checkedAt: new Date().toISOString() }
}

export async function calculateBookingTotal(raw) {
  const args = object(raw); exact(args, ['listingId', 'checkIn', 'checkOut', 'guests']); const listing = await approvedStay(uuid(args.listingId, 'listingId')); const range = dateRange(args); const guests = integer(args.guests, 'guests', { min: 1, max: 30 }) || 1
  const available = await availability(listing.id, range.checkIn, range.checkOut)
  if (!available) return { listingId: listing.id, available: false, total: null }
  const quote = await computeStayTotalMinor(listing, range.checkIn, range.checkOut)
  return { listingId: listing.id, available: true, guests, nights: range.nights, total: { amountMinor: quote.totalMinor, currency: listing.currency }, breakdown: quote }
}

export async function createBookingDraft(raw, context = {}) {
  const args = object(raw); exact(args, ['listingId', 'checkIn', 'checkOut', 'guests'])
  if (context.confirmationClaimed !== true) invalid('A valid one-time server confirmation is required to prepare a booking draft.')
  const total = await calculateBookingTotal(args)
  if (!total.available) return { created: false, reason: 'unavailable' }
  return { created: true, draft: { listingId: total.listingId, checkIn: args.checkIn, checkOut: args.checkOut, guests: total.guests, nights: total.nights, total: total.total, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), confirmationRequired: true, bookingLink: `#/booking/review/${total.listingId}` }, notice: 'No inventory is reserved and no payment is taken.' }
}

export async function getBookingStatus(raw, context) {
  const args = object(raw); exact(args, ['bookingId']); const bookingId = uuid(args.bookingId, 'bookingId')
  const booking = await db().booking.findFirst({ where: { id: bookingId, guestId: context.user.id }, select: { id: true, listingId: true, status: true, checkIn: true, checkOut: true, amountMinor: true, currency: true, updatedAt: true } })
  if (!booking) { const error = new Error('Booking is unavailable.'); error.statusCode = 404; error.code = 'ASSISTANT_BOOKING_UNAVAILABLE'; error.expose = true; throw error }
  return { booking }
}

export async function createSupportHandoff(raw, context) {
  const args = object(raw); exact(args, ['reason']); const reason = text(args.reason, 'reason', 160, true)
  await db().adminAuditLog.create({ data: { actorUserId: context.user.id, action: 'AI_ASSISTANT_SUPPORT_HANDOFF', entityType: 'ai_assistant', entityId: context.user.id, after: { reasonCategory: reason.replace(/[^a-z0-9 _-]/gi, '').slice(0, 80) } } })
  return { created: true, support: { email: 'info@sybnb.app', whatsapp: '+963 998 191 422' } }
}
