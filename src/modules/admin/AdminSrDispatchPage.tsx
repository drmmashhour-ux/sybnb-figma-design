import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchSrDispatch, type SrDispatchBoard } from '../../shared/api/platformApi'
import { SrDispatchMap } from '../sr/SrDispatchMap'

type Props = { lang: Lang }

const REFRESH_MS = 8000

const copy = {
  ar: {
    back: 'العودة',
    title: 'غرفة عمليات SR',
    subtitle: 'خريطة مباشرة لكل الرحلات النشطة والسائقين المتصلين — تتحدّث تلقائياً.',
    loading: 'جار التحميل…',
    error: 'تعذّر تحميل لوحة العمليات',
    activeRides: 'رحلات نشطة',
    waitingRides: 'بانتظار سائق',
    onlineDrivers: 'سائقون متصلون',
    busyDrivers: 'سائقون مشغولون',
    legWaiting: 'رحلة بانتظار سائق',
    legAssigned: 'رحلة مُسندة/جارية',
    legFree: 'سائق متاح',
    legBusy: 'سائق مشغول',
    updated: 'آخر تحديث',
  },
  en: {
    back: 'Back',
    title: 'SR Operations',
    subtitle: 'A live map of every active ride and online driver — auto-refreshing.',
    loading: 'Loading…',
    error: 'Could not load the dispatch board',
    activeRides: 'Active rides',
    waitingRides: 'Waiting for a driver',
    onlineDrivers: 'Online drivers',
    busyDrivers: 'Busy drivers',
    legWaiting: 'Ride waiting for a driver',
    legAssigned: 'Ride assigned / in progress',
    legFree: 'Driver available',
    legBusy: 'Driver busy',
    updated: 'Updated',
  },
}

export function AdminSrDispatchPage({ lang }: Props) {
  const t = copy[lang]
  const [board, setBoard] = useState<SrDispatchBoard | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const load = () =>
      fetchSrDispatch()
        .then((b) => {
          setBoard(b)
          setError(false)
        })
        .catch(() => setError(true))
    void load()
    const interval = window.setInterval(load, REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [])

  return (
    <div style={styles.page} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <button style={styles.back} onClick={() => (window.location.hash = '/admin')}>
        ← {t.back}
      </button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      {error && !board ? <p style={styles.err}>{t.error}</p> : null}

      {board ? (
        <>
          <div style={styles.counts}>
            <Count label={t.activeRides} value={board.counts.activeRides} />
            <Count label={t.waitingRides} value={board.counts.waitingRides} alert={board.counts.waitingRides > 0} />
            <Count label={t.onlineDrivers} value={board.counts.onlineDrivers} />
            <Count label={t.busyDrivers} value={board.counts.busyDrivers} />
          </div>

          <SrDispatchMap rides={board.rides} drivers={board.drivers} />

          <div style={styles.legend}>
            <Legend color="#14b8a6" label={t.legWaiting} />
            <Legend color="#3b82f6" label={t.legAssigned} />
            <Legend color="#22c55e" label={t.legFree} />
            <Legend color="#f59e0b" label={t.legBusy} />
          </div>
          <p style={styles.updated}>
            {t.updated}: {new Date(board.generatedAt).toLocaleTimeString(lang === 'ar' ? 'ar-SY' : 'en-US')}
          </p>
        </>
      ) : (
        <p style={styles.muted}>{t.loading}</p>
      )}
    </div>
  )
}

function Count({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div style={{ ...styles.count, ...(alert ? styles.countAlert : null) }}>
      <div style={styles.countValue}>{value}</div>
      <div style={styles.countLabel}>{label}</div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={styles.legendItem}>
      <span style={{ ...styles.legendDot, background: color }} /> {label}
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 1100, margin: '0 auto', padding: '20px 16px 48px' },
  back: { background: 'transparent', border: 'none', color: '#0f766e', fontWeight: 700, cursor: 'pointer', fontSize: 15, padding: 0 },
  title: { fontSize: 26, margin: '10px 0 4px', color: '#0f172a' },
  subtitle: { margin: '0 0 16px', color: '#64748b', fontSize: 14 },
  err: { color: '#dc2626', fontSize: 14 },
  muted: { color: '#64748b', fontSize: 14 },
  counts: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 },
  count: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px' },
  countAlert: { borderColor: '#fca5a5', background: '#fef2f2' },
  countValue: { fontSize: 28, fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' },
  countLabel: { fontSize: 12, color: '#64748b', marginTop: 2 },
  legend: { display: 'flex', gap: 16, flexWrap: 'wrap', margin: '12px 0 0', color: '#475569', fontSize: 13 },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  legendDot: { width: 11, height: 11, borderRadius: '50%', display: 'inline-block' },
  updated: { color: '#94a3b8', fontSize: 12, marginTop: 10 },
}

export default AdminSrDispatchPage
