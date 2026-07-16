import { useEffect, useMemo, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { BrandLogo } from '../../shared/brand'
import {
  addAccommodationRoomType,
  createAccommodation,
  createAndSubmitPrototypeListing,
  submitAccommodation,
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
    id: 'media',
    title: { ar: 'الصور والملفات', en: 'Photos and files' },
    helper: { ar: 'صور العقار وإثبات الدفع والملكية أو التفويض.', en: 'Property photos, payment proof, and ownership or authorization files.' },
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
  const adFileSlots =
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
  const [price, setPrice] = useState(draft.price || '15')
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
  // Set once the accommodation shell + first STAYS room type are created; every following room
  // type in the same session reuses it instead of re-collecting location/documents/photos.
  const [accommodationId, setAccommodationId] = useState<string | null>(null)
  const [roomTypeStage, setRoomTypeStage] = useState<'idle' | 'prompt'>('idle')
  const isMultiRoomFlow = division === 'STAYS' && !isAdvertisingFlow

  useEffect(() => {
    if (typeof window === 'undefined') return
    const nextDraft: WizardDraft = {
      division,
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
  }, [division, selectedType, title, description, governorate, city, area, address, latitude, longitude, mapPinConfirmed, price, size, guestCapacity, bedrooms, bathrooms, instantBookEnabled, searchCapsuleEnabled, availabilityDates, variableNightPrice, availableStart, availableEnd, bookedDate, paymentDay, visualFilters])
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
  const availabilityCalendar = {
    searchCapsuleEnabled,
    availabilityDates,
    variableNightPrice,
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

      setSubmitState('submitting')
      setSubmitError('')

      const roomTypeMetadata = {
        propertyType: selectedType,
        sizeSqm: toNumber(size),
        guestCapacity: toNumber(guestCapacity),
        bedrooms: toNumber(bedrooms),
        bathrooms: toNumber(bathrooms),
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
    setSize('40')
    setBedrooms('1')
    setBathrooms('1')
    setSelectedType(PROPERTY_TYPES[0].en)
    setVisualFilters({ propertyType: 'apartment', roomType: 'doubleRoom', bedType: 'queenBed', amenities: ['wifi', 'kitchen'] })
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
                onClick={() => setStepIndex(index)}
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
                    onClick={() => setMapPinConfirmed(true)}
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
                        <label>
                          <span>{isAr ? 'يوم الدفع' : 'Payment day'}</span>
                          <input dir="ltr" type="date" value={paymentDay} onChange={(event) => setPaymentDay(event.target.value)} />
                        </label>
                      </div>
                      <div className="seller-host-day-grid seller-host-booking-grid">
                        {reservationMonthDays.map((day) => (
                          <button className={bookedDays.has(day) ? 'booked' : ''} key={day} onClick={() => setBookedDate(day)} type="button">
                            <strong>{new Date(`${day}T00:00:00`).getDate()}</strong>
                            <span>{bookedDays.has(day) ? (isAr ? 'محجوز' : 'Booked') : isAr ? 'فارغ' : 'Free'}</span>
                          </button>
                        ))}
                      </div>
                      <div className="seller-host-reservation-card compact">
                        <span>{isAr ? 'آخر حجز مقبول' : 'Accepted booking'}</span>
                        <strong>{bookedDate}</strong>
                        <em>{`USD ${variableNightPrice || price}`}</em>
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

          {activeStep.id === 'media' && (
            <div className="seller-wizard-section">
              <div className="seller-upload-grid">
                {(isAdvertisingFlow
                  ? adFileSlots
                  : [
                      { id: 'propertyPhotos', ar: 'صور العقار', en: 'Property photos' },
                      { id: 'paymentProof', ar: 'إثبات دفع الخطة', en: 'Plan payment proof' },
                      { id: 'ownershipProof', ar: 'إثبات الملكية', en: 'Ownership proof' },
                      { id: 'authorization', ar: 'أضف التفويض', en: 'Add authorization' },
                      { id: 'deed', ar: 'مخطط أو سند', en: 'Plan or deed' },
                    ]).map((item) => (
                  <button
                    className={uploadedAdFiles.includes(item.id) ? 'uploaded' : ''}
                    key={item.en}
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

function toMinor(value: string) {
  return Math.max(0, Math.round(toNumber(value)))
}
