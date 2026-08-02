import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { computeStayTotalMinor } from '../lib/pricing.mjs'
import { sypMinorToRoundedUsdMinor } from '../lib/currency.mjs'
import { expireOldListings, PAID_PLAN_DIVISIONS } from '../lib/listing-lifecycle.mjs'
import { isOfferPrice, summarizeOffers } from '../lib/offers.mjs'
import { assertListingAttributes, PHOTO_REQUIRED_DIVISIONS } from '../lib/listing-attributes.mjs'
import { computeDealRating, loadCarsComparablePool } from '../lib/car-deal-rating.mjs'
import { computePropertyValuation, loadPropertyComparablePool } from '../lib/property-valuation.mjs'
import { parsePropertyQuery } from '../lib/ai-property-search.mjs'
import { haversineKm, isValidCoords } from '../lib/sr-geocoding.mjs'
import { expireStalePaymentPendingBookings } from '../lib/booking-lifecycle.mjs'
import { expireOpenAuctions, loadAuctionSummaries } from '../lib/auction-lifecycle.mjs'
import {
  MAX_LISTING_PHOTOS,
  deleteListingMedia,
  isValidListingMediaKey,
  mediaServeUrl,
  mimeForKey,
  readListingMedia,
  saveListingMedia,
} from '../lib/listing-media-storage.mjs'

// STAYS/RENTALS/BUY are commission- or contact-based (no upfront platform fee, matching how Centris
// pays brokers on close rather than up front). CARS/MARKETPLACE/NEW_CONSTRUCTION are the paid-plan
// divisions gated behind an admin-approved SellerProfile — PAID_PLAN_DIVISIONS is now shared from
// listing-lifecycle (also used by the admin approval route that starts the paid expiry clock).

