// API host resolution, baked at build time:
//  - VITE_API_BASE_URL set to a real URL  → use it (API split onto its own domain).
//  - unset/empty in a PRODUCTION build     → same-origin: '' makes every call a relative /api/... path,
//    so the Vercel same-origin deployment (frontend + api/index.mjs on one domain) works with no CORS.
//  - unset/empty in DEV                     → local API on 127.0.0.1:3051.
// (Previously the fallback was always localhost, so a production build with VITE_API_BASE_URL="" — the
// documented same-origin setting — would have wrongly called 127.0.0.1.)
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : 'http://127.0.0.1:3051')

// Forward-geocode a place description ("مدحت باشا, دمشق, سوريا") to coordinates via our same-origin
// server proxy (which calls free OpenStreetMap Nominatim — the browser can't call it directly, it
// 403s browser User-Agents). Results are cached client-side so a place is fetched at most once.
const geocodeCache = new Map<string, { lat: number; lng: number } | null>()
export async function geocodePlace(query: string): Promise<{ lat: number; lng: number } | null> {
  const q = query.trim()
  if (!q) return null
  if (geocodeCache.has(q)) return geocodeCache.get(q) ?? null
  try {
    const response = await fetch(`${API_BASE_URL}/api/geocode?q=${encodeURIComponent(q)}`)
    if (!response.ok) {
      geocodeCache.set(q, null)
      return null
    }
    const payload = (await response.json()) as { result?: { lat: number; lng: number } | null }
    const result = payload.result && Number.isFinite(payload.result.lat) && Number.isFinite(payload.result.lng)
      ? { lat: payload.result.lat, lng: payload.result.lng }
      : null
    geocodeCache.set(q, result)
    return result
  } catch {
    geocodeCache.set(q, null)
    return null
  }
}

type ApiUser = {
  id: string
  email: string | null
  displayName: string
  roles: string[]
  referralCode?: string
}

type AuthResponse = {
  ok: true
  user: ApiUser
  token: string
}

export type PlatformAuthSession = AuthResponse

export type PlatformListing = {
  id: string
  ownerId: string
  division: string
  titleAr: string
  titleEn: string | null
  description: string | null
  status: string
  hostTier?: string | null
  priceMinor: number
  currency: string
  instantBookEnabled?: boolean
  expiresAt?: string | null
  metadata: Record<string, unknown>
  owner?: {
    id: string
    displayName: string
    idDocumentStatus?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null
  }
  media?: Array<Record<string, unknown>>
  location?: Record<string, unknown> | null
  accommodation?: { id: string; titleAr: string; titleEn: string | null } | null
  hasActiveOffer?: boolean
  offerNightsCount?: number
  cheapestOfferMinor?: number | null
  // Guest-review aggregate for cards (Airbnb-style ★). Null average when there are no visible reviews.
  reviewAverage?: number | null
  reviewCount?: number
  // CarGurus-style Deal Rating (025/Carcad Phase E) -- CARS listings only, computed server-side
  // against a pool of comparable APPROVED listings. Absent/undefined for every other division.
  dealRating?: {
    tier: 'GREAT_DEAL' | 'GOOD_DEAL' | 'FAIR_PRICE' | 'HIGH_PRICE' | null
    comparableCount: number
    medianPriceMinor: number | null
    priceDeltaMinor?: number
  } | null
  // Property valuation (Synitres module) -- BUY/RENTALS only, computed server-side against comparable
  // live listings' median price-per-m² (same city + type + size band). Absent for other divisions.
  valuation?: {
    tier: 'BELOW_MARKET' | 'AT_MARKET' | 'ABOVE_MARKET' | null
    comparableCount: number
    medianPricePerSqmMinor: number | null
    subjectPricePerSqmMinor?: number
    estimatedValueMinor?: number
  } | null
  // Online auctions (026) -- CARS listings only, a card-safe public summary. The full
  // context-aware state (youAreHighestBidder, reservePriceMinor for the owner, winnerBidderId for
  // the winner) is fetched separately via fetchAuctionState(), never bundled into search/detail.
  auction?: {
    status: 'OPEN' | 'ENDED' | 'CANCELLED'
    currentPriceMinor: number
    reserveMet: boolean
    endsAt: string
    bidCount: number
  } | null
}

export type PlatformPaymentProof = {
  id: string
  bookingId: string | null
  userId: string
  provider: string
  status: string
  amountMinor: number
  currency: string
  proofAssetUrl: string | null
  providerRef: string | null
  adminNote: string | null
  reviewedById: string | null
  reviewedAt: string | null
  user?: {
    id: string
    displayName: string
    email: string | null
  }
  payer?: {
    id: string
    displayName: string
    email: string | null
  }
  booking?: PlatformBooking & {
    guest?: {
      id: string
      displayName: string
      email: string | null
    }
    listing?: PlatformListing
  }
}

export type PlatformRideRequest = {
  id: string
  riderId: string
  driverId: string | null
  pickupLocationId: string | null
  dropoffLocationId: string | null
  status: string
  requestedAt: string
  fareMinor: number | null
  currency: string
  metadata: Record<string, unknown>
  updatedAt: string
  // 4-digit pickup code — returned by the API to the RIDER only (the driver's copy is stripped server-side).
  pickupPin?: string | null
  // Great-circle km from the online driver's last location to this ride's pickup (nearest-first pool).
  pickupDistanceKm?: number | null
  // Auto-dispatch: this ride is currently offered EXCLUSIVELY to the requesting driver (accept-now).
  offeredToMe?: boolean
  rider?: {
    id: string
    displayName: string
    email: string | null
  }
}

export type PlatformDriverVehicle = {
  id: string
  make: string
  model: string
  year: number
  plate: string
  color: string | null
  category: string
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  reviewNote?: string | null
  createdAt: string
}

export type PlatformBooking = {
  id: string
  listingId: string
  guestId: string
  status: string
  checkIn: string | null
  checkOut: string | null
  amountMinor: number
  currency: string
  metadata: Record<string, unknown>
  guestCheckedInAt?: string | null
  guestCheckedOutAt?: string | null
  createdAt: string
  updatedAt: string
  guest?: {
    id: string
    displayName: string
    email: string | null
    idDocumentRef?: string | null
    idDocumentSubmittedAt?: string | null
  }
}

const PROTOTYPE_OWNER = {
  id: 'prototype-owner-sybnb',
  displayName: 'SYBNB Verified Provider',
}

const LOCAL_FALLBACK_BOOKINGS_KEY = 'sybnb-v6-local-fallback-bookings'
const LOCAL_FALLBACK_PAYMENT_PROOFS_KEY = 'sybnb-v6-local-fallback-payment-proofs'

