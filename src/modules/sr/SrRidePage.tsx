import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { navigate } from '../../app/routes'
import { srRideFilterGroupsFromConfig, type VisualFilterSelection } from '../../engines/filters'
import { DivisionTriad } from '../../shared/layout/DivisionTriad'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createPrototypeSrRide,
  fetchPrototypeSrRide,
  fetchSrQuote,
  type PlatformRideRequest,
  type PlatformSrQuote,
} from '../../shared/api/platformApi'
import { moneyText, statusText } from '../../shared/i18n/display'
import { OpenDisputeForm } from '../disputes/OpenDisputeForm'
import { selectedFilterLabels, VisualFilterPanel } from '../../shared/filters/VisualFilterPanel'
import { sypMinorToRoundedUsdMinor } from '../../shared/currency'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'SYBNB Ride',
    subtitle: 'طلب رحلة حقيقي محفوظ في قاعدة البيانات، يُعرض مباشرة على السائقين القريبين ليقبلوه بأنفسهم.',
    mode: 'وضع بيانات منخفض',
    pickup: 'نقطة الانطلاق',
    dropoff: 'الوجهة',
    category: 'الفئة',
    fare: 'الأجرة التقديرية',
    payCurrency: 'عملة الدفع',
    payCash: 'نقداً (ل.س)',
    payUsd: 'دولار أمريكي',
    usdRoundingNote: 'الأجرة بالدولار تُقرّب للأعلى لأقرب ٥$ لتفادي الحاجة لفكة.',
    distance: 'المسافة التقديرية',
    distanceApprox: '(تقريبية بحسب العنوان)',
    request: 'طلب الرحلة',
    refresh: 'تحديث الحالة',
    status: 'حالة الرحلة',
    rideId: 'رقم الرحلة',
    driver: 'السائق',
    pickupCode: 'رمز الانطلاق',
    pickupCodeHint: 'اقرأ هذا الرمز للسائق عند الوصول لبدء الرحلة.',
    location: 'الموقع',
    accuracy: 'دقة الموقع',
    saved: 'تم حفظ الرحلة',
    error: 'تعذر تنفيذ طلب SYBNB Ride',
    saving: 'جار الحفظ',
    gps: 'استخدام موقعي الحالي',
    manualHint: 'يمكن متابعة الطلب حتى بدون GPS عبر العناوين اليدوية.',
    waitingForDriver: 'بانتظار قبول أحد السائقين القريبين للرحلة...',
    driverAssigned: 'تم تعيين سائق لرحلتك.',
    priceBreakdown: 'تفاصيل السعر',
    baseFare: 'الأجرة الأساسية',
    distanceCharge: 'رسوم المسافة',
    trackingSurcharge: 'رسوم التتبع الحي',
    dynamicAdjustment: 'تعديل الطلب (ذروة/موسم)',
    regulatoryContribution: 'مساهمة تنظيمية',
    gst: 'ضريبة GST',
    qst: 'ضريبة QST',
    total: 'الإجمالي',
    tipHint: 'لا يشمل الإكرامية — تُضاف بعد الرحلة، ولا تخضع لعمولة المنصة.',
    commissionHint: 'قد تتضمن هذه الأجرة عمولة خدمة SYBNB التصاعدية للسائق (9%–12%)، تُخصم من أجرة السائق ولا تُضاف على إجمالي الراكب.',
    pendingConfirmation: 'قيد التأكيد — 0',
    testModeBadge: 'وضع الاختبار',
    taxDisclosureBanner: 'وضع الاختبار — تقدير ضريبي لأغراض إعلامية فقط. لا يُحوَّل ولا يُسدَّد أي مبلغ لأي جهة حكومية.',
  },
  en: {
    back: 'Back to landing',
    title: 'SYBNB Ride',
    subtitle: 'Real ride request saved in PostgreSQL, broadcast live to nearby drivers to self-accept.',
    mode: 'Low-data mode',
    pickup: 'Pickup',
    dropoff: 'Dropoff',
    category: 'Category',
    fare: 'Estimated fare',
    payCurrency: 'Payment currency',
    payCash: 'Cash (SYP)',
    payUsd: 'US Dollar',
    usdRoundingNote: 'USD fares round up to the nearest $5 so no one needs to make change.',
    distance: 'Estimated distance',
    distanceApprox: '(approximate, from address text)',
    request: 'Request ride',
    refresh: 'Refresh status',
    status: 'Ride status',
    rideId: 'Ride ID',
    driver: 'Driver',
    pickupCode: 'Pickup code',
    pickupCodeHint: 'Read this code to your driver at pickup to start the trip.',
    location: 'Location',
    accuracy: 'Accuracy',
    saved: 'Ride saved',
    error: 'Could not complete SYBNB Ride request',
    saving: 'Saving',
    gps: 'Use my current location',
    manualHint: 'The request can continue without GPS through manual addresses.',
    waitingForDriver: 'Waiting for a nearby driver to accept the ride...',
    driverAssigned: 'A driver has been assigned to your ride.',
    priceBreakdown: 'Price breakdown',
    baseFare: 'Base fare',
    distanceCharge: 'Distance charge',
    trackingSurcharge: 'Live-tracking surcharge',
    dynamicAdjustment: 'Demand adjustment (peak/season)',
    regulatoryContribution: 'Regulatory contribution',
    gst: 'GST',
    qst: 'QST',
    total: 'Total',
    tipHint: "Doesn't include a tip — tips are added after the ride and are never commissionable.",
    commissionHint: "This fare may include SYBNB's progressive driver service commission (9%-12%), taken from the driver's fare share -- never added on top of the passenger's total.",
    pendingConfirmation: 'Pending confirmation — 0',
    testModeBadge: 'TEST MODE',
    taxDisclosureBanner: 'TEST MODE — Tax estimate for information only. No amount is transmitted or remitted to a government authority.',
  },
  fr: {
    back: "Retour à l'accueil",
    title: 'SYBNB Ride',
    subtitle: 'Demande de course réelle enregistrée dans PostgreSQL, diffusée en direct aux conducteurs à proximité pour acceptation.',
    mode: 'Mode données réduites',
    pickup: 'Départ',
    dropoff: 'Destination',
    category: 'Catégorie',
    fare: 'Tarif estimé',
    payCurrency: 'Devise de paiement',
    payCash: 'Comptant (LSP)',
    payUsd: 'Dollar américain',
    usdRoundingNote: "Les tarifs en dollars sont arrondis au 5$ supérieur pour éviter d'avoir à rendre la monnaie.",
    distance: 'Distance estimée',
    distanceApprox: "(approximative, d'après le texte de l'adresse)",
    request: 'Demander une course',
    refresh: 'Actualiser le statut',
    status: 'Statut de la course',
    rideId: 'Numéro de la course',
    driver: 'Conducteur',
    pickupCode: 'Code de départ',
    pickupCodeHint: 'Lisez ce code à votre conducteur à son arrivée pour démarrer la course.',
    location: 'Emplacement',
    accuracy: 'Précision',
    saved: 'Course enregistrée',
    error: 'Impossible de compléter la demande SYBNB Ride',
    saving: 'Enregistrement',
    gps: 'Utiliser ma position actuelle',
    manualHint: "La demande peut continuer sans GPS grâce aux adresses saisies manuellement.",
    waitingForDriver: "En attente qu'un conducteur à proximité accepte la course...",
    driverAssigned: 'Un conducteur a été assigné à votre course.',
    priceBreakdown: 'Détail du prix',
    baseFare: 'Tarif de base',
    distanceCharge: 'Frais de distance',
    trackingSurcharge: 'Frais de suivi en direct',
    dynamicAdjustment: 'Ajustement de la demande (pointe/saison)',
    regulatoryContribution: 'Contribution réglementaire',
    gst: 'TPS',
    qst: 'TVQ',
    total: 'Total',
    tipHint: "N'inclut pas de pourboire — celui-ci est ajouté après la course et n'est jamais soumis à la commission de la plateforme.",
    commissionHint: "Ce tarif peut inclure la commission de service progressive de SYBNB pour le conducteur (9%-12%), prélevée sur la part du conducteur -- jamais ajoutée au total du passager.",
    pendingConfirmation: 'En attente de confirmation — 0',
    testModeBadge: 'MODE TEST',
    taxDisclosureBanner: "MODE TEST — Estimation fiscale fournie à titre informatif seulement. Aucun montant n'est transmis ou remis à une autorité gouvernementale.",
  },
}

