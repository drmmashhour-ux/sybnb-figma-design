import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { renterPropertyFilterGroups, type VisualFilterSelection } from '../../engines/filters'
import { getCity, getGovernorate, labelFor, SYRIA_GOVERNORATES } from '../../engines/search'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { fetchApprovedListings, sendListingInquiryMessage, type PlatformListing } from '../../shared/api/platformApi'
import { listingDescriptionText, listingTitleText, moneyText, statusText } from '../../shared/i18n/display'
import { PaymentCapsule } from '../payments/PaymentCapsule'

type Props = {
  lang: Lang
  mode?: 'rentals' | 'buy'
}

type RentalRequest = {
  id: string
  listingId: string
  listingTitle: string
  documents: string[]
  createdAt: string
  status: 'SENT_TO_IMMOCONTACT'
}

type SearchPanel = 'governorate' | 'city' | 'street' | 'date' | null
type SortMode = 'newest' | 'lowest'

const GUEST_RETURN_PATH_KEY = 'sybnb.v6.guestReturnPath'
const GUEST_TOKEN_KEY = 'sybnb-v6-guest-token'

const dateOptions = ['هذا الأسبوع', 'هذا الشهر', '3 أشهر', 'تاريخ مفتوح']
const mainGroupOptions = [
  { id: 'apartment', ar: 'شقة', en: 'Apartment' },
  { id: 'villa', ar: 'فيلا', en: 'Villa' },
  { id: 'room', ar: 'غرفة', en: 'Room' },
  { id: 'office', ar: 'مكتب', en: 'Office' },
  { id: 'shop', ar: 'محل', en: 'Shop' },
  { id: 'land', ar: 'أرض', en: 'Land' },
]