const FALLBACK_APPROVED_LISTINGS: PlatformListing[] = [
  {
    id: 'fallback-stay-malki-apartment',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'STAYS',
    titleAr: 'إقامة مفروشة وسط دمشق',
    titleEn: 'Furnished stay in central Damascus',
    description: 'Ready-to-live apartment with quick service access.',
    status: 'APPROVED',
    priceMinor: 15,
    currency: 'USD',
    metadata: { roomType: 'entireApartment', beds: 2, bathrooms: 1, trustScore: 94 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/divisions/daily-rental.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Al-Malki', lat: 33.514, lng: 36.292 },
  },
  {
    id: 'fallback-stay-heritage-courtyard',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'STAYS',
    titleAr: 'بيت دمشقي تراثي',
    titleEn: 'Damascene heritage courtyard stay',
    description: 'Heritage home with calm courtyard and verified host.',
    status: 'APPROVED',
    priceMinor: 45,
    currency: 'USD',
    metadata: { roomType: 'heritageHome', beds: 3, bathrooms: 2, trustScore: 96 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/properties/heritage-home.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Old City', lat: 33.511, lng: 36.306 },
  },
  {
    id: 'fallback-stay-mezzeh-studio',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'STAYS',
    titleAr: 'استوديو مفروش في المزة',
    titleEn: 'Furnished studio in Mezzeh',
    description: 'Compact verified stay near services with simple guest booking.',
    status: 'APPROVED',
    priceMinor: 25,
    currency: 'USD',
    metadata: { roomType: 'studio', beds: 1, bathrooms: 1, trustScore: 93 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/divisions/daily-rental.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Mezzeh', lat: 33.502, lng: 36.258 },
  },
  {
    id: 'fallback-stay-yafour-villa',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'STAYS',
    titleAr: 'فيلا يومية في يعفور',
    titleEn: 'Daily villa stay in Yafour',
    description: 'Spacious verified villa stay for families and longer guest trips.',
    status: 'APPROVED',
    priceMinor: 65,
    currency: 'USD',
    metadata: { roomType: 'villa', beds: 4, bathrooms: 3, trustScore: 95 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/properties/villa.webp' }],
    location: { country: 'SY', governorate: 'Rif Dimashq', city: 'Yafour', area: 'Main road', lat: 33.493, lng: 36.189 },
  },
  {
    id: 'fallback-rental-villa-malki',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'RENTALS',
    titleAr: 'فيلا النخيل الملكية',
    titleEn: 'Royal Palm Villa',
    description: 'Monthly rental villa with protected contact flow and verified owner.',
    status: 'APPROVED',
    priceMinor: 900000,
    currency: 'SYP',
    metadata: { propertyType: 'villa', bedrooms: 4, bathrooms: 3, bedType: 'king', trustScore: 98 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/properties/villa.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Yafour', lat: 33.489, lng: 36.221 },
  },
  {
    id: 'fallback-rental-modern-apartment',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'RENTALS',
    titleAr: 'شقة عصرية بلس',
    titleEn: 'Modern Plus Apartment',
    description: 'Monthly apartment near services with elevator and parking.',
    status: 'APPROVED',
    priceMinor: 550000,
    currency: 'SYP',
    metadata: { propertyType: 'apartment', bedrooms: 3, bathrooms: 2, bedType: 'queen', trustScore: 95 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/divisions/monthly-rental.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Mezzeh', lat: 33.502, lng: 36.258 },
  },
  {
    id: 'fallback-buy-villa-yafour',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'BUY',
    titleAr: 'فيلا للبيع في يعفور',
    titleEn: 'Villa for sale in Yafour',
    description: 'Verified owner sale with documents ready for platform review.',
    status: 'APPROVED',
    priceMinor: 1250000000,
    currency: 'SYP',
    metadata: { propertyType: 'villa', bedrooms: 5, bathrooms: 4, trustScore: 97 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/divisions/buy-property.webp' }],
    location: { country: 'SY', governorate: 'Rif Dimashq', city: 'Yafour', area: 'Main road', lat: 33.493, lng: 36.189 },
  },
  {
    id: 'fallback-buy-office-kafr-souseh',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'BUY',
    titleAr: 'مكتب تجاري فاخر',
    titleEn: 'Premium commercial office',
    description: 'Commercial property with clean documentation and visit request flow.',
    status: 'APPROVED',
    priceMinor: 840000000,
    currency: 'SYP',
    metadata: { propertyType: 'office', rooms: 6, bathrooms: 2, trustScore: 92 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/properties/office.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Kafr Souseh', lat: 33.486, lng: 36.282 },
  },
  {
    id: 'fallback-car-sedan-damascus',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'CARS',
    titleAr: 'سيارة سيدان موثوقة',
    titleEn: 'Verified sedan listing',
    description: 'Clean car listing with seller contact and protected request flow.',
    status: 'APPROVED',
    priceMinor: 180000000,
    currency: 'SYP',
    metadata: { carShape: 'sedan', transmission: 'automatic', fuel: 'gas', trustScore: 93 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/cars/sedan.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Abu Rummaneh', lat: 33.516, lng: 36.284 },
  },
  {
    id: 'fallback-car-suv-showroom',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'CARS',
    titleAr: 'SUV عائلية من معرض موثق',
    titleEn: 'Verified family SUV',
    description: 'SUV listing from a verified dealer with inspection notes.',
    status: 'APPROVED',
    priceMinor: 260000000,
    currency: 'SYP',
    metadata: { carShape: 'suv', transmission: 'automatic', fuel: 'hybrid', trustScore: 95 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/cars/suv.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Mazzeh', lat: 33.501, lng: 36.258 },
  },
  {
    id: 'fallback-market-furniture',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'MARKETPLACE',
    titleAr: 'مجموعة أثاث منزلية',
    titleEn: 'Home furniture set',
    description: 'Marketplace item with seller verification and protected request.',
    status: 'APPROVED',
    priceMinor: 4500000,
    currency: 'SYP',
    metadata: { category: 'furniture', condition: 'used', trustScore: 90 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/market/furniture.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Old City', lat: 33.511, lng: 36.306 },
  },
  {
    id: 'fallback-market-appliance',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'MARKETPLACE',
    titleAr: 'أجهزة منزلية بحالة ممتازة',
    titleEn: 'Excellent home appliances',
    description: 'Verified marketplace offer ready for buyer request.',
    status: 'APPROVED',
    priceMinor: 3200000,
    currency: 'SYP',
    metadata: { category: 'appliances', condition: 'new', trustScore: 91 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/market/appliances.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Kafr Souseh', lat: 33.486, lng: 36.282 },
  },
  {
    id: 'fallback-project-residence',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'NEW_CONSTRUCTION',
    titleAr: 'مشروع سكني جديد',
    titleEn: 'New residential project',
    description: 'Builder project with visit booking and document review flow.',
    status: 'APPROVED',
    priceMinor: 650000000,
    currency: 'SYP',
    metadata: { projectType: 'residential', units: 28, trustScore: 96 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/properties/new-project.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Mezzeh', lat: 33.502, lng: 36.258 },
  },
  {
    id: 'fallback-project-tower',
    ownerId: PROTOTYPE_OWNER.id,
    division: 'NEW_CONSTRUCTION',
    titleAr: 'برج مكاتب قيد الإنجاز',
    titleEn: 'Office tower under construction',
    description: 'New construction opportunity with builder dashboard workflow.',
    status: 'APPROVED',
    priceMinor: 980000000,
    currency: 'SYP',
    metadata: { projectType: 'commercial', units: 16, trustScore: 94 },
    owner: PROTOTYPE_OWNER,
    media: [{ url: '/assets/filter-photos/properties/office.webp' }],
    location: { country: 'SY', governorate: 'Damascus', city: 'Damascus', area: 'Kafr Souseh', lat: 33.486, lng: 36.282 },
  },
]

function fallbackApprovedListings(division = 'STAYS') {
  return FALLBACK_APPROVED_LISTINGS
    .filter((listing) => listing.division === division)
    .map(markSampleListing)
}

function markSampleListing(listing: PlatformListing): PlatformListing {
  return {
    ...listing,
    metadata: {
      ...listing.metadata,
      sybnbDataMode: 'sample',
    },
  }
}

export function isSampleListing(listing: PlatformListing) {
  return listing.metadata?.sybnbDataMode === 'sample'
}

export type PlatformReviewBooking = PlatformBooking & {
  listing?: PlatformListing
}

export type PlatformIdDocumentReview = {
  id: string
  displayName: string
  email: string | null
  idDocumentMimeType: string | null
  idDocumentSubmittedAt: string | null
  idDocumentStatus?: string | null
}

export type PlatformReviewQueue = {
  listings: PlatformListing[]
  payments: PlatformPaymentProof[]
  gifts: PlatformWalletGift[]
  bookings: PlatformReviewBooking[]
  idDocuments: PlatformIdDocumentReview[]
}

export type PlatformAdminAuditLog = {
  id: string
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  ipHash: string | null
  createdAt: string
  actor?: {
    id: string
    displayName: string
    email: string | null
  } | null
}

export type PlatformAdminMetrics = {
  usersByRole: Record<string, number>
  listingsByDivision: Record<string, number>
  listingsByStatus: Record<string, number>
  bookingsByStatus: Record<string, number>
  ridesByStatus: Record<string, number>
  paymentsByStatus: Record<string, number>
  giftsByStatus: Record<string, number>
  walletCount: number
  walletBalanceMinor: number
  approvedPaymentCount: number
  approvedPaymentVolumeMinor: number
}

export type PlatformHealth = {
  ok: boolean
  service: string
  database: {
    ok: boolean
    code: string
    message?: string
  }
}

export type PlatformContracts = {
  ok: true
  endpoints: Array<Record<string, unknown>>
  securityRules: string[]
}

export type PlatformSellerProfile = {
  id: string
  userId: string
  legalName: string
  sellerType: string
  documentStatus: string
  planCode: string | null
}

export type PlatformOverview = {
  user: ApiUser & {
    idDocumentRef?: string | null
    idDocumentSubmittedAt?: string | null
    idDocumentStatus?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null
  }
  bookings: Array<PlatformBooking & { listing?: PlatformListing; payments?: PlatformPaymentProof[] }>
  listings: PlatformListing[]
  payments: PlatformPaymentProof[]
  rides: PlatformRideRequest[]
  wallet: null | {
    id: string
    currency: string
    cachedBalanceMinor: number
    entries: Array<Record<string, unknown>>
  }
  sellerProfile: PlatformSellerProfile | null
  gifts: {
    sent: Array<Record<string, unknown>>
    claimed: Array<Record<string, unknown>>
  }
  referrals: {
    made: Array<{
      id: string
      status: 'PENDING' | 'REWARDED'
      createdAt: string
      rewardedAt: string | null
      referee: { id: string; displayName: string }
    }>
    rewardedCount: number
    pendingCount: number
  }
}

export type PlatformHostOverview = {
  host: ApiUser & { idDocumentStatus?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null }
  totals: {
    listings: number
    approvedListings: number
    pendingListings: number
    requests: number
    requested: number
    confirmed: number
    revenueMinor: number
  }
  listings: Array<PlatformListing & { bookings?: PlatformBooking[] }>
  requests: Array<
    PlatformBooking & {
      listing?: Pick<PlatformListing, 'id' | 'division' | 'titleAr' | 'titleEn' | 'priceMinor' | 'currency' | 'status'>
      payments?: PlatformPaymentProof[]
    }
  >
  insightSignal?: { listingsNeedingAttention: number }
}

export type PlatformDriverOverview = {
  driver: ApiUser & { idDocumentStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null }
  totals: {
    assigned: number
    active: number
    completed: number
    earningsMinor: number
    todayCompletedCount: number
    todayEarningsMinor: number
  }
  rides: PlatformRideRequest[]
}

export type PlatformWalletGift = {
  id: string
  senderUserId: string
  recipientUserId: string | null
  amountMinor: number
  currency: string
  message: string | null
  status: string
  expiresAt: string
  createdAt: string
  updatedAt: string
  sender?: {
    id: string
    displayName: string
  }
}

export type PlatformWallet = {
  id: string
  userId: string
  currency: string
  cachedBalanceMinor: number
  entries?: Array<Record<string, unknown>>
}

type ApiErrorBody = {
  ok: false
  error?: {
    code?: string
    message?: string
  }
}

type CreateListingInput = {
  division?: string
  titleAr: string
  titleEn?: string
  description?: string
  priceMinor: number
  currency: string
  instantBookEnabled?: boolean
  metadata: Record<string, unknown>
}

export const LAST_SUBMITTED_LISTING_KEY = 'sybnb.v6.lastSubmittedListing'
// In-flight STR draft marker for idempotent retry (see createAndSubmitPrototypeListing). Holds the
// created listing id + how many photos have uploaded, so a failed-then-retried submit resumes the same
// draft instead of piling up duplicate drafts.
const PENDING_LISTING_DRAFT_KEY = 'sybnb.v6.pendingListingDraft'
export const SELLER_SESSION_KEY = 'sybnb.v6.sellerSession'
export const GUEST_SESSION_KEY = 'sybnb.v6.guestSession'
export const GUEST_SESSION_TOKEN_KEY = 'sybnb-v6-guest-token'
export const GUEST_DEVICE_ID_KEY = 'sybnb.v6.guestDeviceId'
export const STAFF_SESSION_KEY = 'sybnb.v6.staffSession'
export const STAFF_SESSION_TOKEN_KEY = 'sybnb-v6-staff-token'

// Persistent login: the auth SESSION (guest/staff/seller token) is kept in localStorage so it survives an
// app/tab restart — on web across browser restarts, and on mobile because the Capacitor webview persists
// localStorage across app launches. Opening the app therefore means "already signed in" (backed by the
// 90-day server token TTL). Ephemeral UI state (return paths, search, fallback caches) intentionally stays
// in sessionStorage. Guarded for SSR/private-mode so a blocked storage never throws.
export const authStorage = {
  getItem(key: string): string | null {
    try {
      return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
    } catch {
      /* storage unavailable (private mode / quota) — session just won't persist */
    }
  },
  removeItem(key: string): void {
    try {
      if (typeof window !== 'undefined') window.localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  },
}

export type HostDashboardMode = 'host' | 'seller'

export async function fetchPrototypeHealth() {
  return apiRequest<PlatformHealth>('/api/health')
}

export async function fetchPrototypeContracts() {
  return apiRequest<PlatformContracts>('/api/contracts')
}

export type AiPropertySearchFilters = {
  propertyType?: string
  bedrooms?: number
  minPrice?: number
  maxPrice?: number
  amenities?: string[]
}

// AI property search (Synitres): parse a free-text query ("3-bed apartment under 25M with elevator")
// into structured filters. Works with or without an API key (server falls back to a keyword parser).
export async function aiParsePropertySearch(query: string) {
  const response = await apiRequest<{ ok: true; filters: AiPropertySearchFilters }>('/api/listings/ai-search', {
    method: 'POST',
    body: { query },
  })
  return response.filters
}

export async function createAndSubmitPrototypeListing(
  input: CreateListingInput & {
    photos?: File[]
    availability?: Array<{ date: string; status: 'BLOCKED' | 'AVAILABLE'; priceOverrideMinor?: number | null }>
  },
) {
  const { photos, availability, ...listingInput } = input
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())

  // IDEMPOTENT DRAFT REUSE (Option A): the create → upload photos → set availability → submit sequence
  // used to create a brand-new draft on EVERY call. So if any photo upload or the availability PATCH
  // failed mid-way (a bad file, a transient 500), the listing was created but never submitted, and each
  // retry piled up another orphaned duplicate draft. Now we remember the in-flight draft (id + how many
  // photos already uploaded) in sessionStorage, keyed by a fingerprint of the listing's core fields, and
  // RESUME it on retry instead of starting over — no duplicate drafts, and photos aren't re-uploaded.
  const fingerprint = JSON.stringify([listingInput.titleAr, listingInput.titleEn, listingInput.priceMinor, listingInput.currency])
  let listingId: string | null = null
  let photosUploaded = 0
  try {
    const raw = sessionStorage.getItem(PENDING_LISTING_DRAFT_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as { listingId?: string; photosUploaded?: number; fingerprint?: string }
      if (saved?.listingId && saved.fingerprint === fingerprint) {
        listingId = saved.listingId
        photosUploaded = Number(saved.photosUploaded) || 0
      }
    }
  } catch {
    /* corrupt draft marker — fall through and create a fresh draft */
  }

  const rememberDraft = () => {
    try {
      sessionStorage.setItem(PENDING_LISTING_DRAFT_KEY, JSON.stringify({ listingId, photosUploaded, fingerprint }))
    } catch {
      /* storage full / disabled — non-fatal, we just lose retry-resume */
    }
  }

  if (!listingId) {
    const created = await apiRequest<{ ok: true; listing: PlatformListing }>('/api/listings', {
      method: 'POST',
      token: session.token,
      body: {
        division: 'STAYS',
        ...listingInput,
      },
    })
    listingId = created.listing.id
    photosUploaded = 0
    rememberDraft()
  }

  // Upload the guest-facing photos BEFORE submit, in order (so each media row's sortOrder matches the
  // metadata.photoCategories index). Without this the listing was created + submitted with NO photos —
  // the reason a submitted stay showed up blank everywhere. Resume after any already uploaded on a prior
  // attempt so a mid-sequence failure never re-uploads (and never duplicates) earlier photos.
  if (photos && photos.length) {
    for (let i = photosUploaded; i < photos.length; i += 1) {
      const fileBase64 = await readFileAsBase64(photos[i])
      await apiRequest<{ ok: true }>(`/api/listings/${listingId}/media`, {
        method: 'POST',
        token: session.token,
        body: { fileBase64, mimeType: photos[i].type },
      })
      photosUploaded = i + 1
      rememberDraft()
    }
  }

  // Persist the availability the host set in the wizard (per-night prices on the open days + any blocked
  // date). Available-by-default is preserved — we only write the dates the host explicitly touched, never
  // a mass block, so a listing can't come out unbookable.
  if (availability && availability.length) {
    await apiRequest<{ ok: true }>(`/api/host/listings/${listingId}/availability`, {
      method: 'PATCH',
      token: session.token,
      body: { dates: availability },
    })
  }

  const submitted = await apiRequest<{ ok: true; listing: PlatformListing }>(
    `/api/listings/${listingId}/submit`,
    {
      method: 'PATCH',
      token: session.token,
    },
  )

  // Submitted cleanly — clear the in-flight draft marker so the next listing starts fresh.
  try {
    sessionStorage.removeItem(PENDING_LISTING_DRAFT_KEY)
  } catch {
    /* ignore */
  }
  sessionStorage.setItem(LAST_SUBMITTED_LISTING_KEY, JSON.stringify(submitted.listing))
  return submitted.listing
}

// Facebook-style marketplace quick-list: create a free MARKETPLACE (goods) listing, attach the photo
// (required for goods), and submit it for review — all in one call. Uses the seller/host session.
export async function createAndSubmitMarketplaceListing(input: {
  titleAr: string
  titleEn?: string
  description?: string
  priceMinor: number
  currency: string
  category: string
  condition: string
  city: string
  lat?: number
  lng?: number
  photoBase64: string
  photoMimeType: string
}) {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const created = await apiRequest<{ ok: true; listing: PlatformListing }>('/api/listings', {
    method: 'POST',
    token: session.token,
    body: {
      division: 'MARKETPLACE',
      titleAr: input.titleAr,
      titleEn: input.titleEn,
      description: input.description,
      priceMinor: input.priceMinor,
      currency: input.currency,
      metadata: {
        category: input.category,
        condition: input.condition,
        city: input.city,
        ...(input.lat !== undefined && input.lng !== undefined ? { lat: input.lat, lng: input.lng } : {}),
      },
    },
  })
  await apiRequest<{ ok: true }>(`/api/listings/${created.listing.id}/media`, {
    method: 'POST',
    token: session.token,
    body: { fileBase64: input.photoBase64, mimeType: input.photoMimeType },
  })
  const submitted = await apiRequest<{ ok: true; listing: PlatformListing }>(`/api/listings/${created.listing.id}/submit`, {
    method: 'PATCH',
    token: session.token,
  })
  return submitted.listing
}

export type CarVehicleAttributes = {
  make: string
  model: string
  year: number
  mileageKm: number
  transmission: string
  fuelType: string
  condition: 'NEW' | 'USED' | 'EXCELLENT' | 'GOOD' | 'FAIR' | 'REFURBISHED'
}

// CARS listing creation -- previously the seller wizard never actually uploaded real photo
// bytes (only filenames were kept in memory) and never populated the structured vehicle fields
// server/lib/listing-attributes.mjs's carRules() requires, so submission always failed with
// LISTING_PHOTOS_REQUIRED + LISTING_ATTRIBUTES_INCOMPLETE. This creates the draft, uploads each
// real photo, then submits -- same three-call sequence as createAndSubmitMarketplaceListing,
// just looping the photo upload over multiple files.
export type CarAuctionConfig = {
  reservePriceMinor?: number
  minIncrementMinor: number
  durationHours: number
}

export async function createAndSubmitCarListing(input: {
  titleAr: string
  titleEn?: string
  description?: string
  priceMinor: number
  currency: string
  vehicle: CarVehicleAttributes
  metadata: Record<string, unknown>
  photos: File[]
  auction?: CarAuctionConfig
}) {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const created = await apiRequest<{ ok: true; listing: PlatformListing }>('/api/listings', {
    method: 'POST',
    token: session.token,
    body: {
      division: 'CARS',
      titleAr: input.titleAr,
      titleEn: input.titleEn,
      description: input.description,
      priceMinor: input.priceMinor,
      currency: input.currency,
      metadata: { ...input.metadata, vehicle: input.vehicle, saleType: input.auction ? 'AUCTION' : 'FIXED' },
    },
  })
  for (const file of input.photos) {
    const fileBase64 = await readFileAsBase64(file)
    await apiRequest<{ ok: true }>(`/api/listings/${created.listing.id}/media`, {
      method: 'POST',
      token: session.token,
      body: { fileBase64, mimeType: file.type },
    })
  }
  if (input.auction) {
    await apiRequest<{ ok: true }>(`/api/listings/${created.listing.id}/auction`, {
      method: 'POST',
      token: session.token,
      body: input.auction,
    })
  }
  const submitted = await apiRequest<{ ok: true; listing: PlatformListing }>(`/api/listings/${created.listing.id}/submit`, {
    method: 'PATCH',
    token: session.token,
  })
  sessionStorage.setItem(LAST_SUBMITTED_LISTING_KEY, JSON.stringify(submitted.listing))
  return submitted.listing
}

// Online auctions (026): read the full context-aware auction state for a listing (includes
// youAreHighestBidder / reservePriceMinor(owner) / winnerBidderId(owner or winner) depending on who
// is asking) -- separate from the card-safe `PlatformListing.auction` summary bundled into
// search/detail responses.
export type PlatformAuctionState = {
  id: string
  listingId: string
  status: 'OPEN' | 'ENDED' | 'CANCELLED'
  startingPriceMinor: number
  currentPriceMinor: number
  reserveMet: boolean
  minIncrementMinor: number
  startsAt: string
  endsAt: string
  bidCount: number
  youAreHighestBidder?: boolean
  reservePriceMinor?: number | null
  endedAt?: string
  hasWinner?: boolean
  youWon?: boolean
}

export async function fetchAuctionState(listingId: string) {
  // Buyer-facing (ListingDetailPage's AuctionBidPanel) -- same session as inquiry/contact-seller,
  // ensurePrototypeGuestSession() creates one on demand so an anonymous visitor can still view
  // public auction state (server exposes context-aware fields only when the token identifies them
  // as the leader/owner/winner; a fresh guest session yields the plain public shape either way).
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; auction: PlatformAuctionState }>(`/api/listings/${listingId}/auction`, {
    token: session.token,
  })
  return response.auction
}

export async function placeAuctionBid(listingId: string, maxProxyMinor: number) {
  const session = await ensurePrototypeGuestSession()
  return apiRequest<{ ok: true; currentPriceMinor: number; youAreHighestBidder: boolean; reserveMet: boolean; endsAt: string }>(
    `/api/listings/${listingId}/auction/bids`,
    { method: 'POST', token: session.token, body: { maxProxyMinor } },
  )
}

export type PlatformAccommodation = {
  id: string
  ownerId: string
  titleAr: string
  titleEn: string | null
  description: string | null
  governorate: string
  city: string
  area: string | null
  address: string | null
  status: string
  metadata: Record<string, unknown>
  listings?: PlatformListing[]
  offerSummary?: { listingsWithOfferCount: number; totalListingsCount: number }
}

type CreateAccommodationInput = {
  titleAr: string
  titleEn?: string
  description?: string
  governorate: string
  city: string
  area?: string
  address?: string
  metadata?: Record<string, unknown>
}

type AddAccommodationRoomTypeInput = {
  titleAr: string
  titleEn?: string
  description?: string
  priceMinor: number
  currency?: string
  instantBookEnabled?: boolean
  metadata: Record<string, unknown>
}

export async function createAccommodation(input: CreateAccommodationInput) {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const response = await apiRequest<{ ok: true; accommodation: PlatformAccommodation }>('/api/accommodations', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.accommodation
}

export async function addAccommodationRoomType(accommodationId: string, input: AddAccommodationRoomTypeInput) {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const response = await apiRequest<{ ok: true; listing: PlatformListing }>(
    `/api/accommodations/${accommodationId}/room-types`,
    {
      method: 'POST',
      token: session.token,
      body: input,
    },
  )
  return response.listing
}

// Upload one guest-facing photo (the image bytes) to a listing/room-type as ListingMedia. Used by
// the stays wizard so listings actually publish WITH photos (previously only filenames were kept).
export async function uploadListingPhoto(listingId: string, file: File) {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const fileBase64 = await readFileAsBase64(file)
  await apiRequest<{ ok: true }>(`/api/listings/${listingId}/media`, {
    method: 'POST',
    token: session.token,
    body: { fileBase64, mimeType: file.type },
  })
}

// PREMIUM (paid) photo enhancement — sends a staged photo to the server, which runs faithful AI
// super-resolution/denoise (fal.ai) and returns the enhanced JPEG. Distinct from the free on-device
// enhancer. Requires a host/seller session; the server rate-limits it so provider cost stays bounded.
// Throws PREMIUM_ENHANCE_NOT_CONFIGURED (501) when no key is set, so callers can hide the feature.
export async function enhanceHostPhoto(file: File): Promise<File> {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const fileBase64 = await readFileAsBase64(file)
  const result = await apiRequest<{ ok: true; fileBase64: string; mimeType: string }>(
    '/api/host/photos/enhance',
    {
      method: 'POST',
      token: session.token,
      body: { fileBase64, mimeType: file.type },
    },
  )
  const binary = atob(result.fileBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: result.mimeType || 'image/jpeg' })
}

export async function submitAccommodation(accommodationId: string) {
  const session = getStoredSellerSession() || (await ensurePrototypeHostSession())
  const response = await apiRequest<{ ok: true; accommodation: PlatformAccommodation }>(
    `/api/accommodations/${accommodationId}/submit`,
    {
      method: 'PATCH',
      token: session.token,
    },
  )
  return response.accommodation
}

export async function fetchAccommodation(accommodationId: string) {
  return apiRequest<{ ok: true; accommodation: PlatformAccommodation }>(`/api/accommodations/${accommodationId}`)
}

// AI listing-description helper (capsule): sends the host's selected attributes to the server, which
// writes a bilingual description with Claude (or a template fallback when no key is configured).
export async function generateListingDescription(
  attributes: Record<string, unknown>,
): Promise<{ titleAr: string; titleEn: string; descriptionAr: string; descriptionEn: string; source: string }> {
  // Prefer a host/seller session; fall back to the device guest session (auto-created) so the
  // "Write with AI" button works even before the host has finished the partner sign-in.
  const session =
    getStoredSellerSession() ||
    getStoredStaffSession('HOST') ||
    getStoredStaffSession('SELLER') ||
    (await ensurePrototypeGuestSession())
  const response = await apiRequest<{ ok: true; titleAr?: string; titleEn?: string; descriptionAr: string; descriptionEn: string; source: string }>(
    '/api/host/listing-description',
    { method: 'POST', token: session.token, body: attributes },
  )
  return {
    titleAr: response.titleAr || '',
    titleEn: response.titleEn || '',
    descriptionAr: response.descriptionAr || '',
    descriptionEn: response.descriptionEn || '',
    source: response.source,
  }
}

// "Ask SYBNB AI" — role-aware assistant for any signed-in user. The server derives the role
// (guest/host/admin) from the session token, so we send whichever session the user has (most
// privileged first), falling back to the auto-created guest session so the helper always works.
export async function askAssistant(
  question: string,
  locale: 'ar' | 'en' | 'fr',
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  confirmation?: { action: 'createBookingDraft'; listingId: string },
): Promise<AssistantResponse> {
  const session =
    getStoredStaffSession('ADMIN') ||
    getStoredStaffSession('HOST') ||
    getStoredStaffSession('SELLER') ||
    getStoredSellerSession() ||
    (await ensurePrototypeGuestSession())
  const response = await apiRequest<{ ok: true } & AssistantResponse>(
    '/api/assistant/ask',
    { method: 'POST', token: session.token, body: { question, locale, history, ...(confirmation ? { confirmation } : {}) } },
  )
  return { answer: response.answer || '', source: response.source, listings: response.listings || [], draft: response.draft || null }
}

export type AssistantListingCard = {
  id: string
  title: { ar: string; en: string; fr: string }
  price: { amountMinor: number; currency: string; basis: 'stay_total' | 'nightly_base' }
  availability: boolean | null
  locationSummary: string | null
  rating: number | null
  reviewCount: number
  image: string | null
  link: string
  propertyType: string | null
  amenities: string[]
}

export type AssistantDraft = {
  listingId: string; checkIn: string; checkOut: string; guests: number; nights: number
  total: { amountMinor: number; currency: string }; expiresAt: string; confirmationRequired: true; bookingLink: string
}

export type AssistantResponse = { answer: string; source: string; listings: AssistantListingCard[]; draft: AssistantDraft | null }

// AI "Correct & improve" — polishes the host's OWN text (spelling/grammar/clarity), never invents
// facts. Same session fallback as the description writer so it works throughout the listing flow.
export async function correctListingText(
  text: string,
  locale: 'ar' | 'en',
): Promise<{ corrected: string; source: string }> {
  const session =
    getStoredSellerSession() ||
    getStoredStaffSession('HOST') ||
    getStoredStaffSession('SELLER') ||
    (await ensurePrototypeGuestSession())
  const response = await apiRequest<{ ok: true; corrected: string; source: string }>(
    '/api/host/listing-correct',
    { method: 'POST', token: session.token, body: { text, locale } },
  )
  return { corrected: response.corrected || '', source: response.source }
}

export type TruthCheckItem = { claim: string; verdict: 'evidenced' | 'not_evidenced' | 'contradicted'; note: string }

// AI honesty guard: cross-checks the host's CLAIMED features against their PHOTOS (vision) and returns
// warnings on mismatches. Warn-not-block. `photos` are base64 (no data: prefix) + mediaType.
export async function checkListingHonesty(
  claims: string[],
  photos: { data: string; mediaType: string }[],
  locale: 'ar' | 'en',
): Promise<{ status: string; items: TruthCheckItem[]; warnings: string[] }> {
  const session =
    getStoredSellerSession() ||
    getStoredStaffSession('HOST') ||
    getStoredStaffSession('SELLER') ||
    (await ensurePrototypeGuestSession())
  const response = await apiRequest<{ ok: true; status: string; items?: TruthCheckItem[]; warnings?: string[] }>(
    '/api/host/listing-truth-check',
    { method: 'POST', token: session.token, body: { claims, photos, locale } },
  )
  return { status: response.status, items: response.items || [], warnings: response.warnings || [] }
}

// Room/space vocabulary for the AI "photo tour". Keep in sync with server ai-photo-categorize.mjs.
export const PHOTO_ROOM_CATEGORIES = [
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
] as const
export type PhotoRoomCategory = (typeof PHOTO_ROOM_CATEGORIES)[number]
export type PhotoCategoryItem = { index: number; category: PhotoRoomCategory; confidence: number | null }

// AI "photo tour": ask the server to label each uploaded photo by room/space. Returns one item per photo
// the model classified (by 0-based index). status: ok | skipped | unavailable (no AI key). The host can
// re-tag anything — this only SUGGESTS.
export async function categorizeListingPhotos(
  photos: { data: string; mediaType: string }[],
  locale: 'ar' | 'en',
): Promise<{ status: string; items: PhotoCategoryItem[] }> {
  const session =
    getStoredSellerSession() ||
    getStoredStaffSession('HOST') ||
    getStoredStaffSession('SELLER') ||
    (await ensurePrototypeGuestSession())
  const response = await apiRequest<{ ok: true; status: string; items?: PhotoCategoryItem[] }>(
    '/api/host/listing-photo-categories',
    { method: 'POST', token: session.token, body: { photos, locale } },
  )
  return { status: response.status, items: response.items || [] }
}

export async function createSellerAccountSession(input: {
  displayName: string
  email: string
  password: string
  phone?: string
  sellerRole: string
  planCode: string
}) {
  const account = {
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    role: 'SELLER',
    phone: input.phone,
  }

  let session: PlatformAuthSession
  try {
    session = await register(account)
  } catch {
    session = await login(input.email, input.password)
  }

  const storedSession = {
    ...session,
    sellerRole: input.sellerRole,
    planCode: input.planCode,
  }
  authStorage.setItem(SELLER_SESSION_KEY, JSON.stringify(storedSession))
  return storedSession
}

// Email is now the real account identifier (was previously a synthetic guest-<phone>@sybnb.local
// address) — the guest-signup gate verifies email ownership via a real code before this call ever
// succeeds server-side (see sendEmailVerificationCode / verifyEmailVerificationCode below).
export async function createGuestAccountSession(input: {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  password: string
  referralCode?: string
}) {
  const displayName = [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || 'SYBNB Guest'
  const trimmedReferralCode = input.referralCode?.trim()
  const email = input.email?.trim() || ''
  const phone = input.phone?.trim() || ''
  const account = {
    email,
    password: input.password,
    displayName,
    role: 'GUEST',
    phone,
    ...(input.firstName?.trim() ? { firstName: input.firstName.trim() } : {}),
    ...(input.lastName?.trim() ? { lastName: input.lastName.trim() } : {}),
    ...(trimmedReferralCode ? { referralCode: trimmedReferralCode } : {}),
  }

  let session: PlatformAuthSession
  try {
    session = await register(account)
  } catch {
    // Already registered → sign in with whichever identifier the user verified (email or phone).
    session = email ? await login(email, input.password) : await loginByPhone(phone, input.password)
  }

  authStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
  authStorage.setItem(GUEST_SESSION_TOKEN_KEY, session.token)
  // App.tsx's needsGuestAccountGate check re-renders on this event. Without it, gated routes
  // whose returnPath equals the current path (e.g. /ride, /ride-preview, /dashboard) never
  // re-render after signup: the caller's `window.location.hash = returnPath` is a same-value
  // no-op, so no hashchange event fires either, leaving the account gate stuck on screen despite
  // a valid session now existing.
  window.dispatchEvent(new Event('sybnb-session-changed'))
  return session
}

// Upgrades the CURRENT anonymous device-guest session into a real named account WITHOUT losing the
// device's trip history — the server upgrades the same user row in place, so existing bookings and
// wallet entries carry over. Requires the device guest session token (proves device ownership) and
// a just-verified email OTP. After success the stored session becomes the named account.
export async function claimGuestAccount(input: { email: string; password: string; displayName?: string }) {
  const guest = await ensurePrototypeGuestSession()
  const session = await apiRequest<PlatformAuthSession>('/api/auth/claim-guest-account', {
    method: 'POST',
    token: guest.token,
    body: { email: input.email.trim(), password: input.password, displayName: input.displayName?.trim() || undefined },
  })
  authStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
  authStorage.setItem(GUEST_SESSION_TOKEN_KEY, session.token)
  window.dispatchEvent(new Event('sybnb-session-changed'))
  return session
}

// Real email OTP for the guest-signup gate. Chosen over SMS: no per-message carrier cost, no
// SMS-gateway account needed. devCode is only ever populated outside production (SMTP is rarely
// configured in local/dev environments) — never trust it as a UI-visible "success", it's a
// dev-only convenience so testing keeps working without a real mailbox.
export type EmailCodePurpose = 'guest-signup' | 'staff-login' | 'password-reset'

export async function sendEmailVerificationCode(email: string, purpose: EmailCodePurpose = 'guest-signup') {
  return apiRequest<{ ok: true; emailSent: boolean; emailError?: string; devCode?: string }>('/api/auth/email-code/send', {
    method: 'POST',
    body: { email, purpose },
  })
}

export async function verifyEmailVerificationCode(email: string, code: string, purpose: EmailCodePurpose = 'guest-signup') {
  return apiRequest<{ ok: true }>('/api/auth/email-code/verify', {
    method: 'POST',
    body: { email, code, purpose },
  })
}

// Real phone/SMS OTP — the alternative to the email code (same purpose values). devCode is only
// populated outside production (or until an SMS provider is configured); never treat it as delivery.
export async function sendPhoneVerificationCode(phone: string, purpose: EmailCodePurpose = 'guest-signup') {
  return apiRequest<{ ok: true; smsSent: boolean; smsError?: string; devCode?: string }>('/api/auth/phone-code/send', {
    method: 'POST',
    body: { phone, purpose },
  })
}

export async function verifyPhoneVerificationCode(phone: string, code: string, purpose: EmailCodePurpose = 'guest-signup') {
  return apiRequest<{ ok: true }>('/api/auth/phone-code/verify', {
    method: 'POST',
    body: { phone, code, purpose },
  })
}

// Real forgot-password flow. Caller must send + verify an email code with purpose='password-reset'
// (the two functions above) before this will succeed server-side.
export async function resetPasswordWithEmailCode(email: string, newPassword: string) {
  return apiRequest<{ ok: true }>('/api/auth/password-reset', {
    method: 'POST',
    body: { email, newPassword },
  })
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('Could not read the selected file.'))
    reader.onload = () => {
      const result = String(reader.result || '')
      // data:<mime>;base64,<data> — strip the prefix, the server only needs the encoded bytes.
      const commaIndex = result.indexOf(',')
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

// Previously this only ever sent the file's *name* to the server — the actual image was never
// uploaded, so nothing (human or automated) could ever review what was actually submitted. This
// now reads and sends the real file bytes.
export async function submitGuestIdDocument(file: File) {
  const session = await ensurePrototypeGuestSession()
  const fileBase64 = await readFileAsBase64(file)
  const response = await apiRequest<{
    ok: true
    user: { id: string; idDocumentRef: string; idDocumentSubmittedAt: string; idDocumentStatus: string }
  }>('/api/me/id-document', {
    method: 'PATCH',
    token: session.token,
    body: { fileBase64, mimeType: file.type },
  })
  return response.user
}

export function getStoredGuestSession(): PlatformAuthSession | null {
  try {
    const raw = authStorage.getItem(GUEST_SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as PlatformAuthSession
    if (!session?.token || !session?.user) return null
    return session
  } catch {
    return null
  }
}

// Best-effort real server-side logout (F-02): tells the server to bump this user's sessionVersion
// so the token being discarded here can't be replayed even if someone else has a copy of it. The
// local session is cleared regardless of whether this call succeeds -- a network failure here
// must never block the user from leaving their session, it just means server-side revocation
// happens a little late (or not at all, until the token's own 90-day expiry) for that one call.
function requestServerLogout(token: string | null) {
  if (!token) return
  void apiRequest<{ ok: true }>('/api/auth/logout', { method: 'POST', token }).catch(() => {})
}

export function clearGuestSession() {
  requestServerLogout(authStorage.getItem(GUEST_SESSION_TOKEN_KEY))
  authStorage.removeItem(GUEST_SESSION_KEY)
  authStorage.removeItem(GUEST_SESSION_TOKEN_KEY)
  window.dispatchEvent(new Event('sybnb-session-changed'))
}

export function getStoredStaffSession(requiredRole?: 'ADMIN' | 'HOST' | 'SELLER' | 'DRIVER'): PlatformAuthSession | null {
  try {
    const raw = authStorage.getItem(STAFF_SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as PlatformAuthSession
    if (!session?.token || !session?.user) return null
    if (requiredRole && !session.user.roles.includes(requiredRole)) return null
    return session
  } catch {
    return null
  }
}

export async function createStaffAccountSession(
  role: 'ADMIN' | 'HOST' | 'DRIVER',
  input?: {
    email?: string
    password?: string
    phone?: string
    mode?: 'signIn' | 'signUp'
  },
) {
  const fallbackAccount = staffPrototypeAccount(role)
  const email = input?.email?.trim() || ''
  const password = input?.password?.trim()
  const phone = input?.phone?.trim() || ''
  // Staff can sign in with a verified email OR phone (matching the backend). One identifier + password.
  if ((!email && !phone) || !password) {
    throw new Error('Email or phone, plus password, are required')
  }

  let session: AuthResponse
  if (input?.mode === 'signUp') {
    if (role === 'ADMIN') {
      throw new Error('Admin accounts are owner-created. Sign in with an existing admin account.')
    }
    session = await register({
      ...fallbackAccount,
      email,
      password,
      phone,
    })
  } else {
    session = email ? await login(email, password) : await loginByPhone(phone, password)
  }
  authStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session))
  authStorage.setItem(STAFF_SESSION_TOKEN_KEY, session.token)
  return session
}

export function clearStoredStaffSession() {
  requestServerLogout(authStorage.getItem(STAFF_SESSION_TOKEN_KEY))
  authStorage.removeItem(STAFF_SESSION_KEY)
  authStorage.removeItem(STAFF_SESSION_TOKEN_KEY)
}

export function getStoredSellerSession(): PlatformAuthSession | null {
  try {
    const raw = authStorage.getItem(SELLER_SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as PlatformAuthSession
    if (!session?.token || !session?.user) return null
    return session
  } catch {
    return null
  }
}

async function getHostDashboardSession(mode: HostDashboardMode) {
  if (mode === 'seller') {
    const sellerSession = getStoredSellerSession()
    if (sellerSession) return sellerSession
  }

  return ensurePrototypeHostSession()
}

export async function createAndApprovePrototypeListing(input: CreateListingInput) {
  const session = await ensurePrototypeHostSession()
  const created = await apiRequest<{ ok: true; listing: PlatformListing }>('/api/listings', {
    method: 'POST',
    token: session.token,
    body: {
      division: input.division || 'STAYS',
      ...input,
    },
  })

  await apiRequest<{ ok: true; listing: PlatformListing }>(`/api/listings/${created.listing.id}/submit`, {
    method: 'PATCH',
    token: session.token,
  })

  const approved = await reviewPrototypeQueueEntity('listings', created.listing.id, 'APPROVE')
  return approved as PlatformListing
}

export type ListingSearchFilters = {
  governorate?: string
  city?: string
  area?: string
  propertyType?: string
  roomType?: string
  bedType?: string
  category?: string
  condition?: string
  minPrice?: number
  maxPrice?: number
  bedrooms?: number
  bathrooms?: number
  amenities?: string[]
  checkIn?: string
  checkOut?: string
  sort?: 'priceAsc' | 'priceDesc' | 'newest'
  // CARS-only filters (Carcad Phase B) -- server/routes/listings.mjs reads these against
  // metadata.vehicle.* (falling back to flat metadata.*).
  make?: string
  model?: string
  minYear?: number
  maxYear?: number
  minMileageKm?: number
  maxMileageKm?: number
  transmission?: string
  fuelType?: string
  // Search radius (Carcad Phase F) -- all three must be provided together, server-validated.
  centerLat?: number
  centerLng?: number
  radiusKm?: number
}

export async function fetchApprovedListingsPage(division = 'STAYS', filters: ListingSearchFilters = {}, cursor?: string | null) {
  const params = new URLSearchParams({ division })
  if (cursor) params.set('cursor', cursor)
  if (filters.governorate) params.set('governorate', filters.governorate)
  if (filters.city) params.set('city', filters.city)
  if (filters.area) params.set('area', filters.area)
  if (filters.propertyType) params.set('propertyType', filters.propertyType)
  if (filters.roomType) params.set('roomType', filters.roomType)
  if (filters.bedType) params.set('bedType', filters.bedType)
  if (filters.category) params.set('category', filters.category)
  if (filters.condition) params.set('condition', filters.condition)
  if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice))
  if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice))
  if (filters.bedrooms !== undefined) params.set('bedrooms', String(filters.bedrooms))
  if (filters.bathrooms !== undefined) params.set('bathrooms', String(filters.bathrooms))
  if (filters.amenities?.length) params.set('amenities', filters.amenities.join(','))
  if (filters.checkIn) params.set('checkIn', filters.checkIn)
  if (filters.checkOut) params.set('checkOut', filters.checkOut)
  if (filters.sort) params.set('sort', filters.sort)
  if (filters.make) params.set('make', filters.make)
  if (filters.model) params.set('model', filters.model)
  if (filters.minYear !== undefined) params.set('minYear', String(filters.minYear))
  if (filters.maxYear !== undefined) params.set('maxYear', String(filters.maxYear))
  if (filters.minMileageKm !== undefined) params.set('minMileageKm', String(filters.minMileageKm))
  if (filters.maxMileageKm !== undefined) params.set('maxMileageKm', String(filters.maxMileageKm))
  if (filters.transmission) params.set('transmission', filters.transmission)
  if (filters.fuelType) params.set('fuelType', filters.fuelType)
  if (filters.centerLat !== undefined) params.set('centerLat', String(filters.centerLat))
  if (filters.centerLng !== undefined) params.set('centerLng', String(filters.centerLng))
  if (filters.radiusKm !== undefined) params.set('radiusKm', String(filters.radiusKm))
  try {
    const response = await apiRequest<{ ok: true; listings: PlatformListing[]; nextCursor: string | null }>(`/api/listings?${params.toString()}`)
    return { listings: response.listings, nextCursor: response.nextCursor ?? null }
  } catch {
    return { listings: fallbackApprovedListings(division), nextCursor: null }
  }
}

// Backward-compatible wrapper: first page as a plain array (division / marketplace / cars / rentals
// browse pages that don't paginate). The STR search page uses fetchApprovedListingsPage for "load more".
export async function fetchApprovedListings(division = 'STAYS', filters: ListingSearchFilters = {}) {
  const { listings } = await fetchApprovedListingsPage(division, filters)
  return listings
}

export type ListingAvailabilityEntry = {
  id: string
  listingId: string
  date: string
  status: 'BLOCKED' | 'AVAILABLE'
  priceOverrideMinor: number | null
  note: string | null
}

export async function fetchListingAvailability(listingId: string, from: string, to: string) {
  const params = new URLSearchParams({ from, to })
  try {
    return await apiRequest<{
      ok: true
      blockedDates: string[]
      priceOverrides: Array<{ date: string; priceMinor: number }>
      bookedRanges: Array<{ checkIn: string; checkOut: string }>
      offerNightsCount: number
      cheapestOfferMinor: number | null
    }>(`/api/listings/${listingId}/availability?${params.toString()}`)
  } catch {
    return { ok: true as const, blockedDates: [], priceOverrides: [], bookedRanges: [], offerNightsCount: 0, cheapestOfferMinor: null }
  }
}

export async function fetchListingQuote(listingId: string, checkIn: string, checkOut: string, currency?: 'USD') {
  const params = new URLSearchParams({ checkIn, checkOut, ...(currency ? { currency } : {}) })
  return apiRequest<{ ok: true; totalMinor: number; nights: number; perNight: Array<{ date: string; priceMinor: number }>; currency: string }>(
    `/api/listings/${listingId}/quote?${params.toString()}`,
  )
}

export type PlatformListingReview = {
  id: string
  listingId: string
  bookingId: string
  guestId: string
  rating: number
  comment: string | null
  hiddenAt?: string | null
  createdAt: string
  guest?: { id: string; displayName: string }
}

export async function submitPrototypeReview(input: { bookingId: string; rating: number; comment?: string }) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; review: PlatformListingReview }>('/api/reviews', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.review
}

export async function fetchListingReviews(listingId: string) {
  return apiRequest<{ ok: true; reviews: PlatformListingReview[]; average: number | null; count: number }>(
    `/api/listings/${listingId}/reviews`,
  )
}

export async function hideAdminReview(reviewId: string) {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; review: PlatformListingReview }>(`/api/admin/reviews/${reviewId}/hide`, {
    method: 'PATCH',
    token: session.token,
  })
  return response.review
}

// ── Admin account control: open any account, fix it, or suspend/reinstate/soft-delete it ──
export type AdminAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED'
export type PlatformAdminAccount = {
  id: string
  displayName: string
  email: string | null
  status: AdminAccountStatus
  createdAt: string
  idDocumentStatus: string | null
  isDemo: boolean
  roles: string[]
}
export type PlatformAdminAccountDetail = PlatformAdminAccount & {
  locale: string
  deletedAt: string | null
  hasIdDocument: boolean
  counts: { listings: number; bookings: number; paymentProofs: number }
  recentActivity: Array<{ action: string; createdAt: string; after: unknown }>
}

export async function adminSearchAccounts(section: string, status?: AdminAccountStatus | '', q?: string) {
  const session = await ensurePrototypeAdminSession()
  const params = new URLSearchParams({ section })
  if (status) params.set('status', status)
  if (q) params.set('q', q)
  const response = await apiRequest<{ ok: true; accounts: PlatformAdminAccount[] }>(
    `/api/admin/accounts?${params.toString()}`,
    { token: session.token },
  )
  return response.accounts
}

export async function adminGetAccount(id: string) {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; account: PlatformAdminAccountDetail }>(`/api/admin/accounts/${id}`, {
    token: session.token,
  })
  return response.account
}

export async function adminSetAccountStatus(id: string, status: AdminAccountStatus, reason?: string) {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; account: { id: string; status: AdminAccountStatus; deletedAt: string | null } }>(
    `/api/admin/accounts/${id}/status`,
    { method: 'PATCH', token: session.token, body: { status, reason } },
  )
  return response.account
}

export async function adminUpdateAccount(
  id: string,
  patch: { displayName?: string; locale?: string; email?: string; addRoles?: string[]; removeRoles?: string[] },
) {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; account: PlatformAdminAccount }>(`/api/admin/accounts/${id}`, {
    method: 'PATCH',
    token: session.token,
    body: patch,
  })
  return response.account
}

// ── Loyalty / standing (Phase 2): AI suggests a tier, an admin approves ──
export type StandingKind = 'HOST' | 'GUEST'
export type PlatformStandingSuggestion = {
  id: string
  userId: string
  kind: StandingKind
  currentTier: string
  suggestedTier: string
  reason: string
  stats: Record<string, unknown>
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  aiModel: string | null
  createdAt: string
  user?: { id: string; displayName: string; email: string | null }
}

export async function adminScanStanding(kind: StandingKind, limit = 25) {
  const session = await ensurePrototypeAdminSession()
  return apiRequest<{ ok: true; scanned: number; suggestionsCreated: number }>('/api/admin/standing/scan', {
    method: 'POST',
    token: session.token,
    body: { kind, limit },
  })
}

export async function adminListStandingSuggestions(status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING') {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; suggestions: PlatformStandingSuggestion[] }>(
    `/api/admin/standing/suggestions?status=${status}`,
    { token: session.token },
  )
  return response.suggestions
}

export async function adminDecideStandingSuggestion(id: string, decision: 'APPROVE' | 'REJECT') {
  const session = await ensurePrototypeAdminSession()
  const response = await apiRequest<{ ok: true; suggestion: PlatformStandingSuggestion }>(
    `/api/admin/standing/suggestions/${id}`,
    { method: 'PATCH', token: session.token, body: { decision } },
  )
  return response.suggestion
}

export type PlatformAdminHostInsight = PlatformHostInsight & {
  host?: { id: string; displayName: string; email: string | null }
  listing?: { id: string; titleAr: string; titleEn: string | null }
}

export async function fetchAdminHostInsights() {
  const session = await ensurePrototypeAdminSession()
  return apiRequest<{
    ok: true
    insights: PlatformAdminHostInsight[]
    totals: { generated: number; emailed: number; read: number }
  }>('/api/admin/host-insights', { token: session.token })
}

export type PlatformMessage = {
  id: string
  threadId: string
  senderUserId: string
  senderRole: 'GUEST' | 'HOST' | 'ADMIN' | 'SUPPORT'
  body: string
  createdAt: string
  sender?: { id: string; displayName: string }
}

export type PlatformMessageThread = {
  id: string
  bookingId: string
  messages: PlatformMessage[]
}

function resolveViewerSession(preferStaff = false) {
  const guest = getStoredGuestSession()
  const host = getStoredStaffSession('HOST')
  const seller = getStoredSellerSession()
  const admin = getStoredStaffSession('ADMIN')

  if (preferStaff) {
    if (host) return host
    if (admin) return admin
    if (seller) return seller
    if (guest) return guest
  } else {
    if (guest) return guest
    if (host) return host
    if (seller) return seller
    if (admin) return admin
  }

  throw new Error('Sign in before opening this conversation.')
}

export async function fetchBookingThread(bookingId: string, preferStaff = false) {
  const session = resolveViewerSession(preferStaff)
  const response = await apiRequest<{ ok: true; thread: PlatformMessageThread }>(`/api/bookings/${bookingId}/thread`, {
    token: session.token,
  })
  return response.thread
}

export async function sendBookingMessage(bookingId: string, body: string, preferStaff = false) {
  const session = resolveViewerSession(preferStaff)
  const response = await apiRequest<{ ok: true; message: PlatformMessage }>(`/api/bookings/${bookingId}/thread/messages`, {
    method: 'POST',
    token: session.token,
    body: { body },
  })
  return response.message
}

export type PlatformThreadDocument = {
  id: string
  mimeType: string
  originalFilename: string | null
  createdAt: string
  uploaderUserId: string
}

export type PlatformListingInquiryThread = {
  id: string
  listingId: string
  guestId: string
  messages: PlatformMessage[]
  documents: PlatformThreadDocument[]
}

export type PlatformHostInquiryThread = {
  id: string
  listingId: string | null
  guestId: string | null
  updatedAt: string
  listing: { id: string; titleAr: string; titleEn: string | null; division: string; priceMinor: number; currency: string } | null
  guest: { id: string; displayName: string; email: string | null } | null
  messages: PlatformMessage[]
  documents: PlatformThreadDocument[]
}

// Real, persistent "contact the owner" thread for RENTALS/BUY listings, reusing the same
// messages system built for STAYS bookings instead of writing to localStorage only.
export async function fetchListingInquiryThread(listingId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; thread: PlatformListingInquiryThread }>(`/api/listings/${listingId}/thread`, {
    token: session.token,
  })
  return response.thread
}

export async function sendListingInquiryMessage(listingId: string, body: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; message: PlatformMessage }>(`/api/listings/${listingId}/thread/messages`, {
    method: 'POST',
    token: session.token,
    body: { body },
  })
  return response.message
}

// Real per-thread document upload (Rentals/Buy renter/buyer request documents) -- replaces the
// previous behavior where only the filename was captured and pasted into a chat message.
export async function sendListingInquiryDocument(listingId: string, file: File) {
  const session = await ensurePrototypeGuestSession()
  const fileBase64 = await readFileAsBase64(file)
  const response = await apiRequest<{ ok: true; document: PlatformThreadDocument }>(`/api/listings/${listingId}/thread/documents`, {
    method: 'POST',
    token: session.token,
    body: { fileBase64, mimeType: file.type, originalFilename: file.name },
  })
  return response.document
}

// <img src> can't send an Authorization header, and these documents are private to the thread's
// two participants (plus staff), so the viewer fetches the bytes as an authenticated blob instead
// of linking to the endpoint directly -- same pattern as fetchIdDocumentBlobUrl.
export async function fetchThreadDocumentBlobUrl(listingId: string, documentId: string, mode?: HostDashboardMode) {
  const session = mode ? await getHostDashboardSession(mode) : await ensurePrototypeGuestSession()
  const response = await fetch(`${API_BASE_URL}/api/listings/${listingId}/thread/documents/${documentId}/file`, {
    headers: { authorization: `Bearer ${session.token}` },
  })
  if (!response.ok) throw new Error(`Could not load document: ${response.status}`)
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

// Owner-side inbox: every real inquiry thread across the owner's own listings.
export async function fetchHostInquiries(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; threads: PlatformHostInquiryThread[] }>('/api/host/inquiries', {
    token: session.token,
  })
  return response.threads
}

export async function fetchListingInquiryThreadAsOwner(listingId: string, guestId: string, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; thread: PlatformListingInquiryThread }>(
    `/api/listings/${listingId}/thread?guestId=${encodeURIComponent(guestId)}`,
    { token: session.token },
  )
  return response.thread
}

export async function sendListingInquiryMessageAsOwner(listingId: string, guestId: string, body: string, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; message: PlatformMessage }>(`/api/listings/${listingId}/thread/messages`, {
    method: 'POST',
    token: session.token,
    body: { body, guestId },
  })
  return response.message
}

export async function fetchHostListingAvailability(listingId: string, from: string, to: string, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const params = new URLSearchParams({ from, to })
  const response = await apiRequest<{ ok: true; availability: ListingAvailabilityEntry[] }>(
    `/api/host/listings/${listingId}/availability?${params.toString()}`,
    { token: session.token },
  )
  return response.availability
}

export async function updateHostListingAvailability(
  listingId: string,
  dates: Array<{ date: string; status: 'BLOCKED' | 'AVAILABLE'; priceOverrideMinor?: number | null }>,
  mode: HostDashboardMode = 'host',
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; availability: ListingAvailabilityEntry[] }>(
    `/api/host/listings/${listingId}/availability`,
    { method: 'PATCH', token: session.token, body: { dates } },
  )
  return response.availability
}

