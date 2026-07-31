import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  claimPrototypeSrRide,
  fetchDriverDocuments,
  fetchDriverVehicles,
  fetchPendingSrRides,
  fetchPrototypeDriverOverview,
  updatePrototypeDriverRideStatus,
  verifyDriverPickupPin,
  type PlatformDriverDocument,
  type PlatformDriverOverview,
  type PlatformDriverVehicle,
  type PlatformRideRequest,
} from '../../shared/api/platformApi'
import { moneyText, statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'لوحة سائق SR',
    subtitle: 'الرحلات المسندة للسائق وحالات التنفيذ مباشرة من قاعدة البيانات.',
    refresh: 'تحديث',
    loading: 'جار التحميل',
    saving: 'جار الحفظ',
    error: 'تعذر تحميل رحلات السائق',
    assigned: 'مسندة',
    active: 'نشطة',
    completed: 'مكتملة',
    earnings: 'إيراد مكتمل',
    rider: 'الراكب',
    pickup: 'الانطلاق',
    dropoff: 'الوجهة',
    status: 'الحالة',
    fare: 'الأجرة',
    arriving: 'في الطريق',
    start: 'بدء الرحلة',
    complete: 'إنهاء',
    cancel: 'إلغاء',
    pickupCodeLabel: 'رمز الانطلاق من الراكب',
    pickupCodePlaceholder: 'أدخل الرمز المكوّن من 4 أرقام',
    verifyPickup: 'تأكيد الرمز وبدء الرحلة',
    verifying: 'جار التحقق...',
    myVehicles: 'مركباتي',
    empty: 'لا توجد رحلات مسندة بعد.',
    dispatch: 'مركز التوجيه',
    safety: 'أمان الرحلة',
    routeConfidence: 'ثقة المسار',
    payout: 'صرف السائق',
    nextBest: 'أفضل إجراء',
    nextBestText: 'ابدأ بالرحلات النشطة، ثم حدّث الحالة فور الوصول لتفعيل ثقة العميل.',
    openOperations: 'فتح العمليات',
    openFinance: 'فتح المالية',
    connected: 'متصل',
    disconnected: 'غير متصل',
    available: 'متاح',
    accept: 'قبول',
    pendingEmpty: 'لا توجد طلبات رحلات بانتظار سائق الآن.',
    pendingLoading: 'جار البحث عن طلبات قريبة...',
    claiming: 'جار القبول...',
    claimError: 'تعذر قبول الرحلة، ربما قبلها سائق آخر للتو.',
    distance: 'المسافة',
    docsStatus: 'حالة الأمان والوثائق',
    verifiedIdentity: 'الهوية الموثقة',
    idApproved: 'موثقة',
    idPendingReview: 'قيد المراجعة',
    idRejected: 'مرفوضة',
    idNotSubmitted: 'لم تُرفع بعد',
    roadReadyTitle: 'الجاهزية لاستقبال الرحلات',
    roadReadyYes: 'جاهز — يمكنك استقبال الرحلات.',
    roadReadyNo: 'غير جاهز — أكمل العناصر أدناه لاستقبال الرحلات.',
    reqLicense: 'رخصة القيادة',
    reqRegistration: 'دفتر المركبة',
    reqVehicle: 'مركبة معتمدة',
    manageVehicles: 'إدارة المركبات',
    checkYes: '✓',
    checkNo: '✗',
    todayEarnings: 'أرباح اليوم',
    todayRidesCount: 'رحلة مكتملة اليوم',
    reportIssue: 'إبلاغ عن مشكلة',
    sos: 'طوارئ SOS',
  },
  en: {
    back: 'Back to landing',
    title: 'SR Driver Dashboard',
    subtitle: 'Assigned driver rides and live execution states directly from PostgreSQL.',
    refresh: 'Refresh',
    loading: 'Loading',
    saving: 'Saving',
    error: 'Could not load driver rides',
    assigned: 'Assigned',
    active: 'Active',
    completed: 'Completed',
    earnings: 'Completed earnings',
    rider: 'Rider',
    pickup: 'Pickup',
    dropoff: 'Dropoff',
    status: 'Status',
    fare: 'Fare',
    arriving: 'Arriving',
    start: 'Start ride',
    complete: 'Complete',
    cancel: 'Cancel',
    pickupCodeLabel: 'Rider pickup code',
    pickupCodePlaceholder: 'Enter the 4-digit code',
    verifyPickup: 'Confirm code & start trip',
    verifying: 'Verifying…',
    myVehicles: 'My vehicles',
    empty: 'No assigned rides yet.',
    dispatch: 'Dispatch center',
    safety: 'Ride safety',
    routeConfidence: 'Route confidence',
    payout: 'Driver payout',
    nextBest: 'Best next action',
    nextBestText: 'Start with active rides, then update arrival state immediately to increase rider confidence.',
    openOperations: 'Open operations',
    openFinance: 'Open finance',
    connected: 'Connected',
    disconnected: 'Offline',
    available: 'Available',
    accept: 'Accept',
    pendingEmpty: 'No ride requests waiting for a driver right now.',
    pendingLoading: 'Looking for nearby requests...',
    claiming: 'Claiming...',
    claimError: 'Could not claim this ride, another driver may have just accepted it.',
    distance: 'Distance',
    docsStatus: 'Safety and document status',
    verifiedIdentity: 'Verified identity',
    idApproved: 'Verified',
    idPendingReview: 'Pending review',
    idRejected: 'Rejected',
    idNotSubmitted: 'Not submitted yet',
    roadReadyTitle: 'Ready to receive rides',
    roadReadyYes: 'Road-ready — you can receive rides.',
    roadReadyNo: 'Not road-ready — complete the items below to receive rides.',
    reqLicense: 'Driver license',
    reqRegistration: 'Vehicle registration',
    reqVehicle: 'Approved vehicle',
    manageVehicles: 'Manage vehicles',
    checkYes: '✓',
    checkNo: '✗',
    todayEarnings: 'Today earnings',
    todayRidesCount: 'completed rides today',
    reportIssue: 'Report issue',
    sos: 'SOS emergency',
  },
}

