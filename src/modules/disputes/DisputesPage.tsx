import { useEffect, useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchMyDisputes, type PlatformDispute } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

// Customer "My disputes" list (GET /api/disputes).
const copy = {
  ar: {
    back: 'العودة',
    title: 'نزاعاتي',
    subtitle: 'النزاعات التي فتحتها على الرحلات والحجوزات المكتملة وقرار SYBNB بشأنها.',
    loading: 'جار التحميل...',
    empty: 'لم تفتح أي نزاع بعد.',
    error: 'تعذر تحميل النزاعات.',
    subjectRide: 'رحلة SYBNB Ride',
    subjectBooking: 'حجز إقامة',
    reason: 'السبب',
    refund: 'المبلغ المُعاد',
    statusOpen: 'قيد المراجعة',
    statusRefunded: 'تم الاسترداد',
    statusRejected: 'مرفوض',
  },
  en: {
    back: 'Back',
    title: 'My disputes',
    subtitle: 'Disputes you opened on completed rides and bookings, and SYBNB’s decision.',
    loading: 'Loading…',
    empty: 'You have not opened any disputes yet.',
    error: 'Could not load your disputes.',
    subjectRide: 'SYBNB Ride trip',
    subjectBooking: 'Stay booking',
    reason: 'Reason',
    refund: 'Refunded',
    statusOpen: 'Under review',
    statusRefunded: 'Refunded',
    statusRejected: 'Rejected',
  },
}

function statusInfo(status: PlatformDispute['status'], t: typeof copy.en) {
  if (status === 'RESOLVED_REFUNDED') return { text: t.statusRefunded, color: '#0a7d33' }
  if (status === 'RESOLVED_REJECTED') return { text: t.statusRejected, color: '#b3261e' }
  return { text: t.statusOpen, color: '#8a6d0b' }
}

export function DisputesPage({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en
  const [disputes, setDisputes] = useState<PlatformDispute[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let alive = true
    fetchMyDisputes()
      .then((d) => { if (alive) { setDisputes(d); setState('ready') } })
      .catch(() => { if (alive) setState('error') })
    return () => { alive = false }
  }, [])

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>{t.back}</button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      {state === 'loading' && <p style={styles.muted}>{t.loading}</p>}
      {state === 'error' && <p style={styles.error}>{t.error}</p>}
      {state === 'ready' && disputes.length === 0 && <p style={styles.muted}>{t.empty}</p>}
      {state === 'ready' &&
        disputes.map((d) => {
          const s = statusInfo(d.status, t)
          return (
            <article key={d.id} style={styles.card}>
              <div style={styles.cardTop}>
                <strong>{d.subjectType === 'SR_RIDE' ? t.subjectRide : t.subjectBooking}</strong>
                <span style={{ ...styles.badge, color: s.color, borderColor: s.color }}>{s.text}</span>
              </div>
              <p style={styles.reason}><span style={styles.label}>{t.reason}: </span>{d.reason}</p>
              {d.status === 'RESOLVED_REFUNDED' && d.refundMinor != null && (
                <p style={styles.refund}>{t.refund}: {moneyText(d.refundMinor, d.currency || 'SYP', lang)}</p>
              )}
              {d.resolutionNote && <p style={styles.note}>{d.resolutionNote}</p>}
            </article>
          )
        })}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 640, margin: '0 auto', padding: '20px 16px 64px', display: 'flex', flexDirection: 'column', gap: 12 },
  back: { alignSelf: 'flex-start', background: 'transparent', border: 'none', color: '#2f6fed', cursor: 'pointer', padding: 0, fontSize: 14 },
  title: { fontSize: 24, margin: 0 },
  subtitle: { margin: 0, color: '#555', fontSize: 14, lineHeight: 1.5 },
  card: { display: 'flex', flexDirection: 'column', gap: 6, padding: 14, borderRadius: 12, border: '1px solid #e4e4ee', background: '#fff' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  badge: { fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, border: '1px solid', whiteSpace: 'nowrap' },
  reason: { margin: 0, fontSize: 14, color: '#333' },
  label: { color: '#888' },
  refund: { margin: 0, fontSize: 14, fontWeight: 600, color: '#0a7d33' },
  note: { margin: 0, fontSize: 13, color: '#666' },
  muted: { color: '#888', fontSize: 14 },
  error: { color: '#b3261e', fontSize: 14 },
}
