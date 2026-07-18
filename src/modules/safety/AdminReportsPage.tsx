import { useEffect, useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { actionReport, fetchAdminReports, type PlatformReport } from '../../shared/api/platformApi'

// Admin report queue (GET /api/admin/reports, OPEN only) + action (PATCH /api/admin/reports/:id).
const copy = {
  ar: {
    back: 'العودة',
    title: 'بلاغات المحتوى',
    subtitle: 'البلاغات المفتوحة على الإعلانات والتقييمات والمستخدمين بانتظار القرار.',
    loading: 'جار التحميل...',
    empty: 'لا توجد بلاغات مفتوحة.',
    error: 'تعذر تحميل البلاغات.',
    subject: 'المحتوى',
    reporter: 'المبلِّغ',
    reason: 'السبب',
    notePlaceholder: 'ملاحظة القرار (اختياري)...',
    reviewed: 'تمت المراجعة',
    actioned: 'تم اتخاذ إجراء',
    dismissed: 'تم الرفض',
    working: 'جار التنفيذ...',
    done: 'تم',
    genericError: 'تعذر تنفيذ القرار.',
  },
  en: {
    back: 'Back',
    title: 'Content reports',
    subtitle: 'Open reports on listings, reviews, and users awaiting a decision.',
    loading: 'Loading…',
    empty: 'No open reports.',
    error: 'Could not load reports.',
    subject: 'Subject',
    reporter: 'Reporter',
    reason: 'Reason',
    notePlaceholder: 'Resolution note (optional)…',
    reviewed: 'Reviewed',
    actioned: 'Actioned',
    dismissed: 'Dismissed',
    working: 'Working…',
    done: 'Done',
    genericError: 'Could not apply the decision.',
  },
}

export function AdminReportsPage({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en
  const [reports, setReports] = useState<PlatformReport[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  async function load() {
    setState('loading')
    try {
      setReports(await fetchAdminReports())
      setState('ready')
    } catch {
      setState('error')
    }
  }

  useEffect(() => { void load() }, [])

  function onDone(id: string) {
    setReports((prev) => prev.filter((r) => r.id !== id))
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/admin/review')}>{t.back}</button>
      <h1 style={styles.title}>{t.title}</h1>
      <p style={styles.subtitle}>{t.subtitle}</p>

      {state === 'loading' && <p style={styles.muted}>{t.loading}</p>}
      {state === 'error' && <p style={styles.error}>{t.error}</p>}
      {state === 'ready' && reports.length === 0 && <p style={styles.muted}>{t.empty}</p>}
      {state === 'ready' && reports.map((r) => <ReportRow key={r.id} report={r} t={t} isAr={isAr} onDone={onDone} />)}
    </main>
  )
}

function ReportRow({ report, t, isAr, onDone }: { report: PlatformReport; t: typeof copy.en; isAr: boolean; onDone: (id: string) => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resolvedText, setResolvedText] = useState('')

  async function resolve(status: 'REVIEWED' | 'ACTIONED' | 'DISMISSED', label: string) {
    setBusy(true)
    setError('')
    try {
      await actionReport(report.id, { status, note: note.trim() || undefined })
      setResolvedText(label)
      setTimeout(() => onDone(report.id), 1000)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error && err.message ? err.message : t.genericError)
    }
  }

  if (resolvedText) return <article style={styles.card}><p style={styles.resolved}>{resolvedText}</p></article>

  return (
    <article style={styles.card} dir={isAr ? 'rtl' : 'ltr'}>
      <div style={styles.cardTop}>
        <strong>{report.subjectType} · {report.subjectId.slice(0, 8).toUpperCase()}</strong>
        <span style={styles.muted}>{t.reporter}: {report.reporterUserId.slice(0, 8).toUpperCase()}</span>
      </div>
      <p style={styles.reason}><span style={styles.label}>{t.reason}: </span>{report.reason}</p>
      {report.note && <p style={styles.note}>{report.note}</p>}
      <input style={styles.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} maxLength={1000} />
      {error && <p style={styles.error} role="alert">{error}</p>}
      <div style={styles.actions}>
        <button style={styles.actionedButton} disabled={busy} onClick={() => void resolve('ACTIONED', t.actioned)}>{busy ? t.working : t.actioned}</button>
        <button style={styles.reviewedButton} disabled={busy} onClick={() => void resolve('REVIEWED', t.reviewed)}>{busy ? t.working : t.reviewed}</button>
        <button style={styles.dismissButton} disabled={busy} onClick={() => void resolve('DISMISSED', t.dismissed)}>{busy ? t.working : t.dismissed}</button>
      </div>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 720, margin: '0 auto', padding: '20px 16px 64px', display: 'flex', flexDirection: 'column', gap: 12 },
  back: { alignSelf: 'flex-start', background: 'transparent', border: 'none', color: '#2f6fed', cursor: 'pointer', padding: 0, fontSize: 14 },
  title: { fontSize: 24, margin: 0 },
  subtitle: { margin: 0, color: '#555', fontSize: 14 },
  card: { display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 12, border: '1px solid #e4e4ee', background: '#fff' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  reason: { margin: 0, fontSize: 14, color: '#333' },
  note: { margin: 0, fontSize: 13, color: '#666' },
  label: { color: '#888' },
  input: { padding: '10px 12px', borderRadius: 10, border: '1px solid #ccd', fontSize: 14 },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  actionedButton: { padding: '9px 14px', borderRadius: 10, border: 'none', background: '#b3261e', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  reviewedButton: { padding: '9px 14px', borderRadius: 10, border: '1px solid #2f6fed', background: '#fff', color: '#2f6fed', fontWeight: 600, cursor: 'pointer' },
  dismissButton: { padding: '9px 14px', borderRadius: 10, border: '1px solid #ccd', background: '#fff', color: '#555', fontWeight: 600, cursor: 'pointer' },
  resolved: { margin: 0, fontSize: 14, fontWeight: 600, color: '#0a7d33' },
  muted: { color: '#888', fontSize: 13 },
  error: { color: '#b3261e', fontSize: 13, margin: 0 },
}