const copy = {
  ar: {
    previous: 'السابق',
    next: 'التالي',
    logo: 'SYBNB',
    navTitle: 'الإيجار',
    login: 'تسجيل الدخول',
    signup: 'إنشاء حساب',
    search: 'بحث',
    searchCapsule: 'كبسولة البحث',
    searchCapsuleHint: 'اختر الموقع والتاريخ ثم افتح خيارات الباحث.',
    rouletteHint: 'اسحب الشريط لاختيار المنطقة بسرعة.',
    applied: 'تم تطبيق كبسولة البحث.',
    beforeSearch: 'ابدأ من كبسولة البحث لاختيار نوع العقار والموقع. بعد الضغط على بحث تظهر النتائج ثم تفاصيل العقار.',
    mainGroup: 'نوع العقار',
    chooseGovernorate: 'اختر المحافظة',
    chooseCity: 'اختر المدينة',
    chooseStreet: 'اختر الحي / الشارع',
    chooseDate: 'اختر التاريخ',
    governorate: 'المحافظة',
    city: 'المدينة',
    street: 'حي / شارع',
    dateOptional: 'التاريخ اختياري',
    newest: 'الأحدث',
    lowestPrice: 'الأقل سعراً',
    availableResults: 'النتائج المتاحة',
    sendRequest: 'إرسال طلب',
    viewDetails: 'عرض التفاصيل',
    chooseAfterAccount: 'افتح الحساب أولاً',
    eyebrow: 'الإيجار الشهري',
    title: 'مسار المستأجر',
    subtitle: 'بحث منفصل للإيجار الشهري: اختر العقار، افتح حساب، ارفع مستندات المستأجر، ثم أرسل طلب التواصل عبر IMMOContact.',
    searchTitle: 'عقارات شهرية فقط',
    filterTitle: 'خيارات الباحث',
    showFilters: 'فتح خيارات الباحث',
    hideFilters: 'إغلاق خيارات الباحث',
    selectedFilters: 'الاختيارات',
    noFilters: 'اختر خيارات البحث بنفس نظام STR.',
    renterTunnel: 'نفق المستأجر',
    live: 'نتائج مباشرة',
    selected: 'العقار المختار',
    detailTitle: 'تفاصيل العقار المختار',
    protected: 'محمي عبر SYBNB',
    trustedOwner: 'مالك موثوق',
    fastContact: 'تواصل سريع',
    detailSteps: ['افتح حساب المستأجر', 'ارفع مستندات الطلب', 'أرسل الطلب إلى IMMOContact', 'انتظر موافقة المالك والإدارة'],
    noSelection: 'اختر عقاراً من النتائج قبل إرسال الطلب.',
    choose: 'اختيار العقار',
    openAccount: 'فتح حساب المستأجر',
    accountGateTitle: 'افتح حساب المستأجر للمتابعة',
    accountGateText: 'يمكنك مشاهدة التفاصيل أولاً، لكن إرسال الطلب ورفع المستندات يتم بعد تسجيل الدخول أو إنشاء حساب.',
    accountReady: 'حساب المستأجر جاهز',
    docsTitle: 'مستندات المستأجر',
    docsHint: 'ارفع الهوية، إثبات العمل أو الدخل، وأي ملف يدعم طلب الإيجار الشهري. PDF / PNG / JPG.',
    docsUpload: 'رفع المستندات',
    docsReady: 'مستندات مرفوعة',
    agreementTitle: 'اتفاقية طلب الإيجار الشهري',
    agreementCopy: 'أوافق أن بياناتي صحيحة، وأن التواصل والعقد والمستندات تتم عبر SYBNB و IMMOContact، وأن أي نزاع أو تغيير في الشروط يراجع عبر المنصة قبل أي اتفاق خارجي.',
    send: 'إرسال طلب التواصل',
    sending: 'جارٍ الإرسال...',
    sent: 'تم إرسال طلب المستأجر إلى IMMOContact',
    openInbox: 'فتح IMMOContact',
    required: 'افتح حساب المستأجر، اختر عقاراً، ارفع مستنداً واحداً على الأقل، واقبل الاتفاقية قبل الإرسال.',
    price: 'الإيجار الشهري',
    owner: 'المالك',
    status: 'الحالة',
    empty: 'لا توجد عقارات شهرية منشورة بعد.',
    loading: 'جار التحميل',
    error: 'تعذر تحميل عقارات الإيجار الشهري',
    steps: ['بحث الإيجار الشهري', 'اختيار العقار', 'فتح حساب المستأجر', 'رفع المستندات', 'إرسال IMMOContact'],
  },
  en: {
    previous: 'Back',
    next: 'Next',
    logo: 'SYBNB',
    navTitle: 'Rentals',
    login: 'Sign in',
    signup: 'Create account',
    search: 'Search',
    searchCapsule: 'Search capsule',
    searchCapsuleHint: 'Choose location and date, then open searcher choices.',
    rouletteHint: 'Swipe the strip to choose the area quickly.',
    applied: 'Search capsule applied.',
    beforeSearch: 'Start with the search capsule to choose property type and location. After Search, results and property details appear.',
    mainGroup: 'Property type',
    chooseGovernorate: 'Choose governorate',
    chooseCity: 'Choose city',
    chooseStreet: 'Choose district / street',
    chooseDate: 'Choose date',
    governorate: 'Governorate',
    city: 'City',
    street: 'District / street',
    dateOptional: 'Date optional',
    newest: 'Newest',
    lowestPrice: 'Lowest price',
    availableResults: 'Available results',
    sendRequest: 'Send request',
    viewDetails: 'View details',
    chooseAfterAccount: 'Open account first',
    eyebrow: 'Monthly rentals',
    title: 'Renter tunnel',
    subtitle: 'A separate monthly-rental flow: choose a property, open an account, upload renter documents, then send the contact request through IMMOContact.',
    searchTitle: 'Monthly properties only',
    filterTitle: 'Searcher choices',
    showFilters: 'Open searcher choices',
    hideFilters: 'Close searcher choices',
    selectedFilters: 'Selected choices',
    noFilters: 'Choose search options using the same STR system.',
    renterTunnel: 'Renter tunnel',
    live: 'Live results',
    selected: 'Selected property',
    detailTitle: 'Selected property details',
    protected: 'Protected through SYBNB',
    trustedOwner: 'Trusted owner',
    fastContact: 'Fast contact',
    detailSteps: ['Open renter account', 'Upload request documents', 'Send to IMMOContact', 'Wait for owner and admin approval'],
    noSelection: 'Choose a property from the results before sending the request.',
    choose: 'Choose property',
    openAccount: 'Open renter account',
    accountGateTitle: 'Open renter account to continue',
    accountGateText: 'You can inspect the details first, but request submission and document upload require sign in or account creation.',
    accountReady: 'Renter account ready',
    docsTitle: 'Renter documents',
    docsHint: 'Upload ID, work or income proof, and any file supporting the monthly rental request. PDF / PNG / JPG.',
    docsUpload: 'Upload documents',
    docsReady: 'Documents uploaded',
    agreementTitle: 'Monthly Rental Request Agreement',
    agreementCopy: 'I agree my details are accurate, and that contact, contract, and documents remain inside SYBNB and IMMOContact. Any dispute or term change must be reviewed through the platform before any outside agreement.',
    send: 'Send contact request',
    sending: 'Sending...',
    sent: 'Renter request sent to IMMOContact',
    openInbox: 'Open IMMOContact',
    required: 'Open renter account, choose a property, upload at least one document, and accept the agreement before sending.',
    price: 'Monthly rent',
    owner: 'Owner',
    status: 'Status',
    empty: 'No published monthly rentals yet.',
    loading: 'Loading',
    error: 'Could not load monthly rentals',
    steps: ['Monthly search', 'Choose property', 'Open renter account', 'Upload documents', 'Send IMMOContact'],
  },
}