export type HostPayoutView = {
  type: 'sham_cash'
  accountHolder: string
  last4: string
  updatedAt: string | null
} | null

// Reads the host's Sham Cash payout account on file. The server only ever returns type +
// accountHolder + last4 — never the full number (which is encrypted at rest).
export async function fetchHostPayoutMethod(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; payout: HostPayoutView }>('/api/host/payout', {
    token: session.token,
  })
  return response.payout
}

// Saves/updates the host's Sham Cash payout account. The full number is sent once over the wire,
// encrypted server-side, and thereafter only its last 4 digits are readable.
export async function saveHostPayoutMethod(
  input: { accountHolder: string; shamCashNumber: string },
  mode: HostDashboardMode = 'host',
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; payout: HostPayoutView }>('/api/host/payout', {
    method: 'PUT',
    token: session.token,
    body: input,
  })
  return response.payout
}

export type ListingClaimCheck = {
  slotId: string
  amenityAr: string
  amenityEn: string
  verdict: 'yes' | 'no' | 'unclear' | 'missing'
  reason: string
}

export type ListingClaimInput = { slotId: string; labelAr: string; labelEn: string }

// Runs the AI truth-controller for a listing's claimed amenities. Advisory only — the host can
// still publish. Returns [] when AI is unconfigured/unavailable (fail-open).
export async function verifyListingClaims(
  listingId: string,
  claims: ListingClaimInput[],
  mode: HostDashboardMode = 'host',
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; checks: ListingClaimCheck[] }>(
    `/api/host/listings/${listingId}/verify-claims`,
    { method: 'POST', token: session.token, body: { claims } },
  )
  return response.checks
}

