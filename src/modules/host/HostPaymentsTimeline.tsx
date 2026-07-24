import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchHostPayments, type HostDashboardMode, type PlatformHostPayments } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
  mode?: HostDashboardMode
}

// H6 (part 2) — the host payments calendar/timeline. Renders each booking's booked → payment → release
// timeline with its per-row status and FROZEN amounts, straight from GET /api/host/payments (the M5
// Payout/Payment records). It performs NO money math of its own: every figure is read from the endpoint, so
// what a host sees is exactly what was frozen at settlement.

const copy = {
  ar: {
    back: 'العودة للوحة الاستضافة',
    title: 'تقويم الدفعات',
    subtitle: 'مسار كل حجز: محجوز ← دفع ← صرف. كل مبلغ مثبّت وقت التسوية، دون إعادة حساب.',
    loading: 'جار التحميل...',
    error: 'تعذر تحميل تقويم الدفعات.',
    empty: 'لا توجد دفعات بعد.',
    pending: 'بانتظار الصرف',
    released: 'تم الصرف',
    commission: 'عمولتك (تكلفتك)',
    booked: 'محجوز',
    paid: 'دفع الضيف',
    release: 'صرف المستحق',
    grossPayout: 'المستحق (إجمالي)',
    cardFee: 'رسوم معالجة البطاقة (مخصومة)',
    hostPayout: 'صافي مستحقك',
    statusPENDING_HOLD: 'ضمن فترة الحجز',
    statusELIGIBLE: 'جاهز للصرف',
    statusRELEASED: 'تم الصرف',
    statusREVERSED: 'معكوس',
    notYet: 'لم يُصرف بعد',
  },
  en: {
    back: 'Back to host dashboard',
    title: 'Payments timeline',
    subtitle: 'Each booking: booked → payment → release. Every amount was frozen at settlement — no recompute.',
    loading: 'Loading...',
    error: 'Could not load the payments timeline.',
    empty: 'No payments yet.',
    pending: 'Pending release',
    released: 'Released',
    commission: 'Your commission (your cost)',
    booked: 'Booked',
    paid: 'Guest paid',
    release: 'Payout release',
    grossPayout: 'Payout (gross)',
    cardFee: 'Card processing fee (deducted)',
    hostPayout: 'Your net payout',
    statusPENDING_HOLD: 'In hold window',
    statusELIGIBLE: 'Ready to release',
    statusRELEASED: 'Released',
    statusREVERSED: 'Reversed',
    notYet: 'Not released yet',
  },
}

function dateText(value: string | null, isAr: boolean) {
  return value ? new Date(value).toLocaleDateString(isAr ? 'ar-SY' : 'en-US') : '—'
}

