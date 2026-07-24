import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { assertNoUnknownFields } from '../lib/validate.mjs'
import { assertDivisionActiveForBeta } from '../lib/closed-beta-gate.mjs'
import { computeGuestBookingTotalMinor, computeStayTotalMinor } from '../lib/pricing.mjs'
import { computeQuebecStayTaxesResolved } from '../lib/quebec-stay-tax.mjs'
import { stayQuoteToRoundedUsd } from '../lib/currency.mjs'
import { expireOldListings, PAID_PLAN_DIVISIONS } from '../lib/listing-lifecycle.mjs'
import { isOfferPrice, summarizeOffers } from '../lib/offers.mjs'
import { assertListingAttributes, PHOTO_REQUIRED_DIVISIONS } from '../lib/listing-attributes.mjs'
import {
  MAX_LISTING_PHOTOS,
  deleteListingMedia,
  isValidListingMediaKey,
  mediaServeUrl,
  mimeForKey,
  readListingMedia,
  saveListingMedia,
} from '../lib/listing-media-storage.mjs'
import { LISTING_DOCUMENT_CATEGORY, deleteListingDocument, readListingDocument, saveListingDocument } from '../lib/listing-document-storage.mjs'
import { privateDocumentDownloadHeaders } from '../lib/private-document-download.mjs'
import { recordStaffDocumentAccess } from '../lib/document-access-audit.mjs'
import { retentionDeleteAfter } from '../lib/listing-document-retention.mjs'

// Québec compliance review (item 1): real certificate types a host can upload against a listing.
const LISTING_DOCUMENT_TYPES = ['CITQ_CERTIFICATE']
const LISTING_DOCUMENT_SAFE_SELECT = {
  id: true, listingId: true, type: true, mimeType: true, status: true,
  reviewedById: true, reviewedAt: true, expiresAt: true, retentionDeleteAfter: true,
  legalHold: true, legalHoldReason: true, deletedAt: true, createdAt: true, updatedAt: true,
  version: true, isCurrent: true, replacesId: true,
}

// STAYS/RENTALS/BUY are commission- or contact-based (no upfront platform fee, matching how Centris
// pays brokers on close rather than up front). CARS/MARKETPLACE/NEW_CONSTRUCTION are the paid-plan
// divisions gated behind an admin-approved SellerProfile — PAID_PLAN_DIVISIONS is now shared from
// listing-lifecycle (also used by the admin approval route that starts the paid expiry clock).

// Listing ids are UUID columns in Postgres — a non-UUID id (e.g. the frontend's
// 'fallback-*' sample-listing ids) makes Prisma throw P2023 instead of returning null,
// which would otherwise surface as an uncaught 500. Reject those up front as a clean 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Backs the Premium "تمييز أعلى داخل البحث" (higher search highlight) plan copy
// (src/modules/seller/SellerListingWizard.tsx HOST_LISTING_PLANS) with real ranking: Premium
// listings sort first under the platform's own default ordering. Never applied when the guest
// picked an explicit price sort -- that's a deliberate choice and shouldn't be overridden by a
// paid boost. Array.prototype.sort is stable (ES2019+), so equal-priority listings keep the
// relative order the DB/filters already gave them.
function applySearchBoost(listings) {
  return [...listings].sort((a, b) => {
    const boostA = a.metadata?.listingPlan === 'premium' ? 0 : 1
    const boostB = b.metadata?.listingPlan === 'premium' ? 0 : 1
    return boostA - boostB
  })
}