export async function fetchPrototypeListing(listingId: string) {
  try {
    const response = await apiRequest<{ ok: true; listing: PlatformListing; hostTier?: string | null; sellerVerified?: boolean }>(
      `/api/listings/${listingId}`,
    )
    // Surface the host's admin-approved loyalty tier (Phase 2) on the listing so the detail page can
    // show a guest-facing trust badge.
    return { ...response.listing, hostTier: response.hostTier ?? null }
  } catch (error) {
    const fallbackListing = FALLBACK_APPROVED_LISTINGS.find((listing) => listing.id === listingId)
    if (fallbackListing) return fallbackListing
    throw error
  }
}

export async function submitPrototypeLocalWalletProof(input: {
  bookingId?: string
  amountMinor: number
  currency: string
  proofAssetUrl?: string
  providerRef: string
}) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; proof: PlatformPaymentProof }>('/api/payments/local-wallet-proof', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.proof
}

export async function fetchStripePaymentStatus() {
  const response = await apiRequest<{ ok: true; configured: boolean; currency: string }>('/api/payments/stripe/status')
  return response
}

export async function createStripeCheckoutSession(bookingId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; url: string; sessionId: string }>('/api/payments/stripe/create-checkout-session', {
    method: 'POST',
    token: session.token,
    body: { bookingId, origin: window.location.origin },
  })
  return response
}