const ACTIVE_RIDE_ID_KEY = 'sybnb.v6.activeSrRideId'

const categories = ['SR Economy', 'SR Comfort', 'SR SUV', 'SR XXL']

// Display-only rebrand (SR/SIR is the internal code; customer-facing label is "SYBNB Ride" per the
// Québec compliance review): the stored category value posted to the server and saved on the
// ride/vehicle rows must stay exactly as `categories` above -- only the label shown to the rider changes.
const CATEGORY_LABELS: Record<string, string> = {
  'SR Economy': 'SYBNB Ride Economy',
  'SR Comfort': 'SYBNB Ride Comfort',
  'SR SUV': 'SYBNB Ride SUV',
  'SR XXL': 'SYBNB Ride XXL',
}

// Real vehicle-class seating capacity (a static fleet fact, server/lib/fleet.mjs's SR_VEHICLE_CATEGORIES
// -- not live telemetry), shown the same way Lyft/Uber show "up to N" per tier.
const TIER_CAPACITY: Record<string, number> = {
  'SR Economy': 4,
  'SR Comfort': 4,
  'SR SUV': 6,
  'SR XXL': 6,
}

const rideCategoryByFilter: Record<string, string> = {
  economy: 'SR Economy',
  comfort: 'SR Comfort',
  premium: 'SR Comfort',
  familyVan: 'SR XXL',
}

