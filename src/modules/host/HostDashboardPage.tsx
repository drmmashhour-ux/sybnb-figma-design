import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  decidePrototypeHostRequest,
  deleteHostListing,
  editHostListing,
  fetchPrototypeHostOverview,
  markHostGuestCheckpoint,
  updatePrototypeHostInstantBook,
  renewPrototypeHostListing,
  updatePrototypeHostListingStatus,
  verifyListingClaims,
  type HostDashboardMode,
  type ListingClaimCheck,
  type ListingClaimInput,
  type PlatformHostOverview,
  type PlatformListing,
} from '../../shared/api/platformApi'
import { hostInventoryFilterGroups, sellerPropertyFilterGroups, type VisualFilterSelection } from '../../engines/filters'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { divisionText, listingTitleText, moneyText, statusText } from '../../shared/i18n/display'
import { PaymentProofUpload } from '../payments/PaymentProofUpload'
import { HostAvailabilityCalendar } from './HostAvailabilityCalendar'
import { CarPricingToolPanel } from '../cars/CarPricingToolPanel'

type Props = {
  lang: Lang
  mode?: HostDashboardMode
  focus?: ProviderFocus
}

type ProviderFocus = 'stays' | 'cars' | 'newConstruction' | 'marketplace'

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'لوحة البائع والمضيف',
    staysTitle: 'لوحة استضافة الإيجار اليومي',
    staysSubtitle: 'استضافاتك اليومية، طلبات الضيوف، الصور، خيارات الضيوف، والدفع المحمي.',
    carsTitle: 'لوحة بائع المركبات',
    carsSubtitle: 'سياراتك، طلبات العملاء، ملفات المركبة، الصور، والدفع المحمي.',
    newConstructionTitle: 'لوحة المطور العقاري',
    newConstructionSubtitle: 'مشاريعك الجديدة، طلبات الزيارة، وثائق المشروع، وخطة النشر.',
    marketplaceTitle: 'لوحة بائع السوق',
    marketplaceSubtitle: 'منتجاتك، طلبات العملاء، الصور، والتسليم المحمي.',
    subtitle: 'إعلاناتك وطلبات العملاء مباشرة من قاعدة البيانات.',
    refresh: 'تحديث',
    loading: 'جار التحميل',
    error: 'تعذر تحميل لوحة البائع',
    listings: 'الإعلانات',
    hosting: 'الاستضافات',
    approved: 'منشور',
    pending: 'قيد المراجعة',
    requests: 'الطلبات',
    requested: 'بانتظار القرار',
    confirmed: 'مؤكد',
    revenue: 'إيراد مؤكد',
    inventory: 'العقارات المعروضة',
    hostingInventory: 'العقارات المعروضة',
    inbox: 'حجوزات العملاء',
    empty: 'لا توجد عناصر بعد.',
    price: 'السعر',
    status: 'الحالة',
    guest: 'الضيف',
    division: 'القسم',
    view: 'عرض الإعلان',
    details: 'تفاصيل الطلب',
    pause: 'إيقاف مؤقت',
    resume: 'إعادة نشر',
    manageCalendar: 'تقويم الحجوزات المتوفرة',
    hideCalendar: 'إخفاء التقويم',
    pricingTool: 'أداة التسعير',
    hidePricingTool: 'إخفاء أداة التسعير',
    auctionCurrentPrice: 'السعر الحالي للمزاد',
    auctionBidCount: 'عدد العروض',
    auctionTimeLeft: 'ينتهي المزاد في',
    auctionEnded: 'المزاد',
    auctionEndedWinner: 'انتهى — تم بلوغ الحد الأدنى',
    auctionEndedNoWinner: 'انتهى — لم يتم بلوغ الحد الأدنى',
    instantBookOn: '⚡ الحجز الفوري: مفعّل',
    instantBookOff: 'تفعيل الحجز الفوري',
    expiresOn: 'ينتهي الإعلان في',
    renew: 'تجديد الإعلان',
    renewed: 'تم تجديد الإعلان',
    edit: 'تعديل',
    saveEdit: 'حفظ',
    cancelEdit: 'إلغاء',
    editTitleLabel: 'العنوان',
    editPriceLabel: 'السعر',
    deleteListing: 'حذف',
    confirm: 'تأكيد',
    cancel: 'إلغاء',
    saving: 'جار الحفظ',
    filters: 'خيارات المضيف',
    filtersHint: 'نفس رموز البحث للبائع والمضيف.',
    staysFiltersHint: 'هذه الرموز تظهر للضيف عند البحث عن الاستضافة.',
    carsFiltersHint: 'هذه الرموز تظهر للعميل عند البحث عن المركبات فقط.',
    newConstructionFiltersHint: 'هذه الرموز تظهر للعميل عند البحث عن المشاريع الجديدة فقط.',
    marketplaceFiltersHint: 'هذه الرموز تظهر للعميل عند البحث في السوق فقط.',
    providerHealth: 'صحة المزود',
    hostDashboard: 'لوحة المضيف',
    carSellerDashboard: 'لوحة بائع المركبات',
    builderDashboard: 'لوحة المطور العقاري',
    marketplaceSellerDashboard: 'لوحة بائع السوق',
    verifiedHost: 'مضيف موثوق',
    verifiedCarSeller: 'بائع مركبات موثوق',
    verifiedBuilder: 'مطور عقاري موثوق',
    verifiedMarketplaceSeller: 'بائع موثوق',
    pendingVerification: 'التوثيق قيد المراجعة',
    notVerifiedYet: 'غير موثق بعد',
    healthDegree: 'درجة الصحة',
    excellentMonth: 'أداء ممتاز هذا الشهر',
    steadyMonth: 'أداء مستقر هذا الشهر',
    needsAttentionMonth: 'الأداء يحتاج إلى تحسين',
    gettingStarted: 'أضف إعلانك الأول لتبدأ',
    viewEarningsReport: 'عرض تقرير الأرباح',
    views: 'ظهور إعلانك',
    bookingsImpact: 'زيادة الحجوزات',
    slaMaintenance: 'الحفاظ على SLA',
    activeListings: 'الإعلانات النشطة',
    createNewListing: 'إضافة إعلان جديد',
    activeCars: 'المركبات النشطة',
    activeProjects: 'المشاريع النشطة',
    activeProducts: 'المنتجات النشطة',
    inquiries: 'استفسارات',
    listingViews: 'مشاهدات',
    quality: 'الجودة',
    action: 'إجراء',
    paymentState: 'حالة المدفوعات',
    profitLog: 'سجل الأرباح',
    trustCenter: 'مركز الثقة',
    opsSupport: 'دعم العمليات',
    clientMessages: 'رسائل العملاء',
    qualityScore: 'جودة الإعلانات',
    payoutReady: 'جاهز للصرف',
    responseSla: 'سرعة الرد',
    aiImprove: 'تحسين AI',
    aiImproveCopy: 'أضف صور أقوى، شارة الثقة، وسياسة إلغاء واضحة لرفع التحويل.',
    openFinance: 'فتح المالية',
    openOperations: 'فتح العمليات',
    trustBadge: 'شارة الثقة',
    protection: 'حماية الطلبات',
    termsTitle: 'شروط حماية SYBNB',
    termsCopy: 'أتعهد بصحة الإعلان، جاهزية الاستضافة، احترام السعر والحجز، عدم طلب دفع خارجي، والالتزام بسياسة الإلغاء والنزاع.',
    termsRequired: 'يجب قبول شروط SYBNB قبل تأكيد الحجز.',
    markCheckedIn: 'تأكيد وصول الضيف',
    markCheckedOut: 'تأكيد مغادرة الضيف',
    checkedInAt: 'وصل الضيف',
    checkedOutAt: 'غادر الضيف',
    finalStamp: 'نهائي · مسار الاستضافة مؤكد · الحجز والدفع والصرف محمي',
    finalLock: 'تم إغلاق صفحة المضيف كنسخة نهائية: المضيف موثوق، الطلبات محمية، والصرف لا يتم إلا بعد تأكيد الإدارة.',
    bookingVerified: 'الحجز مؤكد',
    paymentVerified: 'الدفع مقبول',
    rulesVerified: 'شروط المضيف مقبولة',
    payoutProtected: 'الصرف محمي',
    currentListings: '٣ إعلانات حاليا',
    apply: 'تطبيق',
    insightPanelTitle: 'توصيات التسعير',
    insightPanelBody: (count: number) => `${count} من إعلاناتك فيها ليالٍ فارغة بدون سعر خاص — قد تستفيد من توصية تسعير.`,
    insightPanelEmpty: 'كل إعلاناتك تبدو جيدة الآن.',
    insightPanelCta: 'عرض التوصيات',
    hubTitle: 'مركز المضيف',
    hubMyListings: 'إعلاناتي',
    hubAvailability: 'الإتاحة والتسعير',
    hubBookings: 'الحجوزات',
    hubPayments: 'المدفوعات',
    hubPayout: 'إعدادات الصرف',
    hubInquiries: 'الاستفسارات',
    checkListing: 'فحص إعلاني (AI)',
    checking: 'جار الفحص...',
    claimAllGood: 'لا ملاحظات — الصور تدعم الخيارات المعلنة.',
    claimAdvisoryNote: 'ملاحظات إرشادية فقط — يمكنك النشر. أضف صورة واضحة أو أزل الخيار.',
    verdictMissing: 'لا توجد صورة إثبات',
    verdictNo: 'الصورة لا تُظهر هذا الخيار بوضوح',
    verdictUnclear: 'الصورة غير واضحة لهذا الخيار',
  },
  en: {
    back: 'Back to landing',
    title: 'Seller / Host Dashboard',
    staysTitle: 'Daily Hosting Dashboard',
    staysSubtitle: 'Your daily hosting stays, guest requests, photos, filters, and protected payments.',
    carsTitle: 'Vehicle Seller Dashboard',
    carsSubtitle: 'Your cars, customer requests, vehicle files, photos, and protected payments.',
    newConstructionTitle: 'Developer Dashboard',
    newConstructionSubtitle: 'Your new projects, visit requests, project documents, and publishing plan.',
    marketplaceTitle: 'Marketplace Seller Dashboard',
    marketplaceSubtitle: 'Your products, customer requests, photos, and protected fulfillment.',
    subtitle: 'Your listings and customer requests directly from PostgreSQL.',
    refresh: 'Refresh',
    loading: 'Loading',
    error: 'Could not load seller dashboard',
    listings: 'Listings',
    hosting: 'Hosting',
    approved: 'Approved',
    pending: 'Pending review',
    requests: 'Requests',
    requested: 'Waiting decision',
    confirmed: 'Confirmed',
    revenue: 'Confirmed revenue',
    inventory: 'Listing inventory',
    hostingInventory: 'Hosting inventory',
    inbox: 'Customer requests',
    empty: 'No items yet.',
    price: 'Price',
    status: 'Status',
    guest: 'Guest',
    division: 'Division',
    view: 'View listing',
    details: 'Request details',
    pause: 'Pause',
    resume: 'Resume',
    manageCalendar: 'Availability calendar',
    hideCalendar: 'Hide calendar',
    pricingTool: 'Pricing tool',
    hidePricingTool: 'Hide pricing tool',
    auctionCurrentPrice: 'Current auction price',
    auctionBidCount: 'Bids',
    auctionTimeLeft: 'Auction ends',
    auctionEnded: 'Auction',
    auctionEndedWinner: 'Ended — reserve met',
    auctionEndedNoWinner: 'Ended — reserve not met',
    instantBookOn: '⚡ Instant Book: On',
    instantBookOff: 'Enable Instant Book',
    expiresOn: 'Listing expires on',
    renew: 'Renew listing',
    renewed: 'Listing renewed',
    edit: 'Edit',
    saveEdit: 'Save',
    cancelEdit: 'Cancel',
    editTitleLabel: 'Title',
    editPriceLabel: 'Price',
    deleteListing: 'Delete',
    confirm: 'Confirm',
    cancel: 'Cancel',
    saving: 'Saving',
    filters: 'Inventory filters',
    filtersHint: 'Same search symbols for seller and host.',
    staysFiltersHint: 'These symbols appear to guests when they search hosting stays.',
    carsFiltersHint: 'These symbols appear to clients when they search cars only.',
    newConstructionFiltersHint: 'These symbols appear to clients when they search new projects only.',
    marketplaceFiltersHint: 'These symbols appear to clients when they search marketplace only.',
    providerHealth: 'Provider health',
    hostDashboard: 'Host Dashboard',
    carSellerDashboard: 'Vehicle Seller Dashboard',
    builderDashboard: 'Developer Dashboard',
    marketplaceSellerDashboard: 'Marketplace Seller Dashboard',
    verifiedHost: 'Verified host',
    verifiedCarSeller: 'Verified vehicle seller',
    verifiedBuilder: 'Verified developer',
    verifiedMarketplaceSeller: 'Verified seller',
    pendingVerification: 'Verification in review',
    notVerifiedYet: 'Not verified yet',
    healthDegree: 'Health score',
    excellentMonth: 'Excellent performance this month',
    steadyMonth: 'Steady performance this month',
    needsAttentionMonth: 'Performance needs attention',
    gettingStarted: 'Add your first listing to get started',
    viewEarningsReport: 'View earnings report',
    views: 'Listing visibility',
    bookingsImpact: 'More bookings',
    slaMaintenance: 'SLA maintenance',
    activeListings: 'Active listings',
    createNewListing: 'Create new listing',
    activeCars: 'Active cars',
    activeProjects: 'Active projects',
    activeProducts: 'Active products',
    inquiries: 'Inquiries',
    listingViews: 'Views',
    quality: 'Quality',
    action: 'Action',
    paymentState: 'Payment status',
    profitLog: 'Profit log',
    trustCenter: 'Trust Center',
    opsSupport: 'Operations support',
    clientMessages: 'Client messages',
    qualityScore: 'Listing quality',
    payoutReady: 'Payout ready',
    responseSla: 'Response SLA',
    aiImprove: 'AI improvements',
    aiImproveCopy: 'Add stronger photos, trust badge, and clear cancellation policy to raise conversion.',
    openFinance: 'Open finance',
    openOperations: 'Open operations',
    trustBadge: 'Trust badge',
    protection: 'Request protection',
    termsTitle: 'SYBNB protection rules',
    termsCopy: 'I confirm the listing is accurate, the stay is ready, the price and booking will be honored, no outside payment will be requested, and cancellation/dispute rules apply.',
    termsRequired: 'You must accept SYBNB rules before confirming the booking.',
    markCheckedIn: 'Mark guest checked in',
    markCheckedOut: 'Mark guest checked out',
    checkedInAt: 'Guest checked in',
    checkedOutAt: 'Guest checked out',
    finalStamp: 'FINAL · HOSTING TUNNEL VERIFIED · BOOKING PAYMENT PAYOUT PROTECTED',
    finalLock: 'Host page is locked as a final edition: verified host, protected requests, and payout only after admin confirmation.',
    bookingVerified: 'Booking confirmed',
    paymentVerified: 'Payment approved',
    rulesVerified: 'Host rules accepted',
    payoutProtected: 'Payout protected',
    currentListings: '3 active listings',
    apply: 'Apply',
    insightPanelTitle: 'Pricing insights',
    insightPanelBody: (count: number) => `${count} of your listings have open nights with no special price set — a pricing insight could help.`,
    insightPanelEmpty: 'All your listings look good right now.',
    insightPanelCta: 'View recommendations',
    hubTitle: 'Host hub',
    hubMyListings: 'My Listings',
    hubAvailability: 'Availability & Pricing',
    hubBookings: 'Bookings',
    hubPayments: 'Payments',
    hubPayout: 'Payout settings',
    hubInquiries: 'Inquiries',
    checkListing: 'Check my listing (AI)',
    checking: 'Checking...',
    claimAllGood: 'No flags — your photos support the claimed options.',
    claimAdvisoryNote: 'Advisory only — you can still publish. Add a clear photo or remove the option.',
    verdictMissing: 'No proof photo',
    verdictNo: 'Photo does not clearly show this option',
    verdictUnclear: 'Photo is unclear for this option',
  },
}