export async function confirmStripePayment(sessionId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; proof: PlatformPaymentProof }>('/api/payments/stripe/confirm', {
    method: 'POST',
    token: session.token,
    body: { sessionId },
  })
  return response.proof
}

// STR host listing-plan CARD checkout (host pays the plan fee mid-wizard). Uses the host/seller
// session so the charge ties to the host's own account; the server prices the plan by code (S6).
export async function createStrPlanCheckoutSession(planCode: string) {
  const session =
    getStoredSellerSession() ||
    getStoredStaffSession('HOST') ||
    getStoredStaffSession('SELLER') ||
    (await ensurePrototypeGuestSession())
  const response = await apiRequest<{ ok: true; url: string; sessionId: string }>(
    '/api/payments/stripe/create-str-plan-checkout-session',
    { method: 'POST', token: session.token, body: { planCode, origin: window.location.origin } },
  )
  return response
}

export async function confirmStrPlanPayment(sessionId: string) {
  const session =
    getStoredSellerSession() ||
    getStoredStaffSession('HOST') ||
    getStoredStaffSession('SELLER') ||
    (await ensurePrototypeGuestSession())
  const response = await apiRequest<{ ok: true; proof: PlatformPaymentProof; planCode: string }>(
    '/api/payments/stripe/confirm-str-plan',
    { method: 'POST', token: session.token, body: { sessionId } },
  )
  return { proof: response.proof, planCode: response.planCode }
}

// Ask the server whether this host already has an UNCONSUMED paid listing plan (a captured plan fee
// that no listing has used yet). The wizard calls this on load so a page refresh — or continuing on a
// different device — recognizes an already-paid plan instead of charging again. Returns the exact plan
// code the host paid for, so it can't be silently upgraded.
export async function fetchStrPlanStatus() {
  const session =
    getStoredSellerSession() ||
    getStoredStaffSession('HOST') ||
    getStoredStaffSession('SELLER') ||
    (await ensurePrototypeGuestSession())
  const response = await apiRequest<{ hasPaidPlan: boolean; paidPlanCode: string | null }>(
    '/api/host/str-plan-status',
    { method: 'GET', token: session.token },
  )
  return { hasPaidPlan: response.hasPaidPlan, paidPlanCode: response.paidPlanCode }
}

// Sham Cash host-plan payment: submit the transfer receipt (real file, stored server-side) + the
// transaction reference. Creates a PENDING proof the admin verifies before approving. Card doesn't use
// this — Stripe auto-verifies the charge.
export async function submitStrPlanShamProof(input: {
  planCode: string
  providerRef: string
  file: File
}) {
  const session =
    getStoredSellerSession() ||
    getStoredStaffSession('HOST') ||
    getStoredStaffSession('SELLER') ||
    (await ensurePrototypeGuestSession())
  const fileBase64 = await readFileAsBase64(input.file)
  const response = await apiRequest<{ ok: true; proof: PlatformPaymentProof }>(
    '/api/payments/str-plan-sham-proof',
    {
      method: 'POST',
      token: session.token,
      body: { planCode: input.planCode, providerRef: input.providerRef, fileBase64, mimeType: input.file.type },
    },
  )
  return response.proof
}

export async function fetchPrototypePaymentProof(proofId: string) {
  const localProof = getLocalFallbackPaymentProof(proofId)
  if (localProof) return localProof

  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; proof: PlatformPaymentProof }>(`/api/payments/${proofId}`, {
    token: session.token,
  })
  return response.proof
}

export function createLocalFallbackPaymentProof(input: {
  bookingId: string
  provider: string
  amountMinor: number
  currency: string
  providerRef: string
  proofAssetUrl?: string | null
}) {
  const booking = getLocalFallbackBooking(input.bookingId)
  if (!booking && !input.bookingId.startsWith('fallback-booking-')) throw new Error('Fallback booking not found')

  const now = new Date().toISOString()
  const autoApprovedLocalProvider = input.provider === 'stripe_test' || input.provider === 'syrian_local_wallet'
  const proof: PlatformPaymentProof = {
    id: `fallback-payment-${Date.now()}`,
    bookingId: input.bookingId,
    userId: booking?.guestId || 'prototype-checkout-guest',
    provider: input.provider,
    status: autoApprovedLocalProvider ? 'APPROVED' : 'PENDING_ADMIN_REVIEW',
    amountMinor: input.amountMinor,
    currency: input.currency,
    proofAssetUrl: input.proofAssetUrl || null,
    providerRef: input.providerRef,
    adminNote: autoApprovedLocalProvider ? 'local_payment_approved' : null,
    reviewedById: autoApprovedLocalProvider ? 'local-payment-test' : null,
    reviewedAt: autoApprovedLocalProvider ? now : null,
    user: booking?.guest
      ? { id: booking.guest.id, displayName: booking.guest.displayName, email: booking.guest.email || null }
      : { id: 'prototype-checkout-guest', displayName: 'SYBNB Demo Guest', email: null },
    booking: booking || undefined,
  }

  const proofs = readLocalFallbackPaymentProofs()
  proofs[proof.id] = proof
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(LOCAL_FALLBACK_PAYMENT_PROOFS_KEY, JSON.stringify(proofs))
  }
  return proof
}