// Listing ids are UUID columns in Postgres — a non-UUID id (e.g. the frontend's
// 'fallback-*' sample-listing ids) makes Prisma throw P2023 instead of returning null,
// which would otherwise surface as an uncaught 500. Reject those up front as a clean 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function handleListings(req, res, url, context) {
  // AI property search (Synitres module): parse a free-text query into the structured filters GET
  // /api/listings understands. Must run BEFORE the :id guard below (else "ai-search" is read as a
  // listing id). Public — searching needs no account. Never throws for a normal request.
  if (url.pathname === '/api/listings/ai-search') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    const body = await readJson(req).catch(() => ({}))
    const filters = await parsePropertyQuery(body.query)
    return json(res, 200, { ok: true, filters })
  }

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
    // A SYP-priced listing can be quoted in USD (convert at the fixed rate, round up to the nearest $5 —
    // same change-avoidance rule as SR fares / wallet gifts). But STR (STAYS) listings are already
    // USD-native, so converting them AGAIN would divide a real dollar total by 15,000 and collapse every
    // stay to ~$5. Only convert when the listing is NOT already in USD.
    const wantsUsd = url.searchParams.get('currency') === 'USD' && listing.currency !== 'USD'
    const totalMinor = wantsUsd ? sypMinorToRoundedUsdMinor(quote.totalMinor) : quote.totalMinor
    const perNight = wantsUsd
      ? quote.perNight.map((night) => ({ ...night, priceMinor: sypMinorToRoundedUsdMinor(night.priceMinor) }))
      : quote.perNight
    return json(res, 200, {
      ok: true,
      totalMinor,
      nights: quote.nights,
      perNight,
      currency: wantsUsd ? 'USD' : listing.currency,
    })
  }

  if (url.pathname === '/api/listings') {
    if (req.method === 'GET') {
      // Expiry sweeps moved OFF this hot public-search path to the /api/cron/maintenance cron (they were
      // unscoped full-table updateMany's running on EVERY search). Search stays read-only now.
      const params = url.searchParams
      // Validate the division enum before it reaches Prisma, else an invalid ?division= raises a raw 500.
      const divisionParam = params.get('division')
      const division = divisionParam ? normalizeListingDivision(divisionParam) : undefined
      // Listings created through the wizard never populate the `location` relation — governorate/
      // city/area/bedrooms/bathrooms/propertyType/amenities all live in `metadata` instead, so those
      // filters are applied in-memory below rather than as a Prisma `where` clause.
      const governorate = params.get('governorate') || undefined
      const city = params.get('city') || undefined
      const area = params.get('area') || undefined
      const propertyType = params.get('propertyType') || undefined
      const roomType = params.get('roomType') || undefined
      const bedType = params.get('bedType') || undefined
      // Marketplace (goods) filters — category + condition live in metadata like the property filters.
      const category = params.get('category') ? String(params.get('category')).toUpperCase() : undefined
      const condition = params.get('condition') ? String(params.get('condition')).toUpperCase() : undefined
      // CARS filters -- vehicle fields live under metadata.vehicle.* (falling back to flat metadata.*),
      // same dual-read shape server/lib/listing-attributes.mjs's carRules() requires at submit time.
      const make = params.get('make') || undefined
      const model = params.get('model') || undefined
      const minYear = parsePositiveInt(params.get('minYear'))
      const maxYear = parsePositiveInt(params.get('maxYear'))
      const minMileageKm = parsePositiveInt(params.get('minMileageKm'))
      const maxMileageKm = parsePositiveInt(params.get('maxMileageKm'))
      const transmission = params.get('transmission') || undefined
      const fuelType = params.get('fuelType') || undefined
      // Search radius (025/Carcad Phase F) -- division-agnostic in the filter itself (any listing
      // with a valid metadata.mapLocation benefits), only surfaced in the CARS browse UI for now.
      const centerLat = params.get('centerLat') !== null ? Number(params.get('centerLat')) : undefined
      const centerLng = params.get('centerLng') !== null ? Number(params.get('centerLng')) : undefined
      const radiusKm = params.get('radiusKm') !== null ? Number(params.get('radiusKm')) : undefined
      const radiusParamsGiven = [centerLat, centerLng, radiusKm].filter((value) => value !== undefined).length
      if (radiusParamsGiven > 0) {
        const valid =
          radiusParamsGiven === 3 &&
          isValidCoords({ lat: centerLat, lng: centerLng }) &&
          Number.isFinite(radiusKm) &&
          radiusKm > 0 &&
          radiusKm <= 500
        if (!valid) {
          const error = new Error('centerLat, centerLng, and radiusKm must all be provided together as valid Syria coordinates and a positive radius (max 500km).')
          error.statusCode = 400
          error.code = 'LISTING_RADIUS_FILTER_INVALID'
          error.expose = true
          throw error
        }
      }
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

      // Keyset pagination + bounded scan. The metadata-JSON filters (city/amenities/vehicle/…) can't be
      // expressed in SQL, so they're applied in JS — but instead of the old hard "newest 200 then filter"
      // window (which made every listing older than the newest 200 INVISIBLE to search once a division
      // grew past 200), we page through the APPROVED set by a stable keyset (orderBy + id tiebreaker,
      // Prisma cursor on the unique id). Each request scans at most SCAN_BUDGET rows and returns up to
      // PAGE_SIZE matches plus a `nextCursor` the client uses to load more — so ALL listings are reachable
      // and DB cost stays bounded regardless of catalogue size.
      const PAGE_SIZE = 50
      const FETCH_BATCH = 120
      const SCAN_BUDGET = 600
      const requestCursor = url.searchParams.get('cursor') || null

      const orderBy =
        sort === 'priceAsc'
          ? [{ priceMinor: 'asc' }, { id: 'desc' }]
          : sort === 'priceDesc'
            ? [{ priceMinor: 'desc' }, { id: 'desc' }]
            : [{ createdAt: 'desc' }, { id: 'desc' }]

      const matchesFilters = (listing) => {
        const meta = listing.metadata || {}
        const visual = meta.visualFilters || {}
        if (governorate && meta.governorate !== governorate) return false
        if (city && meta.city !== city) return false
        if (area && meta.area !== area) return false
        // Marketplace goods filters (case-insensitive against the metadata values the sell flow writes).
        if (category && String(meta.category || '').toUpperCase() !== category) return false
        if (condition && String(meta.condition || '').toUpperCase() !== condition) return false
        // CARS filters -- strict, not lenient: once a car filter is active, a listing missing that
        // vehicle field is excluded rather than kept "unknown" (unlike bedrooms/bathrooms above),
        // since make/year/mileage/transmission/fuelType are always required at submit time for CARS.
        const vehicle = meta.vehicle || {}
        if (make && String(vehicle.make ?? meta.make ?? '').toLowerCase() !== make.toLowerCase()) return false
        if (model && String(vehicle.model ?? meta.model ?? '').toLowerCase() !== model.toLowerCase()) return false
        if (minYear !== undefined || maxYear !== undefined) {
          const year = Number(vehicle.year ?? meta.year)
          if (!Number.isFinite(year)) return false
          if (minYear !== undefined && year < minYear) return false
          if (maxYear !== undefined && year > maxYear) return false
        }
        if (minMileageKm !== undefined || maxMileageKm !== undefined) {
          const mileageKm = Number(vehicle.mileageKm ?? meta.mileageKm)
          if (!Number.isFinite(mileageKm)) return false
          if (minMileageKm !== undefined && mileageKm < minMileageKm) return false
          if (maxMileageKm !== undefined && mileageKm > maxMileageKm) return false
        }
        if (transmission && String(vehicle.transmission ?? meta.transmission ?? '').toLowerCase() !== transmission.toLowerCase()) return false
        if (fuelType && String(vehicle.fuelType ?? meta.fuelType ?? '').toLowerCase() !== fuelType.toLowerCase()) return false
        if (radiusKm !== undefined) {
          const map = (meta.mapLocation && typeof meta.mapLocation === 'object') ? meta.mapLocation : {}
          const coords = { lat: Number(map.latitude), lng: Number(map.longitude) }
          if (!isValidCoords(coords)) return false
          if (haversineKm(coords, { lat: centerLat, lng: centerLng }) > radiusKm) return false
        }
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
      }

      const matched = []
      let scanned = 0
      let cursor = requestCursor
      let exhausted = false
      while (matched.length < PAGE_SIZE && scanned < SCAN_BUDGET) {
        const batch = await db().listing.findMany({
          where: {
            status: 'APPROVED',
            division,
            ...(Object.keys(priceMinor).length ? { priceMinor } : {}),
          },
          include: { location: true, media: true },
          orderBy,
          take: FETCH_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        })
        if (!batch.length) {
          exhausted = true
          break
        }
        scanned += batch.length
        for (const listing of batch) {
          cursor = listing.id // advance the keyset to the LAST row we actually processed (never skip rows)
          if (matchesFilters(listing)) matched.push(listing)
          if (matched.length >= PAGE_SIZE) break
        }
        if (matched.length >= PAGE_SIZE) break
        if (batch.length < FETCH_BATCH) {
          exhausted = true
          break
        }
      }
      // More rows may exist beyond this scan → hand the client a cursor to load the next page.
      const nextCursor = exhausted ? null : cursor
      let listings = matched

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
              status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED', 'DISPUTED'] },
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

      let results = listings // already bounded to PAGE_SIZE by the keyset loop above
      // Deal Rating (025/Carcad Phase E): CarGurus-style Great/Good/Fair/High price badge, computed
      // against the pool of currently-live comparable CARS listings. One pool fetch per request.
      if (division === 'CARS' && results.length) {
        const pool = await loadCarsComparablePool()
        results = results.map((listing) => ({ ...listing, dealRating: computeDealRating(listing, pool) }))
      }
      // Property valuation (Synitres module): a Below/At/Above-market badge for BUY/RENTALS, computed
      // against the median price-per-m² of comparable live listings (same city + type + size band).
      if ((division === 'BUY' || division === 'RENTALS') && results.length) {
        const pool = await loadPropertyComparablePool(division)
        results = results.map((listing) => ({ ...listing, valuation: computePropertyValuation(listing, pool) }))
      }
      // Auctions (026): attach a public, card-safe auction summary to any CARS listing running one.
      if (division === 'CARS' && results.length) {
        const summaries = await loadAuctionSummaries(results.map((listing) => listing.id))
        if (summaries.size) {
          results = results.map((listing) => ({ ...listing, auction: summaries.get(listing.id) || null }))
        }
      }

      // Review aggregate per card (Airbnb-style ★ on results). One grouped query; visible reviews only.
      if (results.length) {
        const ids = results.map((listing) => listing.id)
        const reviewRows = await db().listingReview.groupBy({
          by: ['listingId'],
          where: { listingId: { in: ids }, hiddenAt: null },
          _avg: { rating: true },
          _count: { _all: true },
        })
        const reviewByListing = new Map(reviewRows.map((row) => [row.listingId, row]))
        results = results.map((listing) => {
          const agg = reviewByListing.get(listing.id)
          const count = agg?._count?._all || 0
          return {
            ...listing,
            reviewCount: count,
            reviewAverage: count ? Math.round((agg._avg.rating || 0) * 10) / 10 : null,
          }
        })
      }

      return json(res, 200, { ok: true, listings: results, nextCursor })
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
    await expireOpenAuctions({ listing: { id: detailMatch[1] } })
    const listing = await db().listing.findFirst({
      where: { id: detailMatch[1] },
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
    // The public detail is APPROVED-only. A not-yet-approved listing (e.g. PENDING_REVIEW) is visible ONLY
    // to its owner or an admin/support reviewer — so an admin can open a pending listing from the review
    // queue and actually SEE its photos/details before approving. Anyone else gets a 404 (never leak that
    // an unapproved listing exists). context is pre-populated from the token (or null for anonymous).
    if (listing.status !== 'APPROVED') {
      const isOwner = Boolean(context?.user) && listing.ownerId === context.user.id
      const isStaff = Boolean(context?.roles?.includes('ADMIN') || context?.roles?.includes('SUPPORT'))
      if (!isOwner && !isStaff) {
        const error = new Error('Listing not found.')
        error.statusCode = 404
        error.code = 'LISTING_NOT_FOUND'
        error.expose = true
        throw error
      }
    }
    // Verification badge: the listing owner's identity document has been admin-approved. Surfaced on
    // the public detail so a buyer can see "verified seller" before contacting them.
    const sellerVerified = listing.owner?.idDocumentStatus === 'APPROVED'
    // Loyalty (Phase 2): the host's admin-approved trust tier, surfaced so guests see a confidence badge.
    const hostStanding = listing.ownerId
      ? await db().accountStanding.findFirst({ where: { userId: listing.ownerId, kind: 'HOST' }, select: { tier: true } })
      : null
    const hostTier = hostStanding?.tier && hostStanding.tier !== 'NEW' ? hostStanding.tier : null
    let listingWithDealRating = listing
    if (listing.division === 'CARS') {
      const pool = await loadCarsComparablePool()
      listingWithDealRating = { ...listing, dealRating: computeDealRating(listing, pool) }
      // Auctions (026): the card-safe public summary only -- the detail page's bid panel fetches
      // GET /api/listings/:id/auction separately for context-aware fields (youAreHighestBidder,
      // reservePriceMinor for the owner, winnerBidderId for the winner).
      const summaries = await loadAuctionSummaries([listing.id])
      if (summaries.size) listingWithDealRating.auction = summaries.get(listing.id)
    }
    // Property valuation (Synitres): attach the Below/At/Above-market estimate to a BUY/RENTALS detail.
    if (listing.division === 'BUY' || listing.division === 'RENTALS') {
      const pool = await loadPropertyComparablePool(listing.division)
      listingWithDealRating = { ...listing, valuation: computePropertyValuation(listing, pool) }
    }
    return json(res, 200, { ok: true, listing: listingWithDealRating, sellerVerified, hostTier })
  }

  const availabilityMatch = url.pathname.match(/^\/api\/listings\/([^/]+)\/availability$/)
  if (availabilityMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const listingId = availabilityMatch[1]
    const from = parseDateOnly(url.searchParams.get('from')) || new Date()
    const toRaw = parseDateOnly(url.searchParams.get('to'))
    const to = toRaw || new Date(from.getTime() + 1000 * 60 * 60 * 24 * 90)

    // Free up dates held by abandoned (never-paid) PAYMENT_PENDING bookings before reporting the
    // calendar, so a guest never sees squatted nights as unavailable.
    await expireStalePaymentPendingBookings({ listingId })

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
      'content-type': mimeForKey(storageKey),
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
      const saved = await saveListingMedia(body.fileBase64, body.mimeType, listingId)
      const media = await db().listingMedia.create({
        data: { listingId, url: saved.url, kind: 'photo', sortOrder: count },
      })
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
    await deleteListingMedia(media.url) // full url: blob→CDN delete, dev→local file delete
    return json(res, 200, { ok: true, deleted: true })
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
    // (d) Auction-mode CARS listings must have a fully configured Auction row before going live.
    // carRules() stays synchronous (metadata-only) on purpose -- the actual auction config (reserve,
    // increment, endsAt) lives in its own table, so this can't be folded into that contract; it
    // follows the same explicit-extra-block pattern as (a)/(b) above, which already do their own
    // non-metadata DB checks here rather than inside carRules().
    if (existing.division === 'CARS' && existing.metadata?.saleType === 'AUCTION') {
      const auction = await db().auction.findUnique({ where: { listingId: existing.id } })
      if (!auction) {
        const error = new Error('Configure the auction (reserve price, duration) before submitting this listing for review.')
        error.statusCode = 400
        error.code = 'AUCTION_CONFIG_REQUIRED'
        error.expose = true
        throw error
      }
    }

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
