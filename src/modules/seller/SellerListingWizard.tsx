import { useEffect, useMemo, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../../shared/brand'
import {
  addAccommodationRoomType,
  createAccommodation,
  createAndSubmitCarListing,
  createAndSubmitPrototypeListing,
  geocodePlace,
  submitAccommodation,
  type CarVehicleAttributes,
} from '../../shared/api/platformApi'
import type { CSSVars } from '../../shared/theme/cssVars'
import { sellerCarFilterGroups, sellerPropertyFilterGroups, type VisualFilterSelection } from '../../engines/filters'
import { getCity, getGovernorate, labelFor, SYRIA_GOVERNORATES } from '../../engines/search'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { PaymentProofUpload } from '../payments/PaymentProofUpload'

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
  governorate: string
  city: string
  area: string
  address: string
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
  title: Record<Lang, string>
  helper: Record<Lang, string>
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
  services: Record<Lang, string[]>
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
  {
    // Hotel plan (STR): for multi-room properties. The room-type engine already lets a hotel add
    // many room types / bed types under one accommodation (addAccommodationRoomType); this plan is
    // the tier meant for it, with the richest photo slots. Self-attested payment like the other host
    // plans — no server price table involved (see the accommodation flow, not seller-plan-proof).
    id: 'hotel',
    ar: 'Hotel',
    en: 'Hotel',
    priceUsd: 100,
    services: {
      ar: [
        'كل مزايا Premium',
        'عدة أنواع غرف وأسِرّة في إعلان واحد',
        'حتى 30 صورة عبر خانات متعددة',
        'أولوية قصوى في المراجعة',
        'دعم تجهيز الفندق قبل النشر',
      ],
      en: [
        'Everything in Premium',
        'Multiple room types & bed types in one ad',
        'Up to 30 photos across multiple slots',
        'Top-priority admin review',
        'Hotel setup support before publishing',
      ],
    },
    mediaSlots: [
      { id: 'propertyPhotos', ar: 'صور المبنى والواجهة', en: 'Building & exterior photos' },
      { id: 'lobbyPhotos', ar: 'صور اللوبي والمرافق', en: 'Lobby & common areas' },
      { id: 'roomPhotos', ar: 'صور أنواع الغرف', en: 'Room-type photos' },
      { id: 'amenitiesPhotos', ar: 'صور الخدمات', en: 'Amenities photos' },
      { id: 'ownershipProof', ar: 'إثبات الملكية', en: 'Ownership proof' },
      { id: 'authorization', ar: 'أضف التفويض', en: 'Add authorization' },
      { id: 'deed', ar: 'مخطط أو سند', en: 'Plan or deed' },
      { id: 'extraGallery', ar: 'معرض صور إضافي', en: 'Extra gallery' },
      { id: 'inspectionFiles', ar: 'رخص وملفات الفندق', en: 'Hotel licenses & files' },
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
  const [division, setDivision] = useState<ListingDivision>(draft.division || 'STAYS')
  const [listingPlan, setListingPlan] = useState(draft.listingPlan || 'plus')
  const [listingPlanPaymentMethod, setListingPlanPaymentMethod] = useState(draft.listingPlanPaymentMethod || 'shamCash')
  const [listingPlanPaymentConfirmed, setListingPlanPaymentConfirmed] = useState(draft.listingPlanPaymentConfirmed ?? false)
  const [selectedType, setSelectedType] = useState(draft.selectedType || PROPERTY_TYPES[0].en)
  const [title, setTitle] = useState(draft.title ?? '')
  const [description, setDescription] = useState(draft.description ?? '')
  const [governorate, setGovernorate] = useState(draft.governorate || 'damascus')
  const [city, setCity] = useState(draft.city || 'damascus-city')
  const [area, setArea] = useState(draft.area || 'old-city')
  const [areaQuery, setAreaQuery] = useState('')
  const [address, setAddress] = useState(draft.address ?? (isAr ? 'قرب شارع رئيسي' : 'Near a main street'))
  const [latitude, setLatitude] = useState(draft.latitude || '33.5138')
  const [longitude, setLongitude] = useState(draft.longitude || '36.2765')
  const [mapPinConfirmed, setMapPinConfirmed] = useState(draft.mapPinConfirmed ?? false)
  // CARS location fix (025/Carcad Phase D): the pin UI below is otherwise decorative -- this
  // tracks whether a real device/manual coordinate has actually been captured for CARS.
  const [geoStatus, setGeoStatus] = useState<'idle' | 'locating' | 'done' | 'denied' | 'error'>('idle')
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
  // Real CARS vehicle attributes -- server/lib/listing-attributes.mjs's carRules() requires all
  // seven of these before /submit will accept a car listing. Kept separate from `visualFilters`
  // (the buyer-facing browse chips), which use a coarser vocabulary that can't serve as the
  // authoritative source for these (see prefill-only wiring below).
  const [carMake, setCarMake] = useState('')
  const [carModel, setCarModel] = useState('')
  const [carYear, setCarYear] = useState('')
  const [carMileageKm, setCarMileageKm] = useState('')
  const [carTransmission, setCarTransmission] = useState('automatic')
  const [carFuelType, setCarFuelType] = useState('gas')
  const [carCondition, setCarCondition] = useState('USED')
  // Real photo File objects for CARS -- the wizard previously only tracked filenames (never
  // uploaded bytes), which is why PHOTO_REQUIRED_DIVISIONS always rejected CARS submissions.
  const [carPhotoFiles, setCarPhotoFiles] = useState<File[]>([])
  // Online auctions (026): per-listing choice, fixed price OR auction. Config fields only matter
  // when saleType === 'AUCTION'; createAndSubmitCarListing() only calls the auction-config endpoint
  // when this is set, so a FIXED listing behaves exactly as before.
  const [carSaleType, setCarSaleType] = useState<'FIXED' | 'AUCTION'>('FIXED')
  const [carReservePriceMinor, setCarReservePriceMinor] = useState('')
  const [carMinIncrementMinor, setCarMinIncrementMinor] = useState('500000')
  const [carAuctionDurationHours, setCarAuctionDurationHours] = useState('72')
  const [visualFilters, setVisualFilters] = useState<VisualFilterSelection>(
    draft.visualFilters || {
      propertyType: 'apartment',
      roomType: 'doubleRoom',
      bedType: ['queenBed'],
      amenities: ['wifi', 'kitchen'],
    },
  )
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [submitError, setSubmitError] = useState('')
  // Set once the accommodation shell + first STAYS room type are created; every following room
  // type in the same session reuses it instead of re-collecting location/documents/photos.
  const [accommodationId, setAccommodationId] = useState<string | null>(null)
  const [roomTypeStage, setRoomTypeStage] = useState<'idle' | 'prompt'>('idle')
  // Dealer bulk-add (025/Carcad Phase C): simpler than the STAYS room-type loop above -- each car
  // is fully independent, no shared parent entity like Accommodation, so "add another" just resets
  // the car-specific fields and loops back to step 0.
  const [carBulkStage, setCarBulkStage] = useState<'idle' | 'prompt'>('idle')
  const isMultiRoomFlow = division === 'STAYS' && !isAdvertisingFlow

  // One-way prefill only, never overwrite: the carBrand chip's ~30-item closed vocabulary and
  // the condition chip's new/used-only options are coarser than the real make/condition fields,
  // so a chip pick only fills the structured field while it's still empty/default, and the user
  // can always override it with the real input/select.
  useEffect(() => {
    const brand = visualFilters.carBrand
    if (division === 'CARS' && typeof brand === 'string' && brand && !carMake) {
      setCarMake(brand.charAt(0).toUpperCase() + brand.slice(1))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualFilters.carBrand, division])

  useEffect(() => {
    const condition = visualFilters.condition
    if (division === 'CARS' && condition === 'new') setCarCondition((current) => (current === 'USED' ? 'NEW' : current))
    if (division === 'CARS' && condition === 'used') setCarCondition((current) => (current === 'NEW' ? 'USED' : current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visualFilters.condition, division])

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
      governorate,
      city,
      area,
      address,
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
  }, [division, listingPlan, listingPlanPaymentMethod, listingPlanPaymentConfirmed, selectedType, title, description, governorate, city, area, address, latitude, longitude, mapPinConfirmed, price, cleaningFee, taxFee, size, guestCapacity, bedrooms, bathrooms, instantBookEnabled, searchCapsuleEnabled, availabilityDates, variableNightPrice, availableStart, availableEnd, bookedDate, paymentDay, visualFilters])
  const steps = isAdvertisingFlow ? AD_STEPS : accommodationId ? ROOM_TYPE_STEPS : STEPS
  const activeStep = steps[stepIndex]
  const progress = useMemo(() => `${Math.round(((stepIndex + 1) / steps.length) * 100)}%`, [stepIndex, steps.length])
  const isLast = stepIndex === steps.length - 1
  const selectedGovernorateData = getGovernorate(governorate)
  const selectedCityData = getCity(governorate, city)
  const selectedAreaData = selectedCityData?.areas.find((item) => item.key === area)
  const selectedGovernorateLabel = labelFor(lang, selectedGovernorateData)
  const selectedCityLabel = labelFor(lang, selectedCityData)
  const selectedAreaLabel = labelFor(lang, selectedAreaData)
  const areaOptions = selectedCityData?.areas || []

  // Stays/hotels: auto-geocode the picked area (free OSM proxy — same one the search map uses) so
  // the listing carries REAL coordinates. Without this a stay would keep the Damascus default and
  // never get a precise search-map pin or a working "Get directions" button. Arabic names geocode
  // Syrian streets far better than English; a leading "شارع " is stripped as it blocks matches.
  // Any new area selection un-confirms the pin so the host reconfirms the moved location.
  useEffect(() => {
    if (isAdvertisingFlow || division !== 'STAYS') return
    const areaName = selectedAreaData?.ar.replace(/^شارع\s+/, '')
    const parts = [areaName, selectedCityData?.ar, selectedGovernorateData?.ar, 'سوريا'].filter((p): p is string => Boolean(p))
    const query = parts.filter((p, i) => p !== parts[i - 1]).join(', ')
    if (!query) return
    let cancelled = false
    void geocodePlace(query).then((result) => {
      if (cancelled || !result) return
      setLatitude(String(result.lat))
      setLongitude(String(result.lng))
      setMapPinConfirmed(false)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [division, isAdvertisingFlow, governorate, city, area])
  const normalizedAreaQuery = areaQuery.trim().toLowerCase()
  const filteredAreaOptions = (normalizedAreaQuery
    ? areaOptions.filter((item) =>
        [item.ar, item.en, item.key]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(normalizedAreaQuery),
      )
    : areaOptions.slice(0, 10)
  ).slice(0, 16)
  const listingCurrency = division === 'STAYS' ? 'USD' : 'SYP'
  const selectedListingPlan = HOST_LISTING_PLANS.find((plan) => plan.id === listingPlan) || HOST_LISTING_PLANS[1]
  const selectedOfferProofSlots = useMemo(() => selectedOfferProofMediaSlots(visualFilters), [visualFilters])
  const planAllowsOfferProofs = selectedListingPlan.id !== 'basic'
  const activeOfferProofSlots = !isAdvertisingFlow && division === 'STAYS' && planAllowsOfferProofs ? selectedOfferProofSlots : []
  const allowedMediaSlots = isAdvertisingFlow ? adFileSlots : [...selectedListingPlan.mediaSlots, ...activeOfferProofSlots]
  const missingRequiredOfferProofSlots = activeOfferProofSlots.filter((slot) => !uploadedAdFiles.includes(slot.id))
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
  // A host can only open availability on today or future days — never the past.
  const wizardTodayIso = addDaysIso(0)
  const availMonthAtOrBeforeThisMonth =
    availabilityMonth.getFullYear() < new Date().getFullYear() ||
    (availabilityMonth.getFullYear() === new Date().getFullYear() && availabilityMonth.getMonth() <= new Date().getMonth())
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
    if (day < wizardTodayIso) return // can't open a day that has already passed
    updateAvailabilityDates(selectedAvailabilityDays.has(day) ? availabilityDates.filter((item) => item !== day) : [...availabilityDates, day])
  }

  function chooseGovernorate(value: string) {
    const nextGovernorate = getGovernorate(value)
    const nextCity = nextGovernorate?.cities[0]
    setGovernorate(value)
    setCity(nextCity?.key || '')
    setArea(nextCity?.areas[0]?.key || '')
    setAreaQuery('')
    setMapPinConfirmed(false)
  }

  function chooseCity(value: string) {
    const nextCity = getCity(governorate, value)
    setCity(value)
    setArea(nextCity?.areas[0]?.key || '')
    setAreaQuery('')
    setMapPinConfirmed(false)
  }

  const next = async () => {
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
    // CARS-specific gates -- mirror server/lib/listing-attributes.mjs's carRules() exactly so a
    // seller never reaches submit only to be rejected server-side.
    if (!isAdvertisingFlow && division === 'CARS' && activeStep.id === 'basics') {
      const yearNumber = toNumber(carYear)
      const mileageNumber = toNumber(carMileageKm)
      const currentYearLimit = new Date().getFullYear() + 1
      if (!carMake.trim() || !carModel.trim()) {
        setSubmitState('error')
        setSubmitError(isAr ? 'أدخل الماركة والموديل.' : 'Enter the make and model.')
        return
      }
      if (!Number.isFinite(yearNumber) || yearNumber < 1900 || yearNumber > currentYearLimit) {
        setSubmitState('error')
        setSubmitError(isAr ? `أدخل سنة صنع صحيحة (1900-${currentYearLimit}).` : `Enter a valid year (1900-${currentYearLimit}).`)
        return
      }
      if (!Number.isFinite(mileageNumber) || mileageNumber < 0 || mileageNumber > 2_000_000) {
        setSubmitState('error')
        setSubmitError(isAr ? 'أدخل ممشى صحيح (0-2,000,000 كم).' : 'Enter a valid mileage (0-2,000,000 km).')
        return
      }
      // Online auctions (026): client-side mirror of the AUCTION_DURATION_INVALID/AUCTION_INCREMENT_INVALID
      // server checks in server/routes/auctions.mjs, so a dealer never reaches submit only to be rejected.
      if (carSaleType === 'AUCTION') {
        const incrementNumber = toNumber(carMinIncrementMinor)
        const durationNumber = toNumber(carAuctionDurationHours)
        if (!Number.isFinite(incrementNumber) || incrementNumber <= 0) {
          setSubmitState('error')
          setSubmitError(isAr ? 'أدخل أقل زيادة عرض صحيحة.' : 'Enter a valid minimum bid increment.')
          return
        }
        if (!Number.isFinite(durationNumber) || durationNumber < 1 || durationNumber > 720) {
          setSubmitState('error')
          setSubmitError(isAr ? 'مدة المزاد يجب أن تكون بين ساعة و720 ساعة.' : 'Auction duration must be between 1 and 720 hours.')
          return
        }
      }
    }
    // Real location capture (025/Carcad Phase D): previously nothing blocked advancing past this
    // step for CARS, so the map pin was decorative and every car ended up with the same fake
    // default coordinate. Mirrors the mapLocation rule added to carRules() server-side.
    // Real location capture is now required for stays/hotels too — a listing without a confirmed
    // pin has no coordinates, so it never gets a search-map pin or the Get-directions button.
    if (!isAdvertisingFlow && (division === 'CARS' || division === 'STAYS') && activeStep.id === 'location') {
      if (!mapPinConfirmed || !isValidSyriaCoord(latitude, longitude)) {
        setSubmitState('error')
        setSubmitError(
          isAr
            ? division === 'CARS'
              ? 'أكّد موقع السيارة على الخريطة قبل المتابعة.'
              : 'أكّد موقع العقار على الخريطة قبل المتابعة.'
            : division === 'CARS'
              ? "Confirm the car's location on the map before continuing."
              : 'Confirm the property location on the map before continuing.',
        )
        return
      }
    }
    if (!isAdvertisingFlow && division === 'CARS' && activeStep.id === 'media' && !carPhotoFiles.length) {
      setSubmitState('error')
      setSubmitError(isAr ? 'ارفع صورة واحدة حقيقية على الأقل للسيارة.' : 'Upload at least one real photo of the car.')
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
        visualFilters,
        availabilityCalendar,
        mapLocation,
      }

      try {
        if (isMultiRoomFlow) {
          if (!accommodationId) {
            const accommodation = await createAccommodation({
              titleAr: title || (isAr ? 'عقار SYBNB جديد' : 'New SYBNB property'),
              titleEn: title,
              description,
              governorate,
              city,
              area,
              address,
              metadata: {
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
              },
            })
            await addAccommodationRoomType(accommodation.id, {
              titleAr: title || (isAr ? 'نوع غرفة جديد' : 'New room type'),
              titleEn: title,
              description,
              priceMinor: toMinor(price),
              currency: 'USD',
              instantBookEnabled,
              metadata: roomTypeMetadata,
            })
            setAccommodationId(accommodation.id)
          } else {
            await addAccommodationRoomType(accommodationId, {
              titleAr: title || (isAr ? 'نوع غرفة جديد' : 'New room type'),
              titleEn: title,
              description,
              priceMinor: toMinor(price),
              currency: 'USD',
              instantBookEnabled,
              metadata: roomTypeMetadata,
            })
          }
          setSubmitState('idle')
          setRoomTypeStage('prompt')
          return
        }

        if (division === 'CARS') {
          const vehicle: CarVehicleAttributes = {
            make: carMake.trim(),
            model: carModel.trim(),
            year: toNumber(carYear),
            mileageKm: toNumber(carMileageKm),
            transmission: carTransmission,
            fuelType: carFuelType,
            condition: carCondition as CarVehicleAttributes['condition'],
          }
          await createAndSubmitCarListing({
            titleAr: title || 'إعلان SYBNB جديد',
            titleEn: title,
            description,
            priceMinor: toMinor(price),
            currency: listingCurrency,
            vehicle,
            photos: carPhotoFiles,
            auction: carSaleType === 'AUCTION'
              ? {
                  reservePriceMinor: carReservePriceMinor.trim() ? toNumber(carReservePriceMinor) : undefined,
                  minIncrementMinor: toNumber(carMinIncrementMinor),
                  durationHours: toNumber(carAuctionDurationHours),
                }
              : undefined,
            metadata: {
              governorate,
              city,
              area,
              address,
              governorateLabel: selectedGovernorateLabel,
              cityLabel: selectedCityLabel,
              areaLabel: selectedAreaLabel,
              listingPlan: selectedListingPlan.id,
              listingPlanPriceUsd: selectedListingPlan.priceUsd,
              listingPlanPaymentMethod,
              listingPlanPaymentConfirmed,
              uploadedDocumentFiles,
              visualFilters,
              mapLocation,
            },
          })
          setSubmitState('idle')
          setCarBulkStage('prompt')
          return
        }

        await createAndSubmitPrototypeListing({
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
            visualFilters,
            availabilityCalendar,
            mapLocation,
          },
        })
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
    setVisualFilters({ propertyType: 'apartment', roomType: 'doubleRoom', bedType: ['queenBed'], amenities: ['wifi', 'kitchen'] })
    setRoomTypeStage('idle')
    setStepIndex(0)
  }

  async function finishAccommodation() {
    if (!accommodationId) return
    setSubmitState('submitting')
    setSubmitError('')
    try {
      await submitAccommodation(accommodationId)
      clearDraft()
      navigate('/sell/submitted')
    } catch (error) {
      setSubmitState('error')
      setSubmitError(error instanceof Error ? error.message : 'Unable to submit accommodation.')
    }
  }

  function startAnotherCar() {
    setTitle('')
    setDescription('')
    setPrice('15')
    setCarMake('')
    setCarModel('')
    setCarYear('')
    setCarMileageKm('')
    setCarTransmission('automatic')
    setCarFuelType('gas')
    setCarCondition('USED')
    setCarPhotoFiles([])
    setVisualFilters({})
    setMapPinConfirmed(false)
    setGeoStatus('idle')
    setCarSaleType('FIXED')
    setCarReservePriceMinor('')
    setCarMinIncrementMinor('500000')
    setCarAuctionDurationHours('72')
    setCarBulkStage('idle')
    setStepIndex(0)
  }

  function finishCarBulkAdd() {
    clearDraft()
    navigate('/sell/submitted')
  }

  // Real location capture for CARS (025/Carcad Phase D). Previously "Confirm map pin" just set
  // mapPinConfirmed=true unconditionally over whatever was in the (defaulted-to-Damascus) lat/lng
  // inputs -- this actually validates the coordinate before accepting it.
  function confirmMapPin() {
    if (!isValidSyriaCoord(latitude, longitude)) {
      setSubmitState('error')
      setSubmitError(isAr ? 'أدخل إحداثيات صحيحة داخل سوريا.' : 'Enter valid coordinates inside Syria.')
      return
    }
    setMapPinConfirmed(true)
  }

  function useMyLocation() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('error')
      return
    }
    setGeoStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = String(position.coords.latitude)
        const lng = String(position.coords.longitude)
        setLatitude(lat)
        setLongitude(lng)
        if (isValidSyriaCoord(lat, lng)) {
          setMapPinConfirmed(true)
          setGeoStatus('done')
        } else {
          setMapPinConfirmed(false)
          setGeoStatus('error')
        }
      },
      () => setGeoStatus('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
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

  if (carBulkStage === 'prompt') {
    return (
      <main className="seller-page seller-wizard-page" dir={isAr ? 'rtl' : 'ltr'}>
        <section className="seller-account-head">
          <BrandLogo logo="plus" size="nav" />
        </section>

        <section className="seller-wizard-shell">
          <div className="seller-wizard-header">
            <p className="eyebrow">{isAr ? 'تم إرسال السيارة' : 'Car submitted'}</p>
            <h1>{isAr ? 'أضف سيارة أخرى؟' : 'Add another car?'}</h1>
            <p>
              {isAr
                ? 'تم إرسال هذه السيارة للمراجعة. يمكنك إضافة سيارة جديدة الآن أو الانتهاء.'
                : 'This car has been submitted for review. You can add another car now or finish here.'}
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
            <button className="seller-secondary-button" disabled={submitState === 'submitting'} onClick={finishCarBulkAdd}>
              {isAr ? 'لا، إنهاء' : 'No, finish'}
            </button>
            <button className="seller-primary-button" disabled={submitState === 'submitting'} onClick={startAnotherCar}>
              {isAr ? 'نعم، أضف سيارة أخرى' : 'Yes, add another car'}
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
                  active={DIVISION_OPTIONS.find((item) => item.value === division)?.[lang] || ''}
                  items={DIVISION_OPTIONS.map((item) => item[lang])}
                  onChange={(label) => {
                    const next = DIVISION_OPTIONS.find((item) => item[lang] === label)
                    if (next) setDivision(next.value)
                  }}
                  title={isAr ? 'القسم' : 'Division'}
                />
              )}
              {!isAdvertisingFlow && division === 'CARS' && (
                <>
                  <VisualFilterPanel
                    compact
                    groups={sellerCarFilterGroups}
                    lang={lang}
                    selection={visualFilters}
                    onChange={setVisualFilters}
                  />
                  <div className="seller-form-grid">
                    <label>
                      <span>{isAr ? 'الماركة' : 'Make'}</span>
                      <input dir="ltr" onChange={(event) => setCarMake(event.target.value)} placeholder="Toyota" value={carMake} />
                    </label>
                    <label>
                      <span>{isAr ? 'الموديل' : 'Model'}</span>
                      <input dir="ltr" onChange={(event) => setCarModel(event.target.value)} placeholder="Corolla" value={carModel} />
                    </label>
                    <label>
                      <span>{isAr ? 'سنة الصنع' : 'Year'}</span>
                      <input dir="ltr" inputMode="numeric" onChange={(event) => setCarYear(event.target.value)} placeholder="2019" value={carYear} />
                    </label>
                    <label>
                      <span>{isAr ? 'الممشى (كم)' : 'Mileage (km)'}</span>
                      <input dir="ltr" inputMode="numeric" onChange={(event) => setCarMileageKm(event.target.value)} placeholder="85000" value={carMileageKm} />
                    </label>
                    <label>
                      <span>{isAr ? 'ناقل الحركة' : 'Transmission'}</span>
                      <select onChange={(event) => setCarTransmission(event.target.value)} value={carTransmission}>
                        <option value="automatic">{isAr ? 'أوتوماتيك' : 'Automatic'}</option>
                        <option value="manual">{isAr ? 'عادي' : 'Manual'}</option>
                      </select>
                    </label>
                    <label>
                      <span>{isAr ? 'الوقود' : 'Fuel type'}</span>
                      <select onChange={(event) => setCarFuelType(event.target.value)} value={carFuelType}>
                        <option value="gas">{isAr ? 'بنزين' : 'Gas'}</option>
                        <option value="diesel">{isAr ? 'ديزل' : 'Diesel'}</option>
                        <option value="hybrid">{isAr ? 'هايبرد' : 'Hybrid'}</option>
                        <option value="electric">{isAr ? 'كهرباء' : 'Electric'}</option>
                      </select>
                    </label>
                    <label>
                      <span>{isAr ? 'الحالة' : 'Condition'}</span>
                      <select onChange={(event) => setCarCondition(event.target.value)} value={carCondition}>
                        <option value="NEW">{isAr ? 'جديد' : 'New'}</option>
                        <option value="USED">{isAr ? 'مستعمل' : 'Used'}</option>
                        <option value="EXCELLENT">{isAr ? 'ممتاز' : 'Excellent'}</option>
                        <option value="GOOD">{isAr ? 'جيد' : 'Good'}</option>
                        <option value="FAIR">{isAr ? 'مقبول' : 'Fair'}</option>
                        <option value="REFURBISHED">{isAr ? 'مجدّد' : 'Refurbished'}</option>
                      </select>
                    </label>
                  </div>
                  <div className="seller-form-grid">
                    <label>
                      <span>{isAr ? 'طريقة البيع' : 'Sale type'}</span>
                      <select onChange={(event) => setCarSaleType(event.target.value as 'FIXED' | 'AUCTION')} value={carSaleType}>
                        <option value="FIXED">{isAr ? 'سعر ثابت' : 'Fixed price'}</option>
                        <option value="AUCTION">{isAr ? 'مزاد' : 'Auction'}</option>
                      </select>
                    </label>
                    {carSaleType === 'AUCTION' && (
                      <>
                        <label>
                          <span>{isAr ? 'الحد الأدنى للسعر (اختياري)' : 'Reserve price (optional)'}</span>
                          <input dir="ltr" inputMode="numeric" onChange={(event) => setCarReservePriceMinor(event.target.value)} placeholder={isAr ? 'اتركه فارغاً لعدم وجود حد أدنى' : 'Leave blank for no reserve'} value={carReservePriceMinor} />
                        </label>
                        <label>
                          <span>{isAr ? 'أقل زيادة في العرض' : 'Minimum bid increment'}</span>
                          <input dir="ltr" inputMode="numeric" onChange={(event) => setCarMinIncrementMinor(event.target.value)} value={carMinIncrementMinor} />
                        </label>
                        <label>
                          <span>{isAr ? 'مدة المزاد (ساعات)' : 'Auction duration (hours)'}</span>
                          <input dir="ltr" inputMode="numeric" onChange={(event) => setCarAuctionDurationHours(event.target.value)} value={carAuctionDurationHours} />
                        </label>
                      </>
                    )}
                  </div>
                </>
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
              {isAdvertisingFlow && (
                <div className="seller-form-grid">
                  <TouchChoiceGroup
                    active={adPlacement}
                    items={AD_PLACEMENTS.map((item) => item[lang])}
                    onChange={setAdPlacement}
                    title={isAr ? 'مكان الظهور' : 'Placement'}
                  />
                  <TouchChoiceGroup
                    active={adDuration}
                    items={AD_DURATIONS.map((item) => item[lang])}
                    onChange={setAdDuration}
                    title={isAr ? 'مدة الإعلان' : 'Ad duration'}
                  />
                </div>
              )}
              {!isAdvertisingFlow && division === 'CARS' && submitState === 'error' && (
                <div className="seller-inline-alert">
                  <strong>{isAr ? 'بيانات السيارة مطلوبة' : 'Vehicle details required'}</strong>
                  <span>{submitError}</span>
                </div>
              )}
            </div>
          )}

          {activeStep.id === 'location' && (
            <div className="seller-wizard-section">
              <div className="seller-location-capsule">
                <div className="seller-location-summary">
                  <span>{isAr ? 'الموقع المختار' : 'Selected location'}</span>
                  <strong>{[selectedGovernorateLabel, selectedCityLabel, selectedAreaLabel].filter(Boolean).join(' ← ')}</strong>
                </div>
                <div className="seller-location-group">
                  <span>{isAr ? 'المحافظة' : 'Governorate'}</span>
                  <div className="seller-location-options">
                    {SYRIA_GOVERNORATES.map((item) => (
                      <button className={item.key === governorate ? 'active' : ''} key={item.key} onClick={() => chooseGovernorate(item.key)}>
                        {labelFor(lang, item)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="seller-location-group">
                  <span>{isAr ? 'المدينة / القضاء' : 'City / district'}</span>
                  <div className="seller-location-options">
                    {(selectedGovernorateData?.cities || []).map((item) => (
                      <button className={item.key === city ? 'active' : ''} key={item.key} onClick={() => chooseCity(item.key)}>
                        {labelFor(lang, item)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="seller-location-group">
                  <span>{isAr ? 'المنطقة / الشارع' : 'Area / street'}</span>
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
                          setAreaQuery(labelFor(lang, item))
                        }}
                        type="button"
                      >
                        {labelFor(lang, item)}
                      </button>
                    ))}
                    {!filteredAreaOptions.length && (
                      <span className="seller-location-empty">{isAr ? 'لا توجد نتيجة مطابقة' : 'No matching area'}</span>
                    )}
                  </div>
                </div>
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
                  <div className="seller-map-grid-lines" />
                  <div className="seller-map-route seller-map-route-a" />
                  <div className="seller-map-route seller-map-route-b" />
                  <button
                    aria-label={isAr ? 'تأكيد دبوس الموقع' : 'Confirm map pin'}
                    className={`seller-map-pin ${mapPinConfirmed ? 'confirmed' : ''}`}
                    onClick={confirmMapPin}
                    type="button"
                  >
                    <span />
                  </button>
                  <div className="seller-map-chip">
                    <strong>{selectedAreaLabel || selectedCityLabel}</strong>
                    <span>{mapPinConfirmed ? (isAr ? 'تم تأكيد الموقع' : 'Pin confirmed') : isAr ? 'اضغط الدبوس لتأكيد الموقع' : 'Press the pin to confirm'}</span>
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
                  {(division === 'CARS' || division === 'STAYS') && (
                    <button disabled={geoStatus === 'locating'} onClick={useMyLocation} type="button">
                      {geoStatus === 'locating'
                        ? isAr ? 'جارِ تحديد الموقع...' : 'Locating...'
                        : isAr ? 'استخدام موقعي الحالي' : 'Use my current location'}
                    </button>
                  )}
                  {(division === 'CARS' || division === 'STAYS') && (geoStatus === 'denied' || geoStatus === 'error') && (
                    <span className="seller-map-geo-hint">
                      {isAr
                        ? 'تعذر الوصول للموقع. أدخل الإحداثيات يدوياً ثم اضغط تأكيد.'
                        : 'Could not access your location. Enter coordinates manually, then confirm.'}
                    </span>
                  )}
                  <button
                    className={mapPinConfirmed ? 'confirmed' : ''}
                    onClick={confirmMapPin}
                    type="button"
                  >
                    {mapPinConfirmed ? (isAr ? 'تم حفظ الموقع' : 'Location saved') : isAr ? 'تأكيد الموقع على الخريطة' : 'Confirm location on map'}
                  </button>
                </div>
              </div>
              {!isAdvertisingFlow && (division === 'CARS' || division === 'STAYS') && submitState === 'error' && (
                <div className="seller-inline-alert">
                  <strong>{isAr ? 'الموقع مطلوب' : 'Location required'}</strong>
                  <span>{submitError}</span>
                </div>
              )}
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
                  <span>{isAr ? 'الضريبة بالدولار (اختياري)' : 'Tax USD (optional)'}</span>
                  <div className="seller-price-input-shell">
                    <b>USD</b>
                    <input
                      dir="ltr"
                      inputMode="numeric"
                      onChange={(event) => setTaxFee(event.target.value)}
                      placeholder="0"
                      value={taxFee}
                    />
                  </div>
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
                    ? 'تخصم SYBNB عمولة خدمة 10% من قيمة الإيجار (لا تشمل رسوم التنظيف والضريبة) من مستحقاتك عند كل حجز مكتمل.'
                    : 'SYBNB deducts a 10% service commission from the rent amount (not the cleaning fee or tax) from your payout on every completed booking.'}
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
                          <button disabled={availMonthAtOrBeforeThisMonth} onClick={() => setAvailabilityMonth((current) => addMonths(current, -1))} type="button">
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
                        {availabilityMonthDays.map((day) => {
                          const isPast = day < wizardTodayIso
                          return (
                            <button
                              className={selectedAvailabilityDays.has(day) ? 'active' : ''}
                              key={day}
                              disabled={isPast}
                              onClick={() => toggleAvailabilityDay(day)}
                              type="button"
                              style={isPast ? { opacity: 0.3, textDecoration: 'line-through', cursor: 'not-allowed' } : undefined}
                            >
                              <strong>{new Date(`${day}T00:00:00`).getDate()}</strong>
                              <span>{selectedAvailabilityDays.has(day) ? `USD ${variableNightPrice || price}` : isAr ? 'مغلق' : 'Closed'}</span>
                            </button>
                          )
                        })}
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
                    <span>{plan[lang]}</span>
                    <strong>{`USD ${plan.priceUsd}`}</strong>
                    <ul>
                      {plan.services[lang].map((service) => (
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
                    <strong>{`${selectedListingPlan[lang]} · USD ${selectedListingPlan.priceUsd}`}</strong>
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
                      {method[lang]}
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
                  {!isAdvertisingFlow && division === 'CARS' && (
                    <div className="seller-form-grid">
                      <label className="seller-wide-field">
                        <span>{isAr ? 'صور السيارة الحقيقية (مطلوب صورة واحدة على الأقل)' : 'Real car photos (at least one required)'}</span>
                        <input
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          onChange={(event) => {
                            const files = Array.from(event.target.files || []).filter((file) => {
                              const allowed = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
                              const withinSize = file.size <= 8 * 1024 * 1024
                              return allowed && withinSize
                            })
                            if (files.length) setCarPhotoFiles((current) => [...current, ...files])
                            event.target.value = ''
                          }}
                          type="file"
                        />
                      </label>
                      {carPhotoFiles.length > 0 && (
                        <div className="seller-upload-grid">
                          {carPhotoFiles.map((file, index) => (
                            <span key={`${file.name}-${index}`}>
                              {file.name}
                              <button
                                aria-label={isAr ? 'إزالة الصورة' : 'Remove photo'}
                                onClick={() => setCarPhotoFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                                type="button"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      {submitState === 'error' && (
                        <div className="seller-inline-alert">
                          <strong>{isAr ? 'الصور مطلوبة' : 'Photos required'}</strong>
                          <span>{submitError}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {!isAdvertisingFlow && division !== 'CARS' && (
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
                  {division !== 'CARS' && (
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
                      <strong>{item[lang]}</strong>
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
                  )}
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

// Mirrors server/lib/sr-geocoding.mjs's SYRIA_BOUNDS -- duplicated here since src/ never imports
// server/lib/*.mjs. Used to make the CARS map pin require a real, plausible coordinate instead of
// unconditionally confirming whatever is in the (previously decorative) lat/lng inputs.
function isValidSyriaCoord(latStr: string, lngStr: string) {
  const lat = Number(latStr)
  const lng = Number(lngStr)
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 32 && lat <= 37.5 && lng >= 35 && lng <= 43
}

function toMinor(value: string) {
  return Math.max(0, Math.round(toNumber(value)))
}