function getLocalFallbackPaymentProof(proofId: string) {
  return readLocalFallbackPaymentProofs()[proofId] || null
}

function readLocalFallbackPaymentProofs(): Record<string, PlatformPaymentProof> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(LOCAL_FALLBACK_PAYMENT_PROOFS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export async function reviewPrototypePaymentProof(
  proofId: string,
  decision: 'APPROVE' | 'REJECT',
  adminNote?: string,
  shamCashReconciliation?: {
    accountMinor: number | null
    expectedMinor: number
    differenceMinor: number
    source?: string
  },
) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; entity: PlatformPaymentProof }>(
    `/api/admin/review-queue/payments/${proofId}`,
    {
      method: 'PATCH',
      token,
      body: { decision, adminNote, shamCashReconciliation },
    },
  ))
  return response.entity
}

export async function fetchPrototypeReviewQueue() {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; queue: PlatformReviewQueue }>('/api/admin/review-queue', {
    token,
  }))
  return response.queue
}

export async function fetchPrototypeAdminAuditLog(limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) })
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; auditLog: PlatformAdminAuditLog[] }>(
    `/api/admin/audit-log?${params.toString()}`,
    {
      token,
    },
  ))
  return response.auditLog
}

export async function fetchPrototypeAdminMetrics() {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; metrics: PlatformAdminMetrics }>('/api/admin/platform-metrics', {
    token,
  }))
  return response.metrics
}

export type OfficeDashboardSecurityEvent = {
  id: string
  action: string
  entityType: string
  createdAt: string
  after: unknown
  actor: { displayName: string | null; email: string | null } | null
}

export type OfficeDashboard = {
  generatedAt: string
  security: {
    activeLocks: number
    lockouts24h: number
    recentEvents: OfficeDashboardSecurityEvent[]
  }
  bookings: {
    total: number
    byStatus: Record<string, number>
    checkInsToday: number
    upcoming7d: number
    cancellations7d: number
  }
  revenue: {
    currency: string
    grossApprovedMinor: number
    approvedCount: number
    refunded7dMinor: number
    refunded7dCount: number
  }
  pending: {
    listingsAwaitingReview: number
    openDisputes: number
    payoutsReady: number
    idChecksPending: number
  }
}

// The office-tablet snapshot. ADMIN/SUPPORT-gated server-side. Safe to poll on an interval (all
// bounded aggregate queries) and to bake into a downloaded offline HTML file.
export async function fetchOfficeDashboard() {
  return runAdminRequest((token) =>
    apiRequest<{ ok: true } & OfficeDashboard>('/api/admin/office-dashboard', { token }),
  )
}

export type SrDispatchRide = {
  id: string
  status: string
  requestedAt: string
  pickup: { lat: number; lng: number }
  riderName: string | null
  driverName: string | null
}
export type SrDispatchDriver = {
  driverId: string
  driverName: string | null
  location: { lat: number; lng: number }
  lastLocationAt: string
  busy: boolean
}
export type SrDispatchBoard = {
  generatedAt: string
  counts: { activeRides: number; waitingRides: number; onlineDrivers: number; busyDrivers: number }
  rides: SrDispatchRide[]
  drivers: SrDispatchDriver[]
}

// SR live-ops dispatch board — active rides + online drivers with coordinates, for the admin map.
export async function fetchSrDispatch() {
  return runAdminRequest((token) => apiRequest<{ ok: true } & SrDispatchBoard>('/api/admin/sr/dispatch', { token }))
}

// Admin force-cancel a stuck SR ride (releases the rider's reserved funds). ADMIN only.
export async function adminCancelSrRide(rideId: string, reason?: string) {
  return runAdminRequest((token) =>
    apiRequest<{ ok: true; ride: { id: string; status: string } }>(`/api/admin/sr/rides/${rideId}/cancel`, {
      method: 'POST',
      token,
      body: reason ? { reason } : {},
    }),
  )
}

export type PlatformRevenueByCurrency = {
  currency: string
  totalRevenueMinor: number
  sampleSize: number
  history: Array<{ day: string; amountMinor: number }>
  projection: {
    elapsedDays: number
    dailyAverageMinor: number
    next30DaysMinor: number
    next90DaysMinor: number
  }
}

export type PlatformRevenueSummary = {
  // Seller-plan fees and booking commission are collected in different currencies (USD vs SYP by
  // default) — kept as separate per-currency totals rather than summed together, since adding
  // different currencies' minor units as one number would silently misreport the total.
  byCurrency: PlatformRevenueByCurrency[]
  srRidesCompletedCount: number
  srRidesFareVolumeMinor: number
}

export async function fetchAdminRevenueSummary() {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; revenue: PlatformRevenueSummary }>('/api/admin/revenue-summary', {
    token,
  }))
  return response.revenue
}

export type AdminPayout = {
  bookingId: string
  listingTitle: string | null
  hostId: string | null
  hostName: string | null
  hostPayoutMethod: { type: 'sham_cash'; accountHolder: string; last4: string } | null
  checkOut: string | null
  eligibleAt: string | null
  eligibleNow: boolean
  hostPayoutMinor: number
  currency: string
}

export type PlatformStaffMember = {
  id: string
  displayName: string
  email: string | null
  createdAt: string
  roles: string[]
}

// HR directory — users holding a back-office (ADMIN/SUPPORT) role.
export async function fetchAdminStaff() {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; staff: PlatformStaffMember[] }>('/api/admin/staff', { token }),
  )
  return response.staff
}

// Creates a staff/admin account (ADMIN-gated server-side; @sybnb.app enforced). Does NOT create a
// mailbox — that is done separately in Google Workspace.
export async function createAdminStaff(input: { displayName: string; email: string; role: string }) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; staff: PlatformStaffMember }>('/api/admin/staff', {
      method: 'POST',
      token,
      body: input,
    }),
  )
  return response.staff
}

export async function fetchAdminPayouts() {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; payouts: AdminPayout[]; holdDays: number }>('/api/admin/payouts', {
    token,
  }))
  return response
}

export async function releaseAdminPayout(bookingId: string) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; walletEntry: Record<string, unknown> }>(
    `/api/admin/payouts/${bookingId}/release`,
    { method: 'PATCH', token },
  ))
  return response.walletEntry
}

// ---- Admin remediation controls (all ADMIN-gated server-side, all audit-logged) ----
export type AdminDirectoryUser = {
  id: string
  displayName: string
  email: string | null
  status: string
  idDocumentStatus: string | null
  createdAt: string
  roles: string[]
}

export type AdminBookingRow = {
  id: string
  status: string
  amountMinor: number
  currency: string
  checkIn: string | null
  checkOut: string | null
  createdAt: string
  listing: { id: string; titleAr: string; titleEn: string | null; ownerId: string } | null
  guest: { id: string; displayName: string; email: string | null } | null
}

export type AdminNeedsAttention = {
  thresholds: { stuckPaymentHours: number; agingHours: number }
  counts: {
    stuckPayments: number
    noPayoutMethodHosts: number
    imbalancedWallets: number
    agingReviewListings: number
    agingDisputes: number
    agingSos: number
  }
  total: number
  items: {
    stuckBookings: Array<{ id: string; createdAt: string; currency: string; amountMinor: number; listing: { titleAr: string; ownerId: string } | null }>
    noPayoutMethodHosts: Array<{ userId: string; displayName: string; currency: string; cachedBalanceMinor: number }>
    imbalancedWallets: Array<{ walletId: string; userId: string | null; currency: string; cachedBalanceMinor: number; computedBalanceMinor: number }>
  }
}

// A1: suspend / reinstate / close ANY user (bumps sessionVersion → instant logout).
export async function setAdminUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED', reason?: string) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; user: { id: string; status: string; displayName: string } }>(`/api/admin/users/${userId}/status`, {
      method: 'POST',
      token,
      body: { status, reason },
    }),
  )
  return response.user
}

// A4: user directory / search (all roles).
export async function fetchAdminUsers(params: { search?: string; role?: string; status?: string; page?: number } = {}) {
  const q = new URLSearchParams()
  if (params.search) q.set('search', params.search)
  if (params.role) q.set('role', params.role)
  if (params.status) q.set('status', params.status)
  if (params.page) q.set('page', String(params.page))
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; users: AdminDirectoryUser[]; page: number; pages: number; total: number }>(
      `/api/admin/users?${q.toString()}`,
      { token },
    ),
  )
  return response
}

// A2: take down / pause / restore a listing.
export async function setAdminListingStatus(listingId: string, status: 'APPROVED' | 'PAUSED' | 'REJECTED' | 'EXPIRED', reason?: string) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; listing: { id: string; status: string } }>(`/api/admin/listings/${listingId}/status`, {
      method: 'POST',
      token,
      body: { status, reason },
    }),
  )
  return response.listing
}

// A3: force-cancel + refund a booking.
export async function forceCancelBooking(bookingId: string, reason?: string) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; booking: Record<string, unknown> }>(`/api/admin/bookings/${bookingId}/cancel`, {
      method: 'POST',
      token,
      body: { reason },
    }),
  )
  return response.booking
}

// Manual payout hold — persists on the booking and is ENFORCED by the release endpoint (a held payout
// can't be released). `held: false` removes the hold.
export async function holdBookingPayout(bookingId: string, held: boolean) {
  return runAdminRequest((token) =>
    apiRequest<{ ok: true; bookingId: string; payoutHeld: boolean }>(`/api/admin/bookings/${bookingId}/payout-hold`, {
      method: 'POST',
      token,
      body: { held },
    }),
  )
}

// Admin note into a booking's message thread — the guest + host see it in that booking's inbox.
export async function sendAdminBookingMessage(bookingId: string, target: 'guest' | 'host', body: string) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; message: Record<string, unknown> }>(`/api/admin/bookings/${bookingId}/message`, {
      method: 'POST',
      token,
      body: { target, body },
    }),
  )
  return response.message
}

// A4: booking directory / search.
export async function fetchAdminBookings(params: { status?: string; hostId?: string; guestId?: string; page?: number } = {}) {
  const q = new URLSearchParams()
  if (params.status) q.set('status', params.status)
  if (params.hostId) q.set('hostId', params.hostId)
  if (params.guestId) q.set('guestId', params.guestId)
  if (params.page) q.set('page', String(params.page))
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; bookings: AdminBookingRow[]; page: number; pages: number; total: number }>(
      `/api/admin/bookings?${q.toString()}`,
      { token },
    ),
  )
  return response
}

// B: needs-attention board (read-only).
export async function fetchAdminNeedsAttention() {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true } & AdminNeedsAttention>('/api/admin/needs-attention', { token }),
  )
  return response
}

export async function reviewPrototypeQueueEntity(
  entityType: 'listings' | 'payments' | 'gifts' | 'bookings' | 'iddocuments',
  entityId: string,
  decision: 'APPROVE' | 'REJECT',
  adminNote?: string,
) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; entity: unknown }>(
    `/api/admin/review-queue/${entityType}/${entityId}`,
    {
      method: 'PATCH',
      token,
      body: { decision, adminNote },
    },
  ))
  return response.entity
}

// <img src> can't send an Authorization header, and this file is admin/support-only, so the
// review UI fetches it as an authenticated blob instead of linking to the endpoint directly.
// Admin-only: load a Sham Cash plan-payment receipt as a blob URL for inline review (the file endpoint
// is token-authed, so a plain <a href> can't reach it — fetch with the admin token, then objectURL it).
export async function fetchStrPlanProofBlobUrl(proofId: string) {
  const session = await ensurePrototypeAdminSession()
  const response = await fetch(`${API_BASE_URL}/api/payments/str-plan-sham-proof/${proofId}/file`, {
    headers: { authorization: `Bearer ${session.token}` },
  })
  if (!response.ok) throw new Error(`Could not load payment receipt: ${response.status}`)
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export async function fetchIdDocumentBlobUrl(userId: string) {
  const session = await ensurePrototypeAdminSession()
  const response = await fetch(`${API_BASE_URL}/api/admin/id-document/${userId}/file`, {
    headers: { authorization: `Bearer ${session.token}` },
  })
  if (!response.ok) throw new Error(`Could not load ID document: ${response.status}`)
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

async function runAdminRequest<T>(request: (token: string) => Promise<T>) {
  const session = await ensurePrototypeAdminSession()

  try {
    return await request(session.token)
  } catch (error) {
    if (!isAuthApiError(error)) throw error

    clearStoredStaffSession()
    throw error
  }
}

// Supports the WhatsApp/email ID-submission channel: an admin who received a document outside
// the platform looks the customer up by their account email, then attaches the file for them.
export async function lookupAdminUserByEmail(email: string) {
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; user: PlatformIdDocumentReview }>(
    `/api/admin/users/lookup?email=${encodeURIComponent(email)}`,
    { token },
  ))
  return response.user
}

export async function uploadIdDocumentForUser(userId: string, file: File) {
  const fileBase64 = await readFileAsBase64(file)
  const response = await runAdminRequest((token) => apiRequest<{ ok: true; user: PlatformIdDocumentReview }>(
    `/api/admin/id-document/${userId}/upload`,
    { method: 'PATCH', token, body: { fileBase64, mimeType: file.type } },
  ))
  return response.user
}

export type PlatformSrQuote = {
  fareMinor: number
  currency: string
  distanceKm: number
  estimated: boolean
  pickupCoords: { lat: number; lng: number } | null
  dropoffCoords: { lat: number; lng: number } | null
}

export async function fetchSrQuote(input: {
  pickup: string
  dropoff: string
  category: string
  currency: string
  lowDataMode: boolean
  pickupCoords?: { lat: number; lng: number }
}) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; quote: PlatformSrQuote }>('/api/sr/quote', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.quote
}

export type PlatformSrRoute = {
  distanceKm: number | null
  durationMin: number | null
  geometry: Array<[number, number]> | null // OSRM GeoJSON coords: [lng, lat][]
  source: 'osrm' | 'haversine' | 'haversine-fallback'
}

// Real road route + ETA for the trip map (OSRM when configured, straight-line fallback otherwise).
export async function fetchSrRoute(input: { pickupCoords: { lat: number; lng: number }; dropoffCoords: { lat: number; lng: number } }) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; route: PlatformSrRoute }>('/api/sr/route', {
    method: 'POST',
    token: session.token,
    body: { pickupCoords: input.pickupCoords, dropoffCoords: input.dropoffCoords },
  })
  return response.route
}

// The driver's live location for a ride (for the moving marker on the trip map). null until the driver
// starts sharing. Only the rider/driver/admin on the ride may read it (server-enforced).
export async function fetchSrRideLocation(rideId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; status: string; location: { lat: number; lng: number; at: string } | null }>(
    `/api/sr/rides/${rideId}/location`,
    { token: session.token },
  )
  return response
}

