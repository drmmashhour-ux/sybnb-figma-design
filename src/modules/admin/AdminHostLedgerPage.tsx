import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchAdminHostLedger, type PlatformAdminHostLedger } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

type Props = { lang: Lang }

// AD4 — the admin per-host payments ledger + printable tax-slip. The admin searches by host id (+ date range)
// and gets that host's ledger read from the FROZEN M5 records (no recompute). Platform revenue (commission +
// the separately-ledgered plan fee) is shown to the admin only. Printing reuses the FIX 1 isolation
// (#statement-print → only the slip prints, black-on-white, RTL preserved). Admin-only page.

const copy = {
  ar: {
    back: 'العودة', title: 'سجل مدفوعات المضيف', subtitle: 'ابحث بالمضيف والفترة — كل رقم مثبّت من سجلات M5.',
    hostId: 'معرّف المضيف', from: 'من', to: 'إلى', load: 'تحميل', print: 'طباعة الكشف', loading: 'جار التحميل...', error: 'تعذر التحميل.', empty: 'لا مدفوعات في هذه الفترة.',
    host: 'المضيف', period: 'الفترة', generated: 'تاريخ الإصدار',
    listing: 'الإعلان', dates: 'التواريخ', status: 'الحالة', release: 'تاريخ الصرف', gross: 'الإجمالي', commission: 'العمولة', cardFee: 'رسوم البطاقة', net: 'صافي المضيف',
    totals: 'إجمالي الفترة', revenue: 'إيراد المنصة من هذا المضيف', revCommission: 'العمولة', revPlan: 'رسوم الخطة ($19/$49)', footer: 'سجل من منصة SYBNB — ليس وثيقة ضريبية رسمية.',
  },
  en: {
    back: 'Back', title: 'Host payments ledger', subtitle: 'Search by host + period — every figure frozen from the M5 records.',
    hostId: 'Host id', from: 'From', to: 'To', load: 'Load', print: 'Print slip', loading: 'Loading...', error: 'Could not load.', empty: 'No payments in this period.',
    host: 'Host', period: 'Period', generated: 'Generated',
    listing: 'Listing', dates: 'Dates', status: 'Status', release: 'Released', gross: 'Gross', commission: 'Commission', cardFee: 'Card fee', net: 'Host net',
    totals: 'Period totals', revenue: 'Platform revenue from this host', revCommission: 'Commission', revPlan: 'Plan fee ($19/$49)', footer: 'SYBNB platform record — not an official tax form.',
  },
}

function dateText(value: string | null, isAr: boolean) {
  return value ? new Date(value).toLocaleDateString(isAr ? 'ar-SY' : 'en-US') : '—'
}

