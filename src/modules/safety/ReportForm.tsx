import { useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { reportContent, type ReportSubjectType } from '../../shared/api/platformApi'

// Reusable "Report" action for user-generated content (listing / review / seller / user / ride / booking).
// POST /api/reports. Store-compliance (Apple 1.2 / Play UGC).
const copy = {
  ar: {
    report: 'إبلاغ',
    title: 'الإبلاغ عن محتوى',
    reasonPlaceholder: 'سبب الإبلاغ (مثال: محتوى مخالف، احتيال، إساءة)...',
    notePlaceholder: 'تفاصيل إضافية (اختياري)...',
    submit: 'إرسال البلاغ',
    submitting: 'جار الإرسال...',
    reasonRequired: 'يرجى كتابة سبب البلاغ.',
    success: 'شكرًا لك. تم استلام البلاغ وسيراجعه فريق SYBNB.',
    cancel: 'إلغاء',
    genericError: 'تعذر إرسال البلاغ، حاول مجددًا.',
  },
  en: {
    report: 'Report',
    title: 'Report content',
    reasonPlaceholder: 'Reason (e.g. inappropriate content, fraud, abuse)…',
    notePlaceholder: 'Additional details (optional)…',
    submit: 'Submit report',
    submitting: 'Submitting…',
    reasonRequired: 'Please enter a reason.',
    success: 'Thank you. Your report was received and SYBNB will review it.',
    cancel: 'Cancel',
    genericError: 'Could not submit the report. Please try again.',
  },
}

export function ReportForm({
  lang,
  subjectType,
  subjectId,
  compact = false,
}: {
  lang: Lang
  subjectType: ReportSubjectType
  subjectId: string
  compact?: boolean
}) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle')
  const [error, setError] = useState('')

  async function submit() {
    if (!reason.trim()) {
      setError(t.reasonRequired)
      return
    }
    setState('saving')
    setError('')
    try {
      await reportContent({ subjectType, subjectId, reason: reason.trim(), note: note.trim() || undefined })
      setState('done')
    } catch (err) {
      setState('idle')
      setError(err instanceof Error && err.message ? err.message : t.genericError)
    }
  }

  if (state === 'done') {
    return <p style={styles.success} role="status">{t.success}</p>
  }

  if (!open) {
    return <button style={compact ? styles.linkButton : styles.reportButton} onClick={() => setOpen(true)}>⚑ {t.report}</button>
  }

  return (
    <section style={styles.box} dir={isAr ? 'rtl' : 'ltr'}>
      <h3 style={styles.title}>{t.title}</h3>
      <textarea style={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reasonPlaceholder} maxLength={2000} />
      <textarea style={styles.textarea} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.notePlaceholder} maxLength={2000} />
      {error && <p style={styles.error} role="alert">{error}</p>}
      <div style={styles.actions}>
        <button style={styles.primaryButton} disabled={state === 'saving'} onClick={() => void submit()}>
          {state === 'saving' ? t.submitting : t.submit}
        </button>
        <button style={styles.secondaryButton} disabled={state === 'saving'} onClick={() => setOpen(false)}>{t.cancel}</button>
      </div>
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  box: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 12, border: '1px solid #e4e4ee', background: '#fff' },
  title: { fontSize: 15, margin: 0 },
  textarea: { minHeight: 70, padding: 10, borderRadius: 10, border: '1px solid #ccd', fontSize: 14, resize: 'vertical' },
  actions: { display: 'flex', gap: 10 },
  primaryButton: { padding: '10px 16px', borderRadius: 10, border: 'none', background: '#2f6fed', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  secondaryButton: { padding: '10px 16px', borderRadius: 10, border: '1px solid #ccd', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' },
  reportButton: { padding: '8px 14px', borderRadius: 10, border: '1px solid #ccd', background: '#fff', color: '#8a1c1c', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  linkButton: { background: 'transparent', border: 'none', color: '#8a1c1c', cursor: 'pointer', padding: 0, fontSize: 13 },
  error: { color: '#b3261e', fontSize: 13, margin: 0 },
  success: { color: '#0a7d33', fontSize: 14, margin: 0 },
}
