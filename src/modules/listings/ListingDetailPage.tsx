import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchAccommodation,
  fetchListingAvailability,
  fetchListingQuote,
  fetchListingReviews,
  fetchPrototypeListing,
  sendListingInquiryMessage,
  type PlatformListing,
  type PlatformListingReview,
} from '../../shared/api/platformApi'
import { divisionText, listingDescriptionText, listingTitleText, moneyText, statusText } from '../../shared/i18n/display'
import { googleMapsSearchUrl, listingMapTarget, offlineMapSnapshot, offlineMapStorageKey } from '../../shared/maps/googleMapCapsule'
import { LocationMap, directionsUrl } from '../../shared/maps/capsule'
import { freeCancellationLabel } from '../../shared/booking/cancellationPolicy'
import { ReportForm } from '../safety/ReportForm'
import { BlockButton } from '../safety/BlockButton'
import { DateRangePicker, isValidDate, nightsBetween, type DateRange } from '../search/DateRangePicker'
import { loadSearchDatesDraft } from '../search/UnifiedSearchBar'
import { sypMinorToRoundedUsdMinor } from '../../shared/currency'
import { DealRatingBadge } from '../cars/DealRatingBadge'
import { AuctionBidPanel } from '../cars/AuctionBidPanel'

type Props = {
  listingId: string
  lang: Lang
}


const copy = {
  ar: {
    back: 'العودة',
    loading: 'جار التحميل',
    error: 'تعذر تحميل الإعلان',
    price: 'السعر',
    owner: 'المالك',
    division: 'القسم',
    status: 'الحالة',
    saving: 'جار الإرسال',
    dashboard: 'فتح الحساب / تسجيل الدخول',
    reference: 'رقم الإعلان',
    syrianPound: 'ل.س',
    protected: 'محمي عبر SYBNB',
    verifiedOwner: 'مالك موثق',
    verificationPending: 'التحقق قيد المراجعة',
    paymentProtected: 'الدفع محمي',
    nextSteps: 'خطوات العميل',
    accountGate: 'سجّل الدخول أو أنشئ حساباً للمتابعة',
    accountGateCopy: 'مثل Airbnb و Booking، يستطيع العميل التصفح أولاً ثم يحتاج حساباً عند إرسال الحجز والدفع.',
    signIn: 'تسجيل الدخول والمتابعة',
    signUp: 'إنشاء حساب والمتابعة',
    phone: 'رقم الهاتف',
    password: 'كلمة المرور',
    repeatPassword: 'تأكيد كلمة المرور',
    sendCode: 'إرسال الرمز',
    resendCode: 'إعادة إرسال الرمز',
    code: 'رمز التحقق',
    securityError: 'أدخل رقم الهاتف وكلمة المرور وتأكيدها ورمز التحقق قبل المتابعة.',
    accountReady: 'تم تجهيز حساب العميل',
    stepRows: ['راجع تفاصيل الغرفة', 'سجّل الدخول أو أنشئ حساباً', 'أرسل الحجز', 'ادفع داخل SYBNB', 'استلم رقم التأكيد'],
    contact: 'فتح التواصل',
    payCurrency: 'الدفع بالدولار فقط',
    payUsd: 'USD',
    nightlyPrice: 'السعر لليلة',
    stayLength: 'مدة الإقامة',
    estimatedTotal: 'إجمالي الحجز',
    usdRoundingNote: '',
    protectionChoice: 'اختيار الحماية',
    standardRate: 'السعر العادي',
    standardCopy: 'سعر أقل، وتطبق رسوم الإلغاء حسب السياسة.',
    protectedRate: 'السعر المحمي',
    protectedCopy: 'أضف حماية الإلغاء المفاجئ واسترد قيمة الحجز بدون رسوم إلغاء.',
    protectionFee: 'رسوم الحماية',
    totalDue: 'الإجمالي المستحق',
    datesTitle: 'اختر تاريخ الإقامة',
    datesRequired: 'اختر تاريخ الدخول والخروج قبل إرسال طلب الحجز.',
    specialOfferBadge: (count: number, days: number) => `🔥 ${count} ليالٍ بسعر خاص خلال ${days} يوماً القادمة`,
    specialOfferNight: 'سعر خاص',
    editDates: 'تعديل التواريخ',
    quoteLoading: 'جار حساب السعر...',
    mapTitle: 'موقع الاستضافة',
    mapCopy: 'موقع الاستضافة المختارة يظهر هنا. افتح خرائط Google لمراجعة المكان قبل إرسال طلب الحجز.',
    mapPin: 'موقع الاستضافة',
    mapApproximate: 'موقع تقريبي حسب بيانات الإعلان',
    openGoogleMaps: 'فتح في خرائط Google',
    getDirections: 'الاتجاهات · GPS',
    saveOfflineMap: 'حفظ الموقع دون إنترنت',
    offlineMapReady: 'تم حفظ الموقع للاستخدام دون إنترنت',
    offlineMapCopy: 'في حال انقطاع الإنترنت سيبقى العنوان والإحداثيات محفوظة داخل جهاز العميل.',
    mapRequiresInternet: 'الخريطة المباشرة تحتاج إنترنت. الموقع النصي محفوظ داخل الحجز.',
    location: 'الموقع',
    host: 'المضيف',
    terms: 'الشروط',
    reviews: 'التقييمات',
    noReviewsYet: 'لا توجد تقييمات بعد',
    reviewsCount: (count: number) => `${count} ${count === 1 ? 'تقييم' : 'تقييمات'}`,
    otherRoomsTitle: 'غرف أخرى في هذا العقار',
    openRoom: 'عرض هذه الغرفة',
    protectedTitle: 'محمي بواسطة SYBNB',
    rating: 'تقييم الثقة',
    howToBook: 'كيفية الحجز',
    instantBookBadge: '⚡ حجز فوري',
    instantBookExplain: 'هذه الاستضافة تفعّل الحجز الفوري: يتأكد حجزك تلقائياً فور نجاح الدفع، دون انتظار موافقة المضيف.',
    share: 'مشاركة',
    requestOnlyAfterAccount: 'افتح حسابك أو سجّل الدخول أولاً، ثم أرسل طلب الحجز.',
    inquirySentTitle: 'تم إرسال طلبك',
    inquirySentCopy: 'وصل طلبك إلى البائع/المضيف عبر صندوق الرسائل داخل SYBNB. لا حاجة للدفع الآن — سيتواصل معك الطرف الآخر من خلال المنصة.',
    openInbox: 'فتح صندوق الرسائل',
  },
  en: {
    back: 'Back',
    loading: 'Loading',
    error: 'Could not load listing',
    price: 'Price',
    owner: 'Owner',
    division: 'Division',
    status: 'Status',
    saving: 'Sending',
    dashboard: 'Open account / sign in',
    reference: 'Listing ref',
    syrianPound: 'SYP',
    protected: 'Protected by SYBNB',
    verifiedOwner: 'Verified owner',
    verificationPending: 'Verification pending',
    paymentProtected: 'Payment protected',
    nextSteps: 'Customer steps',
    accountGate: 'Sign in or create an account to continue',
    accountGateCopy: 'Like Airbnb and Booking, guests can browse first and need an account when they reserve and pay.',
    signIn: 'Sign in and continue',
    signUp: 'Create account and continue',
    phone: 'Phone number',
    password: 'Password',
    repeatPassword: 'Repeat password',
    sendCode: 'Send code',
    resendCode: 'Resend code',
    code: 'Verification code',
    securityError: 'Enter phone, password, repeated password, and verification code before continuing.',
    accountReady: 'Guest account ready',
    stepRows: ['Review room details', 'Sign in or create account', 'Send booking', 'Pay inside SYBNB', 'Receive confirmation number'],
    contact: 'Open contact',
    payCurrency: 'USD payment only',
    payUsd: 'USD',
    nightlyPrice: 'Nightly price',
    stayLength: 'Stay length',
    estimatedTotal: 'Booking total',
    usdRoundingNote: '',
    protectionChoice: 'Protection choice',
    standardRate: 'Standard rate',
    standardCopy: 'Lower price; cancellation fees apply by policy.',
    protectedRate: 'Protected rate',
    protectedCopy: 'Add sudden-cancellation protection and recover the booking amount without cancellation fee.',
    protectionFee: 'Protection fee',
    totalDue: 'Total due',
    datesTitle: 'Choose your stay dates',
    datesRequired: 'Choose check-in and check-out dates before sending the booking request.',
    specialOfferBadge: (count: number, days: number) => `🔥 ${count} nights at a special price in the next ${days} days`,
    specialOfferNight: 'Special price',
    editDates: 'Edit dates',
    quoteLoading: 'Calculating price...',
    mapTitle: 'Stay location',
    mapCopy: 'The selected stay location appears here. Open Google Maps to review the place before sending the booking request.',
    mapPin: 'Stay location',
    mapApproximate: 'Approximate location from listing data',
    openGoogleMaps: 'Open in Google Maps',
    getDirections: 'Get directions · GPS',
    saveOfflineMap: 'Save offline location',
    offlineMapReady: 'Location saved for offline use',
    offlineMapCopy: 'If internet is unavailable, the address and coordinates stay saved on the guest device.',
    mapRequiresInternet: 'Live map requires internet. The text location is saved inside the booking.',
    location: 'Location',
    host: 'Host',
    terms: 'Terms',
    reviews: 'Reviews',
    noReviewsYet: 'No reviews yet',
    reviewsCount: (count: number) => `${count} ${count === 1 ? 'review' : 'reviews'}`,
    otherRoomsTitle: 'Other rooms at this property',
    openRoom: 'View this room',
    protectedTitle: 'SYBNB Protected',
    rating: 'Trust rating',
    howToBook: 'How booking works',
    instantBookBadge: '⚡ Instant Book',
    instantBookExplain: 'This stay has Instant Book enabled: your booking confirms automatically once payment succeeds, no host approval wait.',
    share: 'Share',
    requestOnlyAfterAccount: 'Open an account or sign in first, then send the booking request.',
    inquirySentTitle: 'Your request was sent',
    inquirySentCopy: "Your request reached the seller/host through SYBNB's inbox. No payment needed now — they'll follow up with you through the platform.",
    openInbox: 'Open inbox',
  },
}