const buyerCopy = {
  ar: {
    navTitle: 'شراء عقار',
    searchCapsuleHint: 'اختر الموقع ونوع العقار ثم افتح خيارات الباحث قبل طلب الزيارة.',
    beforeSearch: 'ابدأ من كبسولة البحث لاختيار نوع العقار والموقع. بعد الضغط على بحث تظهر عقارات البيع ثم تفاصيل العقار.',
    availableResults: 'عقارات البيع المتاحة',
    sendRequest: 'طلب زيارة',
    eyebrow: 'شراء العقار',
    title: 'مسار المشتري',
    subtitle: 'بحث منفصل للمشتري: اختر العقار، افتح حساب، ارفع مستندات المشتري، ثم أرسل طلب الزيارة أو التواصل عبر IMMOContact.',
    searchTitle: 'عقارات للبيع فقط',
    renterTunnel: 'نفق المشتري',
    selected: 'العقار المختار',
    detailTitle: 'تفاصيل العقار المختار',
    detailSteps: ['افتح حساب المشتري', 'ارفع مستندات الطلب', 'أرسل طلب الزيارة عبر IMMOContact', 'انتظر موافقة المالك والإدارة'],
    choose: 'اختيار العقار',
    openAccount: 'فتح حساب المشتري',
    accountGateTitle: 'افتح حساب المشتري للمتابعة',
    accountGateText: 'يمكنك مشاهدة التفاصيل أولاً، لكن طلب الزيارة ورفع مستندات الشراء يتم بعد تسجيل الدخول أو إنشاء حساب.',
    accountReady: 'حساب المشتري جاهز',
    docsTitle: 'مستندات المشتري',
    docsHint: 'ارفع الهوية، إثبات القدرة المالية أو التمويل، وأي ملف يدعم طلب شراء العقار. PDF / PNG / JPG.',
    agreementTitle: 'اتفاقية طلب شراء العقار',
    agreementCopy: 'أوافق أن بياناتي صحيحة، وأن التواصل والزيارة والمستندات تتم عبر SYBNB و IMMOContact، وأن أي عرض أو تغيير في الشروط يراجع عبر المنصة قبل أي اتفاق خارجي.',
    send: 'إرسال طلب الزيارة',
    sending: 'جارٍ الإرسال...',
    sent: 'تم إرسال طلب المشتري إلى IMMOContact',
    required: 'افتح حساب المشتري، اختر عقاراً، ارفع مستنداً واحداً على الأقل، واقبل الاتفاقية قبل الإرسال.',
    price: 'سعر العقار',
    empty: 'لا توجد عقارات للبيع منشورة بعد.',
    error: 'تعذر تحميل عقارات الشراء',
    steps: ['بحث شراء العقار', 'اختيار العقار', 'فتح حساب المشتري', 'رفع المستندات', 'إرسال IMMOContact'],
  },
  en: {
    navTitle: 'Buy Property',
    searchCapsuleHint: 'Choose location and property type, then open searcher choices before requesting a visit.',
    beforeSearch: 'Start with the search capsule to choose property type and location. After Search, sale results and property details appear.',
    availableResults: 'Available sale properties',
    sendRequest: 'Request visit',
    eyebrow: 'Buy property',
    title: 'Buyer tunnel',
    subtitle: 'A separate buyer flow: choose a property, open an account, upload buyer documents, then send a visit or contact request through IMMOContact.',
    searchTitle: 'Sale properties only',
    renterTunnel: 'Buyer tunnel',
    selected: 'Selected property',
    detailTitle: 'Selected property details',
    detailSteps: ['Open buyer account', 'Upload request documents', 'Send visit request through IMMOContact', 'Wait for owner and admin approval'],
    choose: 'Choose property',
    openAccount: 'Open buyer account',
    accountGateTitle: 'Open buyer account to continue',
    accountGateText: 'You can inspect the details first, but visit requests and buyer document upload require sign in or account creation.',
    accountReady: 'Buyer account ready',
    docsTitle: 'Buyer documents',
    docsHint: 'Upload ID, proof of funds or financing, and any file supporting the purchase request. PDF / PNG / JPG.',
    agreementTitle: 'Property Purchase Request Agreement',
    agreementCopy: 'I agree my details are accurate, and that contact, visits, and documents remain inside SYBNB and IMMOContact. Any offer or term change must be reviewed through the platform before any outside agreement.',
    send: 'Send visit request',
    sending: 'Sending...',
    sent: 'Buyer request sent to IMMOContact',
    required: 'Open buyer account, choose a property, upload at least one document, and accept the agreement before sending.',
    price: 'Property price',
    empty: 'No published sale properties yet.',
    error: 'Could not load sale properties',
    steps: ['Buyer search', 'Choose property', 'Open buyer account', 'Upload documents', 'Send IMMOContact'],
  },
}

