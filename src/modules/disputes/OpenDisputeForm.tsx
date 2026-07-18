import { useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { openDispute, type PlatformDispute } from '../../shared/api/platformApi'

// Reusable "open a dispute" form for a completed ride OR booking the customer owns (POST /api/disputes).
// Surfaces the backend guard errors (window passed / already disputed / already refunded) verbatim.
const copy = {
  ar: {
    title: 'فتح نزاع',
    hint: 'إذا لم تكن راضيًا عن هذه الرحلة/الحجز المكتمل، اشرح المشكلة وسيقوم فريق SYBNB بمراجعتها.',
    reasonPlaceholder: 'اشرح سبب النزاع...',
    submit: 'إرسال النزاع',
    submitting: 'جار الإرسال...',
    reasonRequired: 'يرجى كتابة سبب النزاع.',
    success: 'تم فتح النزاع. سيتم إعلامك بالقرار.',
    viewMine: 'عرض نزاعاتي',
    genericError: 'تعذر فتح النزاع، حاول مجددًا.',
  },
  en: {
    title: 'Open a dispute',
    hint: 'If you were not satisfied with this completed ride/booking, describe the issue and SYBNB will review it.',
    reasonPlaceholder: 'Explain the reason for the dispute…',
    submit: 'Submit dispute',
    submitting: 'Submitting…',
    reasonRequired: 'Please enter a reason.',
    success: 'Dispute opened. You will be notified of the decision.',
    viewMine: 'View my disputes',
    genericError: 'Could not open the dispute. Please try again.',
  },
}

export function OpenDisputeForm({
  lang,
  rideId,
  bookingId,
  onOpened,
}: {
  lang: Lang
  rideId?: string
  bookingId?: string
  onOpened?: (dispute: PlatformDispute) => void
}) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
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
      const dispute = await openDispute({ rideId, bookingId, reason: reason.trim() })
      setState('done')
      onOpened?.(dispute)
    } catch (err) {
      setState('idle')
      setError(err instanceof Error && err.message ? err.message : t.genericError)
    }
  }

  if (state === 'done') {
    return (
      <section style={styles.box} dir={isAr ? 'rtl' : 'ltr'}>
        <p style={styles.success}>{t.success}</p>
        <button style={styles.linkButton} onClick={() => (window.location.hash = '/disputes')}>{t.viewMine}</button>
      </section>
    )
  }

  return (
    <section style={styles.box} dir={isAr ? 'rtl' : 'ltr'}>
      {!open ? (
        <button style={styles.secondaryButton} onClick={() => setOpen(true)}>{t.title}</button>
      ) : (
        <>
          <h3 style={styles.title}>{t.title}</h3>
          <p style={styles.hint}>{t.hint}</p>
          <textarea style={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reasonPlaceholder} maxLength={2000} />
          {error && <p style={styles.error} role="alert">{error}</p>}
          <button style={styles.primaryButton} disabled={state === 'saving'} onClick={() => void submit()}>
            {state === 'saving' ? t.submitting : t.submit}
          </button>
        </>
      )}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  box: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 12, border: '1px solid #e4e4ee', background: '#fff' },
  title: { fontSize: 16, margin: 0 },
  hint: { fontSize: 13, color: '#666', margin: 0, lineHeight: 1.5 },
  textarea: { minHeight: 90, padding: 10, borderRadius: 10, border: '1px solid #ccd', fontSize: 14, resize: 'vertical' },
  primaryButton: { padding: '11px 16px', borderRadius: 10, border: 'none', background: '#2f6fed', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  secondaryButton: { padding: '10px 16px', borderRadius: 10, border: '1px solid #2f6fed', background: '#fff', color: '#2f6fed', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  linkButton: { background: 'transparent', border: 'none', color: '#2f6fed', cursor: 'pointer', padding: 0, alignSelf: 'flex-start', fontSize: 14 },
  error: { color: '#b3261e', fontSize: 13, margin: 0 },
  success: { color: '#0a7d33', fontSize: 14, margin: 0 },
}