export function HostPaymentsTimeline({ lang, mode = 'host' }: Props) {
  const t = copy[lang === 'ar' ? 'ar' : 'en']
  const isAr = lang === 'ar'
  const [payments, setPayments] = useState<PlatformHostPayments | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')
    try {
      setPayments(await fetchHostPayments(mode))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  const currency = payments?.totals.currency || 'USD'

  return (
    <main style={styles.page}>
      <button style={styles.back} onClick={() => { window.location.hash = '#/host' }} type="button">
        {t.back}
      </button>
      <section style={styles.hero}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
      </section>

      {status === 'loading' && <p style={styles.body}>{t.loading}</p>}
      {status === 'error' && <p style={styles.alert}>{t.error}</p>}

      {status === 'ready' && payments && (
        <>
          <section style={styles.stats}>
            <div style={styles.stat}>
              <span>{t.pending}</span>
              <b style={{ color: '#e5b80b' }}>{moneyText(payments.totals.pendingMinor, currency, lang)}</b>
            </div>
            <div style={styles.stat}>
              <span>{t.released}</span>
              <b style={{ color: '#20d29b' }}>{moneyText(payments.totals.releasedMinor, currency, lang)}</b>
            </div>
            <div style={styles.stat}>
              <span>{t.commission}</span>
              <b>{moneyText(payments.totals.commissionMinor, currency, lang)}</b>
            </div>
          </section>

          {payments.rows.length === 0 && <p style={styles.body}>{t.empty}</p>}
          <section style={styles.list}>
            {payments.rows.map((row) => (
              <article key={row.bookingId} style={styles.card}>
                <header style={styles.cardHead}>
                  <strong>{row.listingTitle || row.bookingId}</strong>
                  <span
                    style={{
                      ...styles.pill,
                      ...(row.payoutStatus === 'RELEASED'
                        ? styles.released
                        : row.payoutStatus === 'ELIGIBLE'
                          ? styles.eligible
                          : row.payoutStatus === 'REVERSED'
                            ? styles.reversed
                            : styles.pending),
                    }}
                  >
                    {t[`status${row.payoutStatus}` as keyof typeof t]}
                  </span>
                </header>
                {/* booked → payment → release timeline */}
                <ol style={styles.timeline} dir="ltr">
                  <li style={styles.step}>
                    <span style={styles.stepLabel}>{t.booked}</span>
                    <b>{dateText(row.checkIn, isAr)} → {dateText(row.checkOut, isAr)}</b>
                  </li>
                  <li style={styles.step}>
                    <span style={styles.stepLabel}>{t.paid}</span>
                    <b>{dateText(row.paymentDate, isAr)}</b>
                  </li>
                  <li style={styles.step}>
                    <span style={styles.stepLabel}>{t.release}</span>
                    <b>{row.releaseDate ? dateText(row.releaseDate, isAr) : t.notYet}</b>
                  </li>
                </ol>
                <footer style={styles.amounts} dir="ltr">
                  <span>{t.commission}: <b>{moneyText(row.commissionMinor ?? 0, row.currency, lang)}</b></span>
                  {/* H6 / M6 v3 — when a card fee was withheld (net < gross), show WHY the net is lower. */}
                  {row.netPayoutMinor < row.hostPayoutMinor ? (
                    <>
                      <span>{t.grossPayout}: <b>{moneyText(row.hostPayoutMinor, row.currency, lang)}</b></span>
                      <span style={{ color: '#e5b80b' }}>{t.cardFee}: <b>−{moneyText(row.hostPayoutMinor - row.netPayoutMinor, row.currency, lang)}</b></span>
                      <span>{t.hostPayout}: <b>{moneyText(row.netPayoutMinor, row.currency, lang)}</b></span>
                    </>
                  ) : (
                    <span>{t.hostPayout}: <b>{moneyText(row.netPayoutMinor, row.currency, lang)}</b></span>
                  )}
                </footer>
              </article>
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
  list: { display: 'grid', gap: 12 },
  card: { border: '1px solid #242735', borderRadius: 8, background: '#101016', padding: 16, display: 'grid', gap: 12 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  pill: { borderRadius: 8, padding: '6px 10px', textAlign: 'center', fontWeight: 900, fontSize: 12 },
  released: { background: 'rgba(32,210,155,.14)', color: '#20d29b', border: '1px solid rgba(32,210,155,.42)' },
  eligible: { background: 'rgba(82,108,255,.14)', color: '#8ea0ff', border: '1px solid rgba(82,108,255,.42)' },
  pending: { background: 'rgba(229,184,11,.13)', color: '#e5b80b', border: '1px solid rgba(229,184,11,.42)' },
  reversed: { background: 'rgba(255,96,96,.12)', color: '#ff9a9a', border: '1px solid rgba(255,96,96,.4)' },
  timeline: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, listStyle: 'none', margin: 0, padding: 0 },
  step: { border: '1px solid #242735', borderRadius: 8, background: '#0c1220', padding: 12, display: 'grid', gap: 4 },
  stepLabel: { color: '#8d92a2', fontSize: 12 },
  amounts: { display: 'flex', flexWrap: 'wrap', gap: 16, color: '#9aa6ba', fontSize: 14, borderTop: '1px solid #242735', paddingTop: 12 },
}