export function RentalsPage({ lang, mode = 'rentals' }: Props) {
  const isBuyMode = mode === 'buy'
  const t = isBuyMode ? { ...copy[lang], ...buyerCopy[lang] } : copy[lang]
  const isAr = lang === 'ar'
  const [listings, setListings] = useState<PlatformListing[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [documents, setDocuments] = useState<string[]>([])
  const [acceptedAgreement, setAcceptedAgreement] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [sentRequest, setSentRequest] = useState<RentalRequest | null>(null)
  const [sendState, setSendState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [showFilters, setShowFilters] = useState(true)
  const [hasSearched, setHasSearched] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [activeSearchPanel, setActiveSearchPanel] = useState<SearchPanel>(null)
  const [selectedGovernorate, setSelectedGovernorate] = useState('damascus')
  const [selectedCity, setSelectedCity] = useState('damascus-city')
  const [selectedStreet, setSelectedStreet] = useState('old-city')
  const [selectedDate, setSelectedDate] = useState('')
  const [visualFilters, setVisualFilters] = useState<VisualFilterSelection>({
    sort: 'newest',
    priceBand: 'any',
    propertyType: 'apartment',
    roomType: 'any',
    bedType: 'any',
    amenities: ['wifi', 'parking'],
    access: [],
    trust: ['verifiedHost'],
    payments: ['shamCash'],
  })
  const hasGuestAccount = typeof window !== 'undefined' && Boolean(sessionStorage.getItem(GUEST_TOKEN_KEY))
  const activeFilterLabels = useMemo(
    () => selectedFilterLabels(renterPropertyFilterGroups, visualFilters, lang),
    [lang, visualFilters],
  )
  const selectedGovernorateData = getGovernorate(selectedGovernorate)
  const selectedCityData = getCity(selectedGovernorate, selectedCity)
  const selectedAreaData = selectedCityData?.areas.find((area) => area.key === selectedStreet)
  const selectedGovernorateLabel = labelFor(lang, selectedGovernorateData)
  const selectedCityLabel = labelFor(lang, selectedCityData)
  const selectedStreetLabel = labelFor(lang, selectedAreaData)
  const currentPanelOptions = (
    activeSearchPanel === 'governorate'
      ? SYRIA_GOVERNORATES.map((item) => ({ key: item.key, label: labelFor(lang, item) }))
      : activeSearchPanel === 'city'
        ? (selectedGovernorateData?.cities || []).map((item) => ({ key: item.key, label: labelFor(lang, item) }))
        : activeSearchPanel === 'street'
          ? (selectedCityData?.areas || []).map((item) => ({ key: item.key, label: labelFor(lang, item) }))
          : dateOptions.map((item) => ({ key: item, label: item }))
  )
  const visibleListings = useMemo(() => {
    if (sortMode === 'lowest') {
      return [...listings].sort((left, right) => left.priceMinor - right.priceMinor)
    }
    return listings
  }, [listings, sortMode])

  const selectedListing = useMemo(
    () => visibleListings.find((listing) => listing.id === selectedId) || visibleListings[0],
    [visibleListings, selectedId],
  )

  useEffect(() => {
    void loadRentals()
  }, [mode])

  async function loadRentals() {
    setStatus('loading')
    setMessage('')
    try {
      const nextListings = await fetchApprovedListings(isBuyMode ? 'BUY' : 'RENTALS')
      setListings(nextListings)
      setSelectedId(nextListings[0]?.id || '')
      setStatus('ready')
    } catch (error) {
      setListings([])
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  function openAccount() {
    sessionStorage.setItem(GUEST_RETURN_PATH_KEY, isBuyMode ? '/buy' : '/rentals')
    window.location.hash = '/account/open'
  }

  function openContactCenter() {
    if (!hasGuestAccount) {
      sessionStorage.setItem(GUEST_RETURN_PATH_KEY, '/immocontact')
      window.location.hash = '/account/open'
      return
    }
    window.location.hash = '/immocontact'
  }

  function chooseListing(listingId: string) {
    setSelectedId(listingId)
    setMessage('')
  }

  function chooseGovernorate(value: string) {
    const nextGovernorate = getGovernorate(value)
    const nextCity = nextGovernorate?.cities[0]
    setSelectedGovernorate(value)
    setSelectedCity(nextCity?.key || '')
    setSelectedStreet(nextCity?.areas[0]?.key || '')
    setActiveSearchPanel('city')
  }

  function chooseCity(value: string) {
    const nextCity = getCity(selectedGovernorate, value)
    setSelectedCity(value)
    setSelectedStreet(nextCity?.areas[0]?.key || '')
    setActiveSearchPanel('street')
  }

  function applySearchCapsule() {
    setMessage(t.applied)
    setActiveSearchPanel(null)
    setHasSearched(true)
    setShowFilters(false)
  }

  function chooseMainGroup(value: string) {
    setVisualFilters((current) => ({ ...current, propertyType: value }))
  }

  function uploadDocuments(files: FileList | null) {
    const names = Array.from(files || []).map((file) => file.name)
    if (!names.length) return
    setDocuments((current) => [...current, ...names])
  }

  async function sendRequest() {
    if (!hasGuestAccount || !selectedListing || documents.length === 0 || !acceptedAgreement) {
      setMessage(t.required)
      if (!hasGuestAccount) openAccount()
      return
    }

    setSendState('saving')
    setMessage('')

    const introBody = isAr
      ? `طلب ${isBuyMode ? 'شراء' : 'استئجار'} جديد على "${listingTitleText(selectedListing, lang)}".\nالمستندات المرفوعة: ${documents.join('، ')}`
      : `New ${isBuyMode ? 'purchase' : 'rental'} request for "${listingTitleText(selectedListing, lang)}".\nUploaded documents: ${documents.join(', ')}`

    try {
      await sendListingInquiryMessage(selectedListing.id, introBody)

      const request: RentalRequest = {
        id: `${isBuyMode ? 'BUY' : 'MR'}-${Date.now().toString(36).toUpperCase()}`,
        listingId: selectedListing.id,
        listingTitle: listingTitleText(selectedListing, lang),
        documents,
        createdAt: new Date().toISOString(),
        status: 'SENT_TO_IMMOCONTACT',
      }
      setSentRequest(request)
      setMessage(t.sent)
      setSendState('idle')
    } catch (error) {
      setSendState('error')
      setMessage(error instanceof Error ? error.message : t.required)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <header style={styles.appHeader}>
        <strong style={styles.logo}>{t.logo}</strong>
        <span style={styles.navTitle}>{t.navTitle}</span>
        <div style={styles.headerActions}>
          <button style={styles.headerButton} onClick={openAccount}>{t.signup}</button>
          <button style={styles.headerButtonActive} onClick={openAccount}>{t.login}</button>
        </div>
      </header>

      <section style={styles.searchCapsule}>
        <div style={styles.searchCapsuleText}>
          <span style={styles.eyebrow}>{t.searchCapsule}</span>
          <strong>{t.searchTitle}</strong>
          <small>{t.searchCapsuleHint}</small>
        </div>
        <section style={styles.mainGroupCapsule}>
          <strong>{t.mainGroup}</strong>
          <div style={styles.mainGroupGrid}>
            {mainGroupOptions.map((option) => (
              <button
                key={option.id}
                style={visualFilters.propertyType === option.id ? styles.mainGroupActive : styles.mainGroupButton}
                onClick={() => chooseMainGroup(option.id)}
              >
                {isAr ? option.ar : option.en}
              </button>
            ))}
          </div>
        </section>
        <div style={styles.searchHero}>
          <button style={styles.searchButton} onClick={applySearchCapsule}>{t.search}</button>
          <button style={activeSearchPanel === 'governorate' ? styles.searchPillActive : styles.searchPill} onClick={() => setActiveSearchPanel(activeSearchPanel === 'governorate' ? null : 'governorate')}>{selectedGovernorateLabel || t.governorate}</button>
          <button style={activeSearchPanel === 'city' ? styles.searchPillActive : styles.searchPill} onClick={() => setActiveSearchPanel(activeSearchPanel === 'city' ? null : 'city')}>{selectedCityLabel || t.city}</button>
          <button style={activeSearchPanel === 'street' ? styles.searchPillActive : styles.searchPill} onClick={() => setActiveSearchPanel(activeSearchPanel === 'street' ? null : 'street')}>{selectedStreetLabel || t.street}</button>
          <button style={activeSearchPanel === 'date' ? styles.searchPillActive : styles.searchPill} onClick={() => setActiveSearchPanel(activeSearchPanel === 'date' ? null : 'date')}>{selectedDate || t.dateOptional}</button>
          <button style={styles.searchPillActive} onClick={() => setShowFilters((current) => !current)}>
            {showFilters ? t.hideFilters : t.showFilters}
          </button>
        </div>
        {activeSearchPanel ? (
          <section style={styles.searchTouchPanel}>
            <div style={styles.rouletteHeader}>
              <strong>
                {activeSearchPanel === 'governorate'
                  ? t.chooseGovernorate
                  : activeSearchPanel === 'city'
                    ? t.chooseCity
                    : activeSearchPanel === 'street'
                      ? t.chooseStreet
                      : t.chooseDate}
              </strong>
              <span>{t.rouletteHint}</span>
            </div>
            <div style={styles.rouletteTrack}>
              {currentPanelOptions.map((option) => {
                const selected = option.key === (
                  activeSearchPanel === 'governorate'
                    ? selectedGovernorate
                    : activeSearchPanel === 'city'
                      ? selectedCity
                      : activeSearchPanel === 'street'
                        ? selectedStreet
                        : selectedDate
                )
                return (
                  <button
                    key={option.key}
                    style={selected ? styles.rouletteOptionActive : styles.rouletteOption}
                    onClick={() => {
                      if (activeSearchPanel === 'governorate') chooseGovernorate(option.key)
                      if (activeSearchPanel === 'city') {
                        chooseCity(option.key)
                      }
                      if (activeSearchPanel === 'street') {
                        setSelectedStreet(option.key)
                        setActiveSearchPanel(null)
                      }
                      if (activeSearchPanel === 'date') {
                        setSelectedDate(option.key)
                        setActiveSearchPanel(null)
                      }
                    }}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <div style={styles.rouletteCounter}>
              {currentPanelOptions.findIndex((option) => option.key === (
                activeSearchPanel === 'governorate'
                  ? selectedGovernorate
                  : activeSearchPanel === 'city'
                    ? selectedCity
                    : activeSearchPanel === 'street'
                      ? selectedStreet
                      : selectedDate
              )) + 1} / {currentPanelOptions.length}
            </div>
          </section>
        ) : null}
      </section>

      {status === 'loading' ? <section style={styles.panel}>{t.loading}</section> : null}
      {message ? <section style={message === t.required || status === 'error' ? styles.alert : styles.notice}>{message}</section> : null}

      {!hasSearched ? <section style={styles.beforeSearchPanel}>{t.beforeSearch}</section> : null}

      {hasSearched ? <section style={styles.searchSummary}>
        <strong>{selectedGovernorateLabel} · {selectedCityLabel} · {selectedStreetLabel}</strong>
        <span>{selectedDate || t.dateOptional}</span>
        <span>{mainGroupOptions.find((option) => option.id === visualFilters.propertyType)?.[isAr ? 'ar' : 'en']}</span>
      </section> : null}

      {hasSearched ? <section style={styles.layout}>
        <section style={styles.resultsPanel}>
          <div style={styles.panelHead}>
            <div style={styles.sortRow}>
              <button
                style={sortMode === 'newest' ? styles.sortButtonActive : styles.sortButton}
                onClick={() => setSortMode('newest')}
              >
                {t.newest}
              </button>
              <button
                style={sortMode === 'lowest' ? styles.sortButtonActive : styles.sortButton}
                onClick={() => setSortMode('lowest')}
              >
                {t.lowestPrice}
              </button>
            </div>
            <strong>{t.availableResults} ({visibleListings.length})</strong>
          </div>
          <div style={styles.resultGrid}>
            {visibleListings.length ? visibleListings.map((listing) => (
              <article key={listing.id} style={selectedListing?.id === listing.id ? styles.resultCardActive : styles.resultCard}>
                <img src={listingImage(listing, isBuyMode)} alt="" style={styles.resultImage} />
                <div style={styles.resultBody}>
                  <span style={styles.statusPill}>{statusText(listing.status, lang)}</span>
                  <h2 style={styles.cardTitle}>{listingTitleText(listing, lang)}</h2>
                  <p style={styles.cardBody}>{listingDescriptionText(listing, lang)}</p>
                  <div style={styles.metaRow}>
                    <span>{t.price}</span>
                    <strong>{moneyText(listing.priceMinor, listing.currency, lang)}</strong>
                  </div>
                  <button style={styles.primaryButton} onClick={() => chooseListing(listing.id)}>
                    {t.viewDetails}
                  </button>
                </div>
              </article>
            )) : status !== 'loading' ? <p style={styles.empty}>{t.empty}</p> : null}
          </div>
        </section>

        <aside style={styles.tunnelPanel}>
          {showFilters ? (
            <section style={styles.inlineChoices}>
              <div style={styles.panelHead}>
                <strong>{t.filterTitle}</strong>
                <button style={styles.closeFilterButton} onClick={() => setShowFilters(false)}>{t.hideFilters}</button>
              </div>
              <VisualFilterPanel
                compact
                groups={renterPropertyFilterGroups}
                lang={lang}
                selection={visualFilters}
                onChange={setVisualFilters}
              />
              <div style={styles.filterSummary}>
                {activeFilterLabels.length
                  ? activeFilterLabels.map((label) => <span key={label}>{label}</span>)
                  : <span>{t.noFilters}</span>}
              </div>
            </section>
          ) : null}
          <div style={styles.panelHead}>
            <strong>{t.selectedFilters}</strong>
            <button style={styles.closeFilterButton} onClick={() => setShowFilters(true)}>{t.showFilters}</button>
            <span>{activeFilterLabels.length}</span>
          </div>
          {selectedListing ? (
            <>
              <section style={styles.selectedCard}>
                <img src={listingImage(selectedListing, isBuyMode)} alt="" style={styles.selectedImage} />
                <div style={styles.selectedContent}>
                  <span style={styles.statusPill}>{t.protected}</span>
                  <h2 style={styles.selectedTitle}>{listingTitleText(selectedListing, lang)}</h2>
                  <p style={styles.cardBody}>{listingDescriptionText(selectedListing, lang)}</p>
                  <Info label={t.price} value={moneyText(selectedListing.priceMinor, selectedListing.currency, lang)} />
                  <Info label={t.owner} value={selectedListing.owner?.displayName || selectedListing.ownerId.slice(0, 8).toUpperCase()} />
                  <Info label={t.status} value={statusText(selectedListing.status, lang)} />
                </div>
              </section>

              <section style={styles.detailPanel}>
                <strong>{t.detailTitle}</strong>
                <div style={styles.trustGrid}>
                  <span>{t.trustedOwner}</span>
                  <span>{t.fastContact}</span>
                  <span>{t.protected}</span>
                </div>
                <ol style={styles.detailSteps}>
                  {t.detailSteps.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </section>

              <PaymentCapsule
                lang={lang}
                methodLabel="SYBNB / IMMOContact"
                amountLabel={moneyText(selectedListing.priceMinor, selectedListing.currency, lang)}
                destinationCode={isBuyMode ? 'BUYER-CAPSULE' : 'RENTAL-CAPSULE'}
                followCode={sentRequest?.id || 'WAITING'}
                proofCount={documents.length}
                status={sentRequest ? 'admin' : documents.length ? 'proof' : hasGuestAccount ? 'ready' : 'locked'}
              />
            </>
          ) : <p style={styles.empty}>{t.noSelection}</p>}

          {!hasGuestAccount ? (
            <section style={styles.accountPrompt}>
              <strong>{t.accountGateTitle}</strong>
              <p>{t.accountGateText}</p>
              <button style={styles.primaryButton} onClick={openAccount}>{t.openAccount}</button>
            </section>
          ) : (
            <>
              <button style={styles.readyButton} onClick={openAccount}>{t.accountReady}</button>
              <section style={styles.docsPanel}>
                <strong>{t.docsTitle}</strong>
                <p>{t.docsHint}</p>
                <label style={styles.uploadBox}>
                  {t.docsUpload}
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    multiple
                    style={styles.fileInput}
                    onChange={(event) => uploadDocuments(event.target.files)}
                  />
                </label>
                {documents.length ? (
                  <div style={styles.docList}>
                    <span>{documents.length} {t.docsReady}</span>
                    {documents.slice(0, 6).map((name) => <small key={name}>{name}</small>)}
                  </div>
                ) : null}
              </section>

              <label style={styles.agreementBox}>
                <input type="checkbox" checked={acceptedAgreement} onChange={(event) => setAcceptedAgreement(event.target.checked)} />
                <span>
                  <strong>{t.agreementTitle}</strong>
                  {t.agreementCopy}
                </span>
              </label>

              <button style={styles.primaryButton} disabled={sendState === 'saving'} onClick={() => void sendRequest()}>
                {sendState === 'saving' ? t.sending : t.send}
              </button>
            </>
          )}
          <button style={styles.secondaryButton} onClick={openContactCenter}>
            {t.openInbox}
          </button>
        </aside>
      </section> : null}
    </main>
  )
}

function listingImage(listing: PlatformListing, isBuyMode = false) {
  const mediaUrl = listing.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  return typeof mediaUrl === 'string' ? mediaUrl : isBuyMode ? '/assets/divisions/buy-property.webp' : '/assets/divisions/monthly-rental.webp'
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.infoRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090e', color: '#fff', padding: '0 clamp(14px, 3vw, 36px) 90px', display: 'grid', gap: 28, maxWidth: 1240, margin: '0 auto' },
  appHeader: { minHeight: 92, borderBottom: '1px solid rgba(255,255,255,.08)', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 18, alignItems: 'center', position: 'sticky', top: 0, zIndex: 5, background: 'rgba(8,9,14,.9)', backdropFilter: 'blur(16px)' },
  logo: { fontSize: 28, letterSpacing: 1, justifySelf: 'start' },
  navTitle: { color: '#5268ff', fontSize: 18, fontWeight: 950, justifySelf: 'center' },
  headerActions: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  headerButton: { minHeight: 54, border: '1px solid #232638', borderRadius: 16, background: '#101118', color: '#fff', fontWeight: 950, padding: '0 22px' },
  headerButtonActive: { minHeight: 54, border: '1px solid #5268ff', borderRadius: 16, background: '#5268ff', color: '#fff', fontWeight: 950, padding: '0 26px', boxShadow: '0 12px 28px rgba(82,104,255,.22)' },
  langButton: { minHeight: 36, border: 0, background: 'transparent', color: '#a8b0c2', fontWeight: 850 },
  langButtonActive: { minHeight: 36, border: 0, background: 'transparent', color: '#fff', fontWeight: 950 },
  searchCapsule: { border: '1px solid #242638', borderRadius: 30, background: 'linear-gradient(135deg, rgba(82,104,255,.16), rgba(17,17,24,.96))', padding: 16, display: 'grid', gap: 14, boxShadow: '0 18px 55px rgba(0,0,0,.22)', position: 'relative', zIndex: 3 },
  searchCapsuleText: { display: 'grid', gap: 5, justifyItems: 'start', color: '#fff' },
  mainGroupCapsule: { border: '1px solid rgba(255,255,255,.08)', borderRadius: 22, background: 'rgba(8,9,14,.64)', padding: 12, display: 'grid', gap: 10 },
  mainGroupGrid: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))' },
  mainGroupButton: { minHeight: 50, border: '1px solid #30384d', borderRadius: 16, background: '#171b29', color: '#dce5ff', fontWeight: 900 },
  mainGroupActive: { minHeight: 50, border: '1px solid #5268ff', borderRadius: 16, background: '#5268ff', color: '#fff', fontWeight: 950, boxShadow: '0 12px 26px rgba(82,104,255,.22)' },
  searchHero: { border: '1px solid rgba(255,255,255,.08)', borderRadius: 999, background: '#111118', padding: 8, display: 'grid', gap: 8, gridTemplateColumns: '120px repeat(5, minmax(108px, 1fr))', alignItems: 'center' },
  searchButton: { minHeight: 58, border: 0, borderRadius: 18, background: '#5268ff', color: '#fff', fontSize: 18, fontWeight: 950, boxShadow: '0 12px 26px rgba(82,104,255,.24)' },
  searchPill: { minHeight: 50, border: 0, borderRadius: 999, background: '#20212b', color: '#a8b0c2', fontWeight: 850 },
  searchPillActive: { minHeight: 50, border: 0, borderRadius: 999, background: '#5268ff', color: '#fff', fontWeight: 950 },
  searchTouchPanel: { border: '1px solid rgba(82,104,255,.42)', borderRadius: 22, background: '#0d1320', padding: 14, display: 'grid', gap: 12, overflow: 'hidden' },
  rouletteHeader: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', color: '#dce5ff', flexWrap: 'wrap' },
  rouletteTrack: { display: 'flex', gap: 10, overflowX: 'auto', overscrollBehaviorX: 'contain', scrollSnapType: 'x mandatory', padding: '4px 2px 12px', scrollbarWidth: 'thin' },
  rouletteOption: { minWidth: 132, minHeight: 54, border: '1px solid #30384d', borderRadius: 18, background: '#171b29', color: '#dce5ff', fontWeight: 900, scrollSnapAlign: 'center', boxShadow: 'inset 0 -10px 22px rgba(0,0,0,.18)' },
  rouletteOptionActive: { minWidth: 146, minHeight: 58, border: '1px solid #5268ff', borderRadius: 20, background: 'linear-gradient(135deg, #5268ff, #263486)', color: '#fff', fontWeight: 950, scrollSnapAlign: 'center', boxShadow: '0 16px 34px rgba(82,104,255,.28)' },
  rouletteCounter: { justifySelf: 'center', border: '1px solid rgba(213,169,21,.42)', borderRadius: 999, background: 'rgba(213,169,21,.10)', color: '#f4d676', padding: '5px 14px', fontWeight: 950, fontVariantNumeric: 'tabular-nums' },
  touchOptions: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' },
  touchOption: { minHeight: 46, border: '1px solid #30384d', borderRadius: 14, background: '#171b29', color: '#dce5ff', fontWeight: 850 },
  touchOptionActive: { minHeight: 46, border: '1px solid #5268ff', borderRadius: 14, background: 'rgba(82,104,255,.92)', color: '#fff', fontWeight: 950 },
  beforeSearchPanel: { border: '1px solid rgba(82,104,255,.3)', borderRadius: 24, background: 'rgba(82,104,255,.08)', color: '#dce5ff', padding: 22, lineHeight: 1.7, fontWeight: 850 },
  searchSummary: { border: '1px solid rgba(32,210,155,.36)', borderRadius: 18, background: 'rgba(32,210,155,.08)', color: '#b9ffec', padding: 14, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' },
  flowNav: { display: 'none' },
  arrowButton: { width: 54, height: 54, borderRadius: 999, border: '1px solid #30384d', background: '#111827', color: '#fff', fontSize: 34, fontWeight: 900, display: 'grid', placeItems: 'center' },
  hero: { border: '1px solid rgba(25,215,255,.38)', borderRadius: 8, background: 'linear-gradient(135deg, rgba(25,215,255,.12), rgba(17,17,24,.94))', padding: 18, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  eyebrow: { color: '#19d7ff', letterSpacing: 2, fontWeight: 950, fontSize: 11, margin: 0 },
  title: { margin: '6px 0 0', fontSize: 42, lineHeight: 1.05 },
  body: { color: '#a8b3c7', margin: '10px 0 0', lineHeight: 1.65 },
  stepRail: { display: 'grid', gap: 8, alignContent: 'center' },
  stepPill: { border: '1px solid #30384d', borderRadius: 8, background: 'rgba(13,19,32,.78)', color: '#dce5ff', padding: '10px 12px', fontWeight: 850 },
  layout: { display: 'grid', gap: 36, gridTemplateColumns: 'minmax(0, 1fr) 390px', alignItems: 'start' },
  resultsPanel: { background: 'transparent', padding: 0, display: 'grid', gap: 28 },
  filterPanel: { border: '1px solid rgba(80,105,255,.42)', borderRadius: 8, background: 'rgba(13,19,32,.72)', padding: 12, display: 'grid', gap: 12 },
  inlineChoices: { border: '1px solid rgba(82,104,255,.25)', borderRadius: 20, background: 'rgba(82,104,255,.06)', padding: 12, display: 'grid', gap: 12 },
  filterSummary: { display: 'flex', gap: 8, flexWrap: 'wrap', color: '#dce5ff' },
  tunnelPanel: { border: '1px solid #242638', borderRadius: 28, background: '#111118', padding: 28, display: 'grid', gap: 18, position: 'sticky', top: 110, boxShadow: '0 24px 70px rgba(0,0,0,.32)' },
  panelHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', color: '#9aa6ba' },
  closeFilterButton: { minHeight: 34, border: '1px solid #30384d', borderRadius: 999, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 12px' },
  sortRow: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  sortButton: { minHeight: 40, border: 0, borderRadius: 999, background: '#20212b', color: '#a8b0c2', fontWeight: 850, padding: '0 18px' },
  sortButtonActive: { minHeight: 40, border: 0, borderRadius: 999, background: '#5268ff', color: '#fff', fontWeight: 950, padding: '0 20px' },
  resultGrid: { display: 'grid', gap: 28, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' },
  resultCard: { border: '1px solid rgba(255,255,255,.08)', borderRadius: 24, background: '#14151d', overflow: 'hidden', display: 'grid', boxShadow: '0 20px 45px rgba(0,0,0,.24)', minHeight: 380 },
  resultCardActive: { border: '1px solid #5268ff', borderRadius: 24, background: 'rgba(82,104,255,.10)', overflow: 'hidden', display: 'grid', boxShadow: '0 0 0 1px rgba(82,104,255,.24), 0 20px 45px rgba(0,0,0,.24)', minHeight: 380 },
  resultImage: { width: '100%', aspectRatio: '1 / 1.25', objectFit: 'cover', background: '#111827' },
  resultBody: { padding: 18, display: 'grid', gap: 10, alignContent: 'start' },
  statusPill: { justifySelf: 'start', border: '1px solid rgba(25,215,255,.45)', borderRadius: 999, color: '#19d7ff', padding: '5px 9px', fontSize: 11, fontWeight: 950 },
  cardTitle: { margin: 0, fontSize: 22, lineHeight: 1.15 },
  cardBody: { margin: 0, color: '#9aa6ba', lineHeight: 1.55 },
  metaRow: { borderTop: '1px solid #27314a', paddingTop: 10, display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba' },
  selectedCard: { border: '1px solid rgba(32,210,155,.42)', borderRadius: 18, background: 'rgba(32,210,155,.08)', padding: 14, display: 'grid', gap: 14 },
  selectedImage: { width: '100%', aspectRatio: '16 / 10', borderRadius: 14, objectFit: 'cover', background: '#111827' },
  selectedContent: { display: 'grid', gap: 10 },
  selectedTitle: { margin: 0, fontSize: 24 },
  infoRow: { display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba', borderTop: '1px solid #27314a', paddingTop: 10 },
  detailPanel: { border: '1px solid rgba(82,104,255,.42)', borderRadius: 22, background: 'linear-gradient(145deg, rgba(82,104,255,.12), rgba(13,19,32,.82))', padding: 16, display: 'grid', gap: 14 },
  trustGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  detailSteps: { display: 'grid', gap: 10, margin: 0, paddingInlineStart: 22, color: '#c4ccdc', lineHeight: 1.5 },
  accountPrompt: { border: '1px solid rgba(82,104,255,.42)', borderRadius: 22, background: 'rgba(82,104,255,.08)', color: '#dce5ff', padding: 16, display: 'grid', gap: 12, lineHeight: 1.6 },
  docsPanel: { border: '1px solid #30384d', borderRadius: 22, background: '#0d1320', padding: 16, display: 'grid', gap: 10, color: '#a8b3c7' },
  uploadBox: { minHeight: 74, border: '1px dashed rgba(25,215,255,.58)', borderRadius: 18, color: '#19d7ff', display: 'grid', placeItems: 'center', fontWeight: 950, cursor: 'pointer', background: 'rgba(25,215,255,.05)' },
  fileInput: { display: 'none' },
  docList: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.08)', color: '#b9ffec', padding: 10, display: 'grid', gap: 6 },
  agreementBox: { border: '1px solid rgba(213,169,21,.5)', borderRadius: 18, background: 'rgba(213,169,21,.08)', color: '#f4d676', padding: 14, display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 10, alignItems: 'start', lineHeight: 1.55 },
  primaryButton: { minHeight: 58, border: 0, borderRadius: 16, background: '#5268ff', color: '#fff', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 58, border: '1px solid #30384d', borderRadius: 16, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  readyButton: { minHeight: 58, border: '1px solid rgba(32,210,155,.5)', borderRadius: 16, background: 'rgba(32,210,155,.12)', color: '#b9ffec', fontWeight: 950, padding: '0 14px' },
  panel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', color: '#9aa6ba', padding: 14 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  notice: { border: '1px solid rgba(32,210,155,.42)', borderRadius: 8, background: 'rgba(32,210,155,.08)', color: '#b9ffec', padding: 14 },
  empty: { color: '#9aa6ba' },
}
