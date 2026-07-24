import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { text, type Lang, type Localized } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../../shared/brand'
import {
  addAccommodationRoomType,
  createAccommodation,
  createAndSubmitPrototypeListing,
  fetchHostCommissionRate,
  uploadListingPhoto,
  blobToBase64,
  generateListingDescription,
  submitAccommodation,
} from '../../shared/api/platformApi'
import { ListingPhotoUploader, type PhotoDraft } from './ListingPhotoUploader'
import { uploadPhotosSequentially, meetsMinimumPhotos, type PhotoItem } from './listingPhotos'
import type { CSSVars } from '../../shared/theme/cssVars'
import { sellerCarFilterGroups, sellerPropertyFilterGroups, type VisualFilterSelection } from '../../engines/filters'
import {
  CANADA_PROVINCES,
  COUNTRIES,
  getCanadianCity,
  getCanadianProvince,
  getCity,
  getGovernorate,
  isStrBannedArea,
  labelFor,
  SYRIA_GOVERNORATES,
  type CountryKey,
} from '../../engines/search'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { PaymentProofUpload } from '../payments/PaymentProofUpload'
import { SellerLocationMap } from './SellerLocationMap'

type Props = {
  lang: Lang
}

const FLOW_STORAGE_KEY = 'sybnb_v6_sell_flow'
const DRAFT_STORAGE_KEY = 'sybnb_v6_sell_wizard_draft'

type ListingDivision = 'STAYS' | 'RENTALS' | 'BUY' | 'CARS' | 'MARKETPLACE' | 'NEW_CONSTRUCTION'

const DIVISION_OPTIONS: Array<{ value: ListingDivision; ar: string; en: string }> = [
  { value: 'STAYS', ar: 'إيجار يومي', en: 'Daily stay' },
  { value: 'RENTALS', ar: 'إيجار شهري', en: 'Monthly rental' },
  { value: 'BUY', ar: 'عقار للبيع', en: 'Property for sale' },
  { value: 'CARS', ar: 'سيارة', en: 'Car' },
  { value: 'MARKETPLACE', ar: 'منتج أو خدمة', en: 'Product or service' },
  { value: 'NEW_CONSTRUCTION', ar: 'مشروع جديد', en: 'New project' },
]

type WizardDraft = {
  division: ListingDivision
  listingPlan: string
  listingPlanPaymentMethod: string
  listingPlanPaymentConfirmed: boolean
  selectedType: string
  title: string
  description: string
  country: CountryKey
  governorate: string
  city: string
  area: string
  address: string
  citqRegistrationNumber: string
  citqCertificateExpiresAt: string
  residencyType: 'principal' | 'investment' | ''
  latitude: string
  longitude: string
  mapPinConfirmed: boolean
  price: string
  cleaningFee: string
  taxFee: string
  size: string
  guestCapacity: string
  bedrooms: string
  bathrooms: string
  instantBookEnabled: boolean
  searchCapsuleEnabled: boolean
  availabilityDates: string[]
  variableNightPrice: string
  availableStart: string
  availableEnd: string
  bookedDate: string
  paymentDay: string
  visualFilters: VisualFilterSelection
}

function loadDraft(): Partial<WizardDraft> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function clearDraft() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
}

function createListingPlanFollowCode() {
  const suffix = `${Date.now()}`.slice(-6)
  return `LST-${suffix}`
}

function addDaysIso(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function addMonths(date: Date, months: number) {
  const nextDate = new Date(date)
  nextDate.setMonth(nextDate.getMonth() + months)
  return nextDate
}

function monthDays(date: Date) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const days = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(year, month, index + 1)
    return day.toISOString().slice(0, 10)
  })
}

function monthTitle(date: Date, lang: Lang) {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SY' : 'en-US', { month: 'long', year: 'numeric' }).format(date)
}

type WizardStep = {
  id: string
  title: Localized<string>
  helper: Localized<string>
}

const STEPS: WizardStep[] = [
  {
    id: 'basics',
    title: { ar: 'أساسيات الإعلان', en: 'Listing basics' },
    helper: { ar: 'نوع العقار والعنوان المختصر.', en: 'Property type and short title.' },
  },
  {
    id: 'location',
    title: { ar: 'الموقع', en: 'Location' },
    helper: { ar: 'المحافظة والمدينة والمنطقة.', en: 'Governorate, city, and area.' },
  },
  {
    id: 'price',
    title: { ar: 'السعر والتفاصيل', en: 'Price and details' },
    helper: { ar: 'السعر والمساحة والغرف.', en: 'Price, size, and rooms.' },
  },
  {
    id: 'plan',
    title: { ar: 'الخطة والدفع', en: 'Plan and payment' },
    helper: { ar: 'اختر خطة الإعلان وادفعها قبل رفع الصور والملفات.', en: 'Choose and pay the listing plan before uploading photos and files.' },
  },
  {
    id: 'media',
    title: { ar: 'الصور والملفات', en: 'Photos and files' },
    helper: { ar: 'ارفع الصور والملفات المسموحة حسب الخطة المدفوعة.', en: 'Upload photos and files allowed by the paid plan.' },
  },
  {
    id: 'review',
    title: { ar: 'المراجعة والإرسال', en: 'Review and submit' },
    helper: { ar: 'تأكد من البيانات قبل إرسالها لفريق SYBNB.', en: 'Confirm details before sending to the SYBNB team.' },
  },
]

// Reused for every room type after the first one under the same Accommodation: skips
// 'location' and 'media' since those are inherited from the accommodation shell.
const ROOM_TYPE_STEPS: WizardStep[] = STEPS.filter((step) => ['basics', 'price', 'review'].includes(step.id))

const AD_STEPS: WizardStep[] = [
  {
    id: 'basics',
    title: { ar: 'تفاصيل الإعلان', en: 'Ad details' },
    helper: { ar: 'اسم الإعلان ومكان ظهوره داخل المنصة.', en: 'Ad name and placement inside the platform.' },
  },
  {
    id: 'media',
    title: { ar: 'صور وملفات الإعلان', en: 'Ad photos and files' },
    helper: { ar: 'أضف البانر والملفات حسب الخطة المدفوعة.', en: 'Add banners and files based on the paid plan.' },
  },
  {
    id: 'review',
    title: { ar: 'الإرسال والموافقة', en: 'Submit and approval' },
    helper: { ar: 'أرسل الإعلان للإدارة؛ بعد القبول يصبح منشوراً.', en: 'Send the ad to admin; after approval it becomes published.' },
  },
]

const PROPERTY_TYPES = [
  { ar: 'شقة', en: 'Apartment' },
  { ar: 'منزل عائلي', en: 'Family house' },
  { ar: 'فيلا', en: 'Villa' },
  { ar: 'محل تجاري', en: 'Commercial' },
  { ar: 'أرض', en: 'Land' },
  { ar: 'مشروع جديد', en: 'New project' },
]

const AD_PLACEMENTS = [
  { ar: 'الرئيسية', en: 'Landing page' },
  { ar: 'صفحة البحث', en: 'Search page' },
  { ar: 'صفحات الأقسام', en: 'Division pages' },
  { ar: 'كل المنصة', en: 'Whole platform' },
]

const AD_DURATIONS = [
  { ar: 'أسبوع واحد', en: 'One week' },
  { ar: 'شهر واحد', en: 'One month' },
  { ar: 'ثلاثة أشهر', en: 'Three months' },
]

type MediaSlot = {
  id: string
  ar: string
  en: string
  required?: boolean
  offerProof?: boolean
}

// Revenu Quebec Tax on Lodging: https://www.revenuquebec.ca/en/citizens/your-situation/short-term-accommodations/registration-tax-on-lodging/
const QUEBEC_LODGING_TAX_RATE = 0.035

const OFFER_PROOF_PREFIX = 'offerProof:'
const OFFER_PROOF_GROUP_IDS = new Set(['popular', 'amenities', 'meals', 'views', 'access', 'payments'])
const OFFER_PROOF_EXCLUDED_OPTION_IDS = new Set(['any', 'nearMe', 'rating8', 'verifiedHost', 'fastResponse', 'featuredHost', 'instantBooking'])

function selectedOfferProofMediaSlots(selection: VisualFilterSelection): MediaSlot[] {
  const seen = new Set<string>()
  const slots: MediaSlot[] = []

  sellerPropertyFilterGroups.forEach((group) => {
    if (!OFFER_PROOF_GROUP_IDS.has(group.id)) return
    const selected = selection[group.id]
    const selectedIds = Array.isArray(selected) ? selected : selected ? [selected] : []

    selectedIds.forEach((id) => {
      if (OFFER_PROOF_EXCLUDED_OPTION_IDS.has(id) || seen.has(id)) return
      const option = group.options.find((item) => item.id === id)
      if (!option) return
      seen.add(id)
      slots.push({
        id: `${OFFER_PROOF_PREFIX}${id}`,
        ar: option.label.ar,
        en: option.label.en,
        required: true,
        offerProof: true,
      })
    })
  })

  return slots
}

const HOST_LISTING_PLANS: Array<{
  id: string
  ar: string
  en: string
  priceUsd: number
  services: Localized<string[]>
  mediaSlots: MediaSlot[]
}> = [
  {
    id: 'basic',
    ar: 'Basic',
    en: 'Basic',
    priceUsd: 9,
    services: {
      ar: ['نشر إعلان واحد', 'رفع صور العقار', 'إثبات الملكية الأساسي', 'ظهور في البحث بعد موافقة الإدارة'],
      en: ['Publish one listing', 'Upload property photos', 'Basic ownership proof', 'Search visibility after admin approval'],
    },
    mediaSlots: [
      { id: 'propertyPhotos', ar: 'صور العقار', en: 'Property photos' },
      { id: 'ownershipProof', ar: 'إثبات الملكية', en: 'Ownership proof' },
    ],
  },
  {
    id: 'plus',
    ar: 'Plus',
    en: 'Plus',
    priceUsd: 19,
    services: {
      ar: ['كل مزايا Basic', 'رفع التفويض أو السند', 'كبسولات البحث مع صور إثبات', 'مراجعة أولوية من الإدارة'],
      en: ['Everything in Basic', 'Upload authorization or deed', 'Search capsules with proof photos', 'Priority admin review'],
    },
    mediaSlots: [
      { id: 'propertyPhotos', ar: 'صور العقار', en: 'Property photos' },
      { id: 'ownershipProof', ar: 'إثبات الملكية', en: 'Ownership proof' },
      { id: 'authorization', ar: 'أضف التفويض', en: 'Add authorization' },
      { id: 'deed', ar: 'مخطط أو سند', en: 'Plan or deed' },
    ],
  },
  {
    id: 'premium',
    ar: 'Premium',
    en: 'Premium',
    priceUsd: 39,
    services: {
      ar: ['كل مزايا Plus', 'صور وملفات وإثباتات إضافية', 'تمييز أعلى داخل البحث', 'دعم تجهيز الإعلان قبل النشر'],
      en: ['Everything in Plus', 'Extra photos, files, and proofs', 'Higher search highlight', 'Listing preparation support before publishing'],
    },
    mediaSlots: [
      { id: 'propertyPhotos', ar: 'صور العقار', en: 'Property photos' },
      { id: 'ownershipProof', ar: 'إثبات الملكية', en: 'Ownership proof' },
      { id: 'authorization', ar: 'أضف التفويض', en: 'Add authorization' },
      { id: 'deed', ar: 'مخطط أو سند', en: 'Plan or deed' },
      { id: 'extraGallery', ar: 'صور إضافية', en: 'Extra gallery' },
      { id: 'inspectionFiles', ar: 'ملفات الفحص', en: 'Inspection files' },
    ],
  },
]

