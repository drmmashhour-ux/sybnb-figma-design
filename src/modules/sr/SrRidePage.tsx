import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { srRideFilterGroupsFromConfig, type VisualFilterSelection } from '../../engines/filters'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createPrototypeSrRide,
  fetchPrototypeSrRide,
  fetchPrototypeWallet,
  fetchSrQuote,
  fetchSrRideHistory,
  fetchSrRideLocation,
  fetchSrRoute,
  type PlatformRideRequest,
  type PlatformSrQuote,
  type PlatformSrRoute,
} from '../../shared/api/platformApi'
import { SrTripMap } from './SrTripMap'
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
    title: 'سير',
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
    km: 'كم',
    min: 'دقيقة',
    approx: 'تقديري',
    myRides: 'رحلاتي',
    noRides: 'لا رحلات بعد',
    walletBalance: 'رصيد المحفظة',
    needTopUp: 'رصيدك لا يكفي هذه الرحلة — اشحن محفظتك للمتابعة.',
    topUp: 'اشحن المحفظة',
    accuracy: 'دقة الموقع',
    saved: 'تم حفظ الرحلة',
    error: 'تعذر تنفيذ طلب SR',
    saving: 'جار الحفظ',
    gps: 'استخدام موقعي الحالي',
    manualHint: 'يمكن متابعة الطلب حتى بدون GPS عبر العناوين اليدوية.',
    waitingForDriver: 'بانتظار قبول أحد السائقين القريبين للرحلة...',
    driverAssigned: 'تم تعيين سائق لرحلتك.',
  },
  en: {
    back: 'Back to landing',
    title: 'SR Ride',
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
    km: 'km',
    min: 'min',
    approx: 'approx.',
    myRides: 'My rides',
    noRides: 'No rides yet',
    walletBalance: 'Wallet balance',
    needTopUp: 'Your balance is not enough for this ride — top up to continue.',
    topUp: 'Top up wallet',
    accuracy: 'Accuracy',
    saved: 'Ride saved',
    error: 'Could not complete SR request',
    saving: 'Saving',
    gps: 'Use my current location',
    manualHint: 'The request can continue without GPS through manual addresses.',
    waitingForDriver: 'Waiting for a nearby driver to accept the ride...',
    driverAssigned: 'A driver has been assigned to your ride.',
  },
}

const ACTIVE_RIDE_ID_KEY = 'sybnb.v6.activeSrRideId'

const categories = ['SR Economy', 'SR Comfort', 'SR SUV', 'SR XXL']

const rideCategoryByFilter: Record<string, string> = {
  economy: 'SR Economy',
  comfort: 'SR Comfort',
  premium: 'SR Comfort',
  familyVan: 'SR XXL',
}

