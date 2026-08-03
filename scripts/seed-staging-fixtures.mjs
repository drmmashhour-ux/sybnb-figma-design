// Staging fixture seed — makes an otherwise-empty staging DB browsable so the data-dependent UI flows
// (property detail, photo gallery incl. thumbnails + room captions, "similar"/"nearby", recently-viewed,
// host/seller browse) can be exercised end-to-end. It creates ONE pre-verified fixture owner and a small
// set of APPROVED listings across STAYS / BUY / RENTALS with placeholder media (served from /assets) and
// real-estate metadata. Two BUY and two RENTALS share a city so the "similar" strip has something to show.
//
// SAFETY: refuses to run unless SEED_STAGING_FIXTURES=1 — this must NEVER run against production (it would
// inject demo listings into the live catalogue). Idempotent: fixed ids, upserted; each listing's media is
// reset on every run. Targets whatever DATABASE_URL is set when invoked, e.g.:
//   SEED_STAGING_FIXTURES=1 DATABASE_URL="<staging-url>" node scripts/seed-staging-fixtures.mjs
// Optional FIXTURE_ACCOUNT_PASSWORD makes the fixture owner sign-in-able (HOST+SELLER); omit it and the
// account gets an unguessable random password (listings still seed; the account just can't be logged in).

import crypto from 'node:crypto'
import { db } from '../server/lib/prisma.mjs'
import { hashPassword } from '../server/lib/security.mjs'

if (process.env.SEED_STAGING_FIXTURES !== '1') {
  console.error(
    'Refusing to run: set SEED_STAGING_FIXTURES=1 to seed staging fixtures.\n' +
      'NEVER run this against production — it injects demo listings into the live catalogue.',
  )
  process.exit(1)
}

const OWNER_ID = 'fa000000-0000-4000-8000-000000000001'
const OWNER_EMAIL = 'staging-fixtures@sybnb.app'

const IMG = {
  apartment: '/assets/filter-photos/properties/apartment.webp',
  villa: '/assets/filter-photos/properties/villa.webp',
  heritage: '/assets/filter-photos/properties/heritage-home.webp',
  office: '/assets/filter-photos/properties/office.webp',
  daily: '/assets/divisions/daily-rental.webp',
  monthly: '/assets/divisions/monthly-rental.webp',
  buy: '/assets/divisions/buy-property.webp',
}

// Shared location so BUY×2 and RENTALS×2 each surface one "similar" result in the same city.
const loc = { governorate: 'damascus', city: 'damascus-city', mapLocation: { latitude: '33.5138', longitude: '36.2765', pinConfirmed: true } }