export type SrRideDriverCard = {
  firstName: string | null
  rating: { average: number | null; count: number }
  vehicle: { make: string; model: string; year: number; plate: string; color: string | null } | null
}

// A PII-safe view of the assigned driver for the rider: first name, car, and reputation — never the
// driver's email/phone. Returns null while the ride is still unassigned.
export async function fetchSrRideDriver(rideId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; driver: SrRideDriverCard | null }>(
    `/api/sr/rides/${rideId}/driver`,
    { token: session.token },
  )
  return response.driver
}

export async function createPrototypeSrRide(input: {
  pickup: string
  dropoff: string
  category: string
  currency: string
  lowDataMode: boolean
  accuracyMeters?: number
  pickupCoords?: { lat: number; lng: number }
}) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; ride: PlatformRideRequest }>('/api/sr/rides', {
    method: 'POST',
    token: session.token,
    body: {
      pickup: input.pickup,
      dropoff: input.dropoff,
      category: input.category,
      currency: input.currency,
      lowDataMode: input.lowDataMode,
      pickupCoords: input.pickupCoords,
      metadata: {
        accuracyMeters: input.accuracyMeters,
        locationSource: input.accuracyMeters ? 'gps' : 'manual',
      },
    },
  })
  return response.ride
}

// ---- Rider in-ride actions (all scoped to the ride's rider/driver server-side) ----

export async function cancelSrRide(rideId: string) {
  const session = await ensurePrototypeGuestSession()
  return apiRequest<{ ok: true; ride: PlatformRideRequest }>(`/api/sr/rides/${rideId}/cancel`, { method: 'POST', token: session.token })
}

// Emergency SOS on an active ride — best-effort attaches the rider's GPS.
export async function raiseSrSos(rideId: string, coords?: { lat: number; lng: number }, note?: string) {
  const session = await ensurePrototypeGuestSession()
  const body: Record<string, unknown> = {}
  if (coords) {
    body.lat = coords.lat
    body.lng = coords.lng
  }
  if (note) body.note = note
  return apiRequest<{ ok: true; sosEvent: { id: string; status: string } }>(`/api/sr/rides/${rideId}/sos`, { method: 'POST', token: session.token, body })
}

// Share the live trip — returns a token + a public tracking path a rider can send to a trusted contact.
// The link stops leaking live location once the ride ends and expires after `expiresInHours`.
export async function shareSrRide(rideId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; share: { token: string; path: string; apiPath: string; expiresInHours?: number } }>(
    `/api/sr/rides/${rideId}/share`,
    { method: 'POST', token: session.token },
  )
  return response.share
}

// Revoke a previously-shared trip link — every outstanding copy stops resolving immediately.
export async function revokeSrShare(rideId: string) {
  const session = await ensurePrototypeGuestSession()
  await apiRequest<{ ok: true; revoked: true }>(`/api/sr/rides/${rideId}/share`, { method: 'DELETE', token: session.token })
}

export async function rateSrRide(rideId: string, stars: number, comment?: string) {
  const session = await ensurePrototypeGuestSession()
  return apiRequest<{ ok: true }>(`/api/sr/rides/${rideId}/rate`, {
    method: 'POST',
    token: session.token,
    body: comment ? { stars, comment } : { stars },
  })
}

export async function tipSrRide(rideId: string, amountMinor: number) {
  const session = await ensurePrototypeGuestSession()
  return apiRequest<{ ok: true }>(`/api/sr/rides/${rideId}/tip`, { method: 'POST', token: session.token, body: { amountMinor } })
}

// The authenticated rider's own SR trips, most recent first (Trips list + receipts).
export async function fetchSrRideHistory() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; rides: PlatformRideRequest[] }>('/api/sr/rides', { token: session.token })
  return response.rides
}

export async function fetchPrototypeSrRide(rideId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; ride: PlatformRideRequest }>(`/api/sr/rides/${rideId}`, {
    token: session.token,
  })
  return response.ride
}

export async function fetchPrototypeDriverOverview() {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; overview: PlatformDriverOverview }>('/api/driver/rides', {
    token: session.token,
  })
  return response.overview
}

export async function fetchPendingSrRides() {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; online?: boolean; rides: PlatformRideRequest[] }>('/api/driver/rides/pending', {
    token: session.token,
  })
  // The pool is now online-gated + nearest-first. `online` tells the dashboard whether the driver is
  // receiving offers; older responses without the field are treated as online for back-compat.
  return { online: response.online ?? true, rides: response.rides }
}

// SR driver presence (Phase 1): go online/offline. `lat`/`lng` (from the browser's GPS) pin the driver's
// position so they immediately appear in nearby riders' nearest-first pool.
export async function setDriverAvailability(input: { online: boolean; lat?: number; lng?: number }) {
  const session = await ensurePrototypeDriverSession()
  const body: Record<string, unknown> = { online: input.online }
  if (input.lat != null && input.lng != null) {
    body.lat = input.lat
    body.lng = input.lng
  }
  return apiRequest<{ ok: true; online: boolean; location: { lat: number; lng: number } | null }>(
    '/api/driver/availability',
    { method: 'PATCH', token: session.token, body },
  )
}

// Idle GPS heartbeat while online (rejected 409 DRIVER_OFFLINE when offline).
export async function postDriverLocation(input: { lat: number; lng: number }) {
  const session = await ensurePrototypeDriverSession()
  return apiRequest<{ ok: true; location: { lat: number; lng: number; at: string } }>('/api/driver/location', {
    method: 'POST',
    token: session.token,
    body: { lat: input.lat, lng: input.lng },
  })
}

export async function claimPrototypeSrRide(rideId: string) {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; ride: PlatformRideRequest }>(`/api/sr/rides/${rideId}/claim`, {
    method: 'PATCH',
    token: session.token,
  })
  return response.ride
}

// Decline a ride currently offered exclusively to this driver → it re-dispatches to the next nearest.
export async function declinePrototypeSrRide(rideId: string) {
  const session = await ensurePrototypeDriverSession()
  return apiRequest<{ ok: true; reoffered: boolean }>(`/api/sr/rides/${rideId}/decline`, {
    method: 'PATCH',
    token: session.token,
  })
}

export async function updatePrototypeDriverRideStatus(
  rideId: string,
  status: 'DRIVER_ARRIVING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED',
) {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; ride: PlatformRideRequest }>(
    `/api/driver/rides/${rideId}/status`,
    {
      method: 'PATCH',
      token: session.token,
      body: { status },
    },
  )
  return response.ride
}

// SR pickup PIN (017): the driver submits the 4-digit code the rider reads out; the server sets
// pickupVerifiedAt on success, which unlocks starting the trip (IN_PROGRESS).
export async function verifyDriverPickupPin(rideId: string, pin: string) {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; verified: boolean }>(`/api/sr/rides/${rideId}/verify-pin`, {
    method: 'POST',
    token: session.token,
    body: { pin },
  })
  return response.verified
}

// SR fleet (020): driver vehicle records, age-gated per tier server-side.
export async function createDriverVehicle(input: {
  make: string
  model: string
  year: number
  plate: string
  color?: string
  category: string
}) {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; vehicle: PlatformDriverVehicle }>('/api/driver/vehicles', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.vehicle
}

export async function fetchDriverVehicles() {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; vehicles: PlatformDriverVehicle[] }>('/api/driver/vehicles', {
    token: session.token,
  })
  return response.vehicles
}

export type PlatformDriverDocument = {
  id: string
  type: 'LICENSE' | 'VEHICLE_REGISTRATION' | 'INSURANCE'
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  createdAt: string
}

// Driver documents (licence / vehicle registration / insurance) with review status — used to reflect the
// driver's road-ready readiness on the dashboard.
export async function fetchDriverDocuments() {
  const session = await ensurePrototypeDriverSession()
  const response = await apiRequest<{ ok: true; documents: PlatformDriverDocument[] }>('/api/driver/documents', {
    token: session.token,
  })
  return response.documents
}

// ---- STR guest cancellation (bookings.mjs) ----
// Returns the CANCELLED booking. The fee/refund breakdown is audit-logged server-side, not returned here,
// so the UI derives the outcome from the booking policy (free window / protection / flat fee).
export async function cancelBooking(bookingId: string, note?: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; booking: PlatformBooking }>(`/api/bookings/${bookingId}/cancel`, {
    method: 'PATCH',
    token: session.token,
    body: note ? { note } : {},
  })
  return response.booking
}

// ---- Consumer-protection disputes (disputes.mjs) ----
export type PlatformDispute = {
  id: string
  subjectType: 'SR_RIDE' | 'STR_BOOKING'
  rideId: string | null
  bookingId: string | null
  openedByUserId: string
  reason: string
  status: 'OPEN' | 'RESOLVED_REFUNDED' | 'RESOLVED_REJECTED'
  refundMinor: number | null
  currency: string | null
  resolutionNote: string | null
  resolvedAt: string | null
  createdAt: string
  openedBy?: { id: string; displayName: string }
}

// Customer opens a dispute on a completed ride OR booking they own (exactly one subject id).
export async function openDispute(input: { rideId?: string; bookingId?: string; reason: string }) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; dispute: PlatformDispute }>('/api/disputes', {
    method: 'POST',
    token: session.token,
    body: { rideId: input.rideId, bookingId: input.bookingId, reason: input.reason },
  })
  return response.dispute
}

export async function fetchMyDisputes() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; disputes: PlatformDispute[] }>('/api/disputes', {
    token: session.token,
  })
  return response.disputes
}

export async function fetchAdminDisputes() {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; disputes: PlatformDispute[] }>('/api/admin/disputes', { token }),
  )
  return response.disputes
}

export async function resolveDispute(id: string, input: { decision: 'REFUND' | 'REJECT'; note?: string; refundMinor?: number }) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; dispute: PlatformDispute }>(`/api/admin/disputes/${id}`, {
      method: 'PATCH',
      token,
      body: { decision: input.decision, note: input.note, refundMinor: input.refundMinor },
    }),
  )
  return response.dispute
}

// Per-country config (public) — used to show the exact flat cancellation fee in the confirm dialog.
export type PlatformCountryConfig = {
  code: string
  currency: string
  strLateCancelFee?: { feeMinor: number; feeMinorUsd: number }
  disputeWindowHours?: number
}
export async function fetchCountryConfig(code = 'SY') {
  const response = await apiRequest<{ ok: true; country: PlatformCountryConfig }>(`/api/config/country/${code}`)
  return response.country
}

// ---- Store-compliance: account deletion, report content, block users (Phase 2 store-readiness) ----

// DELETE /api/me — in-app account deletion. Throws with the backend code (WALLET_NOT_EMPTY /
// ACCOUNT_HAS_ACTIVE_OBLIGATIONS) so the UI can show a clear message. On success the caller signs out.
export async function deleteMyAccount() {
  const session = await ensurePrototypeGuestSession()
  await apiRequest<{ ok: true; account: { status: string; deleted: boolean } }>('/api/me', {
    method: 'DELETE',
    token: session.token,
  })
  clearGuestSession()
}

export type PlatformUserBlock = {
  id: string
  blockerUserId: string
  blockedUserId: string
  createdAt: string
}

export async function blockUser(userId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; block: PlatformUserBlock }>('/api/me/blocks', {
    method: 'POST',
    token: session.token,
    body: { userId },
  })
  return response.block
}

export async function fetchMyBlocks() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; blocks: PlatformUserBlock[] }>('/api/me/blocks', {
    token: session.token,
  })
  return response.blocks
}

export async function unblockUser(userId: string) {
  const session = await ensurePrototypeGuestSession()
  await apiRequest<{ ok: true; unblocked: string }>(`/api/me/blocks/${userId}`, {
    method: 'DELETE',
    token: session.token,
  })
}

export type ReportSubjectType = 'LISTING' | 'REVIEW' | 'SELLER' | 'USER' | 'RIDE' | 'BOOKING'
export type PlatformReport = {
  id: string
  reporterUserId: string
  subjectType: ReportSubjectType
  subjectId: string
  reason: string
  note: string | null
  status: 'OPEN' | 'REVIEWED' | 'ACTIONED' | 'DISMISSED'
  resolutionNote: string | null
  resolvedAt: string | null
  createdAt: string
}

export async function reportContent(input: { subjectType: ReportSubjectType; subjectId: string; reason: string; note?: string }) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; report: PlatformReport }>('/api/reports', {
    method: 'POST',
    token: session.token,
    body: { subjectType: input.subjectType, subjectId: input.subjectId, reason: input.reason, note: input.note },
  })
  return response.report
}

export async function fetchAdminReports() {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; reports: PlatformReport[] }>('/api/admin/reports', { token }),
  )
  return response.reports
}

export async function actionReport(id: string, input: { status: 'REVIEWED' | 'ACTIONED' | 'DISMISSED'; note?: string }) {
  const response = await runAdminRequest((token) =>
    apiRequest<{ ok: true; report: PlatformReport }>(`/api/admin/reports/${id}`, {
      method: 'PATCH',
      token,
      body: { status: input.status, note: input.note },
    }),
  )
  return response.report
}

export async function createPrototypeBooking(input: {
  listingId: string
  amountMinor: number
  currency: string
  checkIn?: string
  checkOut?: string
  cancellationProtectionPurchased?: boolean
  cancellationProtection?: boolean
  cancellationProtectionFeeMinor?: number
  acceptedTerms?: boolean
  termsVersion?: string
}) {
  try {
    const session = await ensurePrototypeGuestSession()
    const response = await apiRequest<{ ok: true; booking: PlatformBooking }>('/api/bookings', {
      method: 'POST',
      token: session.token,
      body: input,
    })
    return response.booking
  } catch (error) {
    if (input.listingId.startsWith('fallback-')) {
      return createLocalFallbackBooking(input)
    }
    throw error
  }
}

export async function fetchPrototypeBooking(bookingId: string) {
  const localBooking = getLocalFallbackBooking(bookingId)
  if (localBooking) return localBooking

  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{
    ok: true
    booking: PlatformBooking & { listing?: PlatformListing; payments?: PlatformPaymentProof[]; review?: PlatformListingReview | null }
  }>(`/api/bookings/${bookingId}`, {
    token: session.token,
  })
  return response.booking
}