export function SrRidePage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [pickup, setPickup] = useState(isAr ? 'دمشق، المالكي' : 'Damascus, Malki')
  const [dropoff, setDropoff] = useState(isAr ? 'دمشق، المزة' : 'Damascus, Mezzeh')
  const [category, setCategory] = useState(categories[0])
  // SR is SYP-only for riders (guests only ever get a SYP wallet) — the fare/charge currency is fixed.
  const [payCurrency] = useState<'SYP' | 'USD'>('SYP')
  const [lowDataMode, setLowDataMode] = useState(true)
  const [accuracyMeters, setAccuracyMeters] = useState<number | undefined>()
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | undefined>()
  const [ride, setRide] = useState<PlatformRideRequest | null>(null)
  const [quote, setQuote] = useState<PlatformSrQuote | null>(null)
  const [route, setRoute] = useState<PlatformSrRoute | null>(null)
  const [driverLoc, setDriverLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [history, setHistory] = useState<PlatformRideRequest[]>([])
  const [balanceMinor, setBalanceMinor] = useState<number | null>(null)
  const [rideFilters, setRideFilters] = useState<VisualFilterSelection>({
    srRideCategory: 'economy',
    srRideRoute: 'cityRide',
    srRideFeatures: ['instantConfirm', 'verifiedDriver', 'ac'],
    payments: ['localWallet'],
  })
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const rideFilterGroups = useMemo(() => srRideFilterGroupsFromConfig(), [])

  // Placeholder fare shown before the real quote resolves — derived from the SERVER rate table
  // (base + perKm·~5km) so it's in the right ballpark, not the old ~3× overstatement.
  const fallbackFareSypMinor = useMemo(() => {
    const base = category === 'SR XXL' ? 36000 : category === 'SR SUV' ? 27000 : category === 'SR Comfort' ? 18500 : 12500
    return lowDataMode ? base : base + 2500
  }, [category, lowDataMode])
  const fallbackFareMinor = payCurrency === 'USD' ? sypMinorToRoundedUsdMinor(fallbackFareSypMinor) : fallbackFareSypMinor

  const fareMinor = quote?.fareMinor ?? fallbackFareMinor
  // SR is a cashless-wallet flow: a rider can only be charged from their (SYP) wallet, so the request is
  // gated on funds. Guests get a SYP wallet only, so SR pricing/paying is SYP (the USD toggle is hidden).
  const underfunded = balanceMinor != null && fareMinor > balanceMinor

  useEffect(() => {
    if (ride) return
    const timer = window.setTimeout(() => {
      fetchSrQuote({ pickup, dropoff, category, currency: payCurrency, lowDataMode, pickupCoords }).then(setQuote).catch(() => setQuote(null))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [pickup, dropoff, category, payCurrency, lowDataMode, pickupCoords, ride])

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

  // Live trip map: fetch the real road route (OSRM → polyline + ETA) whenever the pickup/dropoff coords
  // resolve. Quote coords drive it before booking; the map stays in sync as the rider adjusts.
  const pickupPoint = quote?.pickupCoords ?? (pickupCoords ?? null)
  const dropoffPoint = quote?.dropoffCoords ?? null
  useEffect(() => {
    if (!pickupPoint || !dropoffPoint) {
      setRoute(null)
      return
    }
    let cancelled = false
    fetchSrRoute({ pickupCoords: pickupPoint, dropoffCoords: dropoffPoint })
      .then((r) => !cancelled && setRoute(r))
      .catch(() => !cancelled && setRoute(null))
    return () => {
      cancelled = true
    }
  }, [pickupPoint?.lat, pickupPoint?.lng, dropoffPoint?.lat, dropoffPoint?.lng])

  // Rider trip history — refreshed on mount and whenever the active ride's status changes (so a just-
  // completed trip appears without a manual reload).
  useEffect(() => {
    fetchSrRideHistory()
      .then(setHistory)
      .catch(() => {})
  }, [ride?.status])

  // Rider's SYP wallet balance — for the fund gate + a top-up prompt (refreshed when a ride settles).
  useEffect(() => {
    fetchPrototypeWallet()
      .then((wallets) => setBalanceMinor(wallets.find((w) => w.currency === 'SYP')?.cachedBalanceMinor ?? 0))
      .catch(() => setBalanceMinor(null))
  }, [ride?.status])

  // Poll the driver's live GPS position for the moving marker, once a driver is assigned and en route.
  useEffect(() => {
    const trackable = ride?.driverId && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS'].includes(ride.status)
    if (!trackable) {
      setDriverLoc(null)
      return
    }
    const poll = () =>
      fetchSrRideLocation(ride!.id)
        .then((r) => setDriverLoc(r.location ? { lat: r.location.lat, lng: r.location.lng } : null))
        .catch(() => {})
    poll()
    const interval = window.setInterval(poll, 5000)
    return () => window.clearInterval(interval)
  }, [ride?.id, ride?.status, ride?.driverId])

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
        <p style={styles.eyebrow}>SR / SYBNB</p>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <div style={styles.mapPreview}>
            {pickupPoint && dropoffPoint ? (
              <>
                <SrTripMap pickup={pickupPoint} dropoff={dropoffPoint} driver={driverLoc} route={route?.geometry ?? null} height={240} />
                {route && route.distanceKm != null ? (
                  <p style={styles.routeMeta} dir="ltr">
                    🛣️ {route.distanceKm} {t.km} · ⏱️ {route.durationMin} {t.min}
                    {route.source !== 'osrm' ? ` · ${t.approx}` : ''}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <span style={styles.dot} />
                <strong>{t.location}</strong>
                <p>{t.manualHint}</p>
              </>
            )}
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
            <div style={styles.categoryStrip}>
              {categories.map((item) => (
                <button
                  key={item}
                  style={item === category ? styles.categoryActive : styles.categoryButton}
                  onClick={() => setCategory(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </section>

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

          <div style={styles.stat}>
            <span>{t.distance}</span>
            <strong dir="ltr">
              {quote ? `${quote.distanceKm} km` : '-'} {quote?.estimated ? t.distanceApprox : ''}
            </strong>
          </div>

          <div style={styles.stat}>
            <span>{t.fare}</span>
            <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(fareMinor, payCurrency, lang)}</strong>
          </div>

          {/* Cashless: SR is paid from the rider's SYBNB (SYP) wallet — show the balance + gate the
              request on funds so we never dead-end on a 402. */}
          <div style={{ ...styles.stat, ...(underfunded ? styles.statLow : null) }}>
            <span>{t.walletBalance}</span>
            <strong dir="ltr">{balanceMinor != null ? moneyText(balanceMinor, 'SYP', lang) : '—'}</strong>
          </div>

          {underfunded ? (
            <>
              <p style={styles.underfundedNote}>{t.needTopUp}</p>
              <button style={styles.topupButton} type="button" onClick={() => (window.location.hash = '/wallet')}>
                {t.topUp}
              </button>
            </>
          ) : (
            <button disabled={status === 'saving'} style={styles.primaryButton} onClick={() => void requestRide()}>
              {status === 'saving' ? t.saving : t.request}
            </button>
          )}
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

      <section style={styles.historySection}>
        <h2 style={styles.historyTitle}>{t.myRides}</h2>
        {history.length === 0 ? (
          <p style={styles.historyEmpty}>{t.noRides}</p>
        ) : (
          <ul style={styles.historyList}>
            {history.map((h) => (
              <li key={h.id} style={styles.historyItem}>
                <div style={styles.historyRoute}>
                  <span>
                    {String(h.metadata.pickup || '-')} → {String(h.metadata.dropoff || '-')}
                  </span>
                  <time dir="ltr" style={styles.historyDate}>
                    {new Date(h.requestedAt).toLocaleString(isAr ? 'ar-SY' : 'en-US')}
                  </time>
                </div>
                <div style={styles.historyMeta}>
                  <b dir="ltr">{moneyText(h.fareMinor || 0, h.currency, lang)}</b>
                  <span style={styles.historyStatus}>{statusText(h.status, lang)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
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
  grid: { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 16, display: 'grid', gap: 12 },
  cardTitle: { fontSize: 22, margin: 0 },
  mapPreview: { minHeight: 170, border: '1px solid #263651', borderRadius: 8, background: 'linear-gradient(135deg,#0c1220,#122033)', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 18, position: 'relative', overflow: 'hidden' },
  routeMeta: { margin: '10px 0 0', color: '#20d29b', fontWeight: 800, fontSize: 14, letterSpacing: '.02em' },
  historySection: { marginTop: 24, borderTop: '1px solid #1e2a3c', paddingTop: 18 },
  historyTitle: { margin: '0 0 12px', fontSize: 18, color: '#e6ebf4' },
  historyEmpty: { color: '#8f96a8', fontSize: 14, margin: 0 },
  historyList: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 },
  historyItem: { border: '1px solid #1e2a3c', borderRadius: 12, background: '#0b0d14', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  historyRoute: { display: 'grid', gap: 3 },
  historyDate: { color: '#8f96a8', fontSize: 12 },
  historyMeta: { display: 'grid', gap: 3, textAlign: 'end' },
  historyStatus: { color: '#20d29b', fontSize: 12, fontWeight: 700 },
  dot: { width: 24, height: 24, borderRadius: 999, background: '#19d7ff', boxShadow: '0 0 0 16px rgba(25,215,255,.13), 0 0 36px rgba(25,215,255,.55)' },
  label: { display: 'grid', gap: 7, color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  input: { minHeight: 52, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', padding: '0 14px', fontWeight: 900 },
  categoryCapsule: { border: '1px solid #263651', borderRadius: 8, background: '#070b12', display: 'grid', gap: 10, padding: 12 },
  categoryTitle: { color: '#9aa6ba', fontSize: 12, fontWeight: 900 },
  categoryStrip: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' },
  categoryButton: { minHeight: 48, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 12px' },
  categoryActive: { minHeight: 48, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 12px' },
  touchFilters: { border: '1px solid #263651', borderRadius: 18, background: '#070b12', padding: 12, display: 'grid', gap: 10 },
  filtersHead: { alignItems: 'center', color: '#fff', display: 'flex', justifyContent: 'space-between', gap: 12 },
  toggle: { minHeight: 52, border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', fontWeight: 900 },
  stat: { border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#9aa6ba', display: 'flex', justifyContent: 'space-between', gap: 12, padding: 12 },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 14px' },
  statLow: { borderColor: '#f7c05b', background: '#1a1204' },
  underfundedNote: { color: '#f7c05b', fontSize: 13, margin: '4px 0 0' },
  topupButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#f59e0b', color: '#1a1204', fontWeight: 950, padding: '0 14px', cursor: 'pointer' },
  secondaryButton: { minHeight: 48, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 14px' },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' },
  message: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 12, fontWeight: 900 },
  error: { borderColor: 'rgba(255,96,96,.45)', background: 'rgba(255,96,96,.1)', color: '#ffd1d1' },
}
