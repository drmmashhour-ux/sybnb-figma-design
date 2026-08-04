import { useEffect, useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchAdminDisputes, resolveDispute, type PlatformDispute } from '../../shared/api/platformApi'
import { AdminShell } from '../admin/AdminShell'

// Admin dispute queue (GET /api/admin/disputes, OPEN only) + resolve REFUND/REJECT
// (PATCH /api/admin/disputes/:id). Mirrors the dispute-adjudication backend.
const copy = {
  ar: {
    back: 'العودة',
    title: 'قائمة النزاعات',
    subtitle: 'النزاعات المفتوحة بانتظار القرار. الاسترداد يُقيّد في محفظة العميل بحد أقصى ما دفعه.',
    loading: 'جار التحميل...',
    empty: 'لا توجد نزاعات مفتوحة.',
    error: 'تعذر تحميل النزاعات.',
    subjectRide: 'رحلة SR',
    subjectBooking: 'حجز إقامة',
    opener: 'مقدّم النزاع',
    reason: 'السبب',
    notePlaceholder: 'ملاحظة القرار (اختياري)...',
    refundAmount: 'مبلغ الاسترداد (اختياري — يُحدّ بما دُفع)',
    refund: 'استرداد',
    reject: 'رفض',
    working: 'جار التنفيذ...',
    resolvedRefunded: 'تم الاسترداد',
    resolvedRejected: 'تم الرفض',
    genericError: 'تعذر تنفيذ القرار.',
  },
  en: {
    back: 'Back',
    title: 'Dispute queue',
    subtitle: 'Open disputes awaiting a decision. A refund credits the customer’s wallet, capped at what they paid.',
    loading: 'Loading…',
    empty: 'No open disputes.',
    error: 'Could not load disputes.',
    subjectRide: 'SR ride',
    subjectBooking: 'Stay booking',
    opener: 'Opened by',
    reason: 'Reason',
    notePlaceholder: 'Resolution note (optional)…',
    refundAmount: 'Refund amount (optional — capped at amount paid)',
    refund: 'Refund',
    reject: 'Reject',
    working: 'Working…',
    resolvedRefunded: 'Refunded',
    resolvedRejected: 'Rejected',
    genericError: 'Could not apply the decision.',
  },
}

export function AdminDisputesPage({ lang, onLanguageChange }: { lang: Lang; onLanguageChange?: (lang: Lang) => void }) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en
  const [disputes, setDisputes] = useState<PlatformDispute[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [resolved, setResolved] = useState<Record<string, string>>({})

  async function load() {
    setState('loading')
    try {
      setDisputes(await fetchAdminDisputes())
      setState('ready')
    } catch {
      setState('error')
    }
  }

  useEffect(() => { void load() }, [])

  function onResolved(id: string, text: string) {
    setResolved((prev) => ({ ...prev, [id]: text }))
    // Remove from the queue after a beat so the admin sees the outcome, then it disappears.
    setTimeout(() => setDisputes((prev) => prev.filter((d) => d.id !== id)), 1200)
  }

  return (
    <AdminShell lang={lang} active="reports" title={t.title} subtitle={t.subtitle} onLanguageChange={onLanguageChange} onRefresh={() => void load()}>
      <div dir={isAr ? 'rtl' : 'ltr'} style={{ display: 'grid', gap: 14 }}>
        {state === 'loading' && <p style={styles.muted}>{t.loading}</p>}
        {state === 'error' && <p style={styles.error}>{t.error}</p>}
        {state === 'ready' && disputes.length === 0 && <div className="empty"><div><span>✓</span>{t.empty}</div></div>}
        {state === 'ready' &&
          disputes.map((d) => (
            <DisputeRow key={d.id} dispute={d} t={t} lang={lang} resolvedText={resolved[d.id]} onResolved={onResolved} />
          ))}
      </div>
    </AdminShell>
  )
}

function DisputeRow({
  dispute,
  t,
  lang,
  resolvedText,
  onResolved,
}: {
  dispute: PlatformDispute
  t: typeof copy.en
  lang: Lang
  resolvedText?: string
  onResolved: (id: string, text: string) => void
}) {
  const isAr = lang === 'ar'
  const [note, setNote] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function resolve(decision: 'REFUND' | 'REJECT') {
    setBusy(true)
    setError('')
    try {
      const updated = await resolveDispute(dispute.id, {
        decision,
        note: note.trim() || undefined,
        refundMinor: decision === 'REFUND' && amount.trim() ? Number(amount) : undefined,
      })
      onResolved(dispute.id, updated.status === 'RESOLVED_REFUNDED' ? t.resolvedRefunded : t.resolvedRejected)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error && err.message ? err.message : t.genericError)
    }
  }

  if (resolvedText) {
    return <article style={styles.card}><p style={styles.resolved}>{resolvedText}</p></article>
  }

  return (
    <article style={styles.card} dir={isAr ? 'rtl' : 'ltr'}>
      <div style={styles.cardTop}>
        <strong>{dispute.subjectType === 'SR_RIDE' ? t.subjectRide : t.subjectBooking}</strong>
        <span style={styles.muted}>{t.opener}: {dispute.openedBy?.displayName || dispute.openedByUserId.slice(0, 8)}</span>
      </div>
      <p style={styles.reason}><span style={styles.label}>{t.reason}: </span>{dispute.reason}</p>
      <input style={styles.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} maxLength={1000} />
      <input style={styles.input} value={amount} inputMode="numeric" onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} placeholder={t.refundAmount} />
      {error && <p style={styles.error} role="alert">{error}</p>}
      <div style={styles.actions}>
        <button style={styles.refundButton} disabled={busy} onClick={() => void resolve('REFUND')}>{busy ? t.working : t.refund}</button>
        <button style={styles.rejectButton} disabled={busy} onClick={() => void resolve('REJECT')}>{busy ? t.working : t.reject}</button>
      </div>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 720, margin: '0 auto', padding: '20px 16px 64px', display: 'flex', flexDirection: 'column', gap: 12 },
  back: { alignSelf: 'flex-start', background: 'transparent', border: 'none', color: '#2f6fed', cursor: 'pointer', padding: 0, fontSize: 14 },
  title: { fontSize: 24, margin: 0 },
  subtitle: { margin: 0, color: '#555', fontSize: 14, lineHeight: 1.5 },
  card: { display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 12, border: '1px solid #e4e4ee', background: '#fff' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  reason: { margin: 0, fontSize: 14, color: '#333' },
  label: { color: '#888' },
  input: { padding: '10px 12px', borderRadius: 10, border: '1px solid #ccd', fontSize: 14 },
  actions: { display: 'flex', gap: 10 },
  refundButton: { padding: '10px 16px', borderRadius: 10, border: 'none', background: '#0a7d33', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  rejectButton: { padding: '10px 16px', borderRadius: 10, border: '1px solid #b3261e', background: '#fff', color: '#b3261e', fontWeight: 600, cursor: 'pointer' },
  resolved: { margin: 0, fontSize: 14, fontWeight: 600, color: '#0a7d33' },
  muted: { color: '#888', fontSize: 13 },
  error: { color: '#b3261e', fontSize: 13, margin: 0 },
}