export function DriverDashboardPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [overview, setOverview] = useState<PlatformDriverOverview | null>(null)
  const [documents, setDocuments] = useState<PlatformDriverDocument[]>([])
  const [vehicles, setVehicles] = useState<PlatformDriverVehicle[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [activeRideId, setActiveRideId] = useState('')
  const [pendingRides, setPendingRides] = useState<PlatformRideRequest[]>([])
  const [pendingStatus, setPendingStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [claimingRideId, setClaimingRideId] = useState('')
  const [claimError, setClaimError] = useState('')

  useEffect(() => {
    void loadOverview()
    void loadPendingRides()
    const interval = window.setInterval(() => void loadPendingRides(), 6000)
    return () => window.clearInterval(interval)
  }, [])

  async function loadPendingRides() {
    try {
      setPendingRides(await fetchPendingSrRides())
      setPendingStatus('ready')
    } catch {
      setPendingStatus('error')
    }
  }

  async function claimRide(rideId: string) {
    setClaimingRideId(rideId)
    setClaimError('')

    try {
      await claimPrototypeSrRide(rideId)
      await Promise.all([loadOverview(), loadPendingRides()])
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : t.claimError)
      await loadPendingRides()
    } finally {
      setClaimingRideId('')
    }
  }

  const stats = useMemo(
    () => [
      { label: t.assigned, value: String(overview?.totals.assigned || 0) },
      { label: t.active, value: String(overview?.totals.active || 0) },
      { label: t.completed, value: String(overview?.totals.completed || 0) },
      { label: t.earnings, value: moneyText(overview?.totals.earningsMinor || 0, 'SYP', lang) },
    ],
    [lang, overview, t],
  )

  async function loadOverview() {
    setStatus('loading')
    setMessage('')

    try {
      setOverview(await fetchPrototypeDriverOverview())
      setStatus('ready')
      // Road-ready readiness inputs (best-effort — don't fail the dashboard if these error).
      void fetchDriverDocuments().then(setDocuments).catch(() => setDocuments([]))
      void fetchDriverVehicles().then(setVehicles).catch(() => setVehicles([]))
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  // Pickup PIN (017): verify the rider's 4-digit code, then start the trip (IN_PROGRESS). Returns the
  // error message on failure so the card can show it inline (e.g. "code does not match").
  async function verifyPickupAndStart(rideId: string, pin: string): Promise<string | null> {
    setMessage('')
    try {
      await verifyDriverPickupPin(rideId, pin)
      await updatePrototypeDriverRideStatus(rideId, 'IN_PROGRESS')
      setOverview(await fetchPrototypeDriverOverview())
      return null
    } catch (error) {
      return error instanceof Error && error.message ? error.message : t.error
    }
  }

  async function updateRide(rideId: string, nextStatus: 'DRIVER_ARRIVING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') {
    setStatus('saving')
    setActiveRideId(rideId)
    setMessage('')

    try {
      await updatePrototypeDriverRideStatus(rideId, nextStatus)
      setOverview(await fetchPrototypeDriverOverview())
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    } finally {
      setActiveRideId('')
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <section style={styles.driverTop}>
        {/* Availability toggle removed: it was a fake control (no online/offline state exists).
            A real go-online/offline switch needs a driver-availability field + endpoint in the
            SR division, which is frozen under the STR-first plan — flagged separately. */}
        <h1 style={styles.driverTitle}>{t.title}</h1>
      </section>

      <section style={styles.hero}>
        <p style={styles.eyebrow}>SR / SYBNB</p>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
        <div style={styles.stats}>
          {stats.map((item) => (
            <div key={item.label} style={styles.statBox}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
        <div style={styles.actions}>
          <button style={styles.primaryButton} onClick={() => void loadOverview()}>
            {status === 'loading' ? t.loading : t.refresh}
          </button>
          <button style={styles.secondaryButton} onClick={() => (window.location.hash = '/driver/vehicles')}>
            {t.myVehicles}
          </button>
        </div>
      </section>

      {status === 'error' && <section style={styles.alert}>{message}</section>}

      <section style={styles.dispatchPanel}>
        <article style={styles.dispatchHero}>
          <span>{t.available}</span>
          <strong>{t.dispatch}</strong>
          {claimError && <p style={styles.insuranceWarning}>{claimError}</p>}
          <div style={styles.offerGrid}>
            {pendingRides.length === 0 ? (
              <p style={{ color: '#9aa6ba' }}>{pendingStatus === 'loading' ? t.pendingLoading : t.pendingEmpty}</p>
            ) : (
              pendingRides.map((pendingRide) => (
                <article key={pendingRide.id} style={styles.offerCard}>
                  <span>{String(pendingRide.metadata.dropoff || '-')}</span>
                  <b dir="ltr">{moneyText(pendingRide.fareMinor || 0, pendingRide.currency, lang)}</b>
                  <i dir="ltr">
                    {pendingRide.metadata.distanceKm ? `${pendingRide.metadata.distanceKm} km` : ''}
                  </i>
                  <button disabled={claimingRideId === pendingRide.id} onClick={() => void claimRide(pendingRide.id)}>
                    {claimingRideId === pendingRide.id ? t.claiming : t.accept}
                  </button>
                </article>
              ))
            )}
          </div>
        </article>
      </section>

      <section style={styles.driverIntelligence}>
        <article style={styles.docsPanel}>
          <h2>{t.docsStatus}</h2>
          {(() => {
            const idOk = overview?.driver.idDocumentStatus === 'APPROVED'
            const licenseOk = documents.some((d) => d.type === 'LICENSE' && d.status === 'APPROVED')
            const registrationOk = documents.some((d) => d.type === 'VEHICLE_REGISTRATION' && d.status === 'APPROVED')
            const vehicleOk = vehicles.some((v) => v.status === 'APPROVED')
            const roadReady = idOk && licenseOk && registrationOk && vehicleOk
            const mark = (ok: boolean) => (ok ? t.checkYes : t.checkNo)
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={roadReady ? styles.roadReadyOk : styles.roadReadyNo}>
                  {roadReady ? t.roadReadyYes : t.roadReadyNo}
                </div>
                <Info label={t.verifiedIdentity} value={`${mark(idOk)} ${idDocumentStatusText(overview?.driver.idDocumentStatus, t)}`} dir={isAr ? 'rtl' : 'ltr'} />
                <Info label={t.reqLicense} value={mark(licenseOk)} />
                <Info label={t.reqRegistration} value={mark(registrationOk)} />
                <Info label={t.reqVehicle} value={mark(vehicleOk)} />
                <button style={styles.secondaryButton} onClick={() => (window.location.hash = '/driver/vehicles')}>{t.manageVehicles}</button>
              </div>
            )
          })()}
        </article>
        <article style={styles.docsPanel}>
          <h2>{t.todayEarnings}</h2>
          <Info label={t.todayEarnings} value={moneyText(overview?.totals.todayEarningsMinor || 0, 'SYP', lang)} dir={lang === 'ar' ? 'rtl' : 'ltr'} />
          <Info label={t.todayRidesCount} value={String(overview?.totals.todayCompletedCount || 0)} />
        </article>
      </section>

      <section style={styles.driverCtas}>
        <button style={styles.sosButton} onClick={() => (window.location.hash = '/trust-center/sos')}>{t.sos}</button>
        <button style={styles.reportButton} onClick={() => (window.location.hash = '/immocontact')}>{t.reportIssue}</button>
        <button style={styles.startButton} onClick={() => (window.location.hash = '/ride')}>{t.start}</button>
      </section>

      <section style={styles.dispatchPanel}>
        <article style={styles.dispatchActions}>
          <strong>{t.nextBest}</strong>
          <p>{t.nextBestText}</p>
          <div style={styles.actions}>
            <button style={styles.secondaryButton} onClick={() => (window.location.hash = '/operations')}>{t.openOperations}</button>
            <button style={styles.primaryButton} onClick={() => (window.location.hash = '/finance')}>{t.openFinance}</button>
          </div>
        </article>
      </section>

      <section style={styles.grid}>
        {overview?.rides.length ? (
          overview.rides.map((ride) => (
            <RideCard
              key={ride.id}
              ride={ride}
              lang={lang}
              labels={t}
              disabled={activeRideId === ride.id || status === 'saving'}
              onUpdate={(nextStatus) => void updateRide(ride.id, nextStatus)}
              onVerifyPin={(pin) => verifyPickupAndStart(ride.id, pin)}
            />
          ))
        ) : (
          <section style={styles.panel}>{status === 'loading' ? t.loading : t.empty}</section>
        )}
      </section>
    </main>
  )
}

function RideCard({
  ride,
  lang,
  labels,
  disabled,
  onUpdate,
  onVerifyPin,
}: {
  ride: PlatformRideRequest
  lang: Lang
  labels: typeof copy.en
  disabled: boolean
  onUpdate: (status: 'DRIVER_ARRIVING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') => void
  onVerifyPin: (pin: string) => Promise<string | null>
}) {
  const [pin, setPin] = useState('')
  const [pinState, setPinState] = useState<'idle' | 'verifying'>('idle')
  const [pinError, setPinError] = useState('')
  // The pickup code is entered once the driver is at the rider (assigned / arriving) to start the trip.
  const atPickup = ride.status === 'DRIVER_ASSIGNED' || ride.status === 'DRIVER_ARRIVING'

  async function submitPin() {
    if (pin.trim().length !== 4) return
    setPinState('verifying')
    setPinError('')
    const err = await onVerifyPin(pin.trim())
    setPinState('idle')
    if (err) setPinError(err)
    else setPin('')
  }

  return (
    <article style={styles.card}>
      <strong>{String(ride.metadata.category || ride.id.slice(0, 8).toUpperCase())}</strong>
      <Info label={labels.rider} value={ride.rider?.displayName || ride.riderId.slice(0, 8).toUpperCase()} />
      <Info label={labels.pickup} value={String(ride.metadata.pickup || '-')} />
      <Info label={labels.dropoff} value={String(ride.metadata.dropoff || '-')} />
      <Info label={labels.status} value={statusText(ride.status, lang)} dir={lang === 'ar' ? 'rtl' : 'ltr'} />
      <Info label={labels.fare} value={moneyText(ride.fareMinor || 0, ride.currency, lang)} dir={lang === 'ar' ? 'rtl' : 'ltr'} />
      {atPickup && (
        <div style={styles.pinBox}>
          <span style={styles.pinLabel}>{labels.pickupCodeLabel}</span>
          <div style={styles.actions}>
            <input
              style={styles.pinInput}
              inputMode="numeric"
              maxLength={4}
              value={pin}
              placeholder={labels.pickupCodePlaceholder}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <button
              disabled={disabled || pinState === 'verifying' || pin.trim().length !== 4}
              style={styles.primaryButton}
              onClick={() => void submitPin()}
            >
              {pinState === 'verifying' ? labels.verifying : labels.verifyPickup}
            </button>
          </div>
          {pinError && <span style={styles.pinError} role="alert">{pinError}</span>}
        </div>
      )}
      {ride.status !== 'COMPLETED' && ride.status !== 'CANCELLED' && (
        <div style={styles.actions}>
          <button disabled={disabled} style={styles.secondaryButton} onClick={() => onUpdate('DRIVER_ARRIVING')}>
            {labels.arriving}
          </button>
          <button disabled={disabled} style={styles.primaryButton} onClick={() => onUpdate('COMPLETED')}>
            {labels.complete}
          </button>
          <button disabled={disabled} style={styles.dangerButton} onClick={() => onUpdate('CANCELLED')}>
            {labels.cancel}
          </button>
        </div>
      )}
    </article>
  )
}

function idDocumentStatusText(status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null | undefined, t: typeof copy.ar) {
  if (status === 'APPROVED') return t.idApproved
  if (status === 'PENDING_REVIEW') return t.idPendingReview
  if (status === 'REJECTED') return t.idRejected
  return t.idNotSubmitted
}

function Info({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div style={styles.info}>
      <span>{label}</span>
      <b dir={dir}>{value}</b>
    </div>
  )
}

function DispatchItem({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <article style={{ ...styles.dispatchItem, borderColor: `${tone}66` }}>
      <span>{label}</span>
      <strong style={{ color: tone }}>{value}</strong>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 22, maxWidth: 1120, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #263651', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  driverTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  availability: { border: '1px solid #1d2433', borderRadius: 999, background: '#11131c', display: 'flex', padding: 5 },
  availableButton: { border: 0, borderRadius: 999, background: '#20d29b', color: '#04100d', fontWeight: 950, minHeight: 48, padding: '0 22px' },
  offlineButton: { border: 0, borderRadius: 999, background: 'transparent', color: '#8f96a8', fontWeight: 900, minHeight: 48, padding: '0 22px' },
  driverTitle: { margin: 0, fontSize: 34 },
  hero: { border: '1px solid #1e2a3c', borderRadius: 8, padding: 18, background: '#101722', display: 'grid', gap: 14 },
  eyebrow: { color: '#19d7ff', letterSpacing: 2, fontWeight: 900, fontSize: 11, margin: 0 },
  title: { margin: 0, fontSize: 38, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  stats: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  statBox: { border: '1px solid #263651', borderRadius: 8, background: '#070b12', color: '#9aa6ba', display: 'grid', gap: 4, padding: 12 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' },
  dispatchPanel: { display: 'grid', gap: 12 },
  dispatchHero: { border: '1px solid rgba(82,108,255,.9)', borderRadius: 14, background: '#101119', padding: 28, display: 'grid', gap: 24 },
  offerGrid: { display: 'grid', gap: 18, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  offerCard: { border: '1px solid #1e2a3c', borderRadius: 14, background: '#0b0d14', padding: 16, display: 'grid', gap: 10 },
  driverIntelligence: { display: 'grid', gap: 34, gridTemplateColumns: '1fr 1fr' },
  docsPanel: { border: '1px solid #1e2a3c', borderRadius: 14, background: '#101119', padding: 24, display: 'grid', gap: 12 },
  insuranceWarning: { borderRadius: 10, background: 'rgba(255,82,116,.18)', color: '#ff8aa0', padding: 14, margin: 0, fontWeight: 900 },
  driverCtas: { display: 'grid', gap: 28, gridTemplateColumns: '1fr 1fr 1fr' },
  sosButton: { border: 0, borderRadius: 12, background: '#ff5274', color: '#06070c', fontWeight: 950, minHeight: 72, fontSize: 22 },
  reportButton: { border: '1px solid #30384d', borderRadius: 12, background: '#0b0d14', color: '#fff', fontWeight: 950, minHeight: 72, fontSize: 22 },
  startButton: { border: 0, borderRadius: 12, background: '#526cff', color: '#06110e', fontWeight: 950, minHeight: 72, fontSize: 22 },
  dispatchItem: { border: '1px solid #263651', borderRadius: 8, background: '#101722', padding: 14, display: 'grid', gap: 6 },
  dispatchActions: { border: '1px solid #263651', borderRadius: 8, background: '#101722', padding: 14, display: 'grid', gap: 8 },
  card: { border: '1px solid #1e2a3c', borderRadius: 8, background: '#101722', padding: 14, display: 'grid', gap: 10 },
  info: { borderTop: '1px solid #263651', display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba', paddingTop: 9 },
  actions: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' },
  primaryButton: { minHeight: 44, border: 0, borderRadius: 8, background: '#19d7ff', color: '#051014', fontWeight: 950, padding: '0 12px' },
  secondaryButton: { minHeight: 44, border: '1px solid #263651', borderRadius: 8, background: '#131e2e', color: '#fff', fontWeight: 900, padding: '0 12px' },
  dangerButton: { minHeight: 44, border: '1px solid rgba(255,96,96,.5)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ffd1d1', fontWeight: 900, padding: '0 12px' },
  pinBox: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10, border: '1px solid #2a3a55', background: 'rgba(120,160,255,.08)' },
  pinLabel: { fontSize: 13, color: '#cfe0ff', fontWeight: 700 },
  pinInput: { minHeight: 44, width: 130, letterSpacing: 4, textAlign: 'center', fontSize: 18, fontWeight: 900, border: '1px solid #35507d', borderRadius: 8, background: '#0d1826', color: '#fff' },
  pinError: { fontSize: 13, color: '#ffd1d1' },
  roadReadyOk: { fontSize: 13, fontWeight: 800, color: '#22d28f', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(34,210,143,.35)', background: 'rgba(34,210,143,.1)' },
  roadReadyNo: { fontSize: 13, fontWeight: 800, color: '#ffd166', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,209,102,.35)', background: 'rgba(255,209,102,.08)' },
  panel: { border: '1px solid #263651', borderRadius: 8, background: '#101722', color: '#9aa6ba', padding: 14 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
}
