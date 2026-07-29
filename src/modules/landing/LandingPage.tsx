import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { SYRIA_GOVERNORATES, getGovernorate, labelFor } from '../../engines/search/syriaData'
import {
  fetchApprovedListings,
  isSampleListing,
  type ListingSearchFilters,
  type PlatformListing,
} from '../../shared/api/platformApi'
import { listingTitleText, moneyText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

/* ---------------------------------------------------------------------------
 * Centralized brand / destination config. To clone this STR platform for
 * another country, swap this block + the destinations import (SYRIA_GOVERNORATES)
 * — no city/country strings are hard-coded inline below.
 * ------------------------------------------------------------------------- */
const PLATFORM = {
  brand: 'SYBNB',
  suffix: 'STR',
  country: { ar: 'سوريا', en: 'Syria' },
  destinationCount: SYRIA_GOVERNORATES.length,
  heroPhoto: '/assets/divisions/daily-rental.webp',
  fallbackPhoto: '/assets/divisions/daily-rental.webp',
  video: {
    ar: '/assets/videos/str-promo-ar.mp4',
    en: '/assets/videos/str-promo-en.mp4',
  },
  staySearchKey: 'sybnb_v6_stay_search',
}

// Property-type options MIRROR the guest search page's propertyTypeOptions (UnifiedSearchBar):
// same keys, so the handoff value is consumed 1:1 by SearchPreviewPage. Do not invent keys.
const PROPERTY_TYPE_OPTIONS = [
  { key: 'any', ar: 'أي نوع', en: 'Any type' },
  { key: 'apartment', ar: 'شقة', en: 'Apartment' },
  { key: 'villa', ar: 'فيلا', en: 'Villa' },
  { key: 'office', ar: 'مكتب', en: 'Office' },
  { key: 'shop', ar: 'محل', en: 'Shop' },
  { key: 'land', ar: 'أرض', en: 'Land' },
]

// Price-band keys MIRROR PRICE_BANDS in SearchPreviewPage (any/low/mid/high).
const PRICE_BAND_OPTIONS = [
  { key: 'any', ar: 'أي سعر', en: 'Any price' },
  { key: 'low', ar: 'اقتصادي', en: 'Budget' },
  { key: 'mid', ar: 'متوسط', en: 'Mid' },
  { key: 'high', ar: 'مميز', en: 'Premium' },
]

// Airbnb-style themed group rows. Destination keys come from SYRIA_GOVERNORATES; swap for a
// clone. Each row fetches real approved STAYS for its governorate(s); the last row is newest.
const STAY_GROUPS: Array<{
  key: string
  ar: string
  en: string
  governorates?: string[]
  sort?: ListingSearchFilters['sort']
}> = [
  { key: 'damascus', ar: 'إقامات في دمشق', en: 'Stays in Damascus', governorates: ['damascus'] },
  {
    key: 'coast',
    ar: 'إقامات على الساحل (اللاذقية/طرطوس)',
    en: 'Coastal stays (Latakia / Tartus)',
    governorates: ['latakia', 'tartus'],
  },
  { key: 'new', ar: 'جديد على SYBNB', en: 'New on SYBNB', sort: 'newest' },
]

const COPY = {
  ar: {
    letter:
      '«إلى ضيوفنا، في سوريا لكل بيتٍ حكاية، ولكل ضيفٍ مكانٌ يستحقه. أنشأنا SYBNB لتحجز بثقة: أسعار واضحة، دفعٌ محميّ، ودعمٌ محلي يرافقك من الحجز حتى المغادرة — في دمشق القديمة، على ساحل اللاذقية، أو بين بساتين الزبداني. أهلاً بك في بيتك الثاني. — فريق SYBNB»',
    searchStay: 'ابحث عن إقامة',
    becomeHost: 'أصبح مضيفاً',
    heroTitle: 'تشعر أنك في المكان الصحيح',
    heroSub: 'إقامات موثوقة · أسعار واضحة · دعم محلي',
    where: 'الوجهة',
    whereAll: 'كل الوجهات',
    area: 'المنطقة',
    areaAll: 'كل المناطق',
    checkIn: 'تاريخ الوصول',
    checkOut: 'تاريخ المغادرة',
    guests: 'الضيوف',
    propertyType: 'نوع العقار',
    priceBand: 'الفئة السعرية',
    search: 'ابحث',
    trustVerified: 'إقامات موثوقة',
    trustVerifiedBody: 'إعلانات تُراجَع قبل نشرها.',
    trustSecure: 'حجز آمن',
    trustSecureBody: 'دفع محميّ ومراجعة للنزاعات.',
    trustSupport: 'دعم محلي',
    trustSupportBody: 'فريق حقيقي من الحجز حتى المغادرة.',
    catAll: 'الكل',
    catApartments: 'شقق',
    catVillas: 'فلل',
    catHeritage: 'بيوت تراثية',
    staysRow: 'إقامات في سوريا',
    groupEmpty: 'لا إقامات هنا بعد',
    emptyTitle: 'كن أول مضيف — أضف إقامتك على SYBNB',
    emptyBody: 'ما من إقامات منشورة بعد. المساحة مفتوحة لأول المضيفين.',
    emptyCta: 'أضف إقامتك',
    loading: 'جارٍ تحميل الإقامات…',
    perNight: '/ الليلة',
    favorite: 'أضف إلى المفضلة',
    howTitle: 'كيف تعمل',
    step1: 'ابحث واختر',
    step1Body: 'حدّد وجهتك وتواريخك وعدد الضيوف، وتصفّح الإقامات.',
    step2: 'احجز وادفع بأمان',
    step2Body: 'أكمل الحجز وادفع عبر دفع محميّ قبل وصولك.',
    step3: 'تابع رحلتك',
    step3Body: 'تابع حجوزاتك ومدفوعاتك ورحلتك من رحلاتي.',
    tripsTitle: 'رحلاتي',
    tripsBody: 'حجوزاتك ومدفوعاتك ورحلاتك في مكان واحد.',
    tripsCta: 'افتح رحلاتي',
    aboutEyebrow: 'SYBNB · STR',
    aboutTitle: 'إقامات سوريا، بثقة وحماية.',
    aboutBody:
      'SYBNB منصّة إقامات قصيرة الأمد داخل سوريا: ابحث عن مكانك، احجز، وادفع بحماية كاملة، وتابع رحلتك من مكان واحد.',
    missionTitle: 'المهمة',
    missionBody: 'تسهيل حجز الإقامات داخل سوريا بطريقة موثوقة وآمنة للضيف والمضيف.',
    visionTitle: 'الرؤية',
    visionBody: 'أن تصبح SYBNB الوجهة الأولى لحجز الإقامات المحمية في سوريا.',
    sloganTitle: 'الشعار',
    sloganBody: 'ابحث بثقة. احجز بأمان. تابع كل شيء من مكان واحد.',
    movieLabel: 'فيلم SYBNB التعريفي',
  },
  en: {
    letter:
      '“To our guests — in Syria, every home has a story, and every guest deserves a place that feels right. We built SYBNB so you can book with confidence: clear prices, protected payment, and local support from booking to checkout. Welcome to your second home. — The SYBNB team”',
    searchStay: 'Search stay',
    becomeHost: 'Become a host',
    heroTitle: 'Stay somewhere that feels right',
    heroSub: 'Verified homes · Clear prices · Local support',
    where: 'Where',
    whereAll: 'All destinations',
    area: 'Area',
    areaAll: 'All areas',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    guests: 'Guests',
    propertyType: 'Property type',
    priceBand: 'Price',
    search: 'Search stays',
    trustVerified: 'Verified homes',
    trustVerifiedBody: 'Listings are reviewed before they go live.',
    trustSecure: 'Secure booking',
    trustSecureBody: 'Protected payment and dispute review.',
    trustSupport: 'Local support',
    trustSupportBody: 'A real team from booking to checkout.',
    catAll: 'All',
    catApartments: 'Apartments',
    catVillas: 'Villas',
    catHeritage: 'Heritage',
    staysRow: 'Stays in Syria',
    groupEmpty: 'No stays here yet',
    emptyTitle: 'Be the first to list your place on SYBNB',
    emptyBody: 'No stays are published yet. The space is open for the first hosts.',
    emptyCta: 'List your place',
    loading: 'Loading stays…',
    perNight: '/ night',
    favorite: 'Add to favorites',
    howTitle: 'How it works',
    step1: 'Search & choose',
    step1Body: 'Set your destination, dates, and guests, then browse stays.',
    step2: 'Book & pay safely',
    step2Body: 'Complete the booking and pay through protected payment before arrival.',
    step3: 'Track your trip',
    step3Body: 'Follow your bookings, payments, and trip from My Trips.',
    tripsTitle: 'My Trips',
    tripsBody: 'Your bookings, payments, and trips in one place.',
    tripsCta: 'Open My Trips',
    aboutEyebrow: 'SYBNB · STR',
    aboutTitle: 'Stays in Syria, with trust and protection.',
    aboutBody:
      'SYBNB is a short-term stays platform inside Syria: find your place, book it, pay with full protection, and track your trip from one place.',
    missionTitle: 'Mission',
    missionBody: 'Make booking stays inside Syria trusted and safe for both guests and hosts.',
    visionTitle: 'Vision',
    visionBody: 'Become the first destination for protected stay bookings in Syria.',
    sloganTitle: 'Slogan',
    sloganBody: 'Search with trust. Book safely. Track everything in one place.',
    movieLabel: 'SYBNB brand movie',
  },
}

const CATEGORIES = [
  { key: 'all', match: [] as string[] },
  { key: 'apartments', match: ['apartment', 'apartments', 'flat', 'شقة', 'شقق'] },
  { key: 'villas', match: ['villa', 'villas', 'فيلا', 'فلل'] },
  { key: 'heritage', match: ['heritage', 'traditional', 'تراث', 'تراثي', 'قديم'] },
]

function listingCover(listing: PlatformListing): string {
  const mediaUrl = listing.media
    ?.map((item) => item.url || item.src || item.assetUrl)
    .find((value) => typeof value === 'string')
  if (typeof mediaUrl === 'string') return mediaUrl
  return PLATFORM.fallbackPhoto
}

function listingPlace(listing: PlatformListing, lang: Lang): string {
  const loc = (listing.location || {}) as Record<string, unknown>
  const govKey = loc.governorate || loc.governorateKey
  const gov = govKey ? getGovernorate(String(govKey)) : undefined
  return gov ? labelFor(lang, gov) : ''
}

function listingMatchesCategory(listing: PlatformListing, categoryKey: string): boolean {
  if (categoryKey === 'all') return true
  const category = CATEGORIES.find((entry) => entry.key === categoryKey)
  if (!category || category.match.length === 0) return true
  const meta = (listing.metadata || {}) as Record<string, unknown>
  const haystack = `${meta.propertyType ?? ''} ${meta.roomType ?? ''} ${listing.titleAr} ${listing.titleEn ?? ''}`.toLowerCase()
  return category.match.some((token) => haystack.includes(token.toLowerCase()))
}

/* Flatten a governorate's cities' areas into a single deduped list (mirrors the wizard's
 * governorate→city→area taxonomy, collapsed to one guest-facing area picker). */
function governorateAreaOptions(governorateKey: string) {
  const gov = governorateKey ? getGovernorate(governorateKey) : undefined
  if (!gov) return [] as Array<{ key: string; cityKey: string; ar: string; en: string }>
  const seen = new Set<string>()
  const out: Array<{ key: string; cityKey: string; ar: string; en: string }> = []
  for (const city of gov.cities) {
    for (const areaItem of city.areas) {
      if (seen.has(areaItem.key)) continue
      seen.add(areaItem.key)
      out.push({ key: areaItem.key, cityKey: city.key, ar: areaItem.ar, en: areaItem.en })
    }
  }
  return out
}

type StayCardHandlers = {
  lang: Lang
  t: (typeof COPY)['ar']
  favorites: Set<string>
  onToggleFavorite: (id: string) => void
}

function StayCard({ listing, lang, t, favorites, onToggleFavorite }: StayCardHandlers & { listing: PlatformListing }) {
  const place = listingPlace(listing, lang)
  const liked = favorites.has(listing.id)
  return (
    <article className="str-card">
      <button
        className="str-card-hit"
        onClick={() => navigate(`/listing/${listing.id}`)}
        aria-label={listingTitleText(listing, lang)}
      />
      <div className="str-card-media">
        <img src={listingCover(listing)} alt="" loading="lazy" />
        <button
          type="button"
          className={`str-fav ${liked ? 'liked' : ''}`}
          onClick={() => onToggleFavorite(listing.id)}
          aria-label={t.favorite}
          aria-pressed={liked}
        >
          {liked ? '♥' : '♡'}
        </button>
      </div>
      <div className="str-card-body">
        <strong className="str-card-title">{listingTitleText(listing, lang)}</strong>
        {place && <span className="str-card-place">{place}</span>}
        <span className="str-card-price">
          {moneyText(listing.priceMinor, listing.currency, lang)}
          <em>{t.perNight}</em>
        </span>
      </div>
    </article>
  )
}

function StayGroupRow({
  title,
  queries,
  category,
  serif,
  ...handlers
}: StayCardHandlers & {
  title: string
  queries: ListingSearchFilters[]
  category: string
  serif: string
}) {
  const { t } = handlers
  const [rows, setRows] = useState<PlatformListing[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all(queries.map((query) => fetchApprovedListings('STAYS', query).catch(() => [] as PlatformListing[])))
      .then((results) => {
        if (!active) return
        const seen = new Set<string>()
        const merged: PlatformListing[] = []
        for (const list of results) {
          for (const listing of list) {
            // Honesty: never surface sample/fallback demo listings.
            if (isSampleListing(listing) || seen.has(listing.id)) continue
            seen.add(listing.id)
            merged.push(listing)
          }
        }
        setRows(merged)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // queries are derived from static config and stable for this row's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = rows.filter((listing) => listingMatchesCategory(listing, category))

  return (
    <div className="str-group">
      <h3 className={`str-group-title${serif}`}>{title}</h3>
      {loading ? (
        <p className="str-group-empty">{t.loading}</p>
      ) : visible.length > 0 ? (
        <div className="str-row-scroll">
          {visible.map((listing) => (
            <StayCard key={listing.id} listing={listing} {...handlers} />
          ))}
        </div>
      ) : (
        <p className="str-group-empty">{t.groupEmpty}</p>
      )}
    </div>
  )
}

export function LandingPage({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = COPY[lang]
  const serif = isAr ? '' : ' stay-serif'

  const [destination, setDestination] = useState('')
  const [area, setArea] = useState('')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [guests, setGuests] = useState(2)
  const [propertyType, setPropertyType] = useState('any')
  const [priceBand, setPriceBand] = useState('any')

  const [category, setCategory] = useState('all')
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set())

  const areaOptions = useMemo(() => governorateAreaOptions(destination), [destination])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const chosenArea = areaOptions.find((entry) => entry.key === area)
    const query: Record<string, unknown> = { guests }
    if (destination) query.governorate = destination
    if (chosenArea) query.city = chosenArea.cityKey
    if (area) query.area = area
    if (checkIn) query.checkIn = checkIn
    if (checkOut) query.checkOut = checkOut
    if (propertyType && propertyType !== 'any') query.propertyType = propertyType
    if (priceBand && priceBand !== 'any') query.priceBand = priceBand
    try {
      window.localStorage.setItem(PLATFORM.staySearchKey, JSON.stringify(query))
    } catch {
      /* storage may be unavailable; still route to the real search */
    }
    navigate('/search-preview')
  }

  function toggleFavorite(id: string) {
    setFavorites((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const trust = [
    { icon: '✓', title: t.trustVerified, body: t.trustVerifiedBody },
    { icon: '⛨', title: t.trustSecure, body: t.trustSecureBody },
    { icon: '☎', title: t.trustSupport, body: t.trustSupportBody },
  ]

  const steps = [
    { n: 1, title: t.step1, body: t.step1Body },
    { n: 2, title: t.step2, body: t.step2Body },
    { n: 3, title: t.step3, body: t.step3Body },
  ]

  const categoryLabels: Record<string, string> = {
    all: t.catAll,
    apartments: t.catApartments,
    villas: t.catVillas,
    heritage: t.catHeritage,
  }

  const cardHandlers: StayCardHandlers = { lang, t, favorites, onToggleFavorite: toggleFavorite }

  return (
    <main className="landing-page str-landing">
      {/* 1 — STAYS HERO + SEARCH */}
      <section
        id="stay-search"
        className="str-hero"
        style={{ backgroundImage: `url(${PLATFORM.heroPhoto})` }}
        aria-label={t.heroTitle}
      >
        <div className="str-hero-inner">
          <h1 className={`str-hero-title${serif}`}>{t.heroTitle}</h1>
          <p className="str-hero-sub">{t.heroSub}</p>

          <form className="str-search" onSubmit={submitSearch}>
            <div className="str-search-main">
              <div className="str-field">
                <label htmlFor="str-where">{t.where}</label>
                <select
                  id="str-where"
                  value={destination}
                  onChange={(e) => {
                    setDestination(e.target.value)
                    setArea('')
                  }}
                >
                  <option value="">{t.whereAll}</option>
                  {SYRIA_GOVERNORATES.map((gov) => (
                    <option key={gov.key} value={gov.key}>
                      {labelFor(lang, gov)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="str-field">
                <label htmlFor="str-area">{t.area}</label>
                <select
                  id="str-area"
                  value={area}
                  disabled={!destination}
                  onChange={(e) => setArea(e.target.value)}
                >
                  <option value="">{t.areaAll}</option>
                  {areaOptions.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {isAr ? entry.ar : entry.en}
                    </option>
                  ))}
                </select>
              </div>
              <div className="str-field">
                <label htmlFor="str-checkin">{t.checkIn}</label>
                <input id="str-checkin" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
              </div>
              <div className="str-field">
                <label htmlFor="str-checkout">{t.checkOut}</label>
                <input
                  id="str-checkout"
                  type="date"
                  value={checkOut}
                  min={checkIn || undefined}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </div>
              <div className="str-field str-field-guests">
                <label htmlFor="str-guests">{t.guests}</label>
                <input
                  id="str-guests"
                  type="number"
                  min={1}
                  max={16}
                  value={guests}
                  onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>

            <div className="str-search-extra">
              <div className="str-quick">
                <div className="str-field">
                  <label htmlFor="str-ptype">{t.propertyType}</label>
                  <select id="str-ptype" value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                    {PROPERTY_TYPE_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {isAr ? option.ar : option.en}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="str-field">
                  <label>{t.priceBand}</label>
                  <div className="str-bands" role="group" aria-label={t.priceBand}>
                    {PRICE_BAND_OPTIONS.map((option) => (
                      <button
                        type="button"
                        key={option.key}
                        className={`str-chip ${priceBand === option.key ? 'active' : ''}`}
                        aria-pressed={priceBand === option.key}
                        onClick={() => setPriceBand(option.key)}
                      >
                        {isAr ? option.ar : option.en}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button type="submit" className="str-search-btn">
                {t.search}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* 3 — TRUST STRIP */}
      <section className="str-trust" aria-label={t.heroSub}>
        {trust.map((item) => (
          <div className="str-trust-item" key={item.title}>
            <span className="str-trust-icon" aria-hidden="true">{item.icon}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </div>
          </div>
        ))}
      </section>

      {/* 4 — STAYS: Airbnb-style grouped rows (real listings or honest empty lines) */}
      <section className="str-stays" aria-label={t.staysRow}>
        <h2 className={`str-section-title${serif}`}>{t.staysRow}</h2>

        <div className="str-chips" role="tablist" aria-label={t.staysRow}>
          {CATEGORIES.map((entry) => (
            <button
              key={entry.key}
              role="tab"
              aria-selected={category === entry.key}
              className={`str-chip ${category === entry.key ? 'active' : ''}`}
              onClick={() => setCategory(entry.key)}
            >
              {categoryLabels[entry.key]}
            </button>
          ))}
        </div>

        {STAY_GROUPS.map((group) => {
          const queries: ListingSearchFilters[] = group.governorates
            ? group.governorates.map((governorate) => ({ governorate }))
            : [{ sort: group.sort }]
          return (
            <StayGroupRow
              key={group.key}
              title={isAr ? group.ar : group.en}
              queries={queries}
              category={category}
              serif={serif}
              {...cardHandlers}
            />
          )
        })}
      </section>

      {/* 5 — HOW IT WORKS */}
      <section className="str-how" aria-label={t.howTitle}>
        <h2 className={`str-section-title${serif}`}>{t.howTitle}</h2>
        <div className="str-how-grid">
          {steps.map((step) => (
            <article className="str-step" key={step.n}>
              <span className="str-step-num" aria-hidden="true">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* 6 — MY TRIPS band */}
      <section className="str-trips-band" aria-label={t.tripsTitle}>
        <div className="str-trips-copy">
          <b className={serif.trim()}>{t.tripsTitle}</b>
          <p>{t.tripsBody}</p>
        </div>
        <button className="str-btn-outline" onClick={() => navigate('/trips')}>
          {t.tripsCta}
        </button>
      </section>

      {/* 7 — ABOUT */}
      <section id="platform-about" className="str-about" aria-label={t.aboutEyebrow}>
        <span className="str-about-eyebrow">{t.aboutEyebrow}</span>
        <h2 className={serif.trim()}>{t.aboutTitle}</h2>
        <p className="str-about-lead">{t.aboutBody}</p>
        <div className="str-about-pillars">
          <article>
            <b>{t.missionTitle}</b>
            <p>{t.missionBody}</p>
          </article>
          <article>
            <b>{t.visionTitle}</b>
            <p>{t.visionBody}</p>
          </article>
          <article>
            <b>{t.sloganTitle}</b>
            <p>{t.sloganBody}</p>
          </article>
        </div>
      </section>
    </main>
  )
}