export function SrRidePage({ lang }: Props) {
  const t = copy[lang] ?? copy.en
  const isAr = lang === 'ar'
  const [pickup, setPickup] = useState(isAr ? 'دمشق، المالكي' : 'Damascus, Malki')
  const [dropoff, setDropoff] = useState(isAr ? 'دمشق، المزة' : 'Damascus, Mezzeh')
  const [category, setCategory] = useState(categories[0])
  const [payCurrency, setPayCurrency] = useState<'SYP' | 'USD'>('SYP')
  const [lowDataMode, setLowDataMode] = useState(true)
  const [accuracyMeters, setAccuracyMeters] = useState<number | undefined>()
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | undefined>()
  const [ride, setRide] = useState<PlatformRideRequest | null>(null)
  // One quote per tier, fetched in parallel -- each tier has its own real rate card (server/lib/
  // sr-geocoding.mjs CATEGORY_RATES) and etaByCategory is identical across all four responses (same
  // server-side computation regardless of which category was requested), so any one of them can
  // supply the ETA map.
  const [quotesByCategory, setQuotesByCategory] = useState<Record<string, PlatformSrQuote>>({})
  const quote = quotesByCategory[category] ?? null
  const etaByCategory = Object.values(quotesByCategory)[0]?.etaByCategory ?? null
  const [rideFilters, setRideFilters] = useState<VisualFilterSelection>({
    srRideCategory: 'economy',
    srRideRoute: 'cityRide',
    srRideFeatures: ['instantConfirm', 'verifiedDriver', 'ac'],
    payments: ['localWallet'],
  })
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const rideFilterGroups = useMemo(() => srRideFilterGroupsFromConfig(), [])

  const fallbackFareMinorFor = (cat: string) => {
    const base = cat === 'SR XXL' ? 78000 : cat === 'SR SUV' ? 58000 : cat === 'SR Comfort' ? 46000 : 35000
    const sypMinor = lowDataMode ? base : base + 2500
    return payCurrency === 'USD' ? sypMinorToRoundedUsdMinor(sypMinor) : sypMinor
  }
  const fareMinorFor = (cat: string) => quotesByCategory[cat]?.fareMinor ?? fallbackFareMinorFor(cat)
  const fareMinor = fareMinorFor(category)

  useEffect(() => {
    if (ride) return
    const timer = window.setTimeout(() => {
      Promise.all(
        categories.map((item) =>
          fetchSrQuote({ pickup, dropoff, category: item, currency: payCurrency, lowDataMode, pickupCoords })
            .then((result) => [item, result] as const)
            .catch(() => null),
        ),
      ).then((entries) => {
        const next: Record<string, PlatformSrQuote> = {}
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1]
        }
        setQuotesByCategory(next)
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [pickup, dropoff, payCurrency, lowDataMode, pickupCoords, ride])

  // The active ride otherwise lives only in this component's state — reloading the page or
  // navigating away and back loses all track of it even though it's fully real and persisted
  // server-side. Restore it from the last-known id on mount so the rider can still see live
  // driver-assignment/status updates after leaving and returning to this page.
  useEffect(() => {
    const storedRideId = sessionStorage.getItem(ACTIVE_RIDE_ID_KEY)
    if (!storedRideId) return
    fetchPrototypeSrRide(storedRideId)
      .then(setRide)
      .catch(() => sessionStorage.removeItem(ACTIVE_RIDE_ID_KEY))
    // Mount-only restore; requestRide() below is the sole subsequent writer of `ride`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Poll through every non-terminal state, not just REQUESTED/MATCHING — this previously
    // stopped the instant a driver was assigned, so the rider never saw DRIVER_ARRIVING,
    // IN_PROGRESS, or COMPLETED without manually clicking refresh (confirmed live: the ride sat
    // on "driver assigned" through the driver's entire arrive/start/complete sequence).
    if (!ride || ['COMPLETED', 'CANCELLED'].includes(ride.status)) return
    const interval = window.setInterval(() => {
      fetchPrototypeSrRide(ride.id).then(setRide).catch(() => {})
    }, 4000)
    return () => window.clearInterval(interval)
  }, [ride])

  async function useCurrentLocation() {
    setMessage('')
    if (!navigator.geolocation) {
      setAccuracyMeters(undefined)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAccuracyMeters(Math.round(position.coords.accuracy))
        setPickupCoords({ lat: position.coords.latitude, lng: position.coords.longitude })
        setPickup(isAr ? 'موقعي الحالي' : 'Current location')
      },
      () => {
        setAccuracyMeters(undefined)
        setPickupCoords(undefined)
        setMessage(t.manualHint)
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    )
  }

  async function requestRide() {
    setStatus('saving')
    setMessage('')

    try {
      const nextRide = await createPrototypeSrRide({
        pickup,
        dropoff,
        category,
        currency: payCurrency,
        lowDataMode,
        accuracyMeters,
        pickupCoords,
      })
      setRide(nextRide)
      sessionStorage.setItem(ACTIVE_RIDE_ID_KEY, nextRide.id)
      setStatus('idle')
      setMessage(t.saved)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  function updateRideFilters(next: VisualFilterSelection) {
    setRideFilters(next)
    const nextCategory = String(next.srRideCategory || 'economy')
    setCategory(rideCategoryByFilter[nextCategory] || 'SR Economy')
  }

  async function refreshRide() {
    if (!ride) return
    setStatus('saving')
    setMessage('')

    try {
      setRide(await fetchPrototypeSrRide(ride.id))
      setStatus('idle')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <section style={styles.hero}>
        <p style={styles.eyebrow}>SYBNB Ride</p>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
      </section>

      <DivisionTriad lang={lang} offerLabel={{ ar: 'كن سائقاً', en: 'Drive with SYBNB Ride', fr: 'Devenir chauffeur SYBNB Ride' }} offerHref="/driver" />

      <section style={styles.driveBanner}>
        <div>
          <strong style={styles.driveBannerTitle}>{isAr ? 'كن سائقاً مع SYBNB Ride' : 'Drive with SYBNB Ride'}</strong>
          <span style={styles.driveBannerBody}>
            {isAr
              ? 'اكسب دخلاً إضافياً بقيادة سيارتك. سجّل حساب سائق، أضف مركبتك، وابدأ استقبال الرحلات.'
              : 'Earn extra income driving your own car. Create a driver account, add your vehicle, and start accepting rides.'}
          </span>
        </div>
        <button style={styles.driveBannerButton} onClick={() => navigate('/driver')}>
          {isAr ? 'ابدأ الآن' : 'Get started'}
        </button>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <div style={styles.mapPreview}>
            <span style={styles.dot} />
            <strong>{t.location}</strong>
            <p>{t.manualHint}</p>
          </div>

          <button style={styles.secondaryButton} onClick={() => void useCurrentLocation()}>
            {t.gps}
          </button>

          <label style={styles.label}>
            {t.pickup}
            <input style={styles.input} value={pickup} onChange={(event) => setPickup(event.target.value)} />
          </label>

          <label style={styles.label}>
            {t.dropoff}
            <input style={styles.input} value={dropoff} onChange={(event) => setDropoff(event.target.value)} />
          </label>

          <section style={styles.categoryCapsule}>
            <span style={styles.categoryTitle}>{t.category}</span>
            <div style={styles.tierList}>
              {categories.map((item) => {
                const etaMinutes = etaByCategory?.[item]
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setCategory(item)}
                    style={item === category ? styles.tierCardActive : styles.tierCard}
                  >
                    <span style={styles.tierIcon} aria-hidden="true">🚗</span>
                    <span style={styles.tierInfo}>
                      <strong>{CATEGORY_LABELS[item] || item}</strong>
                      <span style={styles.tierCapacity}>
                        {isAr ? `حتى ${TIER_CAPACITY[item]} ركاب` : `Up to ${TIER_CAPACITY[item]}`}
                      </span>
                    </span>
                    <span style={styles.tierMeta}>
                      <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(fareMinorFor(item), payCurrency, lang)}</strong>
                      <span style={etaMinutes ? styles.tierEta : styles.tierEtaNone}>
                        {etaMinutes
                          ? (isAr ? `خلال ${etaMinutes} د` : `in ${etaMinutes} min`)
                          : (isAr ? 'لا سائق قريب الآن' : 'No driver nearby now')}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {quote?.breakdown && (
            <section style={styles.categoryCapsule}>
              <span style={styles.categoryTitle}>{t.priceBreakdown}</span>
              <div style={styles.breakdownList}>
                <div style={styles.breakdownRow}><span>{t.baseFare}</span><span dir="ltr">{moneyText(quote.breakdown.baseFareMinor, quote.breakdown.currency, lang)}</span></div>
                <div style={styles.breakdownRow}><span>{t.distanceCharge}</span><span dir="ltr">{moneyText(quote.breakdown.distanceChargeMinor, quote.breakdown.currency, lang)}</span></div>
                {quote.breakdown.liveTrackingSurchargeMinor > 0 && (
                  <div style={styles.breakdownRow}><span>{t.trackingSurcharge}</span><span dir="ltr">{moneyText(quote.breakdown.liveTrackingSurchargeMinor, quote.breakdown.currency, lang)}</span></div>
                )}
                {quote.breakdown.dynamicPricingAdjustmentMinor !== 0 && (
                  <div style={styles.breakdownRow}><span>{t.dynamicAdjustment}</span><span dir="ltr">{moneyText(quote.breakdown.dynamicPricingAdjustmentMinor, quote.breakdown.currency, lang)}</span></div>
                )}
                <p style={styles.taxDisclosureBanner}>{t.taxDisclosureBanner}</p>
                <div style={styles.breakdownRow}>
                  <span>{t.regulatoryContribution} {quote.breakdown.regulatoryContributionMinor === 0 && <em style={styles.testModeBadge}>{t.testModeBadge}</em>}</span>
                  <span dir="ltr">{quote.breakdown.regulatoryContributionMinor > 0 ? moneyText(quote.breakdown.regulatoryContributionMinor, quote.breakdown.currency, lang) : t.pendingConfirmation}</span>
                </div>
                <div style={styles.breakdownRow}>
                  <span>{t.gst} {quote.breakdown.gstMinor === 0 && <em style={styles.testModeBadge}>{t.testModeBadge}</em>}</span>
                  <span dir="ltr">{quote.breakdown.gstMinor > 0 ? moneyText(quote.breakdown.gstMinor, quote.breakdown.currency, lang) : t.pendingConfirmation}</span>
                </div>
                <div style={styles.breakdownRow}>
                  <span>{t.qst} {quote.breakdown.qstMinor === 0 && <em style={styles.testModeBadge}>{t.testModeBadge}</em>}</span>
                  <span dir="ltr">{quote.breakdown.qstMinor > 0 ? moneyText(quote.breakdown.qstMinor, quote.breakdown.currency, lang) : t.pendingConfirmation}</span>
                </div>
                <div style={styles.breakdownRowTotal}><span>{t.total}</span><span dir="ltr">{moneyText(quote.breakdown.totalMinor, quote.breakdown.currency, lang)}</span></div>
              </div>
              <small style={styles.breakdownHint}>{t.tipHint}</small>
              <small style={styles.breakdownHint}>{t.commissionHint}</small>
            </section>
          )}

          <section style={styles.touchFilters}>
            <div style={styles.filtersHead}>
              <strong>{t.category}</strong>
              <span>{selectedFilterLabels(rideFilterGroups, rideFilters, lang).length}</span>
            </div>
            <VisualFilterPanel
              compact
              groups={rideFilterGroups}
              lang={lang}
              selection={rideFilters}
              onChange={updateRideFilters}
            />
          </section>

          <label style={styles.toggle}>
            <input checked={lowDataMode} type="checkbox" onChange={(event) => setLowDataMode(event.target.checked)} />
            <span>{t.mode}</span>
          </label>

          <section style={styles.categoryCapsule}>
            <span style={styles.categoryTitle}>{t.payCurrency}</span>
            <div style={styles.categoryStrip}>
              <button
                style={payCurrency === 'SYP' ? styles.categoryActive : styles.categoryButton}
                onClick={() => setPayCurrency('SYP')}
                type="button"
              >
                {t.payCash}
              </button>
              <button
                style={payCurrency === 'USD' ? styles.categoryActive : styles.categoryButton}
                onClick={() => setPayCurrency('USD')}
                type="button"
              >
                {t.payUsd}
              </button>
            </div>
            {payCurrency === 'USD' && <small>{t.usdRoundingNote}</small>}
          </section>

          <div style={styles.stat}>
            <span>{t.distance}</span>
            <strong dir="ltr">
              {quote ? `${quote.distanceKm} km` : '-'} {quote?.estimated ? t.distanceApprox : ''}
            </strong>
          </div>

          <button disabled={status === 'saving'} style={styles.primaryButton} onClick={() => void requestRide()}>
            {status === 'saving'
              ? t.saving
              : isAr
                ? `اختيار ${CATEGORY_LABELS[category] || category} · ${moneyText(fareMinor, payCurrency, lang)}`
                : `Select ${CATEGORY_LABELS[category] || category} · ${moneyText(fareMinor, payCurrency, lang)}`}
          </button>
        </article>

        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.status}</h2>
          <Info label={t.rideId} value={ride ? ride.id.slice(0, 8).toUpperCase() : '-'} />
          <Info label={t.status} value={statusText(ride?.status, lang)} dir={isAr ? 'rtl' : 'ltr'} />
          <Info label={t.driver} value={ride?.driverId ? ride.driverId.slice(0, 8).toUpperCase() : '-'} />
          <Info label={t.pickup} value={String(ride?.metadata.pickup || pickup)} />
          <Info label={t.dropoff} value={String(ride?.metadata.dropoff || dropoff)} />
          <Info label={t.accuracy} value={accuracyMeters ? `${accuracyMeters}m` : isAr ? 'يدوي' : 'manual'} />

          {ride && ['REQUESTED', 'MATCHING'].includes(ride.status) && (
            <div style={styles.message}>{t.waitingForDriver}</div>
          )}
          {ride?.driverId && (
            <div style={styles.message}>{t.driverAssigned}</div>
          )}
          {ride?.pickupPin && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING'].includes(ride.status) && (
            <div style={styles.pickupCode}>
              <span style={styles.pickupCodeLabel}>{t.pickupCode}</span>
              <strong style={styles.pickupCodeValue}>{ride.pickupPin}</strong>
              <span style={styles.pickupCodeHint} dir={isAr ? 'rtl' : 'ltr'}>{t.pickupCodeHint}</span>
            </div>
          )}

          <div style={styles.actions}>
            <button disabled={!ride || status === 'saving'} style={styles.secondaryButton} onClick={() => void refreshRide()}>
              {t.refresh}
            </button>
          </div>

          {message && (
            <div style={{ ...styles.message, ...(status === 'error' ? styles.error : {}) }}>
              {message}
            </div>
          )}

          {ride?.status === 'COMPLETED' && ride.id && (
            <div style={{ marginTop: 12 }}>
              <OpenDisputeForm lang={lang} rideId={ride.id} />
            </div>
          )}
        </article>
      </section>
    </main>
  )
}

function Info({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div style={styles.stat}>
      <span>{label}</span>
      <strong dir={dir}>{value}</strong>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  pickupCode: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '14px 16px', margin: '8px 0', borderRadius: 12, border: '1px solid #2f6fed55', background: 'rgba(47,111,237,.10)' },
  pickupCodeLabel: { fontSize: 13, fontWeight: 700, color: '#2f6fed' },
  pickupCodeValue: { fontSize: 34, letterSpacing: 10, fontWeight: 900, color: '#1b3a8a' },
  pickupCodeHint: { fontSize: 12, color: '#555', textAlign: 'center' },
  page: { minHeight: '100vh', background: '#070b12', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1040, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e2a3c', borderRadius: 8, padding: 18, background: '#101722' },
  eyebrow: { color: '#19d7ff', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: '6px 0', fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, maxWidth: 720, lineHeight: 1.6 },
  driveBanner: { alignItems: 'center', background: 'linear-gradient(135deg, rgba(25,215,255,0.14), #101722)', border: '1px solid rgba(25,215,255,0.35)', borderRadius: 8, display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between', padding: '16px 18px' },
  driveBannerTitle: { color: '#fff', display: 'block', fontSize: 17 },
  driveBannerBody: { color: '#9aa6ba', display: 'block', fontSize: 13.5, marginTop: 4 },
  driveBannerButton: { background: '#19d7ff', border: 0, borderRadius: 8, color: '#06131a', fontWeight: 950, minHeight: 46, padding: '0 20px' },
  grid: { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 12 },
  cardTitle: { fontSize: 22, margin: 0 },
  mapPreview: { minHeight: 170, border: '1px solid #263651', borderRadius: 8, background: 'linear-gradient(135deg,#0c1220,#122033)', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 18, position: 'relative', overflow: 'hidden' },
  dot: { width: 24, height: 24, borderRadius: 999, background: '#19d7ff', boxShadow: '0 0 0 16px rgba(25,215,255,.13), 0 0 36px rgba(25,215,255,.55)' },
  label: { display: 'grid', gap: 7, color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  input: { minHeight: 52, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 14px', fontWeight: 900 },
  categoryCapsule: { border: '1px solid #263651', borderRadius: 8, background: '#070b12', display: 'grid', gap: 10, padding: 12 },
  categoryTitle: { color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  breakdownList: { display: 'grid', gap: 6 },
  breakdownRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#c7d2e0' },
  breakdownRowTotal: { display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 900, color: '#fff', borderTop: '1px solid #263651', paddingTop: 6, marginTop: 2 },
  breakdownHint: { color: '#6b7688', fontSize: 11 },
  testModeBadge: {
    fontSize: 9, fontWeight: 800, letterSpacing: '.04em', color: '#1a1a1a', background: '#f5c451',
    borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase', fontStyle: 'normal', marginInlineStart: 6,
  },
  taxDisclosureBanner: {
    fontSize: 11, fontWeight: 700, color: '#1a1a1a', background: '#f5c451', borderRadius: 6,
    padding: '6px 8px', margin: '4px 0',
  },
  categoryStrip: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' },
  categoryButton: { minHeight: 48, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 12px' },
  categoryActive: { minHeight: 48, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 12px' },
  tierList: { display: 'grid', gap: 8 },
  tierCard: {
    alignItems: 'center', background: '#131e2e', border: '1px solid #263651', borderRadius: 12,
    display: 'grid', gap: 10, gridTemplateColumns: 'auto 1fr auto', minHeight: 64, padding: '10px 14px', textAlign: 'start',
  },
  tierCardActive: {
    alignItems: 'center', background: '#0d2733', border: '1.5px solid #19d7ff', borderRadius: 12,
    boxShadow: '0 0 0 1px rgba(25,215,255,.25)', display: 'grid', gap: 10, gridTemplateColumns: 'auto 1fr auto',
    minHeight: 64, padding: '10px 14px', textAlign: 'start',
  },
  tierIcon: { fontSize: 26 },
  tierInfo: { display: 'grid', gap: 2 },
  tierCapacity: { color: '#9aa6ba', fontSize: 12, fontWeight: 700 },
  tierMeta: { display: 'grid', gap: 2, justifyItems: 'end', textAlign: 'end' },
  tierEta: { color: '#34d399', fontSize: 12, fontWeight: 800 },
  tierEtaNone: { color: '#6b7688', fontSize: 12, fontWeight: 700 },
  touchFilters: { border: '1px solid #263651', borderRadius: 18, background: '#070b12', padding: 12, display: 'grid', gap: 10 },
  filtersHead: { alignItems: 'center', color: '#fff', display: 'flex', justifyContent: 'space-between', gap: 12 },
  toggle: { minHeight: 52, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', fontWeight: 900 },
  stat: { border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#9aa6ba', display: 'flex', justifyContent: 'space-between', gap: 12, padding: 12 },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 14px' },
  secondaryButton: { minHeight: 48, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 14px' },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' },
  message: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 12, fontWeight: 900 },
  error: { borderColor: 'rgba(255,96,96,.45)', background: 'rgba(255,96,96,.1)', color: '#ffd1d1' },
}