const DIVISION_IMAGES: Record<string, string> = {
  STAYS: '/assets/divisions/daily-rental.webp',
  RENTALS: '/assets/divisions/monthly-rental.webp',
  BUY: '/assets/divisions/buy-property.webp',
  NEW_CONSTRUCTION: '/assets/divisions/new-construction.webp',
  CARS: '/assets/divisions/cars.webp',
  MARKETPLACE: '/assets/divisions/marketplace.webp',
}

export function ListingDetailPage({ listingId, lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [listing, setListing] = useState<PlatformListing | null>(null)
  const [inquirySent, setInquirySent] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const messageRef = useRef<HTMLElement | null>(null)
  const actionBarRef = useRef<HTMLElement | null>(null)
  const bookingDraft = useMemo(() => loadBookingDraft(listingId), [listingId])
  const [cancellationProtection, setCancellationProtection] = useState(bookingDraft.cancellationProtection ?? false)
  const [offlineMapReady, setOfflineMapReady] = useState(false)
  const [activeTab, setActiveTab] = useState<'terms' | 'host' | 'location' | 'reviews'>('terms')
  const [dateRange, setDateRange] = useState<DateRange>(
    bookingDraft.dateRange || loadSearchDatesDraft() || defaultStayDateRange(),
  )
  const [disabledDates, setDisabledDates] = useState<Set<string>>(new Set())
  const [stayQuote, setStayQuote] = useState<{ totalMinor: number; nights: number; perNight: Array<{ date: string; priceMinor: number }> } | null>(null)
  const [payCurrency] = useState<'USD'>('USD')
  const [offerSummary, setOfferSummary] = useState<{ count: number; cheapestMinor: number | null }>({ count: 0, cheapestMinor: null })
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [siblingRooms, setSiblingRooms] = useState<PlatformListing[]>([])
  const [accommodationOfferSummary, setAccommodationOfferSummary] = useState<{ listingsWithOfferCount: number; totalListingsCount: number } | null>(null)
  const [reviewSummary, setReviewSummary] = useState<{ reviews: PlatformListingReview[]; average: number | null; count: number }>({
    reviews: [],
    average: null,
    count: 0,
  })

  const title = listing ? listingTitleText(listing, lang) : ''
  const actionLabel = useMemo(() => actionForDivision(listing?.division || 'STAYS', lang), [lang, listing?.division])
  const detailCopy = useMemo(() => detailCopyForDivision(listing?.division || 'STAYS', lang, t), [lang, listing?.division, t])
  const returnPath = useMemo(() => readListingReturnPath(), [])
  // Before dates are picked there's no server-computed stayQuote yet. Convert only legacy SYP
  // stays; USD-native stays should flow through unchanged so the guest never sees mixed money.
  const selectedNights = isValidDate(dateRange.checkIn) && isValidDate(dateRange.checkOut) ? nightsBetween(dateRange.checkIn, dateRange.checkOut) : 0
  const billableNights = Math.max(selectedNights, 1)
  const fallbackNightlyMinor = payCurrency === 'USD' && listing?.currency === 'SYP'
    ? sypMinorToRoundedUsdMinor(listing.priceMinor)
    : listing?.priceMinor ?? 0
  const displayedTotalMinor = stayQuote?.totalMinor ?? fallbackNightlyMinor * billableNights
  const protectionFeeMinor = Math.round(displayedTotalMinor * 0.03)
  const protectedTotalMinor = displayedTotalMinor + protectionFeeMinor
  const mapTarget = listing ? listingMapTarget(listing, title, lang) : null
  const mapCoords = (() => {
    if (!mapTarget?.hasCoordinates) return null
    const [lat, lng] = mapTarget.query.split(',').map(Number)
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  })()

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search)
      if (search.has('resetAccount') || search.has('accountReady')) {
        search.delete('resetAccount')
        search.delete('accountReady')
        const nextSearch = search.toString()
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
        window.history.replaceState(null, '', nextUrl)
      }

      try {
        setOfflineMapReady(localStorage.getItem(offlineMapStorageKey(listingId)) !== null)
      } catch {
        setOfflineMapReady(false)
      }
    }
    void loadListing()
    void loadAvailability()
    void loadReviews()
  }, [listingId])

  async function loadAvailability() {
    const from = toISODate(new Date())
    const to = toISODate(new Date(Date.now() + 1000 * 60 * 60 * 24 * 180))
    const response = await fetchListingAvailability(listingId, from, to)
    const blocked = new Set(response.blockedDates)
    response.bookedRanges.forEach((range) => {
      let day = new Date(`${range.checkIn}T00:00:00`)
      const end = new Date(`${range.checkOut}T00:00:00`)
      while (day < end) {
        blocked.add(toISODate(day))
        day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
      }
    })
    setDisabledDates(blocked)
    setOfferSummary({ count: response.offerNightsCount, cheapestMinor: response.cheapestOfferMinor })
  }

  async function loadReviews() {
    try {
      const response = await fetchListingReviews(listingId)
      setReviewSummary({ reviews: response.reviews, average: response.average, count: response.count })
    } catch {
      setReviewSummary({ reviews: [], average: null, count: 0 })
    }
  }

  useEffect(() => {
    if (!listing?.accommodation?.id) {
      setSiblingRooms([])
      return
    }
    let cancelled = false
    fetchAccommodation(listing.accommodation.id)
      .then((response) => {
        if (cancelled) return
        setSiblingRooms(response.accommodation.listings?.filter((room) => room.id !== listing.id) || [])
        setAccommodationOfferSummary(response.accommodation.offerSummary || null)
      })
      .catch(() => {
        if (!cancelled) {
          setSiblingRooms([])
          setAccommodationOfferSummary(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [listing?.accommodation?.id, listing?.id])

  useEffect(() => {
    if (listing?.division !== 'STAYS' || !isValidDate(dateRange.checkIn) || !isValidDate(dateRange.checkOut)) {
      setStayQuote(null)
      return
    }
    let cancelled = false
    setQuoteLoading(true)
    fetchListingQuote(listingId, dateRange.checkIn, dateRange.checkOut, payCurrency === 'USD' ? 'USD' : undefined)
      .then((response) => {
        if (!cancelled) setStayQuote({ totalMinor: response.totalMinor, nights: response.nights, perNight: response.perNight })
      })
      .catch(() => {
        if (!cancelled) setStayQuote(null)
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [listingId, listing?.division, dateRange.checkIn, dateRange.checkOut, payCurrency])

  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView({ behavior: 'instant', block: 'center' })
  }, [message])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const draft: BookingDraft = { dateRange, cancellationProtection, payCurrency }
    sessionStorage.setItem(bookingDraftKey(listingId), JSON.stringify(draft))
  }, [listingId, dateRange, cancellationProtection, payCurrency])

  async function loadListing() {
    setStatus('loading')
    setMessage('')

    try {
      const fetched = await fetchPrototypeListing(listingId)
      setListing(fetched)
      setStatus('ready')
      // Self-correct the breadcrumb's return-path memory from the listing's own division -- a
      // direct/shared link (WhatsApp, etc.) never goes through a browse page's click handler, so
      // sessionStorage would otherwise still hold a stale or default value from a prior visit.
      if (typeof window !== 'undefined') {
        const routeForDivision: Record<string, string> = {
          STAYS: '/stays', RENTALS: '/rentals', BUY: '/buy',
          NEW_CONSTRUCTION: '/new-construction', CARS: '/cars', MARKETPLACE: '/marketplace',
        }
        const route = routeForDivision[fetched.division]
        if (route) {
          sessionStorage.setItem('sybnb-v6-listing-return-path', route)
          window.dispatchEvent(new Event('sybnb:listing-return-path-updated'))
        }
      }
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function requestListing() {
    if (!listing) return
    if (
      listing.division === 'STAYS' &&
      (!isValidDate(dateRange.checkIn) || !isValidDate(dateRange.checkOut) || nightsBetween(dateRange.checkIn, dateRange.checkOut) < 1)
    ) {
      setActiveTab('terms')
      setMessage(t.datesRequired)
      return
    }
    // STAYS is a real paid booking — matching Airbnb/Booking.com's architecture, browsing and
    // date/currency/protection selection stay on THIS page, but the actual reservation is only
    // ever created on a dedicated review/checkout step (BookingReviewPage), never directly from
    // here. This is what keeps "just looking around" and "committing to pay" clearly separate.
    if (listing.division === 'STAYS') {
      window.location.hash = `/booking/review/${listing.id}`
      return
    }

    setStatus('saving')
    setMessage('')

    // Every other division ("Contact seller" / "Request item" / "Book visit") is a lightweight
    // inquiry — it must never create a PAYMENT_PENDING booking for the full listing price. Route
    // it through the same message-thread inquiry used by Rentals/Buy instead (see
    // sendListingInquiryMessage / RentalsPage.tsx).
    try {
      const introBody = isAr
        ? `طلب تواصل جديد بخصوص "${title}".`
        : `New inquiry about "${title}".`
      await sendListingInquiryMessage(listing.id, introBody)
      setInquirySent(true)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  function saveOfflineMap() {
    if (!listing) return
    try {
      localStorage.setItem(offlineMapStorageKey(listing.id), JSON.stringify(offlineMapSnapshot(listing, title, lang)))
      setOfflineMapReady(true)
    } catch {
      setMessage(t.mapRequiresInternet)
    }
  }

  function shareListing() {
    if (typeof window === 'undefined') return
    const url = window.location.href
    if (navigator.share) {
      void navigator.share({ title, url }).catch(() => undefined)
      return
    }
    void navigator.clipboard?.writeText(url)
    setMessage(isAr ? 'تم نسخ رابط الإعلان.' : 'Listing link copied.')
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.flowNav} aria-label={isAr ? 'التنقل بين الخطوات' : 'Step navigation'}>
        <button style={styles.arrowButton} onClick={() => (window.location.hash = returnPath)} aria-label={isAr ? 'السابق' : 'Back'}>
          ‹
        </button>
        <button
          style={styles.arrowButton}
          disabled={!listing || status === 'saving'}
          onClick={() => actionBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          aria-label={isAr ? 'الانتقال لإرسال الطلب' : 'Go to send request'}
        >
          ›
        </button>
      </section>

      {status === 'loading' && <section style={styles.panel}>{t.loading}</section>}
      {status === 'error' && <section ref={messageRef} style={styles.alert}>{message}</section>}
      {status !== 'error' && message && <section ref={messageRef} style={styles.alert}>{message}</section>}

      {listing && (
        <>
          <section style={styles.detailHero}>
            <button style={styles.heroIconButton} onClick={shareListing} aria-label={t.share}>
              ↗
            </button>
            <button
              style={styles.heroNextButton}
              disabled={status === 'saving'}
              onClick={() => actionBarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              aria-label={isAr ? 'الانتقال لإرسال الطلب' : 'Go to send request'}
            >
              →
            </button>
            <div style={styles.media}>
              <img
                src={listingImage(listing)}
                alt={title}
                style={styles.mediaImage}
                onError={(event) => {
                  const fallback = DIVISION_IMAGES[listing.division] || '/assets/divisions/daily-rental.webp'
                  if (event.currentTarget.src.endsWith(fallback)) return
                  event.currentTarget.src = fallback
                }}
              />
              <span style={styles.mediaBadge}>{divisionText(listing.division, lang)}</span>
              {listing.instantBookEnabled && <span style={styles.instantBookBadge}>{t.instantBookBadge}</span>}
              {listing.division === 'CARS' && (
                <span style={styles.dealRatingBadge}>
                  <DealRatingBadge dealRating={listing.dealRating} lang={lang} />
                </span>
              )}
            </div>
          </section>

          {listing.division === 'CARS' && listing.auction != null && (
            <AuctionBidPanel lang={lang} listing={listing} onContactSeller={() => void requestListing()} />
          )}

          <section style={styles.detailBody}>
            <div style={styles.titleBlock}>
              <h1 style={styles.title}>{title}</h1>
              {reviewSummary.count > 0 && (
                <span style={styles.ratingLine}>★ {reviewSummary.average} · {t.reviewsCount(reviewSummary.count)}</span>
              )}
              <span style={styles.locationLine}>⌖ {mapTarget?.label || divisionText(listing.division, lang)}</span>
            </div>

            <div style={styles.tabRow} role="tablist" aria-label={isAr ? 'تفاصيل الإعلان' : 'Listing details'}>
              <button style={activeTab === 'terms' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('terms')}>{t.terms}</button>
              <button style={activeTab === 'host' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('host')}>{t.host}</button>
              <button style={activeTab === 'location' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('location')}>{t.location}</button>
              <button style={activeTab === 'reviews' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('reviews')}>{t.reviews}</button>
            </div>

            <section style={styles.figmaTrustCard}>
              <strong>{t.protectedTitle}</strong>
              {listing.owner?.idDocumentStatus === 'APPROVED' && (
                <div style={styles.trustPills}>
                  <span>{t.verifiedOwner}</span>
                </div>
              )}
              <small>
                {reviewSummary.count > 0
                  ? `${t.rating} ${reviewSummary.average} ★ (${reviewSummary.count})`
                  : t.noReviewsYet}
              </small>
            </section>

            <section style={styles.bookingSteps}>
              <h2>{detailCopy.howToBook}</h2>
              {detailCopy.stepRows.slice(0, 4).map((step, index) => (
                <div key={step} style={styles.bookingStep}>
                  <b>{index + 1}</b>
                  <span>{step}</span>
                </div>
              ))}
              {listing.instantBookEnabled && <p style={styles.instantBookNote}>⚡ {t.instantBookExplain}</p>}
            </section>
          </section>

          {activeTab === 'terms' && (
            <section style={styles.tabPanel}>
              <p style={styles.body}>{listingDescriptionText(listing, lang)}</p>
              {listing.division === 'STAYS' && (
                <>
                  <section style={styles.panel}>
                    <strong>{isAr ? 'اختر تواريخك' : 'Choose your dates'}</strong>
                    <DateRangePicker
                      lang={lang}
                      value={dateRange}
                      onChange={setDateRange}
                      disabledDates={disabledDates}
                      disabledHint={isAr ? 'بعض التواريخ محجوزة بالفعل' : 'Some of those dates are already booked'}
                    />
                  </section>
                  {!dateRange.checkIn && offerSummary.count > 0 && (
                    <section style={styles.panel}>
                      <strong>{t.specialOfferBadge(offerSummary.count, 180)}</strong>
                      {offerSummary.cheapestMinor != null && (
                        <span>{moneyText(sypMinorToRoundedUsdMinor(offerSummary.cheapestMinor), 'USD', lang)} / {isAr ? 'ليلة' : 'night'}</span>
                      )}
                    </section>
                  )}
                  <section style={styles.priceSummary}>
                    <article style={styles.priceSummaryCard}>
                      <span>{t.nightlyPrice}</span>
                      <strong>{moneyText(fallbackNightlyMinor, 'USD', lang)}</strong>
                      <small>{t.payCurrency}</small>
                    </article>
                    <article style={styles.priceSummaryCard}>
                      <span>{t.stayLength}</span>
                      <strong>{stayQuote?.nights ?? billableNights} {isAr ? 'ليالٍ' : 'nights'}</strong>
                      <small>{freeCancellationLabel(dateRange.checkIn, cancellationProtection, lang)}</small>
                    </article>
                    <article style={styles.priceSummaryCardStrong}>
                      <span>{t.estimatedTotal}</span>
                      <strong>{moneyText(cancellationProtection ? protectedTotalMinor : displayedTotalMinor, 'USD', lang)}</strong>
                      <small>{cancellationProtection ? t.protectedRate : t.standardRate}</small>
                    </article>
                  </section>

                  <section style={styles.protectionChoice}>
                    <strong>{t.protectionChoice}</strong>
                    <div style={styles.protectionOptions}>
                      <button
                        style={!cancellationProtection ? styles.protectionOptionActive : styles.protectionOption}
                        onClick={() => setCancellationProtection(false)}
                      >
                        <b>{t.standardRate}</b>
                        <span>{t.standardCopy}</span>
                        <em style={styles.cancellationCutoff}>{freeCancellationLabel(dateRange.checkIn, false, lang)}</em>
                        <small>
                          {quoteLoading
                            ? t.quoteLoading
                            : stayQuote
                              ? `${moneyText(stayQuote.totalMinor, payCurrency, lang)} · ${stayQuote.nights} ${isAr ? 'ليالٍ' : 'nights'}`
                              : `${moneyText(displayedTotalMinor, payCurrency, lang)} · ${billableNights} ${isAr ? 'ليالٍ' : 'nights'}`}
                        </small>
                      </button>
                      <button
                        style={cancellationProtection ? styles.protectionOptionActive : styles.protectionOption}
                        onClick={() => setCancellationProtection(true)}
                      >
                        <b>{t.protectedRate}</b>
                        <span>{t.protectedCopy}</span>
                        <em style={styles.cancellationCutoff}>{freeCancellationLabel(dateRange.checkIn, true, lang)}</em>
                        <small>{t.protectionFee}: {moneyText(protectionFeeMinor, payCurrency, lang)}</small>
                        <small>{t.totalDue}: {moneyText(protectedTotalMinor, payCurrency, lang)}</small>
                      </button>
                    </div>
                  </section>

                </>
              )}
            </section>
          )}

          {activeTab === 'location' && (
            <section style={styles.tabPanel}>
              <section style={styles.mapPanel}>
                <div>
                  <strong>{detailCopy.mapTitle}</strong>
                  <span>{detailCopy.mapCopy}</span>
                </div>
                <div style={styles.mapCanvas} aria-label={detailCopy.mapTitle}>
                  {mapCoords ? (
                    <LocationMap
                      lat={mapCoords.lat}
                      lng={mapCoords.lng}
                      popupHtml={mapTarget?.label ? `<div style="color:#111;font-weight:700;max-width:220px">${mapTarget.label}</div>` : undefined}
                      style={styles.mapFrame}
                    />
                  ) : (
                    <div style={{ ...styles.mapFrame, display: 'grid', placeItems: 'center', color: '#9aa6ba', background: '#10141f' }}>
                      {t.mapApproximate}
                    </div>
                  )}
                  <div style={styles.mapLocationCard}>
                    <span style={styles.mapPin}>{detailCopy.mapPin}</span>
                    <strong>{mapTarget?.label}</strong>
                    <small>{mapTarget?.hasCoordinates ? mapTarget.query : t.mapApproximate}</small>
                  </div>
                </div>
                {mapCoords ? (
                  <a href={directionsUrl(mapCoords.lat, mapCoords.lng)} rel="noreferrer" target="_blank" style={styles.directionsButton}>
                    {t.getDirections}
                  </a>
                ) : null}
                <a href={googleMapsSearchUrl(listing, title, lang)} rel="noreferrer" target="_blank" style={styles.secondaryLinkButton}>
                  {t.openGoogleMaps}
                </a>
                <div style={offlineMapReady ? styles.offlineMapReady : styles.offlineMapCard}>
                  <div>
                    <strong>{offlineMapReady ? t.offlineMapReady : t.mapRequiresInternet}</strong>
                    <span>{t.offlineMapCopy}</span>
                    <small dir="ltr">{mapTarget?.hasCoordinates ? mapTarget.query : mapTarget?.label}</small>
                  </div>
                  <button style={offlineMapReady ? styles.offlineMapSavedButton : styles.offlineMapButton} onClick={saveOfflineMap}>
                    {offlineMapReady ? '✓' : t.saveOfflineMap}
                  </button>
                </div>
              </section>
            </section>
          )}

          {activeTab === 'host' && (
            <section style={styles.trustGrid}>
              <article style={styles.trustCard}>
                <strong>{t.verifiedOwner}</strong>
                <span>
                  {listing.owner?.idDocumentStatus === 'APPROVED'
                    ? `✓ ${listing.owner?.displayName || listing.ownerId.slice(0, 8).toUpperCase()}`
                    : `${listing.owner?.displayName || listing.ownerId.slice(0, 8).toUpperCase()} (${t.verificationPending})`}
                </span>
              </article>
              <article style={styles.trustCard}>
                <strong>{t.paymentProtected}</strong>
                <span>{t.protected}</span>
              </article>
            </section>
          )}

          {activeTab === 'reviews' && (
            <>
              <section style={styles.grid}>
                <Info
                  label={t.rating}
                  value={reviewSummary.count > 0 ? `${reviewSummary.average} ★ (${t.reviewsCount(reviewSummary.count)})` : t.noReviewsYet}
                />
                <Info label={t.status} value={statusText(listing.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />
                <Info label={t.reference} value={listing.id.slice(0, 8).toUpperCase()} />
              </section>
              {reviewSummary.reviews.length > 0 && (
                <section style={styles.grid}>
                  {reviewSummary.reviews.map((review) => (
                    <article key={review.id} style={styles.info}>
                      <span dir={isAr ? 'rtl' : 'ltr'}>{review.guest?.displayName || (isAr ? 'ضيف' : 'Guest')} · {'★'.repeat(review.rating)}</span>
                      <strong dir={isAr ? 'rtl' : 'ltr'}>{review.comment || ''}</strong>
                    </article>
                  ))}
                </section>
              )}
            </>
          )}

          {siblingRooms.length > 0 && (
            <section style={styles.panel}>
              <strong>{t.otherRoomsTitle}</strong>
              {accommodationOfferSummary && accommodationOfferSummary.listingsWithOfferCount > 0 && (
                <span>
                  {isAr
                    ? `${accommodationOfferSummary.listingsWithOfferCount} من ${accommodationOfferSummary.totalListingsCount} أنواع الغرف لديها عرض خاص الآن`
                    : `${accommodationOfferSummary.listingsWithOfferCount} of ${accommodationOfferSummary.totalListingsCount} room types have a special offer right now`}
                </span>
              )}
              <section style={styles.grid}>
                {siblingRooms.map((room) => (
                  <article key={room.id} style={styles.info}>
                    <span dir={isAr ? 'rtl' : 'ltr'}>
                      {listingTitleText(room, lang)}
                      {room.hasActiveOffer ? ` · ${t.specialOfferNight}` : ''}
                    </span>
                    <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(sypMinorToRoundedUsdMinor(room.priceMinor), 'USD', lang)}</strong>
                    <button style={styles.secondaryButton} onClick={() => (window.location.hash = `/listing/${room.id}`)}>
                      {t.openRoom}
                    </button>
                  </article>
                ))}
              </section>
            </section>
          )}

          <section style={styles.metaStrip}>
            <Info label={t.owner} value={listing.owner?.displayName || listing.ownerId.slice(0, 8).toUpperCase()} />
            <Info label={t.division} value={divisionText(listing.division, lang)} dir={isAr ? 'rtl' : 'ltr'} />
          </section>

          {inquirySent && (
            <section style={styles.panel}>
              <strong>{t.inquirySentTitle}</strong>
              <p style={styles.body}>{t.inquirySentCopy}</p>
              <button style={styles.primaryButton} onClick={() => (window.location.hash = '/immocontact')}>
                {t.openInbox}
              </button>
            </section>
          )}

          <section ref={actionBarRef} style={styles.bottomActionBar}>
            {listing.division === 'STAYS' && (
              <div style={styles.reserveBarPrice}>
                <strong>{moneyText(cancellationProtection ? protectedTotalMinor : displayedTotalMinor, 'USD', lang)}</strong>
                <small>
                  {isValidDate(dateRange.checkIn) && isValidDate(dateRange.checkOut)
                    ? `${stayQuote?.nights ?? billableNights} ${isAr ? 'ليالٍ' : 'nights'} · ${dateRange.checkIn} → ${dateRange.checkOut}`
                    : isAr ? 'اختر التواريخ أعلاه' : 'Pick your dates above'}
                </small>
              </div>
            )}
            {!inquirySent && (
              <button disabled={status === 'saving'} style={styles.primaryButton} onClick={() => void requestListing()}>
                {status === 'saving' ? t.saving : actionLabel}
              </button>
            )}
          </section>

          <section style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', marginTop: 8 }}>
            <ReportForm lang={lang} subjectType="LISTING" subjectId={listing.id} />
            <BlockButton lang={lang} userId={listing.ownerId} />
          </section>
        </>
      )}
    </main>
  )
}

function defaultStayDateRange(): DateRange {
  const checkIn = new Date(Date.now() + 1000 * 60 * 60 * 24)
  const checkOut = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3)
  return { checkIn: toISODate(checkIn), checkOut: toISODate(checkOut) }
}

function toISODate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function listingImage(listing: PlatformListing) {
  if (listing.division === 'CARS' || listing.division === 'NEW_CONSTRUCTION' || listing.division === 'MARKETPLACE') {
    return DIVISION_IMAGES[listing.division]
  }
  const mediaUrl = listing.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  if (typeof mediaUrl === 'string') return mediaUrl
  return DIVISION_IMAGES[listing.division] || '/assets/divisions/daily-rental.webp'
}

function Info({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <article style={styles.info}>
      <span>{label}</span>
      <strong dir={dir}>{value}</strong>
    </article>
  )
}

function actionForDivision(division: string, lang: Lang) {
  const actions: Record<string, Record<Lang, string>> = {
    STAYS: { ar: 'متابعة الحجز', en: 'Continue to review' },
    RENTALS: { ar: 'طلب تواصل', en: 'Request contact' },
    BUY: { ar: 'طلب زيارة', en: 'Request visit' },
    CARS: { ar: 'تواصل مع البائع', en: 'Contact seller' },
    MARKETPLACE: { ar: 'طلب المنتج', en: 'Request item' },
    NEW_CONSTRUCTION: { ar: 'حجز زيارة', en: 'Book visit' },
  }
  return actions[division]?.[lang] || actions.STAYS[lang]
}

function detailCopyForDivision(division: string, lang: Lang, fallback: typeof copy.ar) {
  const detailCopy: Record<string, Partial<typeof copy.ar>> = {
    STAYS: {},
    RENTALS: {
      mapTitle: lang === 'ar' ? 'موقع العقار' : 'Property location',
      mapCopy: lang === 'ar' ? 'موقع العقار المختار يظهر هنا. افتح خرائط Google لمراجعة المنطقة قبل إرسال الطلب.' : 'The selected property location appears here. Open Google Maps to review the area before sending the request.',
      mapPin: lang === 'ar' ? 'موقع العقار' : 'Property location',
      howToBook: lang === 'ar' ? 'كيف تسير العملية' : 'How it works',
      stepRows: lang === 'ar'
        ? ['راجع تفاصيل العقار', 'سجّل الدخول أو أنشئ حساباً', 'أرسل طلب التواصل', 'تواصل مع المالك داخل SYBNB']
        : ['Review property details', 'Sign in or create account', 'Send contact request', 'Coordinate with the owner inside SYBNB'],
    },
    BUY: {
      mapTitle: lang === 'ar' ? 'موقع العقار' : 'Property location',
      mapCopy: lang === 'ar' ? 'موقع العقار المختار يظهر هنا. راجع المنطقة قبل طلب الزيارة.' : 'The selected property location appears here. Review the area before requesting a visit.',
      mapPin: lang === 'ar' ? 'موقع العقار' : 'Property location',
      howToBook: lang === 'ar' ? 'كيف تسير العملية' : 'How it works',
      stepRows: lang === 'ar'
        ? ['راجع تفاصيل العقار', 'سجّل الدخول أو أنشئ حساباً', 'أرسل طلب الزيارة', 'نسّق موعد الزيارة داخل SYBNB']
        : ['Review property details', 'Sign in or create account', 'Send visit request', 'Coordinate the visit inside SYBNB'],
    },
    CARS: {
      mapTitle: lang === 'ar' ? 'موقع المركبة' : 'Vehicle location',
      mapCopy: lang === 'ar' ? 'موقع المركبة أو المعرض يظهر هنا. افتح خرائط Google قبل التواصل مع البائع.' : 'The vehicle or showroom location appears here. Open Google Maps before contacting the seller.',
      mapPin: lang === 'ar' ? 'موقع المركبة' : 'Vehicle location',
      howToBook: lang === 'ar' ? 'كيف تسير العملية' : 'How it works',
      stepRows: lang === 'ar'
        ? ['راجع تفاصيل المركبة', 'سجّل الدخول أو أنشئ حساباً', 'تواصل مع البائع', 'نسّق الفحص والمعاينة داخل SYBNB']
        : ['Review vehicle details', 'Sign in or create account', 'Contact the seller', 'Coordinate inspection inside SYBNB'],
    },
    MARKETPLACE: {
      mapTitle: lang === 'ar' ? 'موقع العرض' : 'Offer location',
      mapCopy: lang === 'ar' ? 'موقع العرض يظهر هنا. راجع المنطقة قبل إرسال طلب المنتج.' : 'The offer location appears here. Review the area before requesting the item.',
      mapPin: lang === 'ar' ? 'موقع العرض' : 'Offer location',
      howToBook: lang === 'ar' ? 'كيف تسير العملية' : 'How it works',
      stepRows: lang === 'ar'
        ? ['راجع تفاصيل المنتج', 'سجّل الدخول أو أنشئ حساباً', 'أرسل طلب المنتج', 'نسّق الاستلام مع البائع داخل SYBNB']
        : ['Review item details', 'Sign in or create account', 'Send item request', 'Coordinate pickup with the seller inside SYBNB'],
    },
    NEW_CONSTRUCTION: {
      mapTitle: lang === 'ar' ? 'موقع المشروع' : 'Project location',
      mapCopy: lang === 'ar' ? 'موقع المشروع يظهر هنا. افتح خرائط Google قبل حجز الزيارة.' : 'The project location appears here. Open Google Maps before booking a visit.',
      mapPin: lang === 'ar' ? 'موقع المشروع' : 'Project location',
      howToBook: lang === 'ar' ? 'كيف تسير العملية' : 'How it works',
      stepRows: lang === 'ar'
        ? ['راجع تفاصيل المشروع', 'سجّل الدخول أو أنشئ حساباً', 'احجز موعد زيارة', 'نسّق الزيارة داخل SYBNB']
        : ['Review project details', 'Sign in or create account', 'Book a visit', 'Coordinate the visit inside SYBNB'],
    },
  }
  return { ...fallback, ...(detailCopy[division] || {}) }
}


function bookingDraftKey(listingId: string) {
  return `sybnb-v6-booking-draft:${listingId}`
}

type BookingDraft = {
  dateRange: DateRange
  cancellationProtection: boolean
  payCurrency: 'SYP' | 'USD'
}

function loadBookingDraft(listingId: string): Partial<BookingDraft> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(bookingDraftKey(listingId))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function readListingReturnPath() {
  if (typeof window === 'undefined') return '/stays'
  try {
    return sessionStorage.getItem('sybnb-v6-listing-return-path') || '/stays'
  } catch {
    return '/stays'
  }
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090d', color: '#fff', padding: '20px 14px 112px', display: 'grid', gap: 14, maxWidth: 1080, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  flowNav: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  arrowButton: { width: 54, height: 54, borderRadius: 999, border: '1px solid #30384d', background: '#111827', color: '#fff', fontSize: 34, fontWeight: 900, display: 'grid', placeItems: 'center' },
  detailHero: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', minHeight: 330, overflow: 'hidden', position: 'relative' },
  heroIconButton: { position: 'absolute', top: 18, insetInlineStart: 18, zIndex: 2, width: 52, height: 52, border: 0, borderRadius: 999, background: 'rgba(0,0,0,.42)', color: '#fff', fontSize: 28, fontWeight: 900, display: 'grid', placeItems: 'center', backdropFilter: 'blur(10px)' },
  heroNextButton: { position: 'absolute', top: 18, insetInlineEnd: 18, zIndex: 2, width: 52, height: 52, border: 0, borderRadius: 999, background: 'rgba(0,0,0,.42)', color: '#fff', fontSize: 28, fontWeight: 900, display: 'grid', placeItems: 'center', backdropFilter: 'blur(10px)' },
  media: { minHeight: 330, background: '#0b1120', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 950, textTransform: 'uppercase', position: 'relative', overflow: 'hidden' },
  mediaImage: { width: '100%', height: '100%', minHeight: 330, objectFit: 'cover', display: 'block' },
  mediaBadge: { position: 'absolute', insetInlineStart: 14, bottom: 14, borderRadius: 999, background: 'rgba(8,9,15,.78)', border: '1px solid rgba(255,255,255,.18)', padding: '8px 12px', backdropFilter: 'blur(12px)' },
  dealRatingBadge: { position: 'absolute', insetInlineEnd: 14, bottom: 14 },
  instantBookBadge: { position: 'absolute', insetInlineStart: 14, top: 14, borderRadius: 999, background: 'rgba(213,169,21,.9)', color: '#1a1400', fontWeight: 950, border: '1px solid rgba(255,255,255,.25)', padding: '8px 12px', backdropFilter: 'blur(12px)' },
  detailBody: { border: '1px solid #263146', borderRadius: 8, background: '#10141f', padding: 18, display: 'grid', gap: 16, boxShadow: '0 18px 60px rgba(0,0,0,.24)' },
  titleBlock: { display: 'grid', gap: 8, justifyItems: 'center', textAlign: 'center' },
  locationLine: { color: '#9aa6ba', fontWeight: 800 },
  ratingLine: { color: '#f5c518', fontWeight: 900, fontSize: 15 },
  tabRow: { display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  tab: { minHeight: 42, border: 0, borderRadius: 999, background: '#20212b', color: '#c8cede', padding: '0 18px', fontWeight: 900 },
  tabActive: { minHeight: 42, border: '1px solid #4760ff', borderRadius: 999, background: '#4760ff', color: '#fff', padding: '0 18px', fontWeight: 950 },
  tabPanel: { display: 'grid', gap: 14 },
  figmaTrustCard: { border: '1px solid #232635', borderRadius: 18, background: '#151620', padding: 18, display: 'grid', gap: 14 },
  trustPills: { display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  bookingSteps: { display: 'grid', gap: 10 },
  bookingStep: { display: 'grid', gridTemplateColumns: '38px minmax(0, 1fr)', alignItems: 'center', gap: 10, color: '#9aa6ba' },
  instantBookNote: { border: '1px solid rgba(213,169,21,.35)', borderRadius: 8, background: 'rgba(213,169,21,.08)', color: '#d5a915', padding: 12, fontWeight: 700 },
  accountHint: { border: '1px solid rgba(82,104,255,.45)', borderRadius: 8, background: 'rgba(82,104,255,.1)', color: '#dfe5ff', padding: 12, fontWeight: 900 },
  heroContent: { padding: 18, display: 'grid', gap: 12, alignContent: 'center' },
  eyebrow: { color: '#d5a915', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', lineHeight: 1.65, margin: 0 },
  actions: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  primaryButton: { minHeight: 54, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 16px', fontSize: 18 },
  secondaryButton: { minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  secondaryLinkButton: { minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px', display: 'grid', placeItems: 'center', textDecoration: 'none' },
  directionsButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#14b8a6', color: '#06110e', fontWeight: 950, padding: '0 16px', display: 'grid', placeItems: 'center', textDecoration: 'none' },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' },
  trustGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  trustCard: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.08)', padding: 14, display: 'grid', gap: 8 },
  stepsPanel: { border: '1px solid rgba(213,169,21,.4)', borderRadius: 8, background: 'rgba(213,169,21,.08)', padding: 14, display: 'grid', gap: 12 },
  accountGate: { border: '1px solid rgba(80,105,255,.55)', borderRadius: 8, background: 'rgba(80,105,255,.1)', padding: 16, display: 'grid', gap: 14 },
  secureGateGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  secureInput: { minHeight: 48, border: '1px solid #30384d', borderRadius: 8, background: '#0d1320', color: '#fff', padding: '0 12px', fontWeight: 800 },
  secureError: { color: '#ffabab', fontSize: 13 },
  protectionChoice: { border: '1px solid rgba(213,169,21,.42)', borderRadius: 8, background: '#15140d', padding: 14, display: 'grid', gap: 12 },
  dateFieldsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  mapPanel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 12 },
  mapCanvas: { minHeight: 260, border: '1px solid rgba(82,104,255,.4)', borderRadius: 8, background: '#0c1220', display: 'grid', placeItems: 'center', color: '#fff', overflow: 'hidden', position: 'relative' },
  mapFrame: { border: 0, filter: 'saturate(.86) contrast(.9)', height: '100%', inset: 0, minHeight: 260, opacity: .74, position: 'absolute', width: '100%' },
  mapPin: { borderRadius: 999, background: '#4760ff', color: '#fff', padding: '10px 14px', fontWeight: 950, boxShadow: '0 0 0 10px rgba(82,104,255,.16)' },
  mapLocationCard: { borderRadius: 8, background: 'rgba(6,10,18,.88)', border: '1px solid rgba(255,255,255,.16)', padding: 18, display: 'grid', gap: 12, placeItems: 'center', textAlign: 'center', minWidth: 260, maxWidth: '88%', position: 'relative', zIndex: 1 },
  offlineMapCard: { alignItems: 'center', border: '1px solid rgba(229,184,11,.45)', borderRadius: 8, background: 'rgba(229,184,11,.08)', color: '#f7d45f', display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) auto', padding: 14 },
  offlineMapReady: { alignItems: 'center', border: '1px solid rgba(32,210,155,.5)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#9fffe1', display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) auto', padding: 14 },
  offlineMapButton: { minHeight: 44, border: '1px solid rgba(229,184,11,.7)', borderRadius: 8, background: '#171b29', color: '#f7d45f', fontWeight: 950, padding: '0 14px' },
  offlineMapSavedButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 18px' },
  priceSummary: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  priceSummaryCard: { border: '1px solid #30384d', borderRadius: 8, background: '#0d1320', padding: 14, display: 'grid', gap: 6, color: '#9aa6ba' },
  priceSummaryCardStrong: { border: '1px solid rgba(32,210,155,.65)', borderRadius: 8, background: 'rgba(32,210,155,.12)', padding: 14, display: 'grid', gap: 6, color: '#d8fff3' },
  metaStrip: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' },
  protectionOptions: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' },
  protectionOption: { minHeight: 118, border: '1px solid #30384d', borderRadius: 8, background: '#0d1320', color: '#fff', padding: 14, textAlign: 'start', display: 'grid', gap: 8 },
  protectionOptionActive: { minHeight: 118, border: '1px solid #20d29b', borderRadius: 8, background: '#133326', color: '#fff', padding: 14, textAlign: 'start', display: 'grid', gap: 8 },
  cancellationCutoff: { color: '#20d29b', fontStyle: 'normal', fontWeight: 800, fontSize: 13 },
  info: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 6, color: '#9aa6ba' },
  panel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', color: '#fff', padding: 14, display: 'grid', gap: 12 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  bottomActionBar: { position: 'sticky', bottom: 12, zIndex: 20, border: '1px solid #242a3b', borderRadius: 8, background: 'rgba(13,15,24,.94)', boxShadow: '0 -16px 40px rgba(0,0,0,.35)', backdropFilter: 'blur(16px)', padding: 12, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'center' },
  reserveBarPrice: { display: 'grid', gap: 2, alignContent: 'center', color: '#fff' },
}