export function SellerListingWizard({ lang }: Props) {
  const isAr = lang === 'ar'
  const isAdvertisingFlow = useMemo(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(FLOW_STORAGE_KEY) === 'advertising'
  }, [])
  const adPlan = useMemo(() => {
    if (typeof window === 'undefined') return 'plus'
    const stored = window.localStorage.getItem('sybnb_v6_advertising_plan')
    return stored === 'premium' ? 'premium' : 'plus'
  }, [])
  const adFileSlots: MediaSlot[] =
    adPlan === 'premium'
      ? [
          { id: 'desktopBanner', ar: 'بانر سطح المكتب', en: 'Desktop banner' },
          { id: 'tabletBanner', ar: 'بانر التابلت', en: 'Tablet banner' },
          { id: 'phoneBanner', ar: 'بانر الهاتف', en: 'Phone banner' },
          { id: 'brandLogo', ar: 'شعار الشركة', en: 'Brand logo' },
          { id: 'documents', ar: 'ملفات الشركة أو الحملة', en: 'Company or campaign documents' },
        ]
      : [
          { id: 'mainBanner', ar: 'بانر الإعلان الرئيسي', en: 'Main ad banner' },
          { id: 'brandLogo', ar: 'شعار الشركة', en: 'Brand logo' },
          { id: 'documents', ar: 'ملفات الشركة أو الحملة', en: 'Company or campaign documents' },
        ]
  const draft = useMemo(() => loadDraft(), [])
  const [stepIndex, setStepIndex] = useState(0)
  // M1: the STR commission rate for the host's payout note, fetched from the server single source (never
  // hardcoded). Best-effort — if the lookup fails, the note simply omits the number rather than guessing.
  const [platformFeePct, setPlatformFeePct] = useState<number | null>(null)
  // M6: the current commission contract version + the host's acceptance of it (required to publish a STAYS listing).
  const [contractVersion, setContractVersion] = useState<string | null>(null)
  const [contractAccepted, setContractAccepted] = useState(false)
  useEffect(() => {
    let active = true
    void fetchHostCommissionRate().then((r) => { if (active) { setPlatformFeePct(r.platformFeePct); setContractVersion(r.contractVersion) } }).catch(() => {})
    return () => { active = false }
  }, [])
  const commissionLabel = platformFeePct != null ? `${+(platformFeePct * 100).toFixed(2)}%` : null
  const [division, setDivision] = useState<ListingDivision>(draft.division || 'STAYS')
  const [listingPlan, setListingPlan] = useState(draft.listingPlan || 'plus')
  const [listingPlanPaymentMethod, setListingPlanPaymentMethod] = useState(draft.listingPlanPaymentMethod || 'shamCash')
  const [listingPlanPaymentConfirmed, setListingPlanPaymentConfirmed] = useState(draft.listingPlanPaymentConfirmed ?? false)
  const [listingPlanFollowCode] = useState(() => createListingPlanFollowCode())
  const [listingPlanQrDataUrl, setListingPlanQrDataUrl] = useState('')
  const [listingCardHolder, setListingCardHolder] = useState('')
  const [listingCardNumber, setListingCardNumber] = useState('')
  const [listingCardExpiry, setListingCardExpiry] = useState('')
  const [listingCardCvv, setListingCardCvv] = useState('')
  const [selectedType, setSelectedType] = useState(draft.selectedType || PROPERTY_TYPES[0].en)
  const [title, setTitle] = useState(draft.title ?? '')
  const [description, setDescription] = useState(draft.description ?? '')
  const [country, setCountry] = useState<CountryKey>(draft.country || 'SY')
  const [governorate, setGovernorate] = useState(draft.governorate || 'damascus')
  const [city, setCity] = useState(draft.city || 'damascus-city')
  const [area, setArea] = useState(draft.area || 'old-city')
  const [areaQuery, setAreaQuery] = useState('')
  const [address, setAddress] = useState(draft.address ?? (isAr ? 'قرب شارع رئيسي' : 'Near a main street'))
  // Quebec tourist-accommodation registration (CITQ) -- required by Quebec law for any unit rented
  // 31 days or less for payment. Presence is enforced server-side before a CA listing can submit;
  // whether the borough/season it's in is actually legal is judged by an admin reviewer, not this
  // form (see canadaData.ts strBanned flags and AdminReviewPage's Quebec compliance panel).
  const [citqRegistrationNumber, setCitqRegistrationNumber] = useState(draft.citqRegistrationNumber ?? '')
  // Jurisdiction pricing engine (030): CITQ certificates expire and must be renewed -- an expired or
  // missing expiry date now blocks listing approval and new bookings server-side (listing-attributes.mjs).
  const [citqCertificateExpiresAt, setCitqCertificateExpiresAt] = useState(draft.citqCertificateExpiresAt ?? '')
  // Montreal bans investment/secondary-property STR almost everywhere except specific named streets
  // (not tracked here), while principal-residence STR is allowed within the seasonal window. Self-
  // declared, not verified by this form -- an 'investment' declaration surfaces a stricter-review flag
  // to the admin (AdminReviewPage's Quebec compliance panel), it does not hard-block submission, since
  // a named-street exception may legitimately apply.
  const [residencyType, setResidencyType] = useState<'principal' | 'investment' | ''>(draft.residencyType || '')
  const [latitude, setLatitude] = useState(draft.latitude || '33.5138')
  const [longitude, setLongitude] = useState(draft.longitude || '36.2765')
  const [mapPinConfirmed, setMapPinConfirmed] = useState(draft.mapPinConfirmed ?? false)
  const [price, setPrice] = useState(draft.price || '15')
  const [cleaningFee, setCleaningFee] = useState(draft.cleaningFee || '0')
  const [taxFee, setTaxFee] = useState(draft.taxFee || '0')
  const [size, setSize] = useState(draft.size || '110')
  const [guestCapacity, setGuestCapacity] = useState(draft.guestCapacity || '2')
  const [bedrooms, setBedrooms] = useState(draft.bedrooms || '3')
  const [bathrooms, setBathrooms] = useState(draft.bathrooms || '2')
  const [instantBookEnabled, setInstantBookEnabled] = useState(draft.instantBookEnabled ?? false)
  const [searchCapsuleEnabled, setSearchCapsuleEnabled] = useState(draft.searchCapsuleEnabled ?? true)
  const [availabilityDates, setAvailabilityDates] = useState<string[]>(draft.availabilityDates || [addDaysIso(1), addDaysIso(2), addDaysIso(3), addDaysIso(4)])
  const [variableNightPrice, setVariableNightPrice] = useState(draft.variableNightPrice || '15')
  const [availableStart, setAvailableStart] = useState(draft.availableStart || addDaysIso(1))
  const [availableEnd, setAvailableEnd] = useState(draft.availableEnd || addDaysIso(31))
  const [bookedDate, setBookedDate] = useState(draft.bookedDate || addDaysIso(7))
  const [paymentDay, setPaymentDay] = useState(draft.paymentDay || addDaysIso(1))
  const [availabilityMonth, setAvailabilityMonth] = useState(() => new Date())
  const [reservationMonth, setReservationMonth] = useState(() => addMonths(new Date(), 1))
  const [adPlacement, setAdPlacement] = useState(isAr ? 'الرئيسية' : 'Landing page')
  const [adDuration, setAdDuration] = useState(isAr ? 'أسبوع واحد' : 'One week')
  const [uploadedAdFiles, setUploadedAdFiles] = useState<string[]>([])
  const [uploadedDocumentFiles, setUploadedDocumentFiles] = useState<string[]>([])
  const [adFilesSent, setAdFilesSent] = useState(false)
  const [visualFilters, setVisualFilters] = useState<VisualFilterSelection>(
    draft.visualFilters || {
      propertyType: 'apartment',
      roomType: 'doubleRoom',
      bedType: 'queenBed',
      amenities: ['wifi', 'kitchen'],
    },
  )
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [submitError, setSubmitError] = useState('')
  // C2 — real STR property photos (independent of plan payment). STAYS uses the accommodation flow:
  // photos attach to the room-type Listing created by addAccommodationRoomType. roomTypeListingId is
  // retained so a retry after a partial upload failure reuses the same room-type listing and only
  // re-uploads the not-yet-uploaded photos.
  const [photoDrafts, setPhotoDrafts] = useState<PhotoDraft[]>([])
  const [roomTypeListingId, setRoomTypeListingId] = useState<string | null>(null)
  const [descriptionAiState, setDescriptionAiState] = useState<'idle' | 'generating' | 'error'>('idle')
  const [descriptionAiError, setDescriptionAiError] = useState('')
  // Set once the accommodation shell + first STAYS room type are created; every following room
  // type in the same session reuses it instead of re-collecting location/documents/photos.
  const [accommodationId, setAccommodationId] = useState<string | null>(null)
  const [roomTypeStage, setRoomTypeStage] = useState<'idle' | 'prompt'>('idle')
  const isMultiRoomFlow = division === 'STAYS' && !isAdvertisingFlow

  useEffect(() => {
    if (typeof window === 'undefined') return
    const nextDraft: WizardDraft = {
      division,
      listingPlan,
      listingPlanPaymentMethod,
      listingPlanPaymentConfirmed,
      selectedType,
      title,
      description,
      country,
      governorate,
      city,
      area,
      address,
      citqRegistrationNumber,
      citqCertificateExpiresAt,
      residencyType,
      latitude,
      longitude,
      mapPinConfirmed,
      price,
      cleaningFee,
      taxFee,
      size,
      guestCapacity,
      bedrooms,
      bathrooms,
      instantBookEnabled,
      searchCapsuleEnabled,
      availabilityDates,
      variableNightPrice,
      availableStart,
      availableEnd,
      bookedDate,
      paymentDay,
      visualFilters,
    }
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(nextDraft))
  }, [division, listingPlan, listingPlanPaymentMethod, listingPlanPaymentConfirmed, selectedType, title, description, country, governorate, city, area, address, citqRegistrationNumber, citqCertificateExpiresAt, residencyType, latitude, longitude, mapPinConfirmed, price, cleaningFee, taxFee, size, guestCapacity, bedrooms, bathrooms, instantBookEnabled, searchCapsuleEnabled, availabilityDates, variableNightPrice, availableStart, availableEnd, bookedDate, paymentDay, visualFilters])
  const steps = isAdvertisingFlow ? AD_STEPS : accommodationId ? ROOM_TYPE_STEPS : STEPS
  const activeStep = steps[stepIndex]
  const progress = useMemo(() => `${Math.round(((stepIndex + 1) / steps.length) * 100)}%`, [stepIndex, steps.length])
  const isLast = stepIndex === steps.length - 1
  const isCanada = country === 'CA'
  const selectedGovernorateData = isCanada ? getCanadianProvince(governorate) : getGovernorate(governorate)
  const selectedCityData = isCanada ? getCanadianCity(governorate, city) : getCity(governorate, city)
  const selectedAreaData = selectedCityData?.areas.find((item) => item.key === area)
  const selectedGovernorateLabel = isCanada ? text(selectedGovernorateData || { ar: '', en: '', fr: '' }, lang) : labelFor(lang, selectedGovernorateData)
  const selectedCityLabel = isCanada ? text(selectedCityData || { ar: '', en: '', fr: '' }, lang) : labelFor(lang, selectedCityData)
  const selectedAreaLabel = isCanada ? text(selectedAreaData || { ar: '', en: '', fr: '' }, lang) : labelFor(lang, selectedAreaData)
  const areaOptions = selectedCityData?.areas || []
  const selectedAreaStrBanned = isCanada && isStrBannedArea(governorate, city, area)
  // The CITQ/insurance registration requirement is specific to Quebec's "tourist accommodation"
  // rule (stays of 31 days or less rented for payment) -- RENTALS/BUY/etc. in Quebec aren't
  // short-term tourist accommodation, so this only applies to the STAYS division.
  const isQuebecStr = isCanada && division === 'STAYS' && !isAdvertisingFlow
  // Montreal bans investment/secondary-property STR almost everywhere except a small set of named
  // streets (not tracked here) and restricts principal-residence STR to a seasonal window -- both
  // enforced server-side (server/lib/quebec-str-rules.mjs) only when city === 'montreal'.
  const isMontrealStr = isQuebecStr && city === 'montreal'
  // Revenu Quebec's Tax on Lodging is a flat 3.5% of the nightly rate (confirmed from the official
  // source when this jurisdiction's compliance profile was reviewed -- see server/lib/
  // jurisdiction-compliance.mjs). Unlike Syria, where "Tax USD" is whatever the host chooses to
  // type, a Quebec listing's tax figure is computed here and the field is locked so it can't drift
  // from the real rate.
  useEffect(() => {
    if (!isQuebecStr) return
    const nightly = Number(price)
    if (!Number.isFinite(nightly) || nightly <= 0) return
    setTaxFee((Math.round(nightly * QUEBEC_LODGING_TAX_RATE * 100) / 100).toFixed(2))
    // Only price and the Quebec gate should retrigger this -- taxFee itself is the output, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isQuebecStr, price])
  // Syria place data is {ar,en}; Canada place data is {ar,en,fr} -- route each through the right
  // label function rather than forcing one shape on both.
  function placeLabel(item?: { ar: string; en: string; fr?: string }) {
    if (!item) return ''
    return isCanada ? text({ ar: item.ar, en: item.en, fr: item.fr || item.en }, lang) : labelFor(lang, item)
  }
  const normalizedAreaQuery = areaQuery.trim().toLowerCase()
  const filteredAreaOptions = (normalizedAreaQuery
    ? areaOptions.filter((item) =>
        [item.ar, item.en, (item as { fr?: string }).fr, item.key]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(normalizedAreaQuery),
      )
    : areaOptions.slice(0, 10)
  ).slice(0, 16)
  const listingCurrency = division === 'STAYS' ? 'USD' : 'SYP'
  const selectedListingPlan = HOST_LISTING_PLANS.find((plan) => plan.id === listingPlan) || HOST_LISTING_PLANS[1]

  // Real, scannable QR (same qrcode package + pattern already used in SellerAccountPage.tsx,
  // SyrianLocalWalletPaymentPage, and SellerAdvertisingPaymentPage) instead of plain text.
  useEffect(() => {
    if (listingPlanPaymentMethod !== 'shamCash') return
    let cancelled = false
    const payload = [
      'SYBNB-V6-LISTING-PLAN-PAYMENT',
      'CODE=SYBNB-SHAM-LISTING',
      `AMOUNT=${selectedListingPlan.priceUsd}`,
      'CURRENCY=USD',
      `FOLLOWUP=${listingPlanFollowCode}`,
    ].join('|')
    void QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
      color: { dark: '#07111f', light: '#f7f8ff' },
    }).then((url) => {
      if (!cancelled) setListingPlanQrDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [listingPlanPaymentMethod, listingPlanFollowCode, selectedListingPlan.priceUsd])

  const selectedOfferProofSlots = useMemo(() => selectedOfferProofMediaSlots(visualFilters), [visualFilters])
  const planAllowsOfferProofs = selectedListingPlan.id !== 'basic'
  const activeOfferProofSlots = !isAdvertisingFlow && division === 'STAYS' && planAllowsOfferProofs ? selectedOfferProofSlots : []
  // Quebec's $2M civil liability insurance requirement applies regardless of which plan the host
  // bought -- it's a legal requirement, not a plan feature, so it's added on top of the plan's own
  // slots rather than gated by plan tier the way offer-proof slots are.
  const quebecComplianceSlots: MediaSlot[] = isQuebecStr
    ? [{ id: 'insuranceProof', ar: 'إثبات التأمين (٢ مليون دولار)', en: 'Insurance proof ($2M CAD)', required: true }]
    : []
  const allowedMediaSlots = isAdvertisingFlow ? adFileSlots : [...selectedListingPlan.mediaSlots, ...activeOfferProofSlots, ...quebecComplianceSlots]
  const missingRequiredOfferProofSlots = activeOfferProofSlots.filter((slot) => !uploadedAdFiles.includes(slot.id))
  const missingQuebecComplianceSlots = quebecComplianceSlots.filter((slot) => !uploadedAdFiles.includes(slot.id))
  const stayNightPrice = Math.max(0, toNumber(variableNightPrice || price))
  const stayCleaningFee = division === 'STAYS' ? Math.max(0, toNumber(cleaningFee)) : 0
  const stayTaxFee = division === 'STAYS' ? Math.max(0, toNumber(taxFee)) : 0
  const stayBookingTotal = stayNightPrice + stayCleaningFee + stayTaxFee
  const availabilityCalendar = {
    searchCapsuleEnabled,
    availabilityDates,
    variableNightPrice,
    cleaningFee,
    taxFee,
    bookingTotal: String(stayBookingTotal),
    availableStart,
    availableEnd,
    bookedDate,
    paymentDay,
  }
  const mapLocation = {
    latitude,
    longitude,
    pinConfirmed: mapPinConfirmed,
  }
  const availabilityMonthDays = useMemo(() => monthDays(availabilityMonth), [availabilityMonth])
  const reservationMonthDays = useMemo(() => monthDays(reservationMonth), [reservationMonth])
  const selectedAvailabilityDays = useMemo(() => new Set(availabilityDates), [availabilityDates])
  const bookedDays = useMemo(() => new Set([bookedDate, paymentDay].filter(Boolean)), [bookedDate, paymentDay])

  function updateAvailabilityDates(nextDates: string[]) {
    const sortedDates = Array.from(new Set(nextDates)).sort()
    setAvailabilityDates(sortedDates)
    if (sortedDates.length) {
      setAvailableStart(sortedDates[0])
      setAvailableEnd(sortedDates[sortedDates.length - 1])
    }
  }

  function toggleAvailabilityDay(day: string) {
    updateAvailabilityDates(selectedAvailabilityDays.has(day) ? availabilityDates.filter((item) => item !== day) : [...availabilityDates, day])
  }

  function chooseCountry(value: CountryKey) {
    setCountry(value)
    if (value === 'CA') {
      const firstProvince = CANADA_PROVINCES[0]
      const firstCity = firstProvince?.cities[0]
      setGovernorate(firstProvince?.key || '')
      setCity(firstCity?.key || '')
      setArea(firstCity?.areas[0]?.key || '')
      const center = firstCity ? CANADA_CITY_CENTERS[firstCity.key] : undefined
      if (center) {
        setLatitude(center[0].toFixed(6))
        setLongitude(center[1].toFixed(6))
      }
    } else {
      const firstGovernorate = SYRIA_GOVERNORATES[0]
      const firstCity = firstGovernorate?.cities[0]
      setGovernorate(firstGovernorate?.key || '')
      setCity(firstCity?.key || '')
      setArea(firstCity?.areas[0]?.key || '')
      const center = firstGovernorate ? GOVERNORATE_CENTERS[firstGovernorate.key] : undefined
      if (center) {
        setLatitude(center[0].toFixed(6))
        setLongitude(center[1].toFixed(6))
      }
    }
    setCitqRegistrationNumber('')
    setAreaQuery('')
    setMapPinConfirmed(false)
  }

  function chooseGovernorate(value: string) {
    setGovernorate(value)
    if (country === 'CA') {
      const nextProvince = getCanadianProvince(value)
      const nextCity = nextProvince?.cities[0]
      setCity(nextCity?.key || '')
      setArea(nextCity?.areas[0]?.key || '')
      const center = nextCity ? CANADA_CITY_CENTERS[nextCity.key] : undefined
      if (center) {
        setLatitude(center[0].toFixed(6))
        setLongitude(center[1].toFixed(6))
      }
    } else {
      const nextGovernorate = getGovernorate(value)
      const nextCity = nextGovernorate?.cities[0]
      setCity(nextCity?.key || '')
      setArea(nextCity?.areas[0]?.key || '')
      const center = GOVERNORATE_CENTERS[value]
      if (center) {
        setLatitude(center[0].toFixed(6))
        setLongitude(center[1].toFixed(6))
      }
    }
    setAreaQuery('')
    setMapPinConfirmed(false)
  }

  function chooseCity(value: string) {
    setCity(value)
    if (country === 'CA') {
      const nextCity = getCanadianCity(governorate, value)
      setArea(nextCity?.areas[0]?.key || '')
      const center = CANADA_CITY_CENTERS[value]
      if (center) {
        setLatitude(center[0].toFixed(6))
        setLongitude(center[1].toFixed(6))
      }
    } else {
      const nextCity = getCity(governorate, value)
      setArea(nextCity?.areas[0]?.key || '')
      const center = GOVERNORATE_CENTERS[governorate]
      if (center) {
        setLatitude(center[0].toFixed(6))
        setLongitude(center[1].toFixed(6))
      }
    }
    setAreaQuery('')
    setMapPinConfirmed(false)
  }

  async function suggestDescription() {
    setDescriptionAiState('generating')
    setDescriptionAiError('')
    try {
      const result = await generateListingDescription({
        division,
        titleAr: title,
        governorate: selectedGovernorateLabel,
        city: selectedCityLabel,
        area: selectedAreaLabel,
        propertyType: String(visualFilters.propertyType || selectedType),
        roomType: String(visualFilters.roomType || ''),
        bedType: String(visualFilters.bedType || ''),
        bedrooms: division === 'STAYS' || division === 'RENTALS' || division === 'BUY' ? toNumber(bedrooms) : null,
        bathrooms: division === 'STAYS' || division === 'RENTALS' || division === 'BUY' ? toNumber(bathrooms) : null,
        guestCapacity: division === 'STAYS' ? toNumber(guestCapacity) : null,
        amenities: Array.isArray(visualFilters.amenities) ? visualFilters.amenities : visualFilters.amenities ? [visualFilters.amenities] : [],
        priceMinor: toMinor(price),
        currency: listingCurrency,
      })
      setDescription(isAr ? result.descriptionAr : result.descriptionEn || result.descriptionAr)
      setDescriptionAiState('idle')
    } catch (error) {
      setDescriptionAiState('error')
      setDescriptionAiError(error instanceof Error ? error.message : isAr ? 'تعذر توليد الوصف.' : 'Could not generate the description.')
    }
  }

  const next = async () => {
    if (!isAdvertisingFlow && activeStep.id === 'location' && isQuebecStr && selectedAreaStrBanned) {
      setSubmitState('error')
      setSubmitError(
        isAr
          ? 'يمنع بلدية مونتريال الإيجار القصير في هذا الحي بشكل كامل. اختر منطقة أخرى.'
          : 'The City of Montreal prohibits short-term rental in this borough entirely. Choose a different area.',
      )
      return
    }
    if (!isAdvertisingFlow && activeStep.id === 'location' && isQuebecStr && !citqRegistrationNumber.trim()) {
      setSubmitState('error')
      setSubmitError(
        isAr
          ? 'رقم تسجيل الإقامة السياحية (CITQ) مطلوب لأي إعلان في كيبيك.'
          : 'A tourist accommodation registration number (CITQ) is required for any Quebec listing.',
      )
      return
    }
    if (!isAdvertisingFlow && activeStep.id === 'location' && isQuebecStr) {
      const expiry = citqCertificateExpiresAt ? new Date(citqCertificateExpiresAt) : null
      if (!expiry || Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
        setSubmitState('error')
        setSubmitError(
          isAr
            ? 'تاريخ انتهاء شهادة CITQ مطلوب ويجب أن يكون في المستقبل. لا يمكن نشر إعلان بشهادة منتهية.'
            : 'A CITQ certificate expiry date is required and must be in the future. A listing cannot go live with an expired certificate.',
        )
        return
      }
    }
    if (!isAdvertisingFlow && activeStep.id === 'location' && isQuebecStr && !residencyType) {
      setSubmitState('error')
      setSubmitError(
        isAr
          ? 'حدد نوع الملكية (سكني أساسي أو استثماري) لأي إعلان في كيبيك.'
          : 'Select the property residency type (principal or investment) for any Quebec listing.',
      )
      return
    }
    if (!isAdvertisingFlow && activeStep.id === 'plan' && !listingPlanPaymentConfirmed) {
      setSubmitState('error')
      setSubmitError(isAr ? 'اختر الخطة وادفعها قبل رفع الصور والملفات.' : 'Choose and pay the plan before uploading photos and files.')
      return
    }
    if (!isAdvertisingFlow && activeStep.id === 'media' && missingRequiredOfferProofSlots.length) {
      setSubmitState('error')
      setSubmitError(
        isAr
          ? `ارفع إثبات واضح للخيارات المختارة: ${missingRequiredOfferProofSlots.map((slot) => slot.ar).join('، ')}`
          : `Upload clear proof for selected offers: ${missingRequiredOfferProofSlots.map((slot) => slot.en).join(', ')}`,
      )
      return
    }
    if (!isAdvertisingFlow && activeStep.id === 'media' && missingQuebecComplianceSlots.length) {
      setSubmitState('error')
      setSubmitError(
        isAr
          ? 'ارفع إثبات التأمين قبل المتابعة -- مطلوب قانونياً لأي إقامة سياحية في كيبيك.'
          : 'Upload insurance proof before continuing -- legally required for any Quebec tourist accommodation.',
      )
      return
    }
    setSubmitState('idle')
    setSubmitError('')

    if (isLast) {
      if (isAdvertisingFlow && (!adFilesSent || !uploadedDocumentFiles.length)) {
        setSubmitState('error')
        setSubmitError(isAr ? 'ارفع مستندات الإعلان وأرسل الصور والملفات للإدارة قبل المتابعة.' : 'Upload ad documents and send photos/files to admin before continuing.')
        return
      }
      if (!isAdvertisingFlow && !uploadedDocumentFiles.length) {
        setSubmitState('error')
        setSubmitError(isAr ? 'ارفع مستندات البائع أو إثبات الملكية قبل إرسال الإعلان للمراجعة.' : 'Upload seller documents or ownership proof before sending the listing for review.')
        return
      }
      if (!isAdvertisingFlow && missingRequiredOfferProofSlots.length) {
        setSubmitState('error')
        setSubmitError(
          isAr
            ? `لا يمكن نشر خيار للضيف بدون صورة إثبات: ${missingRequiredOfferProofSlots.map((slot) => slot.ar).join('، ')}`
            : `Guest-facing offers need proof photos before publish: ${missingRequiredOfferProofSlots.map((slot) => slot.en).join(', ')}`,
        )
        return
      }

      setSubmitState('submitting')
      setSubmitError('')

      const roomTypeMetadata = {
        country,
        citqRegistrationNumber: isQuebecStr ? citqRegistrationNumber.trim() : undefined,
        citqCertificateExpiresAt: isQuebecStr ? citqCertificateExpiresAt : undefined,
        residencyType: isQuebecStr ? residencyType : undefined,
        propertyType: selectedType,
        sizeSqm: toNumber(size),
        guestCapacity: toNumber(guestCapacity),
        bedrooms: toNumber(bedrooms),
        bathrooms: toNumber(bathrooms),
        cleaningFeeMinor: toMinor(cleaningFee),
        taxFeeMinor: toMinor(taxFee),
        guestVisibleFees: {
          currency: 'USD',
          nightlyPriceMinor: toMinor(price),
          cleaningFeeMinor: toMinor(cleaningFee),
          taxFeeMinor: toMinor(taxFee),
        },
        listingPlan: selectedListingPlan.id,
        listingPlanPriceUsd: selectedListingPlan.priceUsd,
        listingPlanPaymentMethod,
        listingPlanPaymentConfirmed,
        allowedMediaSlots: allowedMediaSlots.map((slot) => slot.id),
        selectedOfferProofSlots: activeOfferProofSlots.map((slot) => slot.id),
        uploadedOfferProofSlots: uploadedAdFiles.filter((id) => id.startsWith(OFFER_PROOF_PREFIX)),
        missingOfferProofSlots: missingRequiredOfferProofSlots.map((slot) => slot.id),
        quebecComplianceSlots: quebecComplianceSlots.map((slot) => slot.id),
        missingQuebecComplianceSlots: missingQuebecComplianceSlots.map((slot) => slot.id),
        visualFilters,
        availabilityCalendar,
        mapLocation,
      }

      try {
        if (isMultiRoomFlow) {
          // C2: real property photos are required and attach to the room-type Listing created below.
          if (!meetsMinimumPhotos(photoDrafts.length)) {
            setSubmitState('error')
            setSubmitError(isAr ? 'أضف صورة واحدة على الأقل حتى يرى الضيوف مكانك.' : 'Add at least one photo so guests can see your place.')
            return
          }

          // Create the room-type Listing once; on a retry after a partial upload failure, reuse the
          // same room-type listing id so photos aren't re-created and a duplicate room isn't added.
          let roomListingId = roomTypeListingId
          if (!roomListingId) {
            let accId = accommodationId
            if (!accId) {
              const accommodation = await createAccommodation({
                titleAr: title || (isAr ? 'عقار SYBNB جديد' : 'New SYBNB property'),
                titleEn: title,
                description,
                governorate,
                city,
                area,
                address,
                metadata: {
                  country,
                  citqRegistrationNumber: isQuebecStr ? citqRegistrationNumber.trim() : undefined,
                  citqCertificateExpiresAt: isQuebecStr ? citqCertificateExpiresAt : undefined,
                  residencyType: isQuebecStr ? residencyType : undefined,
                  uploadedDocumentFiles,
                  governorateLabel: selectedGovernorateLabel,
                  cityLabel: selectedCityLabel,
                  areaLabel: selectedAreaLabel,
                  availabilityCalendar,
                  mapLocation,
                  listingPlan: selectedListingPlan.id,
                  listingPlanPriceUsd: selectedListingPlan.priceUsd,
                  listingPlanPaymentMethod,
                  listingPlanPaymentConfirmed,
                  allowedMediaSlots: allowedMediaSlots.map((slot) => slot.id),
                  selectedOfferProofSlots: activeOfferProofSlots.map((slot) => slot.id),
                  uploadedOfferProofSlots: uploadedAdFiles.filter((id) => id.startsWith(OFFER_PROOF_PREFIX)),
                  missingOfferProofSlots: missingRequiredOfferProofSlots.map((slot) => slot.id),
                  quebecComplianceSlots: quebecComplianceSlots.map((slot) => slot.id),
                  missingQuebecComplianceSlots: missingQuebecComplianceSlots.map((slot) => slot.id),
                },
              })
              accId = accommodation.id
              setAccommodationId(accId)
            }
            const roomListing = await addAccommodationRoomType(accId, {
              titleAr: title || (isAr ? 'نوع غرفة جديد' : 'New room type'),
              titleEn: title,
              description,
              priceMinor: toMinor(price),
              currency: 'USD',
              instantBookEnabled,
              metadata: roomTypeMetadata,
            })
            roomListingId = roomListing.id
            setRoomTypeListingId(roomListingId)
          }

          // Upload the real photos SEQUENTIALLY to the room-type Listing via the existing /media API.
          // Never advance/submit until every photo is server-confirmed; a failure is retryable.
          const io = {
            encodePhoto: async (photoItem: PhotoItem) => {
              const draft = photoDrafts.find((p) => p.item.id === photoItem.id)
              if (!draft) throw new Error('Missing photo data')
              return { fileBase64: await blobToBase64(draft.blob), mimeType: photoItem.mimeType }
            },
            uploadPhoto: async (listingId: string, encoded: { fileBase64: string; mimeType: string }) =>
              uploadListingPhoto(listingId, encoded),
          }
          const result = await uploadPhotosSequentially(photoDrafts.map((p) => p.item), io, roomListingId)
          setPhotoDrafts((prev) =>
            prev.map((p) => {
              const updated = result.items.find((i) => i.id === p.item.id)
              return updated ? { ...p, item: updated } : p
            }),
          )
          if (!result.ok) {
            setSubmitState('error')
            setSubmitError(
              isAr
                ? 'تعذّر رفع بعض الصور. اضغط الحفظ مرة أخرى لإعادة المحاولة للصور المتعثرة فقط.'
                : 'Some photos failed to upload. Press Save again to retry only the failed ones.',
            )
            return
          }
          setRoomTypeListingId(null) // this room type is complete; a new room type starts fresh
          setSubmitState('idle')
          setRoomTypeStage('prompt')
          return
        }

        const listingInput = {
          division,
          titleAr: title || 'إعلان SYBNB جديد',
          titleEn: title,
          description,
          priceMinor: toMinor(price),
          currency: listingCurrency,
          instantBookEnabled: division === 'STAYS' ? instantBookEnabled : false,
          metadata: {
            advertising: isAdvertisingFlow,
            adPlan,
            adPlacement,
            adDuration,
            uploadedAdFiles,
            uploadedDocumentFiles,
            propertyType: selectedType,
            country,
            citqRegistrationNumber: isQuebecStr ? citqRegistrationNumber.trim() : undefined,
        citqCertificateExpiresAt: isQuebecStr ? citqCertificateExpiresAt : undefined,
            residencyType: isQuebecStr ? residencyType : undefined,
            governorate,
            city,
            area,
            address,
            governorateLabel: selectedGovernorateLabel,
            cityLabel: selectedCityLabel,
            areaLabel: selectedAreaLabel,
            sizeSqm: toNumber(size),
            guestCapacity: toNumber(guestCapacity),
            bedrooms: toNumber(bedrooms),
            bathrooms: toNumber(bathrooms),
            cleaningFeeMinor: toMinor(cleaningFee),
            taxFeeMinor: toMinor(taxFee),
            guestVisibleFees: {
              currency: 'USD',
              nightlyPriceMinor: toMinor(price),
              cleaningFeeMinor: toMinor(cleaningFee),
              taxFeeMinor: toMinor(taxFee),
            },
            listingPlan: selectedListingPlan.id,
            listingPlanPriceUsd: selectedListingPlan.priceUsd,
            listingPlanPaymentMethod,
            listingPlanPaymentConfirmed,
            allowedMediaSlots: allowedMediaSlots.map((slot) => slot.id),
            selectedOfferProofSlots: activeOfferProofSlots.map((slot) => slot.id),
            uploadedOfferProofSlots: uploadedAdFiles.filter((id) => id.startsWith(OFFER_PROOF_PREFIX)),
            missingOfferProofSlots: missingRequiredOfferProofSlots.map((slot) => slot.id),
            quebecComplianceSlots: quebecComplianceSlots.map((slot) => slot.id),
            missingQuebecComplianceSlots: missingQuebecComplianceSlots.map((slot) => slot.id),
            visualFilters,
            availabilityCalendar,
            mapLocation,
          },
        }

        // Non-STAYS divisions (and the STAYS advertising variant) publish a single listing; the STAYS
        // property flow is handled above via the accommodation/room-type path (C2 photos attach there).
        // M6: a STAYS publish must carry the host's accepted commission contract.
        const consent = division === 'STAYS' && contractAccepted && contractVersion ? { acceptContract: true as const, contractVersion } : undefined
        await createAndSubmitPrototypeListing(listingInput, consent)
        clearDraft()
        navigate('/sell/submitted')
      } catch (error) {
        setSubmitState('error')
        setSubmitError(error instanceof Error ? error.message : 'Unable to submit listing.')
      }
      return
    }

    setStepIndex((current) => Math.min(current + 1, steps.length - 1))
  }

  function startAnotherRoomType() {
    setTitle(isAr ? '' : '')
    setDescription('')
    setPrice('15')
    setCleaningFee('0')
    setTaxFee('0')
    setSize('40')
    setBedrooms('1')
    setBathrooms('1')
    setSelectedType(PROPERTY_TYPES[0].en)
    setVisualFilters({ propertyType: 'apartment', roomType: 'doubleRoom', bedType: 'queenBed', amenities: ['wifi', 'kitchen'] })
    // C2: keep the selected images (no re-selection needed, per the prompt copy) but reset their
    // upload state so they re-upload as THIS new room type's own ListingMedia — each room type manages
    // its own media; no shared galleries or cross-room synchronization.
    setPhotoDrafts((prev) => prev.map((p) => ({ ...p, item: { ...p.item, status: 'selected', mediaUrl: undefined, error: undefined } })))
    setRoomTypeListingId(null)
    setRoomTypeStage('idle')
    setStepIndex(0)
  }

  async function finishAccommodation() {
    if (!accommodationId) return
    // M6: publishing a STAYS accommodation requires the host to have accepted the current commission contract.
    if (!contractAccepted || !contractVersion) {
      setSubmitState('error')
      setSubmitError(isAr ? 'يرجى الموافقة على عقد العمولة قبل النشر.' : 'Please accept the commission contract before publishing.')
      return
    }
    setSubmitState('submitting')
    setSubmitError('')
    try {
      await submitAccommodation(accommodationId, { acceptContract: true, contractVersion })
      clearDraft()
      navigate('/sell/submitted')
    } catch (error) {
      setSubmitState('error')
      setSubmitError(error instanceof Error ? error.message : 'Unable to submit accommodation.')
    }
  }

  function addListingDocumentFiles(fileList: FileList | null) {
    const names = Array.from(fileList || []).map((file) => file.name).filter(Boolean)
    if (!names.length) return

    setUploadedDocumentFiles((current) => Array.from(new Set([...current, ...names])))
    setAdFilesSent(false)
  }

  const back = () => {
    if (stepIndex === 0) {
      navigate('/sell/account')
      return
    }

    setStepIndex((current) => Math.max(current - 1, 0))
  }

  if (roomTypeStage === 'prompt') {
    return (
      <main className="seller-page seller-wizard-page" dir={isAr ? 'rtl' : 'ltr'}>
        <section className="seller-account-head">
          <BrandLogo logo="plus" size="nav" />
        </section>

        <section className="seller-wizard-shell">
          <div className="seller-wizard-header">
            <p className="eyebrow">{isAr ? 'نفس العقار' : 'Same property'}</p>
            <h1>{isAr ? 'أضف نوع غرفة آخر لنفس العقار؟' : 'Add another room type for the same property?'}</h1>
            <p>
              {isAr
                ? 'الموقع والمستندات والصور محفوظة مسبقاً — لن تحتاج لإعادة رفعها لأي غرفة إضافية.'
                : 'Location, documents, and photos are already saved — you will not need to re-upload them for another room type.'}
            </p>
          </div>
          <div className="seller-wizard-body">
            <div className="seller-wizard-section">
              {submitState === 'error' && (
                <div className="seller-inline-alert">
                  <strong>{isAr ? 'تعذر الإرسال' : 'Submission failed'}</strong>
                  <span>{submitError}</span>
                </div>
              )}
            </div>
          </div>
          <div className="seller-wizard-actions">
            <button className="seller-secondary-button" disabled={submitState === 'submitting'} onClick={finishAccommodation}>
              {isAr ? 'لا، أرسل للمراجعة' : 'No, submit for review'}
            </button>
            <button className="seller-primary-button" disabled={submitState === 'submitting'} onClick={startAnotherRoomType}>
              {isAr ? 'نعم، أضف غرفة أخرى' : 'Yes, add another room type'}
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="seller-page seller-wizard-page" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="seller-account-head">
        <BrandLogo logo="plus" size="nav" />
      </section>

      <section className="seller-wizard-shell">
        <div className="seller-wizard-header">
          <p className="eyebrow">
            {isAdvertisingFlow
              ? isAr ? 'معالج الإعلان' : 'Advertising wizard'
              : isAr
                ? `معالج نشر ${DIVISION_OPTIONS.find((item) => item.value === division)?.ar || 'الإعلان'}`
                : `Listing wizard · ${DIVISION_OPTIONS.find((item) => item.value === division)?.en || ''}`}
          </p>
          <h1>{activeStep.title[lang]}</h1>
          <p>{activeStep.helper[lang]}</p>
          <div className="seller-progress-track" aria-label={isAr ? 'تقدم الخطوات' : 'Step progress'}>
            <span style={{ width: progress }} />
          </div>
          <div className="seller-step-chips">
            {steps.map((step, index) => (
              <button
                className={index === stepIndex ? 'active' : ''}
                key={step.id}
                onClick={() => {
                  if (!isAdvertisingFlow && step.id === 'media' && !listingPlanPaymentConfirmed) {
                    const planIndex = steps.findIndex((item) => item.id === 'plan')
                    setStepIndex(planIndex >= 0 ? planIndex : index)
                    setSubmitState('error')
                    setSubmitError(isAr ? 'ادفع خطة الإعلان قبل رفع الصور والملفات.' : 'Pay the listing plan before uploading photos and files.')
                    return
                  }
                  setSubmitState('idle')
                  setSubmitError('')
                  setStepIndex(index)
                }}
              >
                {index + 1}. {step.title[lang]}
              </button>
            ))}
          </div>
        </div>

        <div className="seller-wizard-body">
          {activeStep.id === 'basics' && (
            <div className="seller-wizard-section">
              {!isAdvertisingFlow && (
                <TouchChoiceGroup
                  active={DIVISION_OPTIONS.find((item) => item.value === division)?.[lang === 'ar' ? 'ar' : 'en'] || ''}
                  items={DIVISION_OPTIONS.map((item) => item[lang === 'ar' ? 'ar' : 'en'])}
                  onChange={(label) => {
                    const next = DIVISION_OPTIONS.find((item) => item[lang === 'ar' ? 'ar' : 'en'] === label)
                    if (next) setDivision(next.value)
                  }}
                  title={isAr ? 'القسم' : 'Division'}
                />
              )}
              {!isAdvertisingFlow && division === 'CARS' && (
                <VisualFilterPanel
                  compact
                  groups={sellerCarFilterGroups}
                  lang={lang}
                  selection={visualFilters}
                  onChange={setVisualFilters}
                />
              )}
              {!isAdvertisingFlow && division !== 'CARS' && (
                <VisualFilterPanel
                  compact
                  groups={sellerPropertyFilterGroups}
                  lang={lang}
                  selection={visualFilters}
                  onChange={(nextFilters) => {
                    setVisualFilters(nextFilters)
                    setSelectedType(String(nextFilters.propertyType || selectedType))
                  }}
                />
              )}
              <label className="seller-wide-field">
                <span>{isAdvertisingFlow ? (isAr ? 'اسم الحملة الإعلانية' : 'Campaign name') : isAr ? 'عنوان الإعلان' : 'Listing title'}</span>
                <input
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={isAdvertisingFlow ? (isAr ? 'اسم الحملة' : 'Campaign name') : isAr ? 'اكتب عنوان الإعلان' : 'Write the listing title'}
                  value={title}
                />
              </label>
              <label className="seller-wide-field">
                <span>{isAdvertisingFlow ? (isAr ? 'وصف الإعلان' : 'Ad description') : isAr ? 'وصف مختصر' : 'Short description'}</span>
                <textarea
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder={isAdvertisingFlow ? (isAr ? 'اكتب هدف الإعلان والجمهور المطلوب.' : 'Write the ad goal and target audience.') : isAr ? 'اكتب الوصف بوضوح.' : 'Write the description clearly.'}
                  value={description}
                />
              </label>
              <button
                className="seller-secondary-button"
                disabled={descriptionAiState === 'generating' || !title.trim()}
                onClick={() => void suggestDescription()}
                type="button"
              >
                {descriptionAiState === 'generating'
                  ? isAr
                    ? 'جارٍ توليد الوصف...'
                    : 'Generating description...'
                  : isAr
                    ? 'اقتراح وصف بالذكاء الاصطناعي'
                    : 'Suggest description with AI'}
              </button>
              {descriptionAiState === 'error' && (
                <div className="seller-inline-alert">
                  <strong>{isAr ? 'تعذر التوليد' : 'Could not generate'}</strong>
                  <span>{descriptionAiError}</span>
                </div>
              )}
              {isAdvertisingFlow && (
                <div className="seller-form-grid">
                  <TouchChoiceGroup
                    active={adPlacement}
                    items={AD_PLACEMENTS.map((item) => item[lang === 'ar' ? 'ar' : 'en'])}
                    onChange={setAdPlacement}
                    title={isAr ? 'مكان الظهور' : 'Placement'}
                  />
                  <TouchChoiceGroup
                    active={adDuration}
                    items={AD_DURATIONS.map((item) => item[lang === 'ar' ? 'ar' : 'en'])}
                    onChange={setAdDuration}
                    title={isAr ? 'مدة الإعلان' : 'Ad duration'}
                  />
                </div>
              )}
            </div>
          )}

          {activeStep.id === 'location' && (
            <div className="seller-wizard-section">
              <div className="seller-location-capsule">
                <div className="seller-location-group">
                  <span>{isAr ? 'الدولة' : 'Country'}</span>
                  <div className="seller-location-options">
                    {COUNTRIES.map((item) => (
                      <button className={item.key === country ? 'active' : ''} key={item.key} onClick={() => chooseCountry(item.key)} type="button">
                        {text(item, lang)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="seller-location-summary">
                  <span>{isAr ? 'الموقع المختار' : 'Selected location'}</span>
                  <strong>{[selectedGovernorateLabel, selectedCityLabel, selectedAreaLabel].filter(Boolean).join(' ← ')}</strong>
                </div>
                <div className="seller-location-group">
                  <span>{isAr ? (isCanada ? 'المقاطعة' : 'المحافظة') : isCanada ? 'Province' : 'Governorate'}</span>
                  <div className="seller-location-options">
                    {(isCanada ? CANADA_PROVINCES : SYRIA_GOVERNORATES).map((item) => (
                      <button className={item.key === governorate ? 'active' : ''} key={item.key} onClick={() => chooseGovernorate(item.key)}>
                        {placeLabel(item)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="seller-location-group">
                  <span>{isAr ? 'المدينة / القضاء' : 'City / district'}</span>
                  <div className="seller-location-options">
                    {(selectedGovernorateData?.cities || []).map((item) => (
                      <button className={item.key === city ? 'active' : ''} key={item.key} onClick={() => chooseCity(item.key)}>
                        {placeLabel(item)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="seller-location-group">
                  <span>{isAr ? (isCanada ? 'الحي / الشارع' : 'المنطقة / الشارع') : isCanada ? 'Borough / street' : 'Area / street'}</span>
                  <div className="seller-location-search-line">
                    <input
                      dir={isAr ? 'rtl' : 'ltr'}
                      onChange={(event) => setAreaQuery(event.target.value)}
                      placeholder={isAr ? 'ابحث عن المنطقة أو الشارع' : 'Search area or street'}
                      type="search"
                      value={areaQuery}
                    />
                    <strong>{selectedAreaLabel || (isAr ? 'لم يتم الاختيار' : 'Not selected')}</strong>
                  </div>
                  <div className="seller-location-search-results">
                    {filteredAreaOptions.map((item) => (
                      <button
                        className={item.key === area ? 'active' : ''}
                        key={item.key}
                        onClick={() => {
                          setArea(item.key)
                          setAreaQuery(placeLabel(item))
                        }}
                        type="button"
                      >
                        {placeLabel(item)}
                      </button>
                    ))}
                    {!filteredAreaOptions.length && (
                      <span className="seller-location-empty">{isAr ? 'لا توجد نتيجة مطابقة' : 'No matching area'}</span>
                    )}
                  </div>
                </div>
                {isQuebecStr && selectedAreaStrBanned && (
                  <div className="seller-inline-alert">
                    <strong>{isAr ? 'الإيجار القصير ممنوع في هذا الحي' : 'Short-term rental is banned in this borough'}</strong>
                    <span>
                      {isAr
                        ? 'يمنع بلدية مونتريال الإيجار القصير في هذا الحي بشكل كامل. لن يتم قبول هذا الإعلان مهما كانت المستندات.'
                        : 'The City of Montreal prohibits short-term rental in this borough entirely. This listing cannot be approved regardless of documentation.'}
                    </span>
                  </div>
                )}
                {isQuebecStr && (
                  <label className="seller-wide-field">
                    <span>{isAr ? 'رقم تسجيل الإقامة السياحية (CITQ)' : 'Tourist accommodation registration number (CITQ)'}</span>
                    <input
                      dir="ltr"
                      onChange={(event) => setCitqRegistrationNumber(event.target.value)}
                      placeholder={isAr ? 'مثال: 123456' : 'e.g. 123456'}
                      value={citqRegistrationNumber}
                    />
                    <small>
                      {isAr
                        ? 'مطلوب قانونياً في كيبيك لأي إقامة تُؤجر 31 يوماً أو أقل مقابل دفع. سجّل عبر Corporation de l’industrie touristique du Québec (CITQ).'
                        : "Legally required in Quebec for any unit rented 31 days or less for payment. Register through the Corporation de l'industrie touristique du Québec (CITQ)."}
                    </small>
                  </label>
                )}
                {isQuebecStr && (
                  <label className="seller-wide-field">
                    <span>{isAr ? 'تاريخ انتهاء شهادة CITQ' : 'CITQ certificate expiry date'}</span>
                    <input
                      dir="ltr"
                      onChange={(event) => setCitqCertificateExpiresAt(event.target.value)}
                      type="date"
                      value={citqCertificateExpiresAt}
                    />
                    <small>
                      {isAr
                        ? 'يجب أن يكون تاريخاً مستقبلياً. لن يُقبل الإعلان أو يُسمح بحجوزات جديدة بشهادة منتهية.'
                        : 'Must be a future date. A listing cannot go live, and an already-live listing cannot accept new bookings, with an expired certificate.'}
                    </small>
                  </label>
                )}
                {isQuebecStr && (
                  <label className="seller-wide-field">
                    <span>{isAr ? 'نوع الملكية' : 'Property residency type'}</span>
                    <div className="seller-location-options">
                      <button
                        className={residencyType === 'principal' ? 'active' : ''}
                        onClick={() => setResidencyType('principal')}
                        type="button"
                      >
                        {isAr ? 'سكني أساسي (أعيش هنا)' : 'Principal residence (I live here)'}
                      </button>
                      <button
                        className={residencyType === 'investment' ? 'active' : ''}
                        onClick={() => setResidencyType('investment')}
                        type="button"
                      >
                        {isAr ? 'عقار استثماري (لا أعيش هنا)' : "Investment property (I don't live here)"}
                      </button>
                    </div>
                    <small>
                      {isAr
                        ? 'يحدد فئة تسجيل CITQ. في مونتريال، العقارات الاستثمارية ممنوعة تقريباً في كل مكان إلا شوارع محددة، وتخضع لمراجعة إدارية أدق.'
                        : "Determines your CITQ registration category. In Montreal, investment properties are banned almost everywhere except specific named streets and get stricter admin review."}
                    </small>
                    {isMontrealStr && residencyType === 'investment' && (
                      <div className="seller-inline-alert">
                        <strong>{isAr ? 'مراجعة إدارية أدق مطلوبة' : 'Stricter admin review required'}</strong>
                        <span>
                          {isAr
                            ? 'مونتريال تمنع تأجير العقارات الاستثمارية قصيرة المدة في معظم الأحياء. سيُعلَّم هذا الإعلان للمراجعة اليدوية الدقيقة قبل أي قبول.'
                            : 'Montreal bans short-term rental of investment properties in most areas. This listing will be flagged for careful manual review before any approval.'}
                        </span>
                      </div>
                    )}
                    {isMontrealStr && residencyType === 'principal' && (
                      <div className="seller-inline-alert">
                        <strong>{isAr ? 'نافذة موسمية إلزامية' : 'Mandatory seasonal window'}</strong>
                        <span>
                          {isAr
                            ? 'يسمح بالإقامة الأساسية في مونتريال فقط من ١٠ يونيو إلى ١٠ سبتمبر، وبحد أقصى ٩٠ ليلة سنوياً. النظام يمنع تلقائياً أي تاريخ توفر أو حجز خارج هذه النافذة.'
                            : 'Montreal allows principal-residence STR only June 10-Sept 10, capped at 90 nights/year. The system automatically blocks any availability or booking date outside this window.'}
                        </span>
                      </div>
                    )}
                  </label>
                )}
              </div>
              <label className="seller-wide-field">
                <span>{isAr ? 'العنوان التفصيلي' : 'Detailed address'}</span>
                <input
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder={isAr ? 'اسم الشارع أو أقرب معلم' : 'Street name or nearest landmark'}
                  value={address}
                />
              </label>
              <div className="seller-map-panel">
                <div className="seller-map-card" aria-label={isAr ? 'خريطة موقع الإعلان' : 'Listing location map'}>
                  <SellerLocationMap
                    latitude={toNumber(latitude)}
                    longitude={toNumber(longitude)}
                    onMove={(lat, lng) => {
                      setLatitude(lat.toFixed(6))
                      setLongitude(lng.toFixed(6))
                      setMapPinConfirmed(true)
                    }}
                  />
                  <div className="seller-map-chip">
                    <strong>{selectedAreaLabel || selectedCityLabel}</strong>
                    <span>{mapPinConfirmed ? (isAr ? 'تم تأكيد الموقع' : 'Pin confirmed') : isAr ? 'اضغط أو اسحب الدبوس على الخريطة لتحديد الموقع' : 'Click or drag the pin on the map to set the location'}</span>
                  </div>
                </div>
                <div className="seller-map-controls">
                  <div>
                    <strong>{isAr ? 'تثبيت موقع الإعلان' : 'Set listing location'}</strong>
                    <span>{[selectedCityLabel, selectedAreaLabel, address].filter(Boolean).join(' · ')}</span>
                  </div>
                  <label>
                    <span>{isAr ? 'خط العرض' : 'Latitude'}</span>
                    <input dir="ltr" inputMode="decimal" onChange={(event) => setLatitude(event.target.value)} value={latitude} />
                  </label>
                  <label>
                    <span>{isAr ? 'خط الطول' : 'Longitude'}</span>
                    <input dir="ltr" inputMode="decimal" onChange={(event) => setLongitude(event.target.value)} value={longitude} />
                  </label>
                  <button className={mapPinConfirmed ? 'confirmed' : ''} onClick={() => setMapPinConfirmed(true)} type="button">
                    {mapPinConfirmed ? (isAr ? 'تم حفظ الموقع' : 'Location saved') : isAr ? 'تأكيد الموقع على الخريطة' : 'Confirm location on map'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeStep.id === 'price' && !isAdvertisingFlow && (
            <div className="seller-wizard-section seller-form-grid">
              <label>
                <span>
                  {division === 'STAYS'
                    ? isAr
                      ? 'السعر بالدولار لكل ليلة'
                      : 'USD nightly price'
                    : isAr
                      ? 'السعر المطلوب'
                      : 'Asking price'}
                </span>
                {division === 'STAYS' ? (
                  <div className="seller-price-input-shell">
                    <b>USD</b>
                    <input
                      dir="ltr"
                      inputMode="numeric"
                      onChange={(event) => {
                        setPrice(event.target.value)
                        setVariableNightPrice(event.target.value)
                      }}
                      placeholder="15"
                      value={price}
                    />
                  </div>
                ) : (
                  <input dir="ltr" onChange={(event) => setPrice(event.target.value)} placeholder="250000" value={price} />
                )}
              </label>
              {division === 'STAYS' && (
                <label>
                  <span>{isAr ? 'رسوم التنظيف بالدولار (اختياري)' : 'Cleaning fee USD (optional)'}</span>
                  <div className="seller-price-input-shell">
                    <b>USD</b>
                    <input
                      dir="ltr"
                      inputMode="numeric"
                      onChange={(event) => setCleaningFee(event.target.value)}
                      placeholder="0"
                      value={cleaningFee}
                    />
                  </div>
                </label>
              )}
              {division === 'STAYS' && (
                <label>
                  <span>
                    {isQuebecStr
                      ? isAr
                        ? 'ضريبة الإقامة (كيبيك — ٣٫٥٪ محسوبة تلقائياً)'
                        : 'Lodging tax (Quebec — 3.5%, calculated automatically)'
                      : isAr
                        ? 'الضريبة بالدولار (اختياري)'
                        : 'Tax USD (optional)'}
                  </span>
                  <div className="seller-price-input-shell">
                    <b>USD</b>
                    <input
                      dir="ltr"
                      disabled={isQuebecStr}
                      inputMode="numeric"
                      onChange={(event) => setTaxFee(event.target.value)}
                      placeholder="0"
                      value={taxFee}
                    />
                  </div>
                  {isQuebecStr && (
                    <small>
                      {isAr
                        ? 'رقم إلزامي بموجب ضريبة الإقامة لدى Revenu Québec (٣٫٥٪ من السعر لليلة). لا يمكن تعديله يدوياً.'
                        : "Required by Revenu Québec's Tax on Lodging (3.5% of the nightly rate). Cannot be edited manually."}
                    </small>
                  )}
                </label>
              )}
              <label>
                <span>
                  {division === 'STAYS'
                    ? isAr
                      ? 'عدد الضيوف المقبول'
                      : 'Accepted guests'
                    : isAr
                      ? 'المساحة'
                      : 'Area'}
                </span>
                <input
                  dir="ltr"
                  inputMode="numeric"
                  onChange={(event) => (division === 'STAYS' ? setGuestCapacity(event.target.value) : setSize(event.target.value))}
                  placeholder={division === 'STAYS' ? '2' : '110 m2'}
                  value={division === 'STAYS' ? guestCapacity : size}
                />
              </label>
              <label>
                <span>{isAr ? 'غرف النوم' : 'Bedrooms'}</span>
                <input dir="ltr" onChange={(event) => setBedrooms(event.target.value)} placeholder="3" value={bedrooms} />
              </label>
              <label>
                <span>{isAr ? 'الحمامات' : 'Bathrooms'}</span>
                <input dir="ltr" onChange={(event) => setBathrooms(event.target.value)} placeholder="2" value={bathrooms} />
              </label>
              {division === 'STAYS' && (
                <label className="seller-wide-field seller-instant-book-toggle">
                  <input type="checkbox" checked={instantBookEnabled} onChange={(event) => setInstantBookEnabled(event.target.checked)} />
                  <span>
                    <strong>{isAr ? '⚡ تفعيل الحجز الفوري' : '⚡ Enable Instant Book'}</strong>
                    <small>
                      {isAr
                        ? 'يتأكد حجز الضيف تلقائياً فور نجاح الدفع، دون انتظار موافقتك اليدوية.'
                        : 'Guest bookings confirm automatically once payment succeeds, without waiting for your manual approval.'}
                    </small>
                  </span>
                </label>
              )}
              {division === 'STAYS' && (
                <div className="seller-wide-field seller-money-note">
                  {isAr
                    ? `تخصم SYBNB عمولة خدمة${commissionLabel ? ` ${commissionLabel}` : ''} من قيمة الإيجار ورسوم التنظيف (لا تشمل الضريبة) من مستحقاتك عند كل حجز مكتمل.`
                    : `SYBNB deducts ${commissionLabel ? `a ${commissionLabel}` : 'a'} service commission from the rent plus cleaning fee (not the tax) from your payout on every completed booking.`}
                </div>
              )}
              {division === 'STAYS' && (
                <div className="seller-wide-field seller-money-note">
                  {(() => {
                    // M6: live "gross − commission = your payout" preview using the SAME rate applied to the split.
                    const grossBase = (Number(price) || 0) + (Number(cleaningFee) || 0)
                    const commission = platformFeePct != null ? Math.round(grossBase * platformFeePct * 100) / 100 : null
                    const payout = commission != null ? Math.round((grossBase - commission) * 100) / 100 : null
                    return commission != null ? (
                      <p style={{ margin: '0 0 8px' }}>
                        {isAr
                          ? `على أساس هذا السعر: الإجمالي ${grossBase} − العمولة ${commission} = مستحقاتك ${payout}.`
                          : `For this price: gross ${grossBase} − commission ${commission} = your payout ${payout}.`}
                      </p>
                    ) : null
                  })()}
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <input type="checkbox" checked={contractAccepted} onChange={(event) => setContractAccepted(event.target.checked)} />
                    <span>
                      {isAr
                        ? 'أوافق على عقد العمولة الحالي: تُحتسب العمولة على الإيجار + رسوم التنظيف (لا تشمل الضريبة). مطلوبة قبل النشر.'
                        : 'I accept the current commission contract: commission is on rent + cleaning (tax excluded). Required before publishing.'}
                    </span>
                  </label>
                </div>
              )}
              {division === 'STAYS' && (
                <div className="seller-wide-field seller-host-search-capsule">
                  <div className="seller-host-search-head">
                    <div>
                      <strong>{isAr ? 'كبسولة البحث والرزنامة' : 'Search capsule and calendar'}</strong>
                      <span>
                        {isAr
                          ? 'حدد هل يظهر هذا الإعلان في البحث، ثم ضع أيام التوفر والحجز والدفع.'
                          : 'Choose whether this listing appears in search, then set availability, booking, and payment dates.'}
                      </span>
                    </div>
                    <button
                      className={searchCapsuleEnabled ? 'active' : ''}
                      type="button"
                      onClick={() => setSearchCapsuleEnabled((current) => !current)}
                    >
                      {searchCapsuleEnabled ? (isAr ? 'ظاهر في البحث' : 'Visible in search') : isAr ? 'مخفي من البحث' : 'Hidden from search'}
                    </button>
                  </div>
                  <div className="seller-host-calendar-layout">
                    <section className="seller-host-calendar-panel available">
                      <div className="seller-host-calendar-panel-head">
                        <strong>{isAr ? 'أماكن متوفرة' : 'Available places'}</strong>
                        <div className="seller-host-month-switcher">
                          <button onClick={() => setAvailabilityMonth((current) => addMonths(current, -1))} type="button">
                            {isAr ? 'السابق' : 'Previous'}
                          </button>
                          <b>{monthTitle(availabilityMonth, lang)}</b>
                          <button onClick={() => setAvailabilityMonth((current) => addMonths(current, 1))} type="button">
                            {isAr ? 'التالي' : 'Next'}
                          </button>
                        </div>
                        <label>
                          <span>{isAr ? 'سعر الليلة USD' : 'Night price USD'}</span>
                          <input
                            dir="ltr"
                            inputMode="numeric"
                            onChange={(event) => {
                              setVariableNightPrice(event.target.value)
                              setPrice(event.target.value)
                            }}
                            value={variableNightPrice}
                          />
                        </label>
                      </div>
                      <div className="seller-host-day-grid">
                        {availabilityMonthDays.map((day) => (
                          <button className={selectedAvailabilityDays.has(day) ? 'active' : ''} key={day} onClick={() => toggleAvailabilityDay(day)} type="button">
                            <strong>{new Date(`${day}T00:00:00`).getDate()}</strong>
                            <span>{selectedAvailabilityDays.has(day) ? `USD ${variableNightPrice || price}` : isAr ? 'مغلق' : 'Closed'}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="seller-host-calendar-panel booked">
                      <div className="seller-host-calendar-panel-head">
                        <strong>{isAr ? 'رزنامة الحجوزات' : 'Reservation calendar'}</strong>
                        <div className="seller-host-month-switcher">
                          <button onClick={() => setReservationMonth((current) => addMonths(current, -1))} type="button">
                            {isAr ? 'السابق' : 'Previous'}
                          </button>
                          <b>{monthTitle(reservationMonth, lang)}</b>
                          <button onClick={() => setReservationMonth((current) => addMonths(current, 1))} type="button">
                            {isAr ? 'التالي' : 'Next'}
                          </button>
                        </div>
                        <div className="seller-host-readonly-booking-note">
                          <span>{isAr ? 'للعرض فقط' : 'View only'}</span>
                          <b>{isAr ? 'الحجوزات تأتي من طلبات العملاء المؤكدة' : 'Bookings come from confirmed guest requests'}</b>
                        </div>
                      </div>
                      <div className="seller-host-day-grid seller-host-booking-grid">
                        {reservationMonthDays.map((day) => {
                          const isAcceptedBooking = day === bookedDate
                          const isPaymentDay = day === paymentDay
                          const dayLabel = isAcceptedBooking
                            ? isAr
                              ? 'محجوز'
                              : 'Booked'
                            : isPaymentDay
                              ? isAr
                                ? 'يوم الدفع'
                                : 'Payment day'
                              : isAr
                                ? 'فارغ'
                                : 'Free'
                          return (
                            <button
                              aria-label={dayLabel}
                              className={`${isAcceptedBooking ? 'booked' : ''} ${isPaymentDay ? 'payment' : ''}`.trim()}
                              disabled
                              key={day}
                              type="button"
                            >
                              <strong>{new Date(`${day}T00:00:00`).getDate()}</strong>
                              <span>{dayLabel}</span>
                            </button>
                          )
                        })}
                      </div>
                      <div className="seller-host-reservation-card compact">
                        <span>{isAr ? 'آخر حجز مقبول' : 'Accepted booking'}</span>
                        <strong>{bookedDate}</strong>
                        <div className="seller-host-price-breakdown">
                          <p>
                            <span>{isAr ? 'سعر الليلة' : 'Night'}</span>
                            <b>{`USD ${stayNightPrice}`}</b>
                          </p>
                          {stayCleaningFee > 0 && (
                            <p>
                              <span>{isAr ? 'تنظيف' : 'Cleaning'}</span>
                              <b>{`USD ${stayCleaningFee}`}</b>
                            </p>
                          )}
                          {stayTaxFee > 0 && (
                            <p>
                              <span>{isAr ? 'ضريبة' : 'Tax'}</span>
                              <b>{`USD ${stayTaxFee}`}</b>
                            </p>
                          )}
                          <em>{isAr ? `الإجمالي للضيف USD ${stayBookingTotal}` : `Guest total USD ${stayBookingTotal}`}</em>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              )}
              <div className="seller-wide-field seller-host-search-capsule seller-host-options-capsule">
                <div className="seller-host-search-head">
                  <div>
                    <strong>{isAr ? 'خيارات البحث التي تظهر للضيف' : 'Guest-visible search options'}</strong>
                    <span>
                      {isAr
                        ? 'اختر نفس الكبسولات التي يستخدمها الضيف في البحث حتى يعرف ما توفره الإقامة.'
                        : 'Pick the same capsules guests use in search so the listing clearly shows what this stay offers.'}
                    </span>
                  </div>
                </div>
                <VisualFilterPanel
                  compact
                  groups={sellerPropertyFilterGroups}
                  lang={lang}
                  selection={visualFilters}
                  onChange={setVisualFilters}
                />
              </div>
              <div className="seller-money-note">
                {isAr
                  ? division === 'STAYS'
                    ? 'الإقامات القصيرة تظهر للضيف بالدولار فقط.'
                    : 'السعر يظهر للزوار كما يكتبه البائع، مع إمكانية التفاوض عبر IMMOContact.'
                  : division === 'STAYS'
                    ? 'Short stays are shown to guests in USD only.'
                    : 'The price appears to visitors as entered, with negotiation through IMMOContact.'}
              </div>
            </div>
          )}

          {activeStep.id === 'plan' && !isAdvertisingFlow && (
            <div className="seller-wizard-section">
              <div className="seller-host-plan-grid">
                {HOST_LISTING_PLANS.map((plan) => (
                  <button
                    className={`seller-host-plan-card ${plan.id === selectedListingPlan.id ? 'active' : ''}`}
                    key={plan.id}
                    onClick={() => {
                      setListingPlan(plan.id)
                      setListingPlanPaymentConfirmed(false)
                      setUploadedAdFiles((current) =>
                        current.filter((id) => plan.mediaSlots.some((slot) => slot.id === id) || (plan.id !== 'basic' && id.startsWith(OFFER_PROOF_PREFIX))),
                      )
                    }}
                    type="button"
                  >
                    <span>{plan[lang === 'ar' ? 'ar' : 'en']}</span>
                    <strong>{`USD ${plan.priceUsd}`}</strong>
                    <ul>
                      {plan.services[lang === 'ar' ? 'ar' : 'en'].map((service) => (
                        <li key={service}>{service}</li>
                      ))}
                    </ul>
                    <b>{isAr ? `${plan.mediaSlots.length} خانات أساسية` : `${plan.mediaSlots.length} core upload slots`}</b>
                  </button>
                ))}
              </div>

              <div className="seller-host-plan-gate">
                <div className="seller-host-plan-gate-head">
                  <div>
                    <span>{isAr ? 'دفع خطة الإعلان' : 'Listing plan payment'}</span>
                    <strong>{`${selectedListingPlan[lang === 'ar' ? 'ar' : 'en']} · USD ${selectedListingPlan.priceUsd}`}</strong>
                  </div>
                  <em>{listingPlanPaymentConfirmed ? (isAr ? 'مدفوعة' : 'Paid') : isAr ? 'مطلوبة قبل الرفع' : 'Required before upload'}</em>
                </div>
                <div className="seller-host-plan-methods">
                  {[
                    { id: 'shamCash', ar: 'Sham Cash', en: 'Sham Cash' },
                    { id: 'card', ar: 'بطاقة / Mastercard', en: 'Card / Mastercard' },
                  ].map((method) => (
                    <button
                      className={listingPlanPaymentMethod === method.id ? 'active' : ''}
                      key={method.id}
                      onClick={() => {
                        setListingPlanPaymentMethod(method.id)
                        setListingPlanPaymentConfirmed(false)
                      }}
                      type="button"
                    >
                      {method[lang === 'ar' ? 'ar' : 'en']}
                    </button>
                  ))}
                </div>
                <div className="seller-host-plan-payment-details">
                  {listingPlanPaymentMethod === 'shamCash' ? (
                    <>
                      <span>{isAr ? 'تفاصيل Sham Cash' : 'Sham Cash details'}</span>
                      <strong>{isAr ? 'حوّل مبلغ الخطة إلى حساب SYBNB ثم احفظ رقم العملية.' : 'Send the plan amount to the SYBNB Sham Cash account, then save the transaction number.'}</strong>
                      <div>
                        <b>{isAr ? 'المستلم' : 'Receiver'}</b>
                        <p>SYBNB Platform</p>
                      </div>
                      <div>
                        <b>{isAr ? 'المبلغ' : 'Amount'}</b>
                        <p>{`USD ${selectedListingPlan.priceUsd}`}</p>
                      </div>
                      <div className="seller-sham-qr-panel">
                        {listingPlanQrDataUrl ? (
                          <img className="seller-sham-qr" src={listingPlanQrDataUrl} alt={isAr ? 'رمز QR شام كاش' : 'Sham Cash QR'} />
                        ) : (
                          <div className="seller-sham-qr seller-sham-qr-loading" aria-label={isAr ? 'جارٍ إنشاء رمز QR' : 'Generating QR code'} />
                        )}
                        <div>
                          <strong>{isAr ? 'امسح QR أو ادفع بالكود' : 'Scan QR or pay by code'}</strong>
                          <span dir="ltr">SYBNB-SHAM-LISTING</span>
                          <small>{isAr ? 'اكتب هذا الكود في ملاحظة الدفع:' : 'Write this code in the payment note:'} <b dir="ltr">{listingPlanFollowCode}</b></small>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <span>{isAr ? 'تفاصيل البطاقة' : 'Card details'}</span>
                      <strong>{isAr ? 'ادفع الخطة ببطاقة Mastercard أو Visa عبر Stripe التجريبي.' : 'Pay the plan by Mastercard or Visa through Stripe test payment.'}</strong>
                      <div>
                        <b>{isAr ? 'نوع الدفع' : 'Payment type'}</b>
                        <p>Mastercard / Visa</p>
                      </div>
                      <div>
                        <b>{isAr ? 'المبلغ' : 'Amount'}</b>
                        <p>{`USD ${selectedListingPlan.priceUsd}`}</p>
                      </div>
                      <div className="seller-card-payment-form">
                        <label>
                          <small>{isAr ? 'اسم حامل البطاقة' : 'Cardholder name'}</small>
                          <input value={listingCardHolder} onChange={(event) => setListingCardHolder(event.target.value)} placeholder={isAr ? 'الاسم كما هو على البطاقة' : 'Name on card'} />
                        </label>
                        <label>
                          <small>{isAr ? 'رقم البطاقة' : 'Card number'}</small>
                          <input dir="ltr" inputMode="numeric" maxLength={19} value={listingCardNumber} onChange={(event) => setListingCardNumber(event.target.value)} placeholder="4242 4242 4242 4242" />
                        </label>
                        <div className="seller-card-row">
                          <label>
                            <small>{isAr ? 'تاريخ الانتهاء' : 'Expiry date'}</small>
                            <input dir="ltr" inputMode="numeric" maxLength={5} value={listingCardExpiry} onChange={(event) => setListingCardExpiry(event.target.value)} placeholder="MM/YY" />
                          </label>
                          <label>
                            <small>{isAr ? 'CVV' : 'CVV'}</small>
                            <input dir="ltr" inputMode="numeric" maxLength={4} value={listingCardCvv} onChange={(event) => setListingCardCvv(event.target.value)} placeholder="123" />
                          </label>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className={`seller-host-plan-status ${listingPlanPaymentConfirmed ? 'confirmed' : ''}`}>
                  <span>
                    {listingPlanPaymentConfirmed
                      ? isAr
                        ? 'تم دفع الخطة، يمكنك رفع الملفات الآن.'
                        : 'Plan paid. You can upload files now.'
                      : isAr
                        ? 'بعد تأكيد دفع الخطة ستظهر لك خانات الرفع المسموحة.'
                        : 'After plan payment is confirmed, the allowed upload slots will open.'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setListingPlanPaymentConfirmed(true)
                      setSubmitState('idle')
                      setSubmitError('')
                    }}
                  >
                    {isAr ? 'تأكيد دفع الخطة' : 'Confirm plan payment'}
                  </button>
                </div>
              </div>
              {submitState === 'error' && (
                <div className="seller-inline-alert">
                  <strong>{isAr ? 'الخطة مطلوبة' : 'Plan required'}</strong>
                  <span>{submitError}</span>
                </div>
              )}
            </div>
          )}

          {activeStep.id === 'media' && (
            <div className="seller-wizard-section">
              {isMultiRoomFlow && (
                // C2: real property photos for the STAYS room-type Listing — rendered independently of
                // the plan-payment lock below, so photos are never behind a payment gate (removing the
                // gate itself is roadmap C6).
                <ListingPhotoUploader
                  lang={lang}
                  photos={photoDrafts}
                  onChange={setPhotoDrafts}
                  busy={submitState === 'submitting'}
                />
              )}
              {!isAdvertisingFlow && !listingPlanPaymentConfirmed ? (
                <div className="seller-host-plan-lock">
                  <span>{isAr ? 'الرفع مقفل' : 'Uploads locked'}</span>
                  <strong>{isAr ? 'ادفع خطة الإعلان أولاً' : 'Pay the listing plan first'}</strong>
                  <p>
                    {isAr
                      ? 'كل خطة تفتح عدد ملفات وخدمات مختلف. ارجع إلى خطوة الخطة والدفع لتأكيد الدفع.'
                      : 'Each plan unlocks different upload slots and services. Return to the plan and payment step to confirm payment.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const planIndex = steps.findIndex((item) => item.id === 'plan')
                      setStepIndex(planIndex >= 0 ? planIndex : stepIndex)
                    }}
                  >
                    {isAr ? 'العودة إلى الخطة' : 'Back to plan'}
                  </button>
                </div>
              ) : (
                <>
                  {!isAdvertisingFlow && (
                    <div className="seller-offer-proof-panel">
                      <strong>{isAr ? 'إثبات عروض الضيف' : 'Guest offer proof'}</strong>
                      <span>
                        {planAllowsOfferProofs
                          ? isAr
                            ? 'أي خيار يظهر للضيف يحتاج صورة واضحة باسمه. إذا لم ترفع الإثبات لن يمر الإعلان كعرض حقيقي.'
                            : 'Every guest-visible offer needs a clear photo under its own name. Without proof, the offer cannot publish as real.'
                          : isAr
                            ? 'خطة Basic لا تنشر كبسولات عروض إضافية. اختر Plus أو Premium لتوثيق العروض مثل الموقف أو الفطور.'
                            : 'Basic does not publish extra offer capsules. Choose Plus or Premium to prove offers like parking or breakfast.'}
                      </span>
                      {activeOfferProofSlots.length > 0 && (
                        <em>
                          {isAr
                            ? `مطلوب الآن: ${activeOfferProofSlots.map((slot) => slot.ar).join('، ')}`
                            : `Required now: ${activeOfferProofSlots.map((slot) => slot.en).join(', ')}`}
                        </em>
                      )}
                    </div>
                  )}
                  <div className="seller-upload-grid">
                    {allowedMediaSlots.map((item) => (
                    <button
                      className={`${uploadedAdFiles.includes(item.id) ? 'uploaded' : ''} ${item.offerProof ? 'offer-proof' : ''} ${item.required ? 'required' : ''}`}
                      key={item.id}
                      onClick={() => {
                        setUploadedAdFiles((current) => (current.includes(item.id) ? current : [...current, item.id]))
                        setAdFilesSent(false)
                      }}
                    >
                      <strong>{item[lang === 'ar' ? 'ar' : 'en']}</strong>
                      <span>
                        {uploadedAdFiles.includes(item.id)
                          ? isAr
                            ? 'تمت الإضافة'
                            : 'Added'
                          : isAr
                            ? 'إضافة / رفع'
                            : 'Add / upload'}
                      </span>
                    </button>
                    ))}
                  </div>
                  {!isAdvertisingFlow && missingRequiredOfferProofSlots.length > 0 && (
                    <div className="seller-inline-alert">
                      <strong>{isAr ? 'إثبات العروض مطلوب' : 'Offer proof required'}</strong>
                      <span>
                        {isAr
                          ? `ارفع صورة واضحة لكل خيار مختار: ${missingRequiredOfferProofSlots.map((slot) => slot.ar).join('، ')}`
                          : `Upload a clear photo for each selected option: ${missingRequiredOfferProofSlots.map((slot) => slot.en).join(', ')}`}
                      </span>
                    </div>
                  )}
                </>
              )}
              {isAdvertisingFlow && (
                <div className={`seller-ad-send-panel ${adFilesSent ? 'sent' : ''}`}>
                  <strong>{adPlan === 'premium' ? (isAr ? 'خطة Premium' : 'Premium plan') : isAr ? 'خطة Plus' : 'Plus plan'}</strong>
                  <span>
                    {isAr
                      ? `تمت إضافة ${uploadedAdFiles.length} من ${adFileSlots.length} ملفات مطلوبة ورفع ${uploadedDocumentFiles.length} مستند.`
                      : `${uploadedAdFiles.length} of ${adFileSlots.length} required files added and ${uploadedDocumentFiles.length} document uploaded.`}
                  </span>
                  <button
                    disabled={uploadedAdFiles.length < adFileSlots.length || uploadedDocumentFiles.length < 1}
                    onClick={() => setAdFilesSent(true)}
                  >
                    {adFilesSent ? (isAr ? 'تم إرسال الملفات للإدارة' : 'Files sent to admin') : isAr ? 'إرسال الملفات للإدارة' : 'Send files to admin'}
                  </button>
                </div>
              )}
              <PaymentProofUpload
                cta={isAdvertisingFlow ? (isAr ? 'رفع مستندات الإعلان' : 'Upload ad documents') : isAr ? 'رفع مستندات البائع' : 'Upload seller documents'}
                emptyText={isAr ? 'لم يتم رفع مستندات بعد. ارفع PDF أو PNG أو JPG.' : 'No documents uploaded yet. Upload PDF, PNG, or JPG.'}
                files={uploadedDocumentFiles}
                help={
                  isAdvertisingFlow
                    ? isAr
                      ? 'ارفع إثبات الدفع، ملفات الحملة، التفويض، أو صور النشاط حسب الخطة.'
                      : 'Upload payment proof, campaign files, authorization, or business photos based on the plan.'
                    : isAr
                      ? 'ارفع إثبات الملكية، التفويض، المخططات، صور العقار، أو ملفات السيارة/المشروع.'
                      : 'Upload ownership proof, authorization, plans, property photos, or car/project files.'
                }
                lang={lang}
                onAddFiles={addListingDocumentFiles}
                title={isAdvertisingFlow ? (isAr ? 'مستندات الإعلان والخطة' : 'Ad and plan documents') : isAr ? 'مستندات البائع' : 'Seller documents'}
              />
              <p className="seller-note-line">
                {isAdvertisingFlow
                  ? isAr
                    ? 'لن يظهر الإعلان للزوار قبل موافقة الإدارة. بعد القبول تتحول الحالة إلى منشور.'
                    : 'The ad will not appear to visitors before admin approval. After acceptance, status becomes published.'
                  : isAr
                    ? 'الملفات الثقيلة تُراجع من الإدارة ولا تظهر للزوار إلا إذا كانت ضمن خطة تسمح بذلك.'
                    : 'Heavy files are reviewed by admin and only shown to visitors when the plan allows it.'}
              </p>
            </div>
          )}

          {activeStep.id === 'review' && (
            <div className="seller-wizard-section">
              <div className="seller-review-card" style={{ '--accent': '#d5a915' } as CSSVars}>
                <p>{isAr ? 'جاهز للإرسال' : 'Ready to submit'}</p>
                <h2>{isAdvertisingFlow ? (isAr ? 'سيتم إرسال الإعلان للإدارة' : 'Ad will be sent to admin') : isAr ? 'سيتم إرسال الإعلان للمراجعة' : 'Listing will be sent for review'}</h2>
                <ul>
                  <li>{isAr ? 'قرار الإدارة: قبول / طلب معلومات / رفض' : 'Admin decision: approve / need info / reject'}</li>
                  <li>{isAr ? 'المقبول يصبح منشوراً' : 'Approved becomes published'}</li>
                  <li>
                    {isAdvertisingFlow
                      ? isAr
                        ? 'تم تجهيز طلب الإعلان من مسار الدفع والإرسال.'
                        : 'The advertising request was prepared through the payment and submission flow.'
                      : uploadedDocumentFiles.length
                        ? isAr
                          ? 'تم رفع مستندات البائع المطلوبة قبل الإرسال.'
                          : 'Required seller documents were uploaded before submission.'
                        : isAr
                          ? 'لا يمكن الإرسال قبل رفع مستندات البائع.'
                          : 'Submission is blocked until seller documents are uploaded.'}
                  </li>
                  <li>
                    {isAdvertisingFlow
                      ? adFilesSent
                        ? isAr
                          ? 'تم إرسال الصور والمستندات للإدارة'
                          : 'Photos and documents were sent to admin'
                        : isAr
                          ? 'أرسل الصور والمستندات قبل الإرسال النهائي'
                          : 'Send photos and documents before final submission'
                      : uploadedDocumentFiles.length
                        ? isAr
                          ? `تم رفع ${uploadedDocumentFiles.length} مستند للبائع`
                          : `${uploadedDocumentFiles.length} seller document uploaded`
                        : isAr
                          ? 'ارفع مستندات البائع قبل الإرسال النهائي'
                          : 'Upload seller documents before final submission'}
                  </li>
                  {!isAdvertisingFlow && <li>{selectedFilterLabels(sellerPropertyFilterGroups, visualFilters, lang).join(' · ')}</li>}
                  {!isAdvertisingFlow && activeOfferProofSlots.length > 0 && (
                    <li>
                      {missingRequiredOfferProofSlots.length
                        ? isAr
                          ? `إثباتات عروض ناقصة: ${missingRequiredOfferProofSlots.map((slot) => slot.ar).join('، ')}`
                          : `Missing offer proofs: ${missingRequiredOfferProofSlots.map((slot) => slot.en).join(', ')}`
                        : isAr
                          ? 'كل عروض الضيف المختارة لها إثباتات مرفوعة'
                          : 'All selected guest offers have uploaded proof'}
                    </li>
                  )}
                </ul>
              </div>
              {submitState === 'error' && (
                <div className="seller-inline-alert">
                  <strong>{isAr ? 'تعذر الإرسال' : 'Submission failed'}</strong>
                  <span>{submitError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="seller-wizard-actions">
          <button className="seller-secondary-button" onClick={back}>
            {isAr ? 'رجوع' : 'Back'}
          </button>
          <button className="seller-primary-button" disabled={submitState === 'submitting'} onClick={next}>
            {submitState === 'submitting'
              ? isAr
                ? 'جار الإرسال'
                : 'Submitting'
              : isLast
                ? isMultiRoomFlow
                  ? isAr
                    ? 'حفظ هذه الغرفة'
                    : 'Save this room type'
                  : isAr
                    ? 'إرسال للمراجعة'
                    : 'Submit for review'
                : isAr
                  ? 'متابعة'
                  : 'Continue'}
          </button>
        </div>
      </section>
    </main>
  )
}

function TouchChoiceGroup({
  active,
  items,
  onChange,
  title,
}: {
  active: string
  items: string[]
  onChange: (value: string) => void
  title: string
}) {
  return (
    <section className="seller-touch-choice-group">
      <span>{title}</span>
      <div className="seller-touch-choice-row">
        {items.map((item) => (
          <button
            className={item === active ? 'active' : ''}
            key={item}
            onClick={() => onChange(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>
    </section>
  )
}

function toNumber(value: string) {
  return Number(String(value).replace(/[^\d.]/g, '')) || 0
}

// Real city-center coordinates for each Syrian governorate capital, used only to recenter the
// map when the host switches governorate/city -- the host then drags/clicks the exact spot.
const GOVERNORATE_CENTERS: Record<string, [number, number]> = {
  damascus: [33.5138, 36.2765],
  'rif-dimashq': [33.5731, 36.4028],
  aleppo: [36.2021, 37.1343],
  homs: [34.7324, 36.7137],
  hama: [35.1318, 36.75],
  latakia: [35.5317, 35.7915],
  tartus: [34.8886, 35.8866],
  idlib: [35.9306, 36.6339],
  daraa: [32.6189, 36.1021],
  sweida: [32.7094, 36.5661],
  'deir-ezzor': [35.3359, 40.1408],
  raqqa: [35.95, 39.01],
  hasakah: [36.502, 40.746],
  quneitra: [33.1257, 35.8245],
}

// Real city-center coordinates for Quebec's cities -- only one province is supported today, so
// this recenters by city (rather than province, as Syria's map above does).
const CANADA_CITY_CENTERS: Record<string, [number, number]> = {
  montreal: [45.5017, -73.5673],
  'quebec-city': [46.8139, -71.208],
  gatineau: [45.4765, -75.7013],
  laval: [45.6066, -73.7124],
  longueuil: [45.5312, -73.5185],
  sherbrooke: [45.4042, -71.8929],
  'trois-rivieres': [46.3432, -72.5432],
  saguenay: [48.4283, -71.0678],
}

function toMinor(value: string) {
  return Math.max(0, Math.round(toNumber(value)))
}
