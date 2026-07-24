import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchHostPayments, type HostDashboardMode, type PlatformHostPayments } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'
import { payrollRowsForPeriod, payrollTotals } from './payrollMath'

type Props = {
  lang: Lang
  mode?: HostDashboardMode
}

// H7 — the printable bi-weekly (2-week) payout statement ("payroll" for a tax return). It reads the FROZEN
// M5 records via fetchHostPayments (H6) and does NO recompute: per-booking gross, commission, card fee (when
// net < gross), and NET payout come straight from the records; the period totals (payrollMath) are the sum
// of the rows in the chosen 2-week window. Printing reuses the FIX 1 isolation (#statement-print +
// .no-print), so only the statement prints, black-on-white, RTL preserved.

function twoWeeksAgoISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 13) // inclusive 14-day window ending today
  return d.toISOString().slice(0, 10)
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

const copy = {
  ar: {
    back: 'العودة للوحة الاستضافة',
    title: 'كشف الدفعات (كل أسبوعين)',
    subtitle: 'اختر فترة أسبوعين واطبع كشفاً بمستحقاتك — كل رقم مثبّت وقت التسوية.',
    from: 'من', to: 'إلى', print: 'طباعة الكشف', loading: 'جار التحميل...', error: 'تعذر تحميل الكشف.', empty: 'لا دفعات في هذه الفترة.',
    host: 'المضيف', period: 'الفترة', generated: 'تاريخ الإصدار',
    listing: 'الإعلان', dates: 'التواريخ', status: 'الحالة', gross: 'الإجمالي', commission: 'العمولة', cardFee: 'رسوم البطاقة', net: 'صافي المستحق',
    totals: 'إجمالي الفترة', footer: 'سجل من منصة SYBNB — ليس وثيقة ضريبية رسمية.',
    statusPENDING_HOLD: 'ضمن فترة الحجز', statusELIGIBLE: 'جاهز للصرف', statusRELEASED: 'تم الصرف', statusREVERSED: 'معكوس',
  },
  en: {
    back: 'Back to host dashboard',
    title: 'Payout statement (bi-weekly)',
    subtitle: 'Pick a two-week period and print a statement of your payouts — every figure frozen at settlement.',
    from: 'From', to: 'To', print: 'Print statement', loading: 'Loading...', error: 'Could not load the statement.', empty: 'No payouts in this period.',
    host: 'Host', period: 'Period', generated: 'Generated',
    listing: 'Listing', dates: 'Dates', status: 'Status', gross: 'Gross', commission: 'Commission', cardFee: 'Card fee', net: 'Net payout',
    totals: 'Period totals', footer: 'SYBNB platform record — not an official tax form.',
    statusPENDING_HOLD: 'In hold window', statusELIGIBLE: 'Ready to release', statusRELEASED: 'Released', statusREVERSED: 'Reversed',
  },
}

function dateText(value: string | null, isAr: boolean) {
  return value ? new Date(value).toLocaleDateString(isAr ? 'ar-SY' : 'en-US') : '—'
}

