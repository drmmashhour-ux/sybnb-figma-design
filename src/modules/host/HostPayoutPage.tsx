import { useEffect, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchHostPayoutMethod,
  saveHostPayoutMethod,
  type HostDashboardMode,
  type HostPayoutView,
} from '../../shared/api/platformApi'

type Props = {
  lang: Lang
  mode?: HostDashboardMode
}

const T = {
  ar: {
    title: 'حساب الصرف — شام كاش',
    subtitle: 'أدخل حساب شام كاش الذي ستستلم عليه أرباحك. الإدارة تصرف الأرباح بعد اكتمال الحجز وانتهاء فترة الحماية.',
    onFile: 'الحساب المسجّل',
    holder: 'اسم صاحب الحساب',
    holderPlaceholder: 'الاسم كما هو في شام كاش',
    number: 'رقم شام كاش',
    numberPlaceholder: 'أدخل رقم شام كاش',
    numberHint: 'لا نعرض الرقم كاملاً بعد الحفظ — تظهر آخر 4 أرقام فقط. الرقم مُشفّر عند التخزين.',
    save: 'حفظ حساب الصرف',
    saving: 'جار الحفظ...',
    saved: 'تم حفظ حساب الصرف. تظهر آخر 4 أرقام فقط.',
    loadError: 'تعذر تحميل حساب الصرف.',
    saveError: 'تعذر حفظ حساب الصرف. تحقق من البيانات.',
    none: 'لا يوجد حساب صرف مسجّل بعد.',
    lastFour: 'الأرقام الأخيرة',
    updatedAt: 'آخر تحديث',
    secured: 'مؤمّن ومُشفّر · تتحقق منه الإدارة قبل الصرف',
  },
  en: {
    title: 'Payout account — Sham Cash',
    subtitle: 'Enter the Sham Cash account where you will receive your earnings. Admin releases payouts after the booking completes and the protection hold ends.',
    onFile: 'Account on file',
    holder: 'Account holder name',
    holderPlaceholder: 'Name as it appears on Sham Cash',
    number: 'Sham Cash number',
    numberPlaceholder: 'Enter your Sham Cash number',
    numberHint: 'We never show the full number after saving — only the last 4 digits. The number is encrypted at rest.',
    save: 'Save payout account',
    saving: 'Saving...',
    saved: 'Payout account saved. Only the last 4 digits are shown.',
    loadError: 'Could not load your payout account.',
    saveError: 'Could not save the payout account. Check the details.',
    none: 'No payout account saved yet.',
    lastFour: 'Last digits',
    updatedAt: 'Last updated',
    secured: 'Secured & encrypted · admin verifies it before payout',
  },
}

export function HostPayoutPage({ lang, mode = 'host' }: Props) {
  const isAr = lang === 'ar'
  const t = T[lang]
  const [current, setCurrent] = useState<HostPayoutView>(null)
  const [holder, setHolder] = useState('')
  const [number, setNumber] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving'>('loading')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setStatus('loading')
    fetchHostPayoutMethod(mode)
      .then((payout) => {
        if (!active) return
        setCurrent(payout)
        if (payout?.accountHolder) setHolder(payout.accountHolder)
      })
      .catch(() => {
        if (active) setError(t.loadError)
      })
      .finally(() => {
        if (active) setStatus('ready')
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setStatus('saving')
    try {
      const saved = await saveHostPayoutMethod({ accountHolder: holder.trim(), shamCashNumber: number }, mode)
      setCurrent(saved)
      setNumber('')
      setMessage(t.saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : t.saveError)
    } finally {
      setStatus('ready')
    }
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.header}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.subtitle}>{t.subtitle}</p>
      </section>

      <section style={styles.onFile}>
        <span style={styles.onFileLabel}>{t.onFile}</span>
        {current ? (
          <div style={styles.onFileBody}>
            <strong style={styles.onFileHolder}>{current.accountHolder}</strong>
            <div style={styles.onFileRow}>
              <span>{t.lastFour}</span>
              <b dir="ltr">•••• {current.last4}</b>
            </div>
            {current.updatedAt && (
              <div style={styles.onFileRow}>
                <span>{t.updatedAt}</span>
                <b dir="ltr">{new Date(current.updatedAt).toLocaleString(isAr ? 'ar-SY' : 'en-US')}</b>
              </div>
            )}
            <span style={styles.secured}>{t.secured}</span>
          </div>
        ) : (
          <p style={styles.none}>{status === 'loading' ? '…' : t.none}</p>
        )}
      </section>

      <form style={styles.form} onSubmit={submit}>
        <label style={styles.field}>
          <span>{t.holder}</span>
          <input
            style={styles.input}
            value={holder}
            placeholder={t.holderPlaceholder}
            onChange={(event) => setHolder(event.target.value)}
            required
          />
        </label>
        <label style={styles.field}>
          <span>{t.number}</span>
          <input
            style={styles.input}
            value={number}
            dir="ltr"
            inputMode="numeric"
            placeholder={current ? `•••• ${current.last4}` : t.numberPlaceholder}
            onChange={(event) => setNumber(event.target.value)}
            required
          />
          <small style={styles.hint}>{t.numberHint}</small>
        </label>

        {error && <p style={styles.error}>{error}</p>}
        {message && <p style={styles.success}>{message}</p>}

        <button type="submit" disabled={status === 'saving'} style={styles.saveButton}>
          {status === 'saving' ? t.saving : t.save}
        </button>
      </form>
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 20, maxWidth: 720, margin: '0 auto' },
  header: { display: 'grid', gap: 8 },
  title: { margin: 0, fontSize: 30, lineHeight: 1.1 },
  subtitle: { margin: 0, color: '#9aa6ba', lineHeight: 1.6 },
  onFile: { border: '1px solid rgba(32,210,155,.4)', borderRadius: 10, background: '#101722', padding: 18, display: 'grid', gap: 10 },
  onFileLabel: { color: '#20d29b', fontWeight: 900, fontSize: 12, letterSpacing: 1 },
  onFileBody: { display: 'grid', gap: 8 },
  onFileHolder: { fontSize: 20 },
  onFileRow: { display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba', fontWeight: 800 },
  secured: { color: '#20d29b', fontSize: 12, fontWeight: 800 },
  none: { margin: 0, color: '#9aa6ba' },
  form: { border: '1px solid #242735', borderRadius: 10, background: '#111118', padding: 18, display: 'grid', gap: 16 },
  field: { display: 'grid', gap: 6, color: '#9aa6ba', fontSize: 13, fontWeight: 800 },
  input: { minHeight: 52, borderRadius: 10, border: '1px solid #30384d', background: '#0d1320', color: '#fff', padding: '0 14px', fontSize: 16, fontWeight: 700 },
  hint: { color: '#6f7688', fontSize: 12, fontWeight: 600, lineHeight: 1.5 },
  error: { margin: 0, color: '#ffd1d1', fontWeight: 800 },
  success: { margin: 0, color: '#20d29b', fontWeight: 800 },
  saveButton: { minHeight: 56, border: 0, borderRadius: 10, background: '#20d29b', color: '#06110e', fontWeight: 950, fontSize: 16 },
}