export async function handleListings(req, res, url, context) {
  const idSegmentMatch = url.pathname.match(/^\/api\/listings\/([^/]+)(?:\/(?:quote|availability|reviews|submit))?$/)
  if (idSegmentMatch && !UUID_RE.test(idSegmentMatch[1])) {
    const error = new Error('Listing not found.')
    error.statusCode = 404
    error.code = 'LISTING_NOT_FOUND'
    error.expose = true
    throw error
  }

  const quoteMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/quote$/)
  if (quoteMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const checkIn = parseDateOnly(url.searchParams.get('checkIn'))
    const checkOut = parseDateOnly(url.searchParams.get('checkOut'))
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      const error = new Error('checkIn and checkOut are required and checkOut must be after checkIn.')
      error.statusCode = 400
      error.code = 'QUOTE_DATES_INVALID'
      error.expose = true
      throw error
    }
    const listing = await db().listing.findFirst({ where: { id: quoteMatch[1], status: 'APPROVED' } })
    if (!listing) {
      const error = new Error('Listing not found.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
    const quote = await computeStayTotalMinor(listing, checkIn, checkOut)
    // A listing's own price is SYP unless the host explicitly priced it in USD (listing.currency).
    // A guest who chooses to pay in USD gets a SYP-priced listing converted at the platform's fixed
    // rate; a USD-priced listing is used as-is. Either way each night is rounded up to the nearest
    // $5 individually and summed, so the total always scales with nights and never asks for change
    // (see stayQuoteToRoundedUsd for why rounding the lump total once instead does not, and why
    // running an already-USD listing through the SYP conversion collapses its real price).
    const wantsUsd = url.searchParams.get('currency') === 'USD'
    const { totalMinor: nightlySubtotalMinor, perNight } = wantsUsd ? stayQuoteToRoundedUsd(quote, listing.currency) : quote
    const currency = wantsUsd ? 'USD' : listing.currency

    // Money-model correction (2026-07-22): the guest's real, charged total -- nightly subtotal +
    // cleaning fee + any other currently-supported mandatory charge -- computed the same way
    // bookings.mjs computes booking.amountMinor at creation, so the quote a guest sees here is never
    // contradicted by what they're later asked to pay. Québec lodging tax stays disclosure-only
    // (explicit product decision, 2026-07-22) and is deliberately not part of totalMinor -- shown
    // below purely as an estimate, never collected. Whether to eventually switch to tax-inclusive
    // collection is a pricing/legal decision, not something decided here.
    const guestTotal = computeGuestBookingTotalMinor({ nightlySubtotalMinor, listingMetadata: listing.metadata })
    const { cleaningFeeMinor, extraFeesMinor, amountMinor: totalMinor } = guestTotal
    const isQuebec = listing.metadata?.country === 'CA'
    const quebecTaxes = isQuebec
      ? await computeQuebecStayTaxesResolved(db(), {
          accommodationMinor: nightlySubtotalMinor,
          country: 'CA',
          province: listing.metadata?.governorate || null,
          municipality: listing.metadata?.city || null,
        })
      : null

    // Second compliance-review correction pass: the interface must never imply a tax was collected
    // or remitted just because a rate is displayed. estimatedTaxMinor is the sum of the three
    // published rates above -- purely informational. collectedTaxMinor/remittedTaxMinor are ALWAYS
    // zero here: this is a pre-booking quote, nothing has been charged yet, and even once booked,
    // real collection stays off (STAY_TAX_PLATFORM_COLLECTION) until legally activated. The three
    // are never conflated into one number.
    const estimatedTaxMinor = (quebecTaxes?.lodgingTaxMinor || 0) + (quebecTaxes?.gstMinor || 0) + (quebecTaxes?.qstMinor || 0)

    return json(res, 200, {
      ok: true,
      totalMinor,
      nights: quote.nights,
      perNight,
      currency,
      breakdown: {
        nightlySubtotalMinor,
        cleaningFeeMinor,
        extraFeesMinor,
        // Neither of these is a real SYBNB charge today -- there is no guest service fee and no
        // refundable damage deposit as an actual product feature. They're returned as explicit
        // zeros (never omitted) so the checkout UI can show "Guest service fee: not charged" /
        // "Refundable deposit: not applicable" instead of silently leaving guests to wonder whether
        // one exists. Turning either into a real charge is a pricing decision, not an engineering one.
        guestServiceFeeMinor: 0,
        refundableDepositMinor: 0,
        lodgingTaxMinor: quebecTaxes?.lodgingTaxMinor || 0,
        gstMinor: quebecTaxes?.gstMinor || 0,
        qstMinor: quebecTaxes?.qstMinor || 0,
        estimatedTaxMinor,
        collectedTaxMinor: 0,
        remittedTaxMinor: 0,
        totalMinor,
        currency,
        taxSource: quebecTaxes?.source || null,
      },
    })
  }

  if (url.pathname === '/api/listings') {
    if (req.method === 'GET') {
      await expireOldListings()
      const params = url.searchParams
      // Validate the division enum before it reaches Prisma, else an invalid ?division= raises a raw 500.
      const divisionParam = params.get('division')
      const division = divisionParam ? normalizeListingDivision(divisionParam) : undefined
      // SYB-008: refuse browsing a gated division during the STR-only closed beta (Rentals/Buy/Cars/
      // Marketplace/New Construction/Sell). STAYS stays active; unspecified division is unaffected.
      if (division) assertDivisionActiveForBeta(division)
      // Listings created through the wizard never populate the `location` relation — governorate/
      // city/area/bedrooms/bathrooms/propertyType/amenities all live in `metadata` instead, so those
      // filters are applied in-memory below rather than as a Prisma `where` clause.
      // FIX A: jurisdiction fail-closed. The guest surface must never leak an out-of-jurisdiction
      // listing (e.g. a Quebec/CA listing on the Syria surface), so the country filter is MANDATORY and
      // defaults to the active jurisdiction (Syria) when the caller does not scope it explicitly.
      const country = params.get('country') || 'SY'
      const governorate = params.get('governorate') || undefined
      const city = params.get('city') || undefined
      const area = params.get('area') || undefined
      const propertyType = params.get('propertyType') || undefined
      const roomType = params.get('roomType') || undefined
      const bedType = params.get('bedType') || undefined
      // Marketplace (goods) filters — category + condition live in metadata like the property filters.
      const category = params.get('category') ? String(params.get('category')).toUpperCase() : undefined
      const condition = params.get('condition') ? String(params.get('condition')).toUpperCase() : undefined
      const minPrice = parsePositiveInt(params.get('minPrice'))
      const maxPrice = parsePositiveInt(params.get('maxPrice'))
      const minBedrooms = parsePositiveInt(params.get('bedrooms'))
      const minBathrooms = parsePositiveInt(params.get('bathrooms'))
      const amenities = (params.get('amenities') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
      const checkIn = parseDateOnly(params.get('checkIn'))
      const checkOut = parseDateOnly(params.get('checkOut'))
      const sort = params.get('sort') || undefined

      const priceMinor = {}
      if (minPrice !== undefined) priceMinor.gte = minPrice
      if (maxPrice !== undefined) priceMinor.lte = maxPrice

      const orderBy =
        sort === 'priceAsc' ? { priceMinor: 'asc' } : sort === 'priceDesc' ? { priceMinor: 'desc' } : { createdAt: 'desc' }

      const candidates = await db().listing.findMany({
        where: {
          status: 'APPROVED',
          division,
          // FIX A: exclude demo/test accounts' listings from every guest-facing query.
          NOT: { owner: { isDemo: true } },
          ...(Object.keys(priceMinor).length ? { priceMinor } : {}),
        },
        include: { location: true, media: true },
        orderBy,
        take: 200,
      })

      let listings = candidates.filter((listing) => {
        const meta = listing.metadata || {}
        const visual = meta.visualFilters || {}
        // FIX A: never surface synthetic/sample listings to guests.
        if (meta.sybnbDataMode === 'sample') return false
        // Legacy listings created before the Quebec work never wrote metadata.country -- treat them
        // as Syria, matching resolveListingJurisdiction's same default (server/lib/jurisdiction-compliance.mjs).
        if (country && (typeof meta.country === 'string' && meta.country ? meta.country : 'SY') !== country) return false
        if (governorate && meta.governorate !== governorate) return false
        if (city && meta.city !== city) return false
        if (area && meta.area !== area) return false
        // Marketplace goods filters (case-insensitive against the metadata values the sell flow writes).
        if (category && String(meta.category || '').toUpperCase() !== category) return false
        if (condition && String(meta.condition || '').toUpperCase() !== condition) return false
        // The wizard writes propertyType twice under two different vocabularies (a capitalized
        // English label from the basic step, and a lowercase id from the visual filter chips) —
        // match either, case-insensitively, against the search page's lowercase chip id.
        if (propertyType) {
          const metaTypes = [meta.propertyType, visual.propertyType].filter(Boolean).map((value) => String(value).toLowerCase())
          if (!metaTypes.includes(propertyType.toLowerCase())) return false
        }
        if (roomType && visual.roomType !== roomType) return false
        if (bedType && visual.bedType !== bedType) return false
        // Bedrooms/bathrooms steppers default to 1 on every search (not an explicit "must have"
        // gesture), so a listing that never declared these fields is treated as "unknown" and kept
        // rather than excluded — only a declared, too-low value filters it out.
        if (minBedrooms !== undefined && meta.bedrooms !== undefined && meta.bedrooms !== null) {
          if (!(Number(meta.bedrooms) >= minBedrooms)) return false
        }
        if (minBathrooms !== undefined && meta.bathrooms !== undefined && meta.bathrooms !== null) {
          if (!(Number(meta.bathrooms) >= minBathrooms)) return false
        }
        if (amenities.length) {
          const have = new Set(visual.amenities || [])
          if (!amenities.every((amenity) => have.has(amenity))) return false
        }
        return true
      })

      if (checkIn && checkOut && checkOut > checkIn && listings.length) {
        const ids = listings.map((listing) => listing.id)
        const [blockedRows, overlappingBookings] = await Promise.all([
          db().listingAvailability.findMany({
            where: { listingId: { in: ids }, status: 'BLOCKED', date: { gte: checkIn, lt: checkOut } },
            select: { listingId: true },
          }),
          db().booking.findMany({
            where: {
              listingId: { in: ids },
              status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] },
              checkIn: { lt: checkOut },
              checkOut: { gt: checkIn },
            },
            select: { listingId: true },
          }),
        ])
        const unavailable = new Set([
          ...blockedRows.map((row) => row.listingId),
          ...overlappingBookings.map((booking) => booking.listingId),
        ])
        listings = listings.filter((listing) => !unavailable.has(listing.id))
      }

      if (listings.length) {
        const ids = listings.map((listing) => listing.id)
        const ninetyDaysOut = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90)
        const offerRows = await db().listingAvailability.findMany({
          where: { listingId: { in: ids }, priceOverrideMinor: { not: null }, date: { gte: new Date(), lte: ninetyDaysOut } },
          select: { listingId: true, priceOverrideMinor: true },
        })
        const offersByListing = new Map()
        for (const row of offerRows) {
          if (!offersByListing.has(row.listingId)) offersByListing.set(row.listingId, [])
          offersByListing.get(row.listingId).push(row)
        }
        listings = listings.map((listing) => ({
          ...listing,
          hasActiveOffer: (offersByListing.get(listing.id) || []).some((row) => isOfferPrice(row.priceOverrideMinor, listing.priceMinor)),
        }))
      }

      const rankedListings = sort === 'priceAsc' || sort === 'priceDesc' ? listings : applySearchBoost(listings)
      // FIX A: surface a fail-closed legal-review status per jurisdiction so the guest surface never
      // presents an unreviewed jurisdiction (Syria) as licensed/live. Unknown jurisdiction => unreviewed.
      // A persistent, counsel-editable status is a future ops/config item (see launch checklist).
      const legalReviewStatus = { SY: 'unreviewed' }[country] || 'unreviewed'
      return json(res, 200, { ok: true, listings: rankedListings.slice(0, 50), jurisdiction: country, legalReviewStatus })
    }

    if (req.method === 'POST') {
      requireAuth(context, ['SELLER', 'HOST'])
      const body = await readJson(req)
      const division = normalizeListingDivision(body.division || 'STAYS')

      if (PAID_PLAN_DIVISIONS.has(division)) {
        const sellerProfile = await db().sellerProfile.findUnique({ where: { userId: context.user.id } })
        if (!sellerProfile || sellerProfile.documentStatus !== 'APPROVED') {
          const error = new Error('A paid, admin-approved seller plan is required before publishing this listing.')
          error.statusCode = 403
          error.code = 'SELLER_PLAN_REQUIRED'
          error.expose = true
          throw error
        }
        // NOTE: the paid-plan expiry clock starts at ADMIN APPROVAL (server/routes/admin.mjs), not here —
        // so a seller never burns paid days while a draft sits in the review queue. expiresAt stays null
        // until the listing is approved and goes live.
      }

      const priceMinor = Number(body.priceMinor || 0)
      if (!body.titleAr || String(body.titleAr).trim().length < 3) {
        const error = new Error('Listing title is required.')
        error.statusCode = 400
        error.code = 'LISTING_TITLE_REQUIRED'
        error.expose = true
        throw error
      }
      // PRICE-INT: must be a positive integer within Postgres int4 range, else Prisma throws a raw 500.
      if (!Number.isInteger(priceMinor) || priceMinor <= 0 || priceMinor > 2147483647) {
        const error = new Error('Listing price must be a whole number greater than zero.')
        error.statusCode = 400
        error.code = 'LISTING_PRICE_INVALID'
        error.expose = true
        throw error
      }
      const listing = await db().listing.create({
        data: {
          ownerId: context.user.id,
          division,
          titleAr: String(body.titleAr).trim(),
          titleEn: body.titleEn || undefined,
          description: body.description || undefined,
          priceMinor,
          currency: body.currency || 'SYP',
          instantBookEnabled: Boolean(body.instantBookEnabled),
          metadata: body.metadata || {},
        },
      })
      return json(res, 201, { ok: true, listing })
    }

    return methodNotAllowed(res, ['GET', 'POST'])
  }

  const detailMatch = url.pathname.match(/^\/api\/listings\/([^/]+)$/)
  if (detailMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    await expireOldListings({ id: detailMatch[1] })
    const listing = await db().listing.findFirst({
      where: { id: detailMatch[1], status: 'APPROVED' },
      include: {
        location: true,
        media: true,
        owner: {
          select: {
            id: true,
            displayName: true,
            idDocumentStatus: true,
          },
        },
        accommodation: {
          select: { id: true, titleAr: true, titleEn: true },
        },
      },
    })
    if (!listing) {
      const error = new Error('Listing not found.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
    // Verification badge: the listing owner's identity document has been admin-approved. Surfaced on
    // the public detail so a buyer can see "verified seller" before contacting them.
    const sellerVerified = listing.owner?.idDocumentStatus === 'APPROVED'
    return json(res, 200, { ok: true, listing, sellerVerified })
  }

  const availabilityMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/availability$/)
  if (availabilityMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const listingId = availabilityMatch[1]
    const from = parseDateOnly(url.searchParams.get('from')) || new Date()
    const toRaw = parseDateOnly(url.searchParams.get('to'))
    const to = toRaw || new Date(from.getTime() + 1000 * 60 * 60 * 24 * 90)

    const [listing, blockedRows, priceRows, activeBookings] = await Promise.all([
      // SECURITY (S8 — IDOR): only APPROVED listings expose availability publicly. Without the status
      // filter, anyone could pass any listing id and read another host's occupancy + private pricing.
      db().listing.findFirst({ where: { id: listingId, status: 'APPROVED' }, select: { priceMinor: true } }),
      db().listingAvailability.findMany({
        where: { listingId, status: 'BLOCKED', date: { gte: from, lte: to } },
        select: { date: true },
        orderBy: { date: 'asc' },
      }),
      db().listingAvailability.findMany({
        where: { listingId, priceOverrideMinor: { not: null }, date: { gte: from, lte: to } },
        select: { date: true, priceOverrideMinor: true },
        orderBy: { date: 'asc' },
      }),
      db().booking.findMany({
        where: {
          listingId,
          status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] },
          checkIn: { not: null },
          checkOut: { not: null },
        },
        select: { checkIn: true, checkOut: true },
      }),
    ])

    if (!listing) {
      const error = new Error('Listing is not available.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }

    const blockedDates = blockedRows.map((row) => isoDate(row.date))
    const priceOverrides = priceRows.map((row) => ({ date: isoDate(row.date), priceMinor: row.priceOverrideMinor }))
    const bookedRanges = activeBookings.map((booking) => ({
      checkIn: isoDate(booking.checkIn),
      checkOut: isoDate(booking.checkOut),
    }))
    const { offerNightsCount, cheapestOfferMinor } = listing
      ? summarizeOffers(priceRows, listing.priceMinor)
      : { offerNightsCount: 0, cheapestOfferMinor: null }

    return json(res, 200, { ok: true, blockedDates, priceOverrides, bookedRanges, offerNightsCount, cheapestOfferMinor })
  }

  const reviewsMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/reviews$/)
  if (reviewsMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const reviews = await db().listingReview.findMany({
      where: { listingId: reviewsMatch[1], hiddenAt: null },
      include: { guest: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const count = reviews.length
    const average = count ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / count) * 10) / 10 : null
    return json(res, 200, { ok: true, reviews, average, count })
  }

  // ---- LISTING MEDIA (Block 1): real photo bytes, owner-managed, authz-gated serving ----
  // Serve a stored photo. Public once the listing is APPROVED; owner/admin only while it is a draft
  // (so a competitor can't scrape a seller's unpublished photos by guessing the listing id).
  const mediaFileMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/media\/file\/([^/]+)$/)
  if (mediaFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const [, listingId, storageKey] = mediaFileMatch
    assertListingUuid(listingId)
    if (!isValidListingMediaKey(storageKey)) {
      const error = new Error('Photo not found.')
      error.statusCode = 404
      error.code = 'LISTING_MEDIA_NOT_FOUND'
      error.expose = true
      throw error
    }
    // Bind the key to this listing: a row must exist whose url is exactly this listing's serve path
    // for this key. Prevents reading a key that belongs to a different listing.
    const media = await db().listingMedia.findFirst({
      where: { listingId, url: mediaServeUrl(listingId, storageKey) },
      select: { id: true },
    })
    const listing = await db().listing.findUnique({ where: { id: listingId }, select: { status: true, ownerId: true } })
    if (!media || !listing) {
      const error = new Error('Photo not found.')
      error.statusCode = 404
      error.code = 'LISTING_MEDIA_NOT_FOUND'
      error.expose = true
      throw error
    }
    const isPublic = listing.status === 'APPROVED'
    if (!isPublic) {
      requireAuth(context)
      const isOwner = listing.ownerId === context.user.id
      const isStaff = context.roles.includes('ADMIN') || context.roles.includes('SUPPORT')
      if (!isOwner && !isStaff) {
        const error = new Error('This photo is not available for this account.')
        error.statusCode = 403
        error.code = 'LISTING_MEDIA_FORBIDDEN'
        error.expose = true
        throw error
      }
    }
    const buffer = await readListingMedia(storageKey)
    res.writeHead(200, {
      // Derived from the stored key, never from a caller-supplied value.
      'content-type': mimeForKey(storageKey),
      'content-length': buffer.length,
      'cache-control': isPublic ? 'public, max-age=3600' : 'private, no-store',
    })
    res.end(buffer)
    return true
  }

  const mediaCollectionMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/media$/)
  if (mediaCollectionMatch) {
    const listingId = mediaCollectionMatch[1]
    assertListingUuid(listingId)

    if (req.method === 'POST') {
      requireAuth(context, ['SELLER', 'HOST'])
      const listing = await db().listing.findFirst({ where: { id: listingId }, select: { ownerId: true } })
      if (!listing || listing.ownerId !== context.user.id) {
        const error = new Error('Listing not found for this account.')
        error.statusCode = 404
        error.code = 'LISTING_NOT_FOUND'
        error.expose = true
        throw error
      }
      const count = await db().listingMedia.count({ where: { listingId } })
      if (count >= MAX_LISTING_PHOTOS) {
        const error = new Error(`A listing can have at most ${MAX_LISTING_PHOTOS} photos.`)
        error.statusCode = 400
        error.code = 'LISTING_MEDIA_LIMIT'
        error.expose = true
        throw error
      }
      const body = await readJson(req)
      const { storageKey } = await saveListingMedia(body.fileBase64, body.mimeType)
      // Object first, database second. If the row fails to write, delete the object we just stored:
      // an orphaned object costs storage, but a row pointing at nothing is a broken photo shown to a
      // guest. Never report success unless both halves completed.
      let media
      try {
        media = await db().listingMedia.create({
          data: { listingId, url: mediaServeUrl(listingId, storageKey), kind: 'photo', sortOrder: count },
        })
      } catch (error) {
        await deleteListingMedia(storageKey)
        throw error
      }
      return json(res, 201, { ok: true, media })
    }

    if (req.method === 'GET') {
      // Owner-facing media list (the wizard shows a seller their own draft photos).
      requireAuth(context, ['SELLER', 'HOST'])
      const listing = await db().listing.findFirst({ where: { id: listingId }, select: { ownerId: true } })
      if (!listing || listing.ownerId !== context.user.id) {
        const error = new Error('Listing not found for this account.')
        error.statusCode = 404
        error.code = 'LISTING_NOT_FOUND'
        error.expose = true
        throw error
      }
      const media = await db().listingMedia.findMany({ where: { listingId }, orderBy: { sortOrder: 'asc' } })
      return json(res, 200, { ok: true, media })
    }

    return methodNotAllowed(res, ['POST', 'GET'])
  }

  const mediaItemMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/media\/([^/]+)$/)
  if (mediaItemMatch) {
    const [, listingId, mediaId] = mediaItemMatch
    assertListingUuid(listingId)
    if (req.method !== 'DELETE') return methodNotAllowed(res, ['DELETE'])
    requireAuth(context, ['SELLER', 'HOST'])
    assertListingUuid(mediaId)
    const media = await db().listingMedia.findUnique({
      where: { id: mediaId },
      include: { listing: { select: { ownerId: true } } },
    })
    if (!media || media.listingId !== listingId || media.listing.ownerId !== context.user.id) {
      const error = new Error('Photo not found for this account.')
      error.statusCode = 404
      error.code = 'LISTING_MEDIA_NOT_FOUND'
      error.expose = true
      throw error
    }
    await db().listingMedia.delete({ where: { id: mediaId } })
    await deleteListingMedia(String(media.url || '').split('/').pop())
    return json(res, 200, { ok: true, deleted: true })
  }

  // ---- Québec compliance review (item 1): real certificate files, not just a free-text expiry
  // date, admin-reviewed before a listing can be treated as verified. ----
  const documentCollectionMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/documents$/)
  if (documentCollectionMatch) {
    const listingId = documentCollectionMatch[1]
    assertListingUuid(listingId)

    if (req.method === 'POST') {
      requireAuth(context, ['SELLER', 'HOST'])
      const listing = await db().listing.findFirst({ where: { id: listingId }, select: { ownerId: true, metadata: true } })
      if (!listing || listing.ownerId !== context.user.id) {
        const error = new Error('Listing not found for this account.')
        error.statusCode = 404
        error.code = 'LISTING_NOT_FOUND'
        error.expose = true
        throw error
      }
      const body = await readJson(req)
      assertNoUnknownFields(body, ['type', 'fileBase64', 'mimeType'], 'listing document body')
      const type = String(body.type || '')
      if (!LISTING_DOCUMENT_TYPES.includes(type)) {
        const error = new Error(`type must be one of: ${LISTING_DOCUMENT_TYPES.join(', ')}.`)
        error.statusCode = 400
        error.code = 'LISTING_DOCUMENT_TYPE_INVALID'
        error.expose = true
        throw error
      }
      const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
      const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
      if (!fileBase64 || !mimeType) {
        const error = new Error('A listing document file is required.')
        error.statusCode = 400
        error.code = 'LISTING_DOCUMENT_REQUIRED'
        error.expose = true
        throw error
      }

      // Third compliance-review correction pass: a legal hold must preserve the held certificate
      // (and its audit trail) but must NEVER block the host from uploading a newer renewal -- so
      // uploading here never throws on legalHold. Instead every upload creates a new version row;
      // the previous current row (if any) simply stops being current. A held previous row keeps its
      // legalHold flag, its file, and its own version number completely untouched.
      const previous = await db().listingDocument.findFirst({
        where: { listingId, type, isCurrent: true }, select: { id: true, assetUrl: true, legalHold: true, version: true },
      })

      const storageKey = await saveListingDocument(fileBase64, mimeType)
      // A hold-free superseded file is deleted immediately (no reason to keep a document that no
      // longer describes the listing's active registration). A held file's bytes are preserved --
      // only its own retention/purge job may ever delete it, never a new upload.
      if (previous && !previous.legalHold && previous.assetUrl && previous.assetUrl !== storageKey) {
        await deleteListingDocument(previous.assetUrl)
      }

      // The certificate's own expiry comes from the listing metadata the host already entered
      // (citqCertificateExpiresAt) -- the retention clock (one year past that date) is derived from
      // it, not invented separately.
      const expiresAtRaw = listing.metadata?.citqCertificateExpiresAt
      const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null
      const validExpiresAt = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null

      // A new version always starts PENDING_REVIEW -- admin review never survives a new file (the
      // certificate must be looked at again) -- and never inherits a legal hold from the row it
      // replaces; a hold is a decision about ONE specific certificate file, not the listing's slot.
      const document = await db().$transaction(async (tx) => {
        if (previous) await tx.listingDocument.update({ where: { id: previous.id }, data: { isCurrent: false } })
        return tx.listingDocument.create({
          data: {
            listingId, type, assetUrl: storageKey, mimeType, status: 'PENDING_REVIEW',
            version: previous ? previous.version + 1 : 1,
            isCurrent: true,
            replacesId: previous ? previous.id : null,
            expiresAt: validExpiresAt, retentionDeleteAfter: retentionDeleteAfter(validExpiresAt),
          },
          select: LISTING_DOCUMENT_SAFE_SELECT,
        })
      })
      return json(res, 201, { ok: true, document })
    }

    if (req.method === 'GET') {
      requireAuth(context, ['SELLER', 'HOST'])
      const listing = await db().listing.findFirst({ where: { id: listingId }, select: { ownerId: true } })
      if (!listing || listing.ownerId !== context.user.id) {
        const error = new Error('Listing not found for this account.')
        error.statusCode = 404
        error.code = 'LISTING_NOT_FOUND'
        error.expose = true
        throw error
      }
      const documents = await db().listingDocument.findMany({
        where: { listingId }, select: LISTING_DOCUMENT_SAFE_SELECT, orderBy: { createdAt: 'desc' },
      })
      return json(res, 200, { ok: true, documents })
    }

    return methodNotAllowed(res, ['POST', 'GET'])
  }

  const documentFileMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/documents\/([^/]+)\/file$/)
  if (documentFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const [, listingId, documentId] = documentFileMatch
    const document = await db().listingDocument.findUnique({
      where: { id: documentId },
      select: { listingId: true, assetUrl: true, mimeType: true, listing: { select: { ownerId: true } } },
    })
    if (!document || document.listingId !== listingId) {
      const error = new Error('Listing document not found.')
      error.statusCode = 404
      error.code = 'LISTING_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }
    const isOwner = document.listing?.ownerId === context.user.id
    const isStaff = context.roles.includes('ADMIN') || context.roles.includes('SUPPORT')
    if (!isOwner && !isStaff) {
      const error = new Error('This document is not available for this account.')
      error.statusCode = 403
      error.code = 'LISTING_DOCUMENT_FORBIDDEN'
      error.expose = true
      throw error
    }
    if (!document.assetUrl) {
      const error = new Error('This document has been deleted under the retention policy.')
      error.statusCode = 410
      error.code = 'LISTING_DOCUMENT_RETENTION_DELETED'
      error.expose = true
      throw error
    }
    const buffer = await readListingDocument(document.assetUrl)

    // STG-24 / SYB-005: this route serves both the owning host and staff. Audit only the staff case
    // — a host reading their own certificate is ordinary self-service, and holding a staff role does
    // not reclassify it. `!isOwner` is what keeps that distinction honest.
    if (isStaff && !isOwner) {
      await recordStaffDocumentAccess({
        actorUserId: context.user.id,
        actorRoles: context.roles,
        documentCategory: LISTING_DOCUMENT_CATEGORY,
        entityType: 'listing_documents',
        entityId: documentId,
        result: 'ALLOWED',
      })
    }

    // STG-12 / SYB-004: forced download. Previously served with a bare content-type, so a PDF
    // rendered inline in the host's authenticated, same-origin session.
    res.writeHead(200, privateDocumentDownloadHeaders({
      mimeType: document.mimeType || 'application/octet-stream',
      category: LISTING_DOCUMENT_CATEGORY,
      byteLength: buffer.length,
    }))
    res.end(buffer)
    return true
  }

  const submitMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/submit$/)
  if (submitMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['SELLER', 'HOST'])
    const existing = await db().listing.findFirst({
      where: { id: submitMatch[1], ownerId: context.user.id },
    })
    if (!existing) {
      const error = new Error('Listing not found for this account.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
      const error = new Error('Only draft or rejected listings can be submitted for review.')
      error.statusCode = 400
      error.code = 'LISTING_NOT_SUBMITTABLE'
      error.expose = true
      throw error
    }

    // ---- Block 1 SUBMIT GUARDS: a listing cannot go live until it is real and complete ----
    // (a) Paid divisions: re-verify the seller's plan is STILL admin-approved at submit time, not just
    //     when the draft was created — a plan can lapse or be revoked in between. (Closes the
    //     "submit-time paid plan recheck" gap.)
    if (PAID_PLAN_DIVISIONS.has(existing.division)) {
      const sellerProfile = await db().sellerProfile.findUnique({ where: { userId: context.user.id } })
      if (!sellerProfile || sellerProfile.documentStatus !== 'APPROVED') {
        const error = new Error('A paid, admin-approved seller plan is required before publishing this listing.')
        error.statusCode = 403
        error.code = 'SELLER_PLAN_REQUIRED'
        error.expose = true
        throw error
      }
    }
    // (b) At least one real photo for the catalog-style divisions (cars, marketplace, real estate).
    if (PHOTO_REQUIRED_DIVISIONS.has(existing.division)) {
      const photoCount = await db().listingMedia.count({ where: { listingId: existing.id, kind: 'photo' } })
      if (photoCount < 1) {
        const error = new Error('Add at least one real photo before submitting this listing for review.')
        error.statusCode = 400
        error.code = 'LISTING_PHOTOS_REQUIRED'
        error.expose = true
        throw error
      }
    }
    // (c) All required structured attributes for the division must be present and well-formed.
    assertListingAttributes(existing.division, existing.metadata)

    const listing = await db().listing.update({
      where: { id: existing.id },
      data: { status: 'PENDING_REVIEW' },
    })
    return json(res, 200, { ok: true, listing })
  }

  return false
}

// Reject a non-UUID id up front as a clean 404 instead of letting Prisma throw a raw P2023 (→ 500)
// when a media/serve path carries a malformed listing or media id.
function assertListingUuid(value) {
  if (!UUID_RE.test(value || '')) {
    const error = new Error('Listing not found.')
    error.statusCode = 404
    error.code = 'LISTING_NOT_FOUND'
    error.expose = true
    throw error
  }
}

function parsePositiveInt(value) {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function parseDateOnly(value) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10)
}

function normalizeListingDivision(value) {
  const division = String(value || '').toUpperCase()
  if (['STAYS', 'RENTALS', 'BUY', 'CARS', 'MARKETPLACE', 'NEW_CONSTRUCTION'].includes(division)) {
    return division
  }

  const error = new Error('Listing division is not supported.')
  error.statusCode = 400
  error.code = 'LISTING_DIVISION_INVALID'
  error.expose = true
  throw error
}