export function HostPayrollStatement({ lang, mode = 'host' }: Props) {
  const t = copy[lang === 'ar' ? 'ar' : 'en']
  const isAr = lang === 'ar'
  const [data, setData] = useState<PlatformHostPayments | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [from, setFrom] = useState(twoWeeksAgoISO())
  const [to, setTo] = useState(todayISO())

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')
    try {
      setData(await fetchHostPayments(mode))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  const rows = useMemo(() => (data ? payrollRowsForPeriod(data.rows, from, to) : []), [data, from, to])
  const totals = useMemo(() => payrollTotals(rows), [rows])
  const currency = data?.totals.currency || 'USD'
  const generatedAt = useMemo(() => new Date().toLocaleDateString(isAr ? 'ar-SY' : 'en-US'), [isAr])

  return (
    <main style={styles.page}>
      <button className="no-print" style={styles.back} onClick={() => { window.location.hash = '#/host' }} type="button">{t.back}</button>
      <section className="no-print" style={styles.hero}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
        <div style={styles.controls}>
          <label style={styles.field}><span>{t.from}</span><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={styles.field}><span>{t.to}</span><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          <button style={styles.printButton} onClick={() => window.print()} type="button">{t.print}</button>
        </div>
      </section>

      {status === 'loading' && <p className="no-print" style={styles.body}>{t.loading}</p>}
      {status === 'error' && <p className="no-print" style={styles.alert}>{t.error}</p>}

      {status === 'ready' && data && (
        <section id="statement-print" style={styles.sheet} dir={isAr ? 'rtl' : 'ltr'}>
          <header style={styles.letterhead}>
            <strong style={{ fontSize: 20 }}>SYBNB</strong>
            <div>
              <div>{t.host}: <b>{data.hostName || '—'}</b></div>
              <div>{t.period}: <b dir="ltr">{from} → {to}</b></div>
              <div>{t.generated}: <b>{generatedAt}</b></div>
            </div>
          </header>

          {rows.length === 0 ? (
            <p style={styles.body}>{t.empty}</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t.listing}</th>
                  <th style={styles.th}>{t.dates}</th>
                  <th style={styles.th}>{t.status}</th>
                  <th style={styles.thNum}>{t.gross}</th>
                  <th style={styles.thNum}>{t.commission}</th>
                  <th style={styles.thNum}>{t.cardFee}</th>
                  <th style={styles.thNum}>{t.net}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const cardFee = Math.max(0, row.hostPayoutMinor - row.netPayoutMinor)
                  return (
                    <tr key={row.bookingId}>
                      <td style={styles.td}>{row.listingTitle || row.bookingId}</td>
                      <td style={styles.td} dir="ltr">{dateText(row.checkIn, isAr)} → {dateText(row.checkOut, isAr)}</td>
                      <td style={styles.td}>{t[`status${row.payoutStatus}` as keyof typeof t]}</td>
                      <td style={styles.tdNum}>{moneyText(row.grossMinor ?? 0, row.currency, lang)}</td>
                      <td style={styles.tdNum}>{moneyText(row.commissionMinor ?? 0, row.currency, lang)}</td>
                      <td style={styles.tdNum}>{cardFee > 0 ? moneyText(cardFee, row.currency, lang) : '—'}</td>
                      <td style={styles.tdNum}><b>{moneyText(row.netPayoutMinor, row.currency, lang)}</b></td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={styles.td} colSpan={3}><b>{t.totals}</b></td>
                  <td style={styles.tdNum}><b>{moneyText(totals.grossMinor, currency, lang)}</b></td>
                  <td style={styles.tdNum}><b>{moneyText(totals.commissionMinor, currency, lang)}</b></td>
                  <td style={styles.tdNum}><b>{totals.cardFeeMinor > 0 ? moneyText(totals.cardFeeMinor, currency, lang) : '—'}</b></td>
                  <td style={styles.tdNum}><b>{moneyText(totals.netMinor, currency, lang)}</b></td>
                </tr>
              </tfoot>
            </table>
          )}

          <footer style={styles.disclaimer}>{t.footer}</footer>
        </section>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 24, maxWidth: 1080, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118', display: 'grid', gap: 12 },
  title: { margin: 0, fontSize: 26 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  controls: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' },
  field: { display: 'grid', gap: 4, color: '#9aa6ba', fontSize: 13 },
  printButton: { minHeight: 42, border: 'none', borderRadius: 8, background: '#526cff', color: '#fff', padding: '0 18px', fontWeight: 900, cursor: 'pointer' },
  sheet: { border: '1px solid #242735', borderRadius: 8, background: '#101016', padding: 20, display: 'grid', gap: 16, overflowX: 'auto' },
  letterhead: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', borderBottom: '1px solid #242735', paddingBottom: 12, flexWrap: 'wrap' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 },
  th: { textAlign: 'start', padding: '8px 10px', borderBottom: '1px solid #30384d', color: '#8d92a2', fontWeight: 700 },
  thNum: { textAlign: 'end', padding: '8px 10px', borderBottom: '1px solid #30384d', color: '#8d92a2', fontWeight: 700 },
  td: { padding: '8px 10px', borderBottom: '1px solid #1e2130' },
  tdNum: { padding: '8px 10px', borderBottom: '1px solid #1e2130', textAlign: 'end' },
  disclaimer: { color: '#8d92a2', fontSize: 12, borderTop: '1px solid #242735', paddingTop: 12 },
}