export function HostDashboardPage({ lang, mode = 'host', focus }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const isStaysHost = focus === 'stays'
  const providerCopy = getProviderCopy(t, isAr, focus)
  const [overview, setOverview] = useState<PlatformHostOverview | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'saving'>('loading')
  const [message, setMessage] = useState('')
  const [activeRequestId, setActiveRequestId] = useState('')
  const [activeListingId, setActiveListingId] = useState('')
  const [calendarListingId, setCalendarListingId] = useState('')
  const [pricingToolListingId, setPricingToolListingId] = useState('')
  const [claimChecks, setClaimChecks] = useState<Record<string, ListingClaimCheck[]>>({})
  const [claimCheckedIds, setClaimCheckedIds] = useState<Set<string>>(() => new Set())
  const [claimBusyId, setClaimBusyId] = useState('')
  const [editingListingId, setEditingListingId] = useState('')
  const [editTitleAr, setEditTitleAr] = useState('')
  const [editPriceMinor, setEditPriceMinor] = useState('')
  const [acceptedRequestTerms, setAcceptedRequestTerms] = useState<Record<string, boolean>>({})
  const [hostDocumentFiles, setHostDocumentFiles] = useState<string[]>([])
  const [hostDocumentsSent, setHostDocumentsSent] = useState(false)
  const [inventoryFilters, setInventoryFilters] = useState<VisualFilterSelection>({
    propertyType: 'any',
    roomType: 'any',
    bedType: 'any',
    amenities: [],
    trust: [],
  })

  useEffect(() => {
    void loadOverview()
  }, [mode])

  const visibleListings = useMemo(
    () => (overview?.listings.filter((listing) => matchesProviderFocus(listing, focus)) || []),
    [focus, overview?.listings],
  )
  const visibleRequests = useMemo(
    () => (overview?.requests.filter((request) => request.listing && matchesProviderFocus(request.listing, focus)) || []),
    [focus, overview?.requests],
  )
  const listingQualityScores = visibleListings.map((listing) => listingQualityScore(listing))
  const averageQualityScore = listingQualityScores.length
    ? Math.round(listingQualityScores.reduce((sum, score) => sum + score, 0) / listingQualityScores.length)
    : 0
  const approvedListingCount = visibleListings.filter((listing) => listing.status.toUpperCase() === 'APPROVED').length
  const confirmedRequestCount = visibleRequests.filter((request) => request.status.toUpperCase() === 'CONFIRMED').length
  const requestedRequestCount = visibleRequests.filter((request) => request.status.toUpperCase() === 'REQUESTED').length
  const listingApprovalScore = visibleListings.length ? Math.round((approvedListingCount / visibleListings.length) * 100) : 0
  const requestConfirmationScore = visibleRequests.length ? Math.round((confirmedRequestCount / visibleRequests.length) * 100) : 100
  const responseScore = visibleRequests.length ? clamp(100 - requestedRequestCount * 12 + confirmedRequestCount * 4, 45, 100) : 100
  const trustScore = clamp(
    Math.round(listingApprovalScore * 0.45 + requestConfirmationScore * 0.35 + (hostDocumentsSent ? 20 : hostDocumentFiles.length ? 10 : 0)),
    0,
    100,
  )
  const healthScore = clamp(Math.round((trustScore + averageQualityScore + responseScore) / 3), 0, 100)
  // A brand-new host (no listings, no requests) has no real performance yet — "needs attention" reads
  // as a problem before they've done anything, so show a neutral getting-started state instead.
  const hasHostActivity = visibleListings.length > 0 || visibleRequests.length > 0
  const isDocumentVerified = overview?.host.idDocumentStatus === 'APPROVED'
  const verificationStatusText = isDocumentVerified
    ? providerCopy.verifiedLabel
    : overview?.host.idDocumentStatus === 'PENDING_REVIEW'
      ? t.pendingVerification
      : t.notVerifiedYet
  const dashboardCurrency = visibleListings[0]?.currency || overview?.requests[0]?.currency || 'SYP'
  const activeListingsLabel = isAr
    ? `${visibleListings.length} ${providerCopy.activeUnit}`
    : `${visibleListings.length} ${providerCopy.activeUnit}`

  const hostDocumentsCopy = getHostDocumentsCopy(isAr, focus)
    || (isAr
      ? {
        title: 'مستندات المضيف والاستضافة',
        help: 'ارفع الهوية، إثبات الملكية أو التفويض، صور العقار، وأي ترخيص مطلوب. الإدارة تراجعها قبل تفعيل الثقة والصرف.',
        cta: 'رفع مستندات المضيف',
        empty: 'لم يتم رفع مستندات بعد. أضف PDF أو PNG أو JPG.',
        send: 'إرسال المستندات للإدارة',
        sent: 'تم إرسال مستندات المضيف للإدارة',
      }
      : {
        title: 'Host and hosting documents',
        help: 'Upload ID, ownership proof or authorization, property photos, and any required license. Admin reviews them before trust and payout are enabled.',
        cta: 'Upload host documents',
        empty: 'No host documents uploaded yet. Add PDF, PNG, or JPG.',
        send: 'Send documents to admin',
        sent: 'Host documents sent to admin',
      })

  function addHostDocumentFiles(fileList: FileList | null) {
    const names = Array.from(fileList || []).map((file) => file.name).filter(Boolean)
    if (!names.length) return
    setHostDocumentFiles((current) => Array.from(new Set([...current, ...names])))
    setHostDocumentsSent(false)
  }

  async function loadOverview() {
    setStatus('loading')
    setMessage('')

    try {
      setOverview(await fetchPrototypeHostOverview(mode))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function decideRequest(bookingId: string, decision: 'CONFIRM' | 'CANCEL') {
    if (decision === 'CONFIRM' && !acceptedRequestTerms[bookingId]) {
      setStatus('error')
      setMessage(t.termsRequired)
      return
    }

    setStatus('saving')
    setActiveRequestId(bookingId)
    setMessage('')

    try {
      const booking = await decidePrototypeHostRequest(bookingId, decision, mode, {
        acceptedTerms: decision === 'CONFIRM' ? true : undefined,
        termsVersion: 'SYBNB_HOST_BOOKING_RULES_V1',
      })
      const nextStatus = booking.status || (decision === 'CONFIRM' ? 'CONFIRMED' : 'CANCELLED')
      setOverview((current) => current ? {
        ...current,
        requests: current.requests.map((request) => request.id === bookingId ? { ...request, ...booking, status: nextStatus } : request),
      } : current)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveRequestId('')
    }
  }

  async function markCheckpoint(bookingId: string, action: 'CHECK_IN' | 'CHECK_OUT') {
    setStatus('saving')
    setActiveRequestId(bookingId)
    setMessage('')

    try {
      const booking = await markHostGuestCheckpoint(bookingId, action, mode)
      setOverview((current) => current ? {
        ...current,
        requests: current.requests.map((request) => request.id === bookingId ? { ...request, ...booking } : request),
      } : current)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveRequestId('')
    }
  }

  async function updateListing(listingId: string, nextStatus: 'PAUSED' | 'APPROVED') {
    setStatus('saving')
    setActiveListingId(listingId)
    setMessage('')

    try {
      await updatePrototypeHostListingStatus(listingId, nextStatus, mode)
      setOverview(await fetchPrototypeHostOverview(mode))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveListingId('')
    }
  }

  async function renewListing(listing: PlatformListing) {
    const isPaidPlanDivision = listing.division === 'CARS' || listing.division === 'NEW_CONSTRUCTION'
    // Paid-plan divisions (CARS/NEW_CONSTRUCTION) renew a real paid window, unlike RENTALS/BUY's
    // free self-renew -- re-confirm intent the same way the wizard's own "I paid" step does,
    // rather than silently re-charging the expiry clock on a click.
    if (isPaidPlanDivision) {
      const confirmed = window.confirm(isAr ? 'سيتم تجديد الخطة المدفوعة لهذا الإعلان. هل تؤكد أنك دفعت خطة تجديد جديدة؟' : 'This will renew the paid plan for this listing. Confirm you have paid for a new renewal?')
      if (!confirmed) return
    }

    setStatus('saving')
    setActiveListingId(listing.id)
    setMessage('')

    try {
      await renewPrototypeHostListing(listing.id, mode, isPaidPlanDivision ? true : undefined)
      setOverview(await fetchPrototypeHostOverview(mode))
      setMessage(t.renewed)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveListingId('')
    }
  }

  function startEditListing(listing: PlatformListing) {
    setEditingListingId(listing.id)
    setEditTitleAr(listing.titleAr)
    setEditPriceMinor(String(listing.priceMinor))
  }

  async function saveEditListing(listingId: string) {
    setStatus('saving')
    setActiveListingId(listingId)
    setMessage('')

    try {
      const priceMinor = Number(editPriceMinor)
      await editHostListing(listingId, { titleAr: editTitleAr, priceMinor }, mode)
      setOverview(await fetchPrototypeHostOverview(mode))
      setEditingListingId('')
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveListingId('')
    }
  }

  async function deleteListing(listingId: string) {
    const confirmed = window.confirm(isAr ? 'هل تريد حذف هذا الإعلان نهائياً؟' : 'Delete this listing permanently?')
    if (!confirmed) return

    setStatus('saving')
    setActiveListingId(listingId)
    setMessage('')

    try {
      await deleteHostListing(listingId, mode)
      setOverview(await fetchPrototypeHostOverview(mode))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveListingId('')
    }
  }

  async function runClaimCheck(listing: PlatformListing) {
    const claims = claimInputsForListing(listing)
    setClaimBusyId(listing.id)
    setMessage('')
    try {
      const checks = await verifyListingClaims(listing.id, claims, mode)
      setClaimChecks((current) => ({ ...current, [listing.id]: checks }))
      setClaimCheckedIds((current) => new Set(current).add(listing.id))
    } catch (error) {
      // Advisory feature — a failure must never disrupt the host. Surface a soft note only.
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setClaimBusyId('')
    }
  }

  async function toggleInstantBook(listingId: string, enabled: boolean) {
    setStatus('saving')
    setActiveListingId(listingId)
    setMessage('')

    try {
      await updatePrototypeHostInstantBook(listingId, enabled, mode)
      setOverview(await fetchPrototypeHostOverview(mode))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveListingId('')
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.topBar}>
        <div style={styles.topIcons}>
          <button aria-label={isAr ? 'التنبيهات' : 'Notifications'} style={styles.iconCircle} onClick={() => (window.location.hash = '/immocontact')}>⌁</button>
          <button aria-label={isAr ? 'الإعدادات' : 'Settings'} style={styles.iconCircle} onClick={() => (window.location.hash = '/status')}>⚙</button>
        </div>
        <div style={styles.hostIdentity}>
          <strong>{providerCopy.dashboardTitle}</strong>
          <span>{providerCopy.verifiedLine(overview?.host.displayName, verificationStatusText)}</span>
        </div>
        <div style={styles.avatar}>{(overview?.host.displayName || 'A').slice(0, 1)}</div>
      </section>

      <section style={styles.hostHub} aria-label={t.hubTitle}>
        <span style={styles.hostHubTitle}>{t.hubTitle}</span>
        <div style={styles.hostHubGrid}>
          {([
            [t.hubMyListings, '/host/stays', '▤'],
            [t.hubAvailability, '/host/stays', '▦'],
            [t.hubBookings, '/host/bookings', '▧'],
            [t.hubPayments, '/host/earnings', '▰'],
            [t.hubPayout, '/host/payout', '⎘'],
            [t.hubInquiries, '/host/inquiries', '✉'],
          ] as const).map(([label, route, icon]) => (
            <button key={label} style={styles.hostHubLink} onClick={() => (window.location.hash = route)}>
              <span style={styles.hostHubIcon} aria-hidden="true">{icon}</span>
              <strong>{label}</strong>
            </button>
          ))}
        </div>
      </section>

      <section style={styles.providerHealth}>
        <article style={styles.healthHero}>
          <span>SYBNB · {verificationStatusText}</span>
          <strong>{trustScore}%</strong>
        </article>
        <div style={styles.hostMetric}>
          <span>{t.payoutReady}</span>
          <strong>{moneyText(overview?.totals.revenueMinor || 0, dashboardCurrency, lang)}</strong>
          <button style={styles.earningsLink} onClick={() => (window.location.hash = '/host/earnings')}>
            {t.viewEarningsReport}
          </button>
        </div>
        <div style={styles.hostMetric}>
          <span>{t.qualityScore}</span>
          <strong style={{ color: '#e5b80b' }}>{averageQualityScore}%</strong>
          <span style={styles.qualityTrack}><b style={{ ...styles.trackFill, width: `${averageQualityScore}%` }} /></span>
        </div>
        <div style={styles.healthScore}>
          <span>{t.healthDegree}</span>
          <strong>{hasHostActivity ? healthScore : '—'}</strong>
          <small>{hasHostActivity ? '/100' : ''}</small>
          <em>{!hasHostActivity ? t.gettingStarted : healthScore >= 80 ? t.excellentMonth : healthScore >= 50 ? t.steadyMonth : t.needsAttentionMonth}</em>
        </div>
      </section>

      {status === 'error' && <section style={styles.alert}>{message}</section>}

      <section style={styles.aiPanel}>
        <div style={styles.aiTitle}>
          <strong>{t.insightPanelTitle}</strong>
          <span>✣</span>
        </div>
        <p>
          {(overview?.insightSignal?.listingsNeedingAttention ?? 0) > 0
            ? t.insightPanelBody(overview!.insightSignal!.listingsNeedingAttention)
            : t.insightPanelEmpty}
        </p>
        <button style={styles.goldButton} onClick={() => (window.location.hash = '/host/insights')}>
          {t.insightPanelCta}
        </button>
      </section>

      <section style={styles.activeListings}>
        <div style={styles.sectionHead}>
          <h2>{t.activeListings}</h2>
          <small>{providerCopy.subtitle}</small>
          <span>{activeListingsLabel}</span>
          {mode === 'host' && (
            <button style={styles.primaryButton} onClick={() => (window.location.hash = '/sell/listing-wizard')}>
              + {t.createNewListing}
            </button>
          )}
        </div>
        <div style={styles.hostTable}>
          <div style={styles.hostTableHead}>
            <span>{isAr ? 'العنوان' : 'Title'}</span>
            <span>{t.quality}</span>
            <span>{t.status}</span>
            <span>{t.listingViews}</span>
            <span>{t.inquiries}</span>
            <span>{t.action}</span>
          </div>
          {visibleListings.slice(0, 3).map((listing) => {
            const quality = listingQualityScore(listing)
            const statusLabel = quality >= 75
              ? (isAr ? 'نشط' : 'Active')
              : quality >= 50
                ? (isAr ? 'تحسين مطلوب' : 'Needs improvement')
                : (isAr ? 'غير مكتمل' : 'Incomplete')
            const statusTone = quality >= 75 ? styles.statusGreen : quality >= 50 ? styles.statusGold : styles.statusRed
            return (
              <article key={listing.id} style={styles.hostTableRow}>
                <strong>{listingTitle(listing, lang)}</strong>
                <span style={styles.tableQuality}><b style={{ ...styles.trackFill, width: `${quality}%` }} /></span>
                <span style={{ ...styles.statusPill, ...statusTone }}>{statusLabel}</span>
                <span>{listingViewCount(listing, visibleRequests)}</span>
                <span>{listingInquiryCount(listing, visibleRequests)}</span>
                <button style={styles.editButton} onClick={() => (window.location.hash = `/listing/${listing.id}`)}>✎</button>
              </article>
            )
          })}
        </div>
      </section>

      <section style={styles.documentsPanel}>
        <PaymentProofUpload
          cta={hostDocumentsCopy.cta}
          emptyText={hostDocumentsCopy.empty}
          files={hostDocumentFiles}
          help={hostDocumentsCopy.help}
          lang={lang}
          onAddFiles={addHostDocumentFiles}
          title={hostDocumentsCopy.title}
        />
        <button
          disabled={!hostDocumentFiles.length}
          style={hostDocumentsSent ? styles.primaryButton : styles.secondaryButton}
          onClick={() => setHostDocumentsSent(true)}
        >
          {hostDocumentsSent ? hostDocumentsCopy.sent : hostDocumentsCopy.send}
        </button>
      </section>

      <section style={styles.filtersPanel}>
        <div style={styles.filtersHead}>
          <div>
            <strong>{t.filters}</strong>
            <span>{providerCopy.filtersHint}</span>
          </div>
          <b>{selectedFilterLabels(hostInventoryFilterGroups, inventoryFilters, lang).length}</b>
        </div>
        <VisualFilterPanel
          compact
          groups={hostInventoryFilterGroups}
          lang={lang}
          selection={inventoryFilters}
          onChange={setInventoryFilters}
        />
      </section>

      <section style={styles.grid}>
        <Panel title={providerCopy.inventoryTitle} empty={t.empty}>
          {visibleListings.map((listing) => (
            <article key={listing.id} style={styles.card}>
              {editingListingId === listing.id ? (
                <div style={styles.editForm}>
                  <label>
                    <span>{t.editTitleLabel}</span>
                    <input onChange={(event) => setEditTitleAr(event.target.value)} value={editTitleAr} />
                  </label>
                  <label>
                    <span>{t.editPriceLabel}</span>
                    <input dir="ltr" inputMode="numeric" onChange={(event) => setEditPriceMinor(event.target.value)} value={editPriceMinor} />
                  </label>
                  <div style={styles.actions}>
                    <button disabled={activeListingId === listing.id} style={styles.primaryButton} onClick={() => void saveEditListing(listing.id)}>
                      {activeListingId === listing.id ? t.saving : t.saveEdit}
                    </button>
                    <button style={styles.secondaryButton} onClick={() => setEditingListingId('')}>
                      {t.cancelEdit}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <strong>{listingTitle(listing, lang)}</strong>
                  <Info label={t.division} value={divisionText(listing.division, lang)} dir={isAr ? 'rtl' : 'ltr'} />
                  <Info label={t.status} value={statusText(listing.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />
                  <Info label={t.price} value={moneyText(listing.priceMinor, listing.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} />
                  {listing.auction && listing.auction.status === 'OPEN' && (
                    <>
                      <Info label={t.auctionCurrentPrice} value={moneyText(listing.auction.currentPriceMinor, listing.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} />
                      <Info label={t.auctionBidCount} value={String(listing.auction.bidCount)} dir={isAr ? 'rtl' : 'ltr'} />
                      <Info
                        label={t.auctionTimeLeft}
                        value={new Date(listing.auction.endsAt).toLocaleString(isAr ? 'ar-SY' : 'en-US')}
                        dir={isAr ? 'rtl' : 'ltr'}
                      />
                    </>
                  )}
                  {listing.auction && listing.auction.status === 'ENDED' && (
                    <Info
                      label={t.auctionEnded}
                      value={listing.auction.reserveMet ? t.auctionEndedWinner : t.auctionEndedNoWinner}
                      dir={isAr ? 'rtl' : 'ltr'}
                    />
                  )}
                  {listing.expiresAt && (
                    <Info
                      label={t.expiresOn}
                      value={new Date(listing.expiresAt).toLocaleDateString(isAr ? 'ar-SY' : 'en-US', { timeZone: 'UTC' })}
                      dir={isAr ? 'rtl' : 'ltr'}
                    />
                  )}
                  <div style={styles.actions}>
                    <button style={styles.secondaryButton} onClick={() => (window.location.hash = `/listing/${listing.id}`)}>
                      {t.view}
                    </button>
                    {((listing.division === 'RENTALS' || listing.division === 'BUY') ||
                      ((listing.division === 'CARS' || listing.division === 'NEW_CONSTRUCTION'))) &&
                      listing.status === 'APPROVED' && (
                      <button
                        disabled={activeListingId === listing.id}
                        style={styles.secondaryButton}
                        onClick={() => void renewListing(listing)}
                      >
                        {activeListingId === listing.id ? t.saving : t.renew}
                      </button>
                    )}
                    {['DRAFT', 'REJECTED', 'APPROVED'].includes(listing.status) && (
                      <button
                        disabled={activeListingId === listing.id}
                        style={styles.secondaryButton}
                        onClick={() => startEditListing(listing)}
                      >
                        {t.edit}
                      </button>
                    )}
                    {['DRAFT', 'REJECTED', 'PAUSED'].includes(listing.status) && (
                      <button
                        disabled={activeListingId === listing.id}
                        style={styles.dangerButton}
                        onClick={() => void deleteListing(listing.id)}
                      >
                        {t.deleteListing}
                      </button>
                    )}
                {listing.status === 'PAUSED' ? (
                  <button
                    disabled={activeListingId === listing.id}
                    style={styles.primaryButton}
                    onClick={() => void updateListing(listing.id, 'APPROVED')}
                  >
                    {activeListingId === listing.id ? t.saving : t.resume}
                  </button>
                ) : (
                  <button
                    disabled={activeListingId === listing.id}
                    style={styles.dangerButton}
                    onClick={() => void updateListing(listing.id, 'PAUSED')}
                  >
                    {activeListingId === listing.id ? t.saving : t.pause}
                  </button>
                )}
                <button
                  style={styles.secondaryButton}
                  onClick={() => setCalendarListingId((current) => (current === listing.id ? '' : listing.id))}
                >
                  {calendarListingId === listing.id ? t.hideCalendar : t.manageCalendar}
                </button>
                {listing.division === 'STAYS' && (
                  <button
                    disabled={activeListingId === listing.id}
                    style={listing.instantBookEnabled ? styles.primaryButton : styles.secondaryButton}
                    onClick={() => void toggleInstantBook(listing.id, !listing.instantBookEnabled)}
                  >
                    {activeListingId === listing.id ? t.saving : listing.instantBookEnabled ? t.instantBookOn : t.instantBookOff}
                  </button>
                )}
                {listing.division === 'CARS' && (
                  <button
                    style={styles.secondaryButton}
                    onClick={() => setPricingToolListingId((current) => (current === listing.id ? '' : listing.id))}
                  >
                    {pricingToolListingId === listing.id ? t.hidePricingTool : t.pricingTool}
                  </button>
                )}
              </div>
              {claimSlotsForListing(listing).length > 0 && (
                <div style={styles.claimCheckPanel}>
                  <button
                    style={styles.secondaryButton}
                    disabled={claimBusyId === listing.id}
                    onClick={() => void runClaimCheck(listing)}
                  >
                    {claimBusyId === listing.id ? t.checking : `🔎 ${t.checkListing}`}
                  </button>
                  {claimCheckedIds.has(listing.id) && (() => {
                    const flags = (claimChecks[listing.id] || []).filter((check) => check.verdict !== 'yes')
                    if (flags.length === 0) {
                      return <p style={styles.claimAllGood}>{t.claimAllGood}</p>
                    }
                    return (
                      <div style={styles.claimFlags}>
                        <span style={styles.claimAdvisory}>{t.claimAdvisoryNote}</span>
                        {flags.map((flag) => {
                          const amenity = isAr ? flag.amenityAr : flag.amenityEn
                          const verdictLabel =
                            flag.verdict === 'missing' ? t.verdictMissing : flag.verdict === 'no' ? t.verdictNo : t.verdictUnclear
                          return (
                            <div key={flag.slotId} style={styles.claimFlagRow}>
                              🚩 <b>‘{amenity}’</b> — {verdictLabel}
                              {flag.reason ? <small style={styles.claimReason}> · {flag.reason}</small> : null}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              )}
              {calendarListingId === listing.id && (
                <HostAvailabilityCalendar
                  lang={lang}
                  listingId={listing.id}
                  basePriceMinor={listing.priceMinor}
                  currency={listing.currency}
                  mode={mode}
                />
              )}
              {pricingToolListingId === listing.id && <CarPricingToolPanel lang={lang} listing={listing} />}
                </>
              )}
            </article>
          ))}
        </Panel>

        <Panel title={t.inbox} empty={t.empty}>
          {visibleRequests.map((request) => (
            <article key={request.id} style={styles.card}>
              <strong>{request.listing ? listingTitle(request.listing, lang) : request.id.slice(0, 8).toUpperCase()}</strong>
              <Info label={t.guest} value={request.guest?.displayName || request.guestId.slice(0, 8).toUpperCase()} />
              <Info label={t.status} value={statusText(request.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />
              {request.payments?.some((payment) => payment.status === 'REFUNDED') ? (
                <Info label={t.paymentState} value={statusText('REFUNDED', lang)} dir={isAr ? 'rtl' : 'ltr'} />
              ) : null}
              <Info label={t.price} value={moneyText(request.amountMinor, request.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} />
              {request.status === 'CONFIRMED' ? (
                <button style={styles.secondaryButton} onClick={() => (window.location.hash = `/booking/${request.id}`)}>
                  {t.details}
                </button>
              ) : null}
              {['CONFIRMED', 'COMPLETED'].includes(request.status) && (
                <div style={styles.actions}>
                  {request.guestCheckedInAt ? (
                    <Info label={t.checkedInAt} value={new Date(request.guestCheckedInAt).toLocaleString(isAr ? 'ar-SY' : 'en-US')} dir={isAr ? 'rtl' : 'ltr'} />
                  ) : (
                    <button
                      disabled={activeRequestId === request.id}
                      style={styles.secondaryButton}
                      onClick={() => void markCheckpoint(request.id, 'CHECK_IN')}
                    >
                      {activeRequestId === request.id ? t.saving : t.markCheckedIn}
                    </button>
                  )}
                  {request.guestCheckedOutAt ? (
                    <Info label={t.checkedOutAt} value={new Date(request.guestCheckedOutAt).toLocaleString(isAr ? 'ar-SY' : 'en-US')} dir={isAr ? 'rtl' : 'ltr'} />
                  ) : (
                    <button
                      disabled={activeRequestId === request.id || !request.guestCheckedInAt}
                      style={styles.secondaryButton}
                      onClick={() => void markCheckpoint(request.id, 'CHECK_OUT')}
                    >
                      {activeRequestId === request.id ? t.saving : t.markCheckedOut}
                    </button>
                  )}
                </div>
              )}
              {['REQUESTED', 'CONFIRMED'].includes(request.status) && (
                <div style={styles.actions}>
                  {request.status === 'REQUESTED' ? (
                    <>
                      <label style={styles.termsBox}>
                        <input
                          type="checkbox"
                          checked={Boolean(acceptedRequestTerms[request.id])}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked
                            setAcceptedRequestTerms((current) => ({
                              ...current,
                              [request.id]: checked,
                            }))
                          }}
                        />
                        <span>
                          <strong>{t.termsTitle}</strong>
                          <small>{t.termsCopy}</small>
                        </span>
                      </label>
                      <button
                        disabled={activeRequestId === request.id || !acceptedRequestTerms[request.id]}
                        style={styles.primaryButton}
                        onClick={() => void decideRequest(request.id, 'CONFIRM')}
                      >
                        {activeRequestId === request.id ? t.saving : t.confirm}
                      </button>
                    </>
                  ) : <span />}
                  <button
                    disabled={activeRequestId === request.id}
                    style={styles.dangerButton}
                    onClick={() => void decideRequest(request.id, 'CANCEL')}
                  >
                    {t.cancel}
                  </button>
                </div>
              )}
            </article>
          ))}
        </Panel>
      </section>

      <section style={styles.hostQuickLinks}>
        {[
          [t.paymentState, '/finance', '▰'],
          [t.profitLog, '/finance', '↗'],
          [t.trustCenter, '/trust-center', '♢'],
          [t.opsSupport, '/operations', '?'],
          [t.clientMessages, '/host/inquiries', '✉'],
        ].map(([label, route, icon]) => (
          <button key={label} style={styles.quickLink} onClick={() => (window.location.hash = String(route))}>
            <strong>{label}</strong>
            <span>{icon}</span>
          </button>
        ))}
      </section>

      <div style={styles.hostFinalStamp}>{t.finalStamp}</div>
    </main>
  )
}

function Panel({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : []

  return (
    <section style={styles.panel}>
      <h2 style={styles.panelTitle}>{title}</h2>
      {items.length ? <div style={styles.stack}>{children}</div> : <p style={styles.empty}>{empty}</p>}
    </section>
  )
}

function Info({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div style={styles.info}>
      <span>{label}</span>
      <b dir={dir}>{value}</b>
    </div>
  )
}

function listingTitle(listing: Pick<PlatformListing, 'id' | 'division' | 'titleAr' | 'titleEn'>, lang: Lang) {
  return listingTitleText(listing, lang)
}

const OFFER_PROOF_PREFIX = 'offerProof:'

// Look up the bilingual label for a claimed offer-proof amenity slot (offerProof:<optionId>) from
// the same seller filter catalog the wizard uses — no hard-coded/duplicated amenity list.
function offerProofLabel(slotId: string): { ar: string; en: string } {
  const optionId = slotId.startsWith(OFFER_PROOF_PREFIX) ? slotId.slice(OFFER_PROOF_PREFIX.length) : slotId
  for (const group of sellerPropertyFilterGroups) {
    const option = group.options.find((item) => item.id === optionId)
    if (option) return option.label
  }
  return { ar: optionId, en: optionId }
}

function claimSlotsForListing(listing: PlatformListing): string[] {
  const slots = (listing.metadata as Record<string, unknown> | undefined)?.selectedOfferProofSlots
  if (!Array.isArray(slots)) return []
  return slots.filter((slot): slot is string => typeof slot === 'string' && slot.startsWith(OFFER_PROOF_PREFIX))
}

function claimInputsForListing(listing: PlatformListing): ListingClaimInput[] {
  return claimSlotsForListing(listing).map((slotId) => {
    const label = offerProofLabel(slotId)
    return { slotId, labelAr: label.ar, labelEn: label.en }
  })
}

function matchesProviderFocus(listing: Pick<PlatformListing, 'division'>, focus?: ProviderFocus) {
  if (!focus) return true
  const division = listing.division.toUpperCase()
  if (focus === 'stays') return division === 'STAYS'
  if (focus === 'cars') return division === 'CARS'
  if (focus === 'newConstruction') return division === 'NEW_CONSTRUCTION'
  if (focus === 'marketplace') return division === 'MARKETPLACE'
  return true
}

function getProviderCopy(t: typeof copy.ar | typeof copy.en, isAr: boolean, focus?: ProviderFocus) {
  if (focus === 'cars') {
    return {
      dashboardTitle: t.carSellerDashboard,
      subtitle: t.carsSubtitle,
      verifiedLabel: t.verifiedCarSeller,
      filtersHint: t.carsFiltersHint,
      inventoryTitle: t.activeCars,
      activeUnit: isAr ? 'مركبات حاليا' : 'active cars',
      verifiedLine: (name: string | undefined, statusText: string) => (name ? `${name} · ${statusText}` : statusText),
    }
  }
  if (focus === 'newConstruction') {
    return {
      dashboardTitle: t.builderDashboard,
      subtitle: t.newConstructionSubtitle,
      verifiedLabel: t.verifiedBuilder,
      filtersHint: t.newConstructionFiltersHint,
      inventoryTitle: t.activeProjects,
      activeUnit: isAr ? 'مشاريع حاليا' : 'active projects',
      verifiedLine: (name: string | undefined, statusText: string) => (name ? `${name} · ${statusText}` : statusText),
    }
  }
  if (focus === 'marketplace') {
    return {
      dashboardTitle: t.marketplaceSellerDashboard,
      subtitle: t.marketplaceSubtitle,
      verifiedLabel: t.verifiedMarketplaceSeller,
      filtersHint: t.marketplaceFiltersHint,
      inventoryTitle: t.activeProducts,
      activeUnit: isAr ? 'منتجات حاليا' : 'active products',
      verifiedLine: (name: string | undefined, statusText: string) => (name ? `${name} · ${statusText}` : statusText),
    }
  }
  if (focus === 'stays') {
    return {
      dashboardTitle: t.hostDashboard,
      subtitle: t.staysSubtitle,
      verifiedLabel: t.verifiedHost,
      filtersHint: t.staysFiltersHint,
      inventoryTitle: t.hostingInventory,
      activeUnit: isAr ? 'استضافات حاليا' : 'active stays',
      verifiedLine: (name: string | undefined, statusText: string) => (name ? `${name} · ${statusText}` : statusText),
    }
  }
  return {
    dashboardTitle: t.title,
    subtitle: t.subtitle,
    verifiedLabel: t.verifiedHost,
    filtersHint: t.filtersHint,
    inventoryTitle: t.inventory,
    activeUnit: isAr ? 'إعلانات حاليا' : 'active listings',
    verifiedLine: (name: string | undefined, statusText: string) => (name ? `${name} · ${statusText}` : statusText),
  }
}

function getHostDocumentsCopy(isAr: boolean, focus?: ProviderFocus) {
  if (focus === 'cars') {
    return isAr
      ? {
          title: 'مستندات بائع المركبات',
          help: 'ارفع رخصة المعرض أو الوكيل، ملكية المركبة، صور السيارة، الفحص الفني، وأي تفويض مطلوب قبل نشر المركبة.',
          cta: 'رفع مستندات المركبة',
          empty: 'لم يتم رفع مستندات المركبة بعد. أضف PDF أو PNG أو JPG.',
          send: 'إرسال مستندات المركبة للإدارة',
          sent: 'تم إرسال مستندات المركبة للإدارة',
        }
      : {
          title: 'Vehicle seller documents',
          help: 'Upload dealer/agent license, vehicle ownership, car photos, inspection files, and any required authorization before publishing.',
          cta: 'Upload vehicle documents',
          empty: 'No vehicle documents uploaded yet. Add PDF, PNG, or JPG.',
          send: 'Send vehicle documents to admin',
          sent: 'Vehicle documents sent to admin',
        }
  }
  if (focus === 'newConstruction') {
    return isAr
      ? {
          title: 'مستندات المطور والمشروع',
          help: 'ارفع رخصة المطور، سند الأرض أو الملكية، رخص البناء، المخططات، صور المشروع، وجدول الوحدات قبل نشر المشروع.',
          cta: 'رفع مستندات المشروع',
          empty: 'لم يتم رفع مستندات المشروع بعد. أضف PDF أو PNG أو JPG.',
          send: 'إرسال مستندات المشروع للإدارة',
          sent: 'تم إرسال مستندات المشروع للإدارة',
        }
      : {
          title: 'Developer and project documents',
          help: 'Upload developer license, land/ownership deed, building permits, plans, project photos, and unit schedule before publishing.',
          cta: 'Upload project documents',
          empty: 'No project documents uploaded yet. Add PDF, PNG, or JPG.',
          send: 'Send project documents to admin',
          sent: 'Project documents sent to admin',
        }
  }
  if (focus === 'marketplace') {
    return isAr
      ? {
          title: 'مستندات بائع السوق',
          help: 'ارفع هوية البائع، صور المنتج، فاتورة أو إثبات الملكية، وأي تفويض مطلوب قبل نشر المنتج.',
          cta: 'رفع مستندات المنتج',
          empty: 'لم يتم رفع مستندات المنتج بعد. أضف PDF أو PNG أو JPG.',
          send: 'إرسال مستندات المنتج للإدارة',
          sent: 'تم إرسال مستندات المنتج للإدارة',
        }
      : {
          title: 'Marketplace seller documents',
          help: 'Upload seller ID, product photos, invoice/ownership proof, and any required authorization before publishing.',
          cta: 'Upload product documents',
          empty: 'No product documents uploaded yet. Add PDF, PNG, or JPG.',
          send: 'Send product documents to admin',
          sent: 'Product documents sent to admin',
        }
  }
  return null
}

function listingQualityScore(listing: PlatformListing) {
  const status = listing.status.toUpperCase()
  const mediaCount = Array.isArray(listing.media) ? listing.media.length : 0
  let score = status === 'APPROVED' ? 60 : status.includes('PENDING') || status.includes('REQUEST') ? 45 : 35
  if (listing.description?.trim()) score += 10
  if (listing.priceMinor > 0) score += 10
  if (listing.location) score += 5
  score += Math.min(15, mediaCount * 5)
  return clamp(score, 20, 98)
}

function listingViewCount(listing: PlatformListing, requests: PlatformHostOverview['requests']) {
  const stored = metadataNumber(listing.metadata, ['views', 'viewCount', 'listingViews'])
  if (stored) return stored
  const mediaCount = Array.isArray(listing.media) ? listing.media.length : 0
  const requestCount = requests.filter((request) => request.listingId === listing.id).length
  const approvalBoost = listing.status.toUpperCase() === 'APPROVED' ? 1 : 0
  return requestCount * 35 + mediaCount * 12 + approvalBoost * 25
}

function listingInquiryCount(listing: PlatformListing, requests: PlatformHostOverview['requests']) {
  const stored = metadataNumber(listing.metadata, ['inquiries', 'inquiryCount'])
  if (stored) return stored
  return requests.filter((request) => request.listingId === listing.id).length
}

function metadataNumber(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 24, maxWidth: 1240, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  topBar: { display: 'grid', gap: 14, gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center' },
  topIcons: { display: 'flex', gap: 14 },
  iconCircle: { width: 54, height: 54, borderRadius: 999, border: '1px solid #242735', background: '#101119', color: '#fff', fontWeight: 950, fontSize: 20 },
  hostIdentity: { display: 'grid', gap: 6, justifyItems: 'end', alignContent: 'center' },
  avatar: { width: 62, height: 62, borderRadius: 999, background: '#1d2332', display: 'grid', placeItems: 'center', fontWeight: 950 },
  finalLockPanel: { border: '1px solid rgba(32,210,155,.55)', borderRadius: 8, background: 'linear-gradient(135deg, rgba(32,210,155,.12), rgba(82,108,255,.08))', padding: 16, display: 'grid', gap: 10 },
  finalChecks: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', color: '#20d29b' },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118', display: 'grid', gap: 14 },
  eyebrow: { color: '#d5a915', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  stats: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))' },
  stat: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#9aa6ba', display: 'grid', gap: 4, padding: 12 },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  filtersPanel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', display: 'grid', gap: 12, padding: 14 },
  filtersHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', color: '#d5a915' },
  providerHealth: { border: '1px solid #242735', borderRadius: 8, background: '#121219', padding: 28, display: 'grid', gap: 22, gridTemplateColumns: '1fr 1fr 1fr 1fr', alignItems: 'center' },
  healthHero: { border: '1px solid rgba(32,210,155,.85)', borderRadius: 999, background: 'rgba(32,210,155,.08)', padding: 18, display: 'grid', gap: 8, textAlign: 'center', color: '#20d29b' },
  hostMetric: { minHeight: 104, borderInlineStart: '1px solid #242735', paddingInlineStart: 26, display: 'grid', gap: 8, alignContent: 'center', color: '#8d92a2' },
  earningsLink: { justifySelf: 'start', border: 0, background: 'transparent', color: '#8ea0ff', fontWeight: 900, fontSize: 12, padding: 0, cursor: 'pointer' },
  qualityTrack: { height: 7, borderRadius: 999, background: '#23222b', overflow: 'hidden', display: 'block' },
  trackFill: { display: 'block', height: '100%', borderRadius: 999, background: '#e5b80b' },
  healthScore: { justifySelf: 'end', width: 128, height: 128, borderRadius: 999, border: '12px solid #20d29b', display: 'grid', placeItems: 'center', alignContent: 'center', textAlign: 'center', color: '#fff' },
  documentsPanel: { border: '1px solid rgba(32,210,155,.45)', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 12 },
  aiPanel: { border: '1px solid rgba(229,184,11,.9)', borderRadius: 8, background: '#101016', padding: 32, display: 'grid', gap: 20 },
  aiTitle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#e5b80b', fontSize: 22 },
  aiSuggestion: { border: '1px solid #151722', borderRadius: 8, background: '#090a0f', minHeight: 116, padding: 22, display: 'grid', gap: 18, gridTemplateColumns: '110px minmax(0, 1fr)', alignItems: 'center' },
  goldButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#d5a915', color: '#08090f', fontWeight: 950 },
  activeListings: { display: 'grid', gap: 16 },
  sectionHead: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'end' },
  hostTable: { border: '1px solid #242735', borderRadius: 8, background: '#101016', overflowX: 'auto', overflowY: 'hidden' },
  hostTableHead: { display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) 90px 90px 70px', gap: 12, padding: '14px 18px', borderBottom: '1px solid #242735', color: '#8d92a2', fontSize: 13, minWidth: 710 },
  hostTableRow: { display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) 90px 90px 70px', gap: 12, alignItems: 'center', padding: '18px', borderBottom: '1px solid #242735', minWidth: 710 },
  tableQuality: { height: 7, borderRadius: 999, background: '#23222b', overflow: 'hidden', display: 'block' },
  statusPill: { borderRadius: 8, padding: '8px 10px', textAlign: 'center', fontWeight: 900, fontSize: 12 },
  statusGreen: { background: 'rgba(32,210,155,.14)', color: '#20d29b', border: '1px solid rgba(32,210,155,.42)' },
  statusGold: { background: 'rgba(229,184,11,.13)', color: '#e5b80b', border: '1px solid rgba(229,184,11,.42)' },
  statusRed: { background: 'rgba(255,78,119,.13)', color: '#ff4e77', border: '1px solid rgba(255,78,119,.42)' },
  editButton: { width: 38, height: 38, borderRadius: 8, border: '1px solid rgba(82,108,255,.5)', background: 'rgba(82,108,255,.12)', color: '#526cff', fontWeight: 950 },
  hostHub: { border: '1px solid #242735', borderRadius: 8, background: '#111118', padding: 18, display: 'grid', gap: 14 },
  hostHubTitle: { color: '#d5a915', fontWeight: 950, fontSize: 13, letterSpacing: 1 },
  hostHubGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  hostHubLink: { border: '1px solid #1e1e2a', borderRadius: 10, background: '#0c1220', color: '#fff', minHeight: 92, padding: 14, display: 'grid', gap: 8, alignContent: 'center', justifyItems: 'start', fontWeight: 900, cursor: 'pointer' },
  hostHubIcon: { width: 40, height: 40, borderRadius: 10, background: 'rgba(82,108,255,.14)', color: '#8ea0ff', display: 'grid', placeItems: 'center', fontSize: 20 },
  hostQuickLinks: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' },
  quickLink: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', color: '#fff', minHeight: 86, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 950 },
  hostFinalStamp: { justifySelf: 'start', border: '1px solid rgba(229,184,11,.65)', borderRadius: 999, background: 'rgba(229,184,11,.12)', color: '#e5b80b', padding: '8px 12px', fontSize: 11, fontWeight: 950 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' },
  panel: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 14 },
  panelTitle: { margin: '0 0 12px', fontSize: 20 },
  stack: { display: 'grid', gap: 10 },
  card: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 12, display: 'grid', gap: 8 },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr', alignItems: 'stretch' },
  termsBox: { gridColumn: '1 / -1', border: '1px solid rgba(229,184,11,.55)', borderRadius: 8, background: 'rgba(229,184,11,.08)', color: '#f7d45f', padding: 12, display: 'grid', gap: 10, gridTemplateColumns: '28px minmax(0, 1fr)', alignItems: 'start', lineHeight: 1.45 },
  dangerButton: { minHeight: 42, border: '1px solid rgba(255,96,96,.5)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ffd1d1', fontWeight: 900, padding: '0 14px' },
  editForm: { display: 'grid', gap: 10 },
  info: { display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba' },
  empty: { color: '#9aa6ba', margin: 0 },
  claimCheckPanel: { display: 'grid', gap: 10, marginTop: 4 },
  claimAllGood: { margin: 0, color: '#20d29b', fontWeight: 800, fontSize: 13 },
  claimFlags: { border: '1px solid rgba(229,184,11,.5)', borderRadius: 8, background: 'rgba(229,184,11,.08)', padding: 12, display: 'grid', gap: 8 },
  claimAdvisory: { color: '#f7d45f', fontSize: 12, fontWeight: 800, lineHeight: 1.5 },
  claimFlagRow: { color: '#ffe6a3', fontSize: 13, fontWeight: 700, lineHeight: 1.5 },
  claimReason: { color: '#c9b26a', fontWeight: 600 },
}