function createLocalFallbackBooking(input: {
  listingId: string
  amountMinor: number
  currency: string
  checkIn?: string
  checkOut?: string
  cancellationProtectionPurchased?: boolean
  cancellationProtection?: boolean
  cancellationProtectionFeeMinor?: number
  acceptedTerms?: boolean
  termsVersion?: string
}) {
  const listing = FALLBACK_APPROVED_LISTINGS.find((item) => item.id === input.listingId)
  if (!listing) throw new Error('Fallback listing not found')

  const now = new Date().toISOString()
  const booking: PlatformBooking & { listing?: PlatformListing; payments?: PlatformPaymentProof[] } = {
    id: `fallback-booking-${Date.now()}`,
    listingId: input.listingId,
    guestId: 'prototype-checkout-guest',
    status: 'DRAFT',
    checkIn: input.checkIn || null,
    checkOut: input.checkOut || null,
    amountMinor: input.amountMinor,
    currency: input.currency,
    metadata: {
      source: 'local-fallback-inspection',
      cancellationProtectionPurchased: Boolean(input.cancellationProtectionPurchased || input.cancellationProtection),
      cancellationProtectionFeeMinor: input.cancellationProtectionFeeMinor || 0,
      acceptedTerms: Boolean(input.acceptedTerms),
      termsVersion: input.termsVersion || null,
    },
    createdAt: now,
    updatedAt: now,
    guest: {
      id: 'prototype-checkout-guest',
      displayName: 'SYBNB Demo Guest',
      email: null,
    },
    listing,
    payments: [],
  }

  const bookings = readLocalFallbackBookings()
  bookings[booking.id] = booking
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(LOCAL_FALLBACK_BOOKINGS_KEY, JSON.stringify(bookings))
  }
  return booking
}

function getLocalFallbackBooking(bookingId: string) {
  return readLocalFallbackBookings()[bookingId] || null
}

function readLocalFallbackBookings(): Record<string, PlatformBooking & { listing?: PlatformListing; payments?: PlatformPaymentProof[] }> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(LOCAL_FALLBACK_BOOKINGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export async function disputePrototypeBooking(bookingId: string, note?: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{
    ok: true
    booking: PlatformBooking & { listing?: PlatformListing; payments?: PlatformPaymentProof[] }
  }>(`/api/bookings/${bookingId}/dispute`, {
    method: 'PATCH',
    token: session.token,
    body: { note },
  })
  return response.booking
}

export async function fetchPrototypeOverview() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; overview: PlatformOverview }>('/api/me/overview', {
    token: session.token,
  })
  return response.overview
}

export type MyProperty = PlatformListing & { inquiryCount: number }

// The seller's own BUY/RENTALS portfolio + a live inquiry count per listing (Synitres management view).
export async function fetchMyProperties() {
  const session = getStoredSellerSession() || getStoredStaffSession() || getStoredGuestSession()
  if (!session) throw new Error('Sign in first.')
  const response = await apiRequest<{ ok: true; properties: MyProperty[] }>('/api/me/properties', { token: session.token })
  return response.properties
}

export async function fetchSellerOverview() {
  const session = getStoredSellerSession()
  if (!session) throw new Error('Sign in as a seller first.')
  const response = await apiRequest<{ ok: true; overview: PlatformOverview }>('/api/me/overview', {
    token: session.token,
  })
  return response.overview
}

export async function submitSellerPlanProof(input: {
  amountMinor: number
  currency?: string
  providerRef: string
  proofAssetUrl?: string
  planCode?: string
  legalName?: string
  sellerType?: string
}) {
  const session = getStoredSellerSession()
  if (!session) throw new Error('Sign in as a seller first.')
  const response = await apiRequest<{ ok: true; proof: PlatformPaymentProof }>('/api/payments/seller-plan-proof', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.proof
}

export async function fetchPrototypeHostOverview(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; overview: PlatformHostOverview }>('/api/host/overview', {
    token: session.token,
  })
  return response.overview
}

export type PlatformHostEarningsRow = {
  bookingId: string
  listingTitle: string
  checkIn: string | null
  checkOut: string | null
  status: string
  hostGrossMinor: number
  cleaningFeeMinor: number
  taxesMinor: number
  currency: string
  payoutStatus: 'PENDING_HOLD' | 'ELIGIBLE' | 'RELEASED'
  eligibleAt: string | null
}

export type PlatformHostEarnings = {
  rows: PlatformHostEarningsRow[]
  totals: { forecastedMinor: number; grossEarnedMinor: number; releasedMinor: number; pendingMinor: number; currency: string }
}

export async function fetchPrototypeHostEarnings(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; earnings: PlatformHostEarnings }>('/api/host/earnings', {
    token: session.token,
  })
  return response.earnings
}

export type PlatformHostInsight = {
  id: string
  hostId: string
  listingId: string | null
  kind: string
  facts: Record<string, unknown>
  messageAr: string
  messageEn: string | null
  aiProvider: string | null
  aiModel: string | null
  readAt: string | null
  emailSentAt: string | null
  emailError: string | null
  createdAt: string
}

export async function fetchHostInsights(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  return apiRequest<{ ok: true; insights: PlatformHostInsight[]; unreadCount: number }>('/api/host/insights', {
    token: session.token,
  })
}

export async function generateHostInsight(mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  return apiRequest<{ ok: true; generated: number }>('/api/host/insights/generate', {
    method: 'POST',
    token: session.token,
  })
}

export async function markHostInsightRead(insightId: string, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; insight: PlatformHostInsight }>(`/api/host/insights/${insightId}/read`, {
    method: 'PATCH',
    token: session.token,
  })
  return response.insight
}

export async function decidePrototypeHostRequest(
  bookingId: string,
  decision: 'CONFIRM' | 'CANCEL',
  mode: HostDashboardMode = 'host',
  options: { acceptedTerms?: boolean; termsVersion?: string } = {},
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; booking: PlatformBooking & { listing?: PlatformListing } }>(
    `/api/host/requests/${bookingId}`,
    {
      method: 'PATCH',
      token: session.token,
      body: { decision, ...options },
    },
  )
  return response.booking
}

export async function markHostGuestCheckpoint(
  bookingId: string,
  action: 'CHECK_IN' | 'CHECK_OUT',
  mode: HostDashboardMode = 'host',
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; booking: PlatformBooking & { listing?: PlatformListing } }>(
    `/api/host/requests/${bookingId}/checkin`,
    {
      method: 'PATCH',
      token: session.token,
      body: { action },
    },
  )
  return response.booking
}

export async function updatePrototypeHostListingStatus(
  listingId: string,
  status: 'PAUSED' | 'APPROVED',
  mode: HostDashboardMode = 'host',
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; listing: PlatformListing }>(
    `/api/host/listings/${listingId}/status`,
    {
      method: 'PATCH',
      token: session.token,
      body: { status },
    },
  )
  return response.listing
}

// Rentals/Buy (025): self-service "still available?" renewal -- pushes expiresAt forward on a
// still-live (APPROVED) listing without requiring another admin review. Other divisions renew
// through their paid plan instead (see FREE_TIER_DIVISIONS on the server).
// CARS/NEW_CONSTRUCTION (paid-plan divisions) require re-confirming plan payment to renew --
// RENTALS/BUY (free-tier, no paid plan) don't, so `planPaymentConfirmed` is omitted for them.
export async function renewPrototypeHostListing(listingId: string, mode: HostDashboardMode = 'host', planPaymentConfirmed?: true) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; listing: PlatformListing }>(
    `/api/host/listings/${listingId}/renew`,
    { method: 'PATCH', token: session.token, body: planPaymentConfirmed ? { planPaymentConfirmed } : undefined },
  )
  return response.listing
}

// Edit/delete (025/Carcad Phase C) -- previously no listing could be edited or deleted at all
// after creation, for any division.
export async function editHostListing(
  listingId: string,
  patch: { titleAr?: string; titleEn?: string; description?: string; priceMinor?: number; metadata?: Record<string, unknown> },
  mode: HostDashboardMode = 'host',
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; listing: PlatformListing }>(`/api/host/listings/${listingId}`, {
    method: 'PATCH',
    token: session.token,
    body: patch,
  })
  return response.listing
}

export async function deleteHostListing(listingId: string, mode: HostDashboardMode = 'host') {
  const session = await getHostDashboardSession(mode)
  await apiRequest<{ ok: true; deleted: true }>(`/api/host/listings/${listingId}`, {
    method: 'DELETE',
    token: session.token,
  })
}

export async function updatePrototypeHostInstantBook(
  listingId: string,
  enabled: boolean,
  mode: HostDashboardMode = 'host',
) {
  const session = await getHostDashboardSession(mode)
  const response = await apiRequest<{ ok: true; listing: PlatformListing }>(
    `/api/host/listings/${listingId}/instant-book`,
    {
      method: 'PATCH',
      token: session.token,
      body: { enabled },
    },
  )
  return response.listing
}

export async function createPrototypeWalletGift(input: {
  recipientPhone: string
  amountMinor: number
  currency: string
  message?: string
}) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; gift: PlatformWalletGift }>('/api/wallet/gifts', {
    method: 'POST',
    token: session.token,
    body: input,
  })
  return response.gift
}

export async function claimPrototypeWalletGift(giftId: string, phone: string, code: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{
    ok: true
    entry: Record<string, unknown>
    wallet: PlatformWallet
    gift: PlatformWalletGift
  }>(`/api/wallet/gifts/${giftId}/claim`, {
    method: 'POST',
    token: session.token,
    body: { phone, code },
  })
  return response
}

export async function fetchPrototypeWalletGift(giftId: string) {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; gift: PlatformWalletGift }>(`/api/wallet/gifts/${giftId}`, {
    token: session.token,
  })
  return response.gift
}

export async function fetchPrototypeWallet() {
  const session = await ensurePrototypeGuestSession()
  const response = await apiRequest<{ ok: true; wallets: PlatformWallet[] }>('/api/wallet', {
    token: session.token,
  })
  return response.wallets
}

async function ensurePrototypeHostSession() {
  const stored = getStoredStaffSession('HOST') || getStoredStaffSession('SELLER')
  if (stored) return stored

  throw new Error('Host staff session required')
}

// Each browser/device gets its own random id, generated once and persisted locally. The backend
// uses it to create (or reuse) a real, isolated guest account per device — this used to be a
// single hardcoded shared account for every anonymous visitor platform-wide (one wallet, one ride
// history, one everything), which broke payment isolation and any real accountability. This id is
// not a verified identity (clearing local storage loses it, same as any device-scoped anonymous
// session), but it is a real, distinct database user, not a shared one.
function getOrCreateGuestDeviceId(): string {
  const existing = authStorage.getItem(GUEST_DEVICE_ID_KEY)
  if (existing) return existing
  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  authStorage.setItem(GUEST_DEVICE_ID_KEY, generated)
  return generated
}

async function ensurePrototypeGuestSession() {
  const guestSession = getStoredGuestSession()
  if (guestSession) return guestSession

  const deviceId = getOrCreateGuestDeviceId()
  const session = await apiRequest<AuthResponse>('/api/auth/checkout-guest', {
    method: 'POST',
    body: { source: 'guest-checkout', deviceId },
  })
  authStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
  authStorage.setItem(GUEST_SESSION_TOKEN_KEY, session.token)
  window.dispatchEvent(new Event('sybnb-session-changed'))
  return session
}

async function ensurePrototypeAdminSession() {
  const stored = getStoredStaffSession('ADMIN')
  if (stored) return stored

  throw new Error('Admin staff session required')
}

async function ensurePrototypeDriverSession() {
  const stored = getStoredStaffSession('DRIVER')
  if (stored) return stored

  throw new Error('Driver staff session required')
}

function staffPrototypeAccount(role: 'ADMIN' | 'HOST' | 'DRIVER') {
  if (role === 'ADMIN') {
    return {
      email: 'admin@sybnb.local',
      displayName: 'SYBNB Admin',
      role: 'ADMIN',
      phone: '+963900000099',
    }
  }

  if (role === 'DRIVER') {
    return {
      email: 'driver@sybnb.local',
      displayName: 'SYBNB Driver',
      role: 'DRIVER',
      phone: '+963900000077',
    }
  }

  return {
    email: 'host@sybnb.local',
    displayName: 'SYBNB Host',
    role: 'HOST',
    phone: '+963900000050',
  }
}

async function ensurePrototypeSession(account: {
  email: string
  password: string
  displayName: string
  role: string
  phone: string
}) {
  try {
    return await login(account.email, account.password)
  } catch {
    return register(account)
  }
}

async function createStaffAccount(account: {
  email: string
  password: string
  displayName: string
  role: string
  phone: string
}) {
  try {
    return await register(account)
  } catch {
    return login(account.email, account.password)
  }
}

async function login(email: string, password: string) {
  return apiRequest<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  })
}

// Sign in with a phone number instead of email (backend accepts either). Used by the phone-verify flow.
async function loginByPhone(phone: string, password: string) {
  return apiRequest<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { phone, password },
  })
}

async function register(body: {
  email: string
  password: string
  displayName: string
  role: string
  phone?: string
  firstName?: string
  lastName?: string
  referralCode?: string
}) {
  return apiRequest<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body,
  })
}

// Unified sign-in for the landing auth panel: log in with email + password, then persist the
// session to the store the app actually reads for that role (guest / staff / seller) and fire the
// session-changed event. Returns the session so the caller can route by role. Mirrors the per-role
// setters above so no store handling is duplicated inconsistently.
export async function signIn(email: string, password: string) {
  const session = await login(email.trim(), password)
  const roles = session.user.roles || []
  // A user can hold several roles; persist to every store that applies so each context works.
  if (roles.includes('GUEST')) {
    authStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
    authStorage.setItem(GUEST_SESSION_TOKEN_KEY, session.token)
  }
  if (roles.some((role) => role === 'ADMIN' || role === 'HOST' || role === 'DRIVER' || role === 'SELLER')) {
    authStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session))
    authStorage.setItem(STAFF_SESSION_TOKEN_KEY, session.token)
  }
  if (roles.includes('SELLER')) authStorage.setItem(SELLER_SESSION_KEY, JSON.stringify(session))
  window.dispatchEvent(new Event('sybnb-session-changed'))
  return session
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: string
    token?: string
    body?: unknown
  } = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const payload = (await response.json()) as unknown
  if (!response.ok || isApiErrorBody(payload)) {
    const message = isApiErrorBody(payload) ? payload.error?.message : undefined
    const error = new Error(message || `SYBNB API request failed: ${response.status}`) as Error & { status?: number; code?: string }
    error.status = response.status
    error.code = isApiErrorBody(payload) ? payload.error?.code : undefined
    throw error
  }

  return payload as T
}

function isApiErrorBody(payload: unknown): payload is ApiErrorBody {
  return Boolean(payload && typeof payload === 'object' && 'ok' in payload && payload.ok === false)
}

function isAuthApiError(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'status' in error &&
    ((error as { status?: number }).status === 401 || (error as { status?: number }).status === 403),
  )
}