export function AdminHostLedgerPage({ lang }: Props) {
  const t = copy[lang === 'ar' ? 'ar' : 'en']
  const isAr = lang === 'ar'
  const [hostId, setHostId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [ledger, setLedger] = useState<PlatformAdminHostLedger | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  async function load() {
    if (!hostId.trim()) return
    setStatus('loading')
    try {
      setLedger(await fetchAdminHostLedger(hostId.trim(), { from: from || undefined, to: to || undefined }))
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  const currency = ledger?.totals.currency || 'USD'
  const generatedAt = new Date().toLocaleDateString(isAr ? 'ar-SY' : 'en-US')

  return (
    <main style={styles.page}>
      <button className="no-print" style={styles.back} onClick={() => { window.location.hash = '#/admin/review' }} type="button">{t.back}</button>
      <section className="no-print" style={styles.hero}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
        <div style={styles.controls}>
          <label style={styles.field}><span>{t.hostId}</span><input value={hostId} onChange={(e) => setHostId(e.target.value)} placeholder="uuid" /></label>
          <label style={styles.field}><span>{t.from}</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={styles.field}><span>{t.to}</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button style={styles.loadButton} onClick={() => void load()} type="button">{t.load}</button>
          {status === 'ready' && ledger && ledger.rows.length > 0 && <button style={styles.printButton} onClick={() => window.print()} type="button">{t.print}</button>}
        </div>
      </section>

      {status === 'loading' && <p className="no-print" style={styles.body}>{t.loading}</p>}
      {status === 'error' && <p className="no-print" style={styles.alert}>{t.error}</p>}

      {status === 'ready' && ledger && (
        <section id="statement-print" style={styles.sheet} dir={isAr ? 'rtl' : 'ltr'}>
          <header style={styles.letterhead}>
            <strong style={{ fontSize: 20 }}>SYBNB</strong>
            <div>
              <div>{t.host}: <b>{ledger.hostName || ledger.hostId}</b></div>
              <div>{t.period}: <b dir="ltr">{ledger.from} → {ledger.to}</b></div>
              <div>{t.generated}: <b>{generatedAt}</b></div>
            </div>
          </header>

          {ledger.rows.length === 0 ? (
            <p style={styles.body}>{t.empty}</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>{t.listing}</th>
                  <th style={styles.th}>{t.dates}</th>
                  <th style={styles.th}>{t.status}</th>
                  <th style={styles.th}>{t.release}</th>
                  <th style={styles.thNum}>{t.gross}</th>
                  <th style={styles.thNum}>{t.commission}</th>
                  <th style={styles.thNum}>{t.cardFee}</th>
                  <th style={styles.thNum}>{t.net}</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((row) => {
                  const cardFee = Math.max(0, (row.hostPayoutMinor || 0) - row.netPayoutMinor)
                  return (
                    <tr key={row.bookingId}>
                      <td style={styles.td}>{row.listingTitle || row.bookingId}</td>
                      <td style={styles.td} dir="ltr">{dateText(row.checkIn, isAr)} → {dateText(row.checkOut, isAr)}</td>
                      <td style={styles.td}>{row.payoutStatus}</td>
                      <td style={styles.td}>{dateText(row.releaseDate, isAr)}</td>
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
                  <td style={styles.td} colSpan={4}><b>{t.totals}</b></td>
                  <td style={styles.tdNum}><b>{moneyText(ledger.totals.grossMinor, currency, lang)}</b></td>
                  <td style={styles.tdNum}><b>{moneyText(ledger.totals.commissionMinor, currency, lang)}</b></td>
                  <td style={styles.tdNum}><b>{ledger.totals.cardFeeMinor > 0 ? moneyText(ledger.totals.cardFeeMinor, currency, lang) : '—'}</b></td>
                  <td style={styles.tdNum}><b>{moneyText(ledger.totals.netMinor, currency, lang)}</b></td>
                </tr>
              </tfoot>
            </table>
          )}

          <div style={styles.revenue}>
            <strong>{t.revenue}</strong>
            <span>{t.revCommission}: <b>{moneyText(ledger.revenue.commissionMinor, currency, lang)}</b></span>
            <span>{t.revPlan}: <b>{moneyText(ledger.revenue.planFeeMinor, 'USD', lang)}</b> ({ledger.revenue.planFeeCount})</span>
          </div>

          <footer style={styles.disclaimer}>{t.footer}</footer>
        </section>
      )}
    </main>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 24, maxWidth: 1120, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e1e2a', borderRadius: 8, padding: 18, background: '#111118', display: 'grid', gap: 12 },
  title: { margin: 0, fontSize: 26 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  controls: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' },
  field: { display: 'grid', gap: 4, color: '#9aa6ba', fontSize: 13 },
  loadButton: { minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 16px', fontWeight: 900, cursor: 'pointer' },
  printButton: { minHeight: 42, border: 'none', borderRadius: 8, background: '#526cff', color: '#fff', padding: '0 18px', fontWeight: 900, cursor: 'pointer' },
  sheet: { border: '1px solid #242735', borderRadius: 8, background: '#101016', padding: 20, display: 'grid', gap: 16, overflowX: 'auto' },
  letterhead: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', borderBottom: '1px solid #242735', paddingBottom: 12, flexWrap: 'wrap' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 },
  th: { textAlign: 'start', padding: '8px 10px', borderBottom: '1px solid #30384d', color: '#8d92a2', fontWeight: 700 },
  thNum: { textAlign: 'end', padding: '8px 10px', borderBottom: '1px solid #30384d', color: '#8d92a2', fontWeight: 700 },
  td: { padding: '8px 10px', borderBottom: '1px solid #1e2130' },
  tdNum: { padding: '8px 10px', borderBottom: '1px solid #1e2130', textAlign: 'end' },
  revenue: { display: 'flex', flexWrap: 'wrap', gap: 16, color: '#9aa6ba', fontSize: 14, borderTop: '1px solid #242735', paddingTop: 12 },
  disclaimer: { color: '#8d92a2', fontSize: 12, borderTop: '1px solid #242735', paddingTop: 12 },
}
