import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchPrototypeHostEarnings,
  type HostDashboardMode,
  type PlatformHostEarnings,
} from '../../shared/api/platformApi'
import { moneyText, statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
  mode?: HostDashboardMode
}

const copy = {
  ar: {
    back: 'العودة للوحة الاستضافة',
    title: 'تقرير الأرباح',
    subtitle: 'كل رقم هنا محسوب مباشرة من الحجوزات والدفعات الفعلية.',
    loading: 'جار التحميل...',
    error: 'تعذر تحميل تقرير الأرباح.',
    forecasted: 'متوقع (حجوزات مؤكدة لم تكتمل بعد)',
    earned: 'مكتمل',
    released: 'تم الصرف',
    pending: 'بانتظار الصرف',
    empty: 'لا توجد حجوزات بعد.',
    listing: 'الإعلان',
    dates: 'التواريخ',
    status: 'الحالة',
    hostGross: 'صافي المضيف',
    payoutStatus: 'حالة الصرف',
    eligibleAt: 'تاريخ الأهلية',
    statusPENDING_HOLD: 'ضمن فترة الحجز',
    statusELIGIBLE: 'جاهز للصرف',
    statusRELEASED: 'تم الصرف',
  },
  en: {
    back: 'Back to host dashboard',
    title: 'Earnings report',
    subtitle: 'Every number here is computed directly from real bookings and payments.',
    loading: 'Loading...',
    error: 'Could not load the earnings report.',
    forecasted: 'Forecasted (confirmed, not completed yet)',
    earned: 'Earned',
    released: 'Released',
    pending: 'Pending release',
    empty: 'No bookings yet.',
    listing: 'Listing',
    dates: 'Dates',
    status: 'Status',
    hostGross: 'Host net',
    payoutStatus: 'Payout status',
    eligibleAt: 'Eligible at',
    statusPENDING_HOLD: 'In hold window',
    statusELIGIBLE: 'Ready to release',
    statusRELEASED: 'Released',
  },
}

export function HostEarningsPage({ lang, mode = 'host' }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [earnings, setEarnings] = useState<PlatformHostEarnings | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadEarnings()
  }, [])

  async function loadEarnings() {
    setStatus('loading')
    try {
      setEarnings(await fetchPrototypeHostEarnings(mode))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  // The API rows can legitimately contain more than one currency. Never add their minor units
  // together or label the result with the first row's currency.
  const totalsByCurrency = (earnings?.rows || []).reduce<Record<string, { forecastedMinor: number; grossEarnedMinor: number; releasedMinor: number; pendingMinor: number }>>((groups, row) => {
    const totals = groups[row.currency] ||= { forecastedMinor: 0, grossEarnedMinor: 0, releasedMinor: 0, pendingMinor: 0 }
    if (row.status === 'CONFIRMED') totals.forecastedMinor += row.hostGrossMinor
    if (row.status === 'COMPLETED') {
      totals.grossEarnedMinor += row.hostGrossMinor
      if (row.payoutStatus === 'RELEASED') totals.releasedMinor += row.hostGrossMinor
      else totals.pendingMinor += row.hostGrossMinor
    }
    return groups
  }, {})

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/host')}>
        {t.back}
      </button>
      <section style={styles.hero}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
      </section>

      {status === 'loading' && <p style={styles.body}>{t.loading}</p>}
      {status === 'error' && <p style={styles.alert}>{message}</p>}

      {earnings && (
        <>
          {Object.entries(totalsByCurrency).map(([currency, totals]) => (
            <section style={styles.stats} key={currency} aria-label={currency}>
              <div style={styles.stat}><span>{t.forecasted} · {currency}</span><b>{moneyText(totals.forecastedMinor, currency, lang)}</b></div>
              <div style={styles.stat}><span>{t.earned} · {currency}</span><b>{moneyText(totals.grossEarnedMinor, currency, lang)}</b></div>
              <div style={styles.stat}><span>{t.released} · {currency}</span><b style={{ color: '#20d29b' }}>{moneyText(totals.releasedMinor, currency, lang)}</b></div>
              <div style={styles.stat}><span>{t.pending} · {currency}</span><b style={{ color: '#e5b80b' }}>{moneyText(totals.pendingMinor, currency, lang)}</b></div>
            </section>
          ))}

          <section style={styles.table}>
            <div style={styles.tableHead}>
              <span>{t.listing}</span>
              <span>{t.dates}</span>
              <span>{t.status}</span>
              <span>{t.hostGross}</span>
              <span>{t.payoutStatus}</span>
            </div>
            {earnings.rows.length === 0 && <p style={styles.body}>{t.empty}</p>}
            {earnings.rows.map((row) => (
              <div key={row.bookingId} style={styles.tableRow}>
                <span>{row.listingTitle}</span>
                <span dir="ltr">
                  {row.checkIn ? new Date(row.checkIn).toLocaleDateString(isAr ? 'ar-SY' : 'en-US') : '-'}
                  {' → '}
                  {row.checkOut ? new Date(row.checkOut).toLocaleDateString(isAr ? 'ar-SY' : 'en-US') : '-'}
                </span>
                <span>{statusText(row.status, lang)}</span>
                <b dir="ltr">{moneyText(row.hostGrossMinor, row.currency, lang)}</b>
                <span
                  style={{
                    ...styles.payoutPill,
                    ...(row.payoutStatus === 'RELEASED'
                      ? styles.payoutReleased
                      : row.payoutStatus === 'ELIGIBLE'
                        ? styles.payoutEligible
                        : styles.payoutPending),
                  }}
                >
                  {t[`status${row.payoutStatus}` as 'statusPENDING_HOLD' | 'statusELIGIBLE' | 'statusRELEASED']}
                </span>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 24, maxWidth: 1240, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118', display: 'grid', gap: 10 },
  title: { margin: 0, fontSize: 28 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  stats: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  stat: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#9aa6ba', display: 'grid', gap: 6, padding: 14 },
  table: { border: '1px solid #242735', borderRadius: 8, background: '#101016', overflowX: 'auto', overflowY: 'hidden' },
  tableHead: { display: 'grid', gridTemplateColumns: 'minmax(160px, 2fr) minmax(140px, 1.2fr) 110px 130px 140px', gap: 12, padding: '14px 18px', borderBottom: '1px solid #242735', color: '#8d92a2', fontSize: 13, minWidth: 680 },
  tableRow: { display: 'grid', gridTemplateColumns: 'minmax(160px, 2fr) minmax(140px, 1.2fr) 110px 130px 140px', gap: 12, alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid #242735', fontSize: 14, minWidth: 680 },
  payoutPill: { borderRadius: 8, padding: '6px 10px', textAlign: 'center', fontWeight: 900, fontSize: 12 },
  payoutReleased: { background: 'rgba(32,210,155,.14)', color: '#20d29b', border: '1px solid rgba(32,210,155,.42)' },
  payoutEligible: { background: 'rgba(82,108,255,.14)', color: '#8ea0ff', border: '1px solid rgba(82,108,255,.42)' },
  payoutPending: { background: 'rgba(229,184,11,.13)', color: '#e5b80b', border: '1px solid rgba(229,184,11,.42)' },
}