const LISTINGS = [
  {
    id: 'fa100000-0000-4000-8000-000000000001', division: 'STAYS', priceMinor: 55, instantBookEnabled: true,
    titleAr: 'شقة تجريبية بإطلالة — دمشق', titleEn: 'Demo Apartment — City View', description: 'A furnished demo apartment for staging verification.',
    metadata: { ...loc, propertyType: 'Apartment', area: 'malki', bedrooms: 2, bathrooms: 1, sizeSqm: 95, visualFilters: { amenities: ['wifi', 'kitchen', 'airConditioning'] }, photoCategories: ['living_room', 'bedroom', 'view'] },
    photos: [IMG.apartment, IMG.heritage, IMG.daily], // 3 photos → exercises thumbnails + captions
  },
  {
    id: 'fa100000-0000-4000-8000-000000000002', division: 'STAYS', priceMinor: 35,
    titleAr: 'استوديو تجريبي — دمشق', titleEn: 'Demo Studio', description: 'A cosy demo studio for staging.',
    metadata: { ...loc, propertyType: 'Apartment', bedrooms: 1, bathrooms: 1, sizeSqm: 45, visualFilters: { amenities: ['wifi'] } },
    photos: [IMG.monthly],
  },
  {
    id: 'fa200000-0000-4000-8000-000000000001', division: 'BUY', priceMinor: 250000,
    titleAr: 'فيلا تجريبية للبيع — دمشق', titleEn: 'Demo Villa for Sale', description: 'A spacious demo villa for staging.',
    metadata: { ...loc, propertyType: 'Villa', area: 'yaafour', bedrooms: 5, bathrooms: 4, sizeSqm: 420, visualFilters: { amenities: ['garden', 'parking', 'elevator'] }, photoCategories: ['exterior', 'living_room', 'pool'] },
    photos: [IMG.villa, IMG.heritage, IMG.buy],
  },
  {
    id: 'fa200000-0000-4000-8000-000000000002', division: 'BUY', priceMinor: 120000,
    titleAr: 'شقة تجريبية للبيع — دمشق', titleEn: 'Demo Apartment for Sale', description: 'A demo apartment for sale.',
    metadata: { ...loc, propertyType: 'Apartment', bedrooms: 3, bathrooms: 2, sizeSqm: 140, visualFilters: { amenities: ['elevator', 'parking'] } },
    photos: [IMG.apartment, IMG.office],
  },
  {
    id: 'fa300000-0000-4000-8000-000000000001', division: 'RENTALS', priceMinor: 800,
    titleAr: 'شقة تجريبية للإيجار — دمشق', titleEn: 'Demo Apartment for Rent', description: 'A furnished demo rental.',
    metadata: { ...loc, propertyType: 'Apartment', bedrooms: 2, bathrooms: 1, sizeSqm: 100, visualFilters: { amenities: ['wifi', 'furnished'] } },
    photos: [IMG.monthly, IMG.apartment],
  },
  {
    id: 'fa300000-0000-4000-8000-000000000002', division: 'RENTALS', priceMinor: 1200,
    titleAr: 'منزل تجريبي للإيجار — دمشق', titleEn: 'Demo Family House for Rent', description: 'A family demo rental.',
    metadata: { ...loc, propertyType: 'Family house', bedrooms: 4, bathrooms: 2, sizeSqm: 220, visualFilters: { amenities: ['garden', 'parking'] } },
    photos: [IMG.heritage],
  },
]

async function main() {
  // 1. Pre-verified fixture owner (HOST + SELLER so it can also drive host/seller views).
  const password = process.env.FIXTURE_ACCOUNT_PASSWORD
  const passwordHash = await hashPassword(password || crypto.randomUUID() + crypto.randomUUID())
  await db().user.upsert({
    where: { id: OWNER_ID },
    create: { id: OWNER_ID, email: OWNER_EMAIL, displayName: 'Staging Fixtures Host', referralCode: 'STAGING-FIX-001', passwordHash, status: 'ACTIVE', isDemo: true, idDocumentStatus: 'APPROVED', idDocumentSubmittedAt: new Date() },
    update: { displayName: 'Staging Fixtures Host', status: 'ACTIVE', isDemo: true, idDocumentStatus: 'APPROVED', ...(password ? { passwordHash } : {}) },
  })
  await db().userRole.deleteMany({ where: { userId: OWNER_ID } })
  await db().userRole.createMany({ data: [{ userId: OWNER_ID, role: 'HOST' }, { userId: OWNER_ID, role: 'SELLER' }] })

  // 2. Approved listings + media (idempotent: upsert listing, reset its media each run).
  for (const l of LISTINGS) {
    const data = { ownerId: OWNER_ID, division: l.division, status: 'APPROVED', titleAr: l.titleAr, titleEn: l.titleEn, description: l.description, priceMinor: l.priceMinor, currency: 'USD', instantBookEnabled: Boolean(l.instantBookEnabled), metadata: l.metadata }
    await db().listing.upsert({ where: { id: l.id }, create: { id: l.id, ...data }, update: data })
    await db().listingMedia.deleteMany({ where: { listingId: l.id } })
    await db().listingMedia.createMany({ data: l.photos.map((url, i) => ({ listingId: l.id, url, kind: 'photo', sortOrder: i })) })
  }

  const counts = await db().listing.groupBy({ by: ['division'], where: { ownerId: OWNER_ID }, _count: { _all: true } })
  console.log(`Staging fixtures seeded (idempotent). Owner: ${OWNER_EMAIL}${password ? '' : ' (random password — listings only)'}`)
  for (const c of counts) console.log(`  ${c.division}: ${c._count._all} approved listing(s)`)
  console.log('Exercises: property detail, gallery (thumbnails + room captions on the 3-photo villa/stay), similar/nearby (2 per city), recently-viewed.')
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exitCode = 1
  })
  .finally(() => db().$disconnect())
