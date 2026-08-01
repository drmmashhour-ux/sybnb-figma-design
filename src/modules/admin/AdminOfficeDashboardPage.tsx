import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchOfficeDashboard, type OfficeDashboard } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

// Auto-refresh cadence for the live view (office wall/tablet). 60s keeps the display current without
// hammering the API — every query behind /api/admin/office-dashboard is a bounded aggregate.
const REFRESH_MS = 60_000

const copy = {
  ar: {
    back: 'العودة',
    title: 'لوحة المكتب',
    subtitle: 'ملخّص مباشر للأمان والحجوزات والإيرادات والمهام — احفظه على الجهاز اللوحي في المكتب.',
    live: 'مباشر',
    updated: 'آخر تحديث',
    refresh: 'تحديث',
    download: '⬇ تنزيل نسخة',
    print: '🖨 طباعة / PDF',
    loading: 'جار التحميل…',
    error: 'تعذّر تحميل اللوحة',
    security: 'الأمان',
    lockedAccounts: 'حسابات مقفلة الآن',
    lockouts24h: 'إقفالات آخر ٢٤ ساعة',
    recentEvents: 'أحداث أمنية حديثة',
    noEvents: 'لا أحداث أمنية حديثة — كل شيء هادئ.',
    bookings: 'الحجوزات',
    totalBookings: 'إجمالي الحجوزات',
    checkInsToday: 'وصول اليوم',
    upcoming7d: 'قادمة (٧ أيام)',
    cancellations7d: 'إلغاءات (٧ أيام)',
    revenue: 'الإيرادات',
    grossApproved: 'إجمالي المدفوعات المعتمدة',
    approvedCount: 'عدد المدفوعات',
    refunds7d: 'المبالغ المستردة (٧ أيام)',
    pending: 'مهام بانتظار الإجراء',
    listingsReview: 'إعلانات للمراجعة',
    openDisputes: 'نزاعات مفتوحة',
    payoutsReady: 'دفعات جاهزة للتحويل',
    idChecks: 'مستندات هوية للمراجعة',
    snapshotNote: 'نسخة ثابتة تعمل بدون إنترنت — افتحها من الجهاز اللوحي في أي وقت.',
    generatedAt: 'أُنشئت في',
  },
  en: {
    back: 'Back',
    title: 'Office Dashboard',
    subtitle: 'A live summary of security, bookings, revenue and tasks — save it on the office tablet.',
    live: 'LIVE',
    updated: 'Updated',
    refresh: 'Refresh',
    download: '⬇ Download snapshot',
    print: '🖨 Print / PDF',
    loading: 'Loading…',
    error: 'Could not load the dashboard',
    security: 'Security',
    lockedAccounts: 'Accounts locked now',
    lockouts24h: 'Lockouts (last 24h)',
    recentEvents: 'Recent security events',
    noEvents: 'No recent security events — all quiet.',
    bookings: 'Bookings',
    totalBookings: 'Total bookings',
    checkInsToday: 'Check-ins today',
    upcoming7d: 'Upcoming (7 days)',
    cancellations7d: 'Cancellations (7 days)',
    revenue: 'Revenue',
    grossApproved: 'Approved payments (gross)',
    approvedCount: 'Payments count',
    refunds7d: 'Refunds (last 7 days)',
    pending: 'Awaiting action',
    listingsReview: 'Listings to review',
    openDisputes: 'Open disputes',
    payoutsReady: 'Payouts ready to send',
    idChecks: 'ID documents to review',
    snapshotNote: 'A static copy that works offline — open it on the tablet anytime.',
    generatedAt: 'Generated at',
  },
}

// Human-readable label for a security-event action code (also used in the downloaded snapshot).
function eventLabel(action: string, lang: Lang) {
  const map: Record<string, { ar: string; en: string }> = {
    SECURITY_LOGIN_LOCKOUT: { ar: 'إقفال حساب بعد محاولات دخول فاشلة', en: 'Account locked after failed logins' },
    BOOKING_CARD_REFUNDED: { ar: 'استرداد على البطاقة', en: 'Card refund issued' },
    DISPUTE_REFUNDED: { ar: 'استرداد نزاع', en: 'Dispute refunded' },
    ADMIN_FORCE_CANCEL: { ar: 'إلغاء إداري', en: 'Admin force-cancel' },
    ACCOUNT_STATUS_CHANGED: { ar: 'تغيير حالة حساب', en: 'Account status changed' },
    BOOKING_GUEST_CANCELLED: { ar: 'إلغاء من الضيف', en: 'Guest cancelled a booking' },
  }
  return map[action]?.[lang] || action.replace(/_/g, ' ').toLowerCase()
}

function timeText(iso: string, lang: Lang) {
  try {
    return new Date(iso).toLocaleString(lang === 'ar' ? 'ar-SY' : 'en-US')
  } catch {
    return iso
  }
}

// Builds a fully self-contained HTML document (inline CSS, static data, no scripts, no network) that the
// admin downloads and keeps on the office tablet — it opens offline in any browser. This is deliberately
// its OWN renderer (not the live React tree) so the saved file has zero runtime dependencies.
function buildSnapshotHtml(data: OfficeDashboard, lang: Lang): string {
  const t = copy[lang]
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const money = (minor: number) => moneyText(minor, data.revenue.currency, lang)
  const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  const stat = (label: string, value: string | number, accent = false) =>
    `<div class="stat${accent ? ' accent' : ''}"><div class="v">${esc(String(value))}</div><div class="l">${esc(label)}</div></div>`
  const events =
    data.security.recentEvents.length === 0
      ? `<p class="muted">${esc(t.noEvents)}</p>`
      : `<ul class="events">${data.security.recentEvents
          .map(
            (e) =>
              `<li><span class="ev">${esc(eventLabel(e.action, lang))}</span><span class="et">${esc(timeText(e.createdAt, lang))}</span></li>`,
          )
          .join('')}</ul>`
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>SYBNB — ${esc(t.title)} — ${esc(timeText(data.generatedAt, lang))}</title>
<style>
:root{--teal:#2DD4BF;--gold:#D4AF6A;--ink:#0f172a;--bg:#f8fafc;--card:#fff;--muted:#64748b;--line:#e2e8f0;--red:#dc2626}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;background:var(--bg);color:var(--ink);padding:24px}
h1{font-size:22px;margin:0}h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 12px}
header{display:flex;align-items:center;gap:14px;border-bottom:3px solid var(--teal);padding-bottom:14px;margin-bottom:20px}
.brand{font-weight:800;color:var(--teal);font-size:20px}.brand span{color:var(--gold)}
.gen{margin-inline-start:auto;color:var(--muted);font-size:13px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.stat{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.stat.accent{border-color:var(--gold);background:#fffdf6}
.stat .v{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums}.stat .l{font-size:12px;color:var(--muted);margin-top:2px}
.events{list-style:none;margin:0;padding:0}.events li{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px}
.events .et{color:var(--muted);white-space:nowrap}.muted{color:var(--muted);font-size:13px}
.note{margin-top:18px;color:var(--muted);font-size:12px;text-align:center}
@media(max-width:720px){.grid{grid-template-columns:1fr}}
</style></head><body>
<header><div class="brand">SY<span>BNB</span></div><h1>${esc(t.title)}</h1><div class="gen">${esc(t.generatedAt)}: ${esc(timeText(data.generatedAt, lang))}</div></header>
<div class="grid">
  <section class="card"><h2>🔒 ${esc(t.security)}</h2><div class="stats">
    ${stat(t.lockedAccounts, data.security.activeLocks, data.security.activeLocks > 0)}
    ${stat(t.lockouts24h, data.security.lockouts24h, data.security.lockouts24h > 0)}
  </div><div style="margin-top:14px"><h2>${esc(t.recentEvents)}</h2>${events}</div></section>
  <section class="card"><h2>🏠 ${esc(t.bookings)}</h2><div class="stats">
    ${stat(t.totalBookings, data.bookings.total)}
    ${stat(t.checkInsToday, data.bookings.checkInsToday)}
    ${stat(t.upcoming7d, data.bookings.upcoming7d)}
    ${stat(t.cancellations7d, data.bookings.cancellations7d)}
  </div></section>
  <section class="card"><h2>💵 ${esc(t.revenue)}</h2><div class="stats">
    ${stat(t.grossApproved, money(data.revenue.grossApprovedMinor), true)}
    ${stat(t.approvedCount, data.revenue.approvedCount)}
    ${stat(t.refunds7d, money(data.revenue.refunded7dMinor))}
  </div></section>
  <section class="card"><h2>📋 ${esc(t.pending)}</h2><div class="stats">
    ${stat(t.listingsReview, data.pending.listingsAwaitingReview, data.pending.listingsAwaitingReview > 0)}
    ${stat(t.openDisputes, data.pending.openDisputes, data.pending.openDisputes > 0)}
    ${stat(t.payoutsReady, data.pending.payoutsReady)}
    ${stat(t.idChecks, data.pending.idChecksPending)}
  </div></section>
</div>
<p class="note">${esc(t.snapshotNote)}</p>
</body></html>`
}

export function AdminOfficeDashboardPage({ lang }: Props) {
  const t = copy[lang]
  const [data, setData] = useState<OfficeDashboard | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await fetchOfficeDashboard()
      setData(next)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    timerRef.current = setInterval(() => void load(), REFRESH_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [load])

  const download = useCallback(() => {
    if (!data) return
    const html = buildSnapshotHtml(data, lang)
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date(data.generatedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-')
    a.href = url
    a.download = `sybnb-office-dashboard-${stamp}.html`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [data, lang])

  const money = (minor: number) => (data ? moneyText(minor, data.revenue.currency, lang) : '—')

  return (
    <div style={styles.page} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div style={styles.topbar}>
        <button style={styles.back} onClick={() => (window.location.hash = '/admin')}>
          ← {t.back}
        </button>
        <div style={styles.actions}>
          <button style={styles.ghost} onClick={() => void load()}>
            ⟳ {t.refresh}
          </button>
          <button style={styles.ghost} onClick={() => window.print()}>
            {t.print}
          </button>
          <button style={styles.primary} onClick={download} disabled={!data}>
            {t.download}
          </button>
        </div>
      </div>

      <div style={styles.header}>
        <div>
          <div style={styles.brand}>
            SY<span style={{ color: '#D4AF6A' }}>BNB</span>
          </div>
          <h1 style={styles.title}>{t.title}</h1>
          <p style={styles.subtitle}>{t.subtitle}</p>
        </div>
        <div style={styles.liveBox}>
          <span style={styles.liveDot} /> {t.live}
          {data ? <div style={styles.updatedText}>{t.updated}: {timeText(data.generatedAt, lang)}</div> : null}
        </div>
      </div>

      {loading && !data ? (
        <p style={styles.muted}>{t.loading}</p>
      ) : error && !data ? (
        <p style={{ ...styles.muted, color: '#dc2626' }}>{t.error}</p>
      ) : data ? (
        <div style={styles.grid}>
          <Panel title={`🔒 ${t.security}`}>
            <div style={styles.stats}>
              <Stat label={t.lockedAccounts} value={data.security.activeLocks} alert={data.security.activeLocks > 0} />
              <Stat label={t.lockouts24h} value={data.security.lockouts24h} alert={data.security.lockouts24h > 0} />
            </div>
            <h3 style={styles.subhead}>{t.recentEvents}</h3>
            {data.security.recentEvents.length === 0 ? (
              <p style={styles.muted}>{t.noEvents}</p>
            ) : (
              <ul style={styles.events}>
                {data.security.recentEvents.map((e) => (
                  <li key={e.id} style={styles.eventRow}>
                    <span>{eventLabel(e.action, lang)}</span>
                    <span style={styles.eventTime}>{timeText(e.createdAt, lang)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`🏠 ${t.bookings}`}>
            <div style={styles.stats}>
              <Stat label={t.totalBookings} value={data.bookings.total} />
              <Stat label={t.checkInsToday} value={data.bookings.checkInsToday} />
              <Stat label={t.upcoming7d} value={data.bookings.upcoming7d} />
              <Stat label={t.cancellations7d} value={data.bookings.cancellations7d} />
            </div>
          </Panel>

          <Panel title={`💵 ${t.revenue}`}>
            <div style={styles.stats}>
              <Stat label={t.grossApproved} value={money(data.revenue.grossApprovedMinor)} gold />
              <Stat label={t.approvedCount} value={data.revenue.approvedCount} />
              <Stat label={t.refunds7d} value={money(data.revenue.refunded7dMinor)} />
            </div>
          </Panel>

          <Panel title={`📋 ${t.pending}`}>
            <div style={styles.stats}>
              <Stat label={t.listingsReview} value={data.pending.listingsAwaitingReview} alert={data.pending.listingsAwaitingReview > 0} />
              <Stat label={t.openDisputes} value={data.pending.openDisputes} alert={data.pending.openDisputes > 0} />
              <Stat label={t.payoutsReady} value={data.pending.payoutsReady} />
              <Stat label={t.idChecks} value={data.pending.idChecksPending} />
            </div>
          </Panel>
        </div>
      ) : null}

      <p style={styles.footnote}>{t.snapshotNote}</p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={styles.card}>
      <h2 style={styles.panelTitle}>{title}</h2>
      {children}
    </section>
  )
}

function Stat({ label, value, alert, gold }: { label: string; value: string | number; alert?: boolean; gold?: boolean }) {
  return (
    <div
      style={{
        ...styles.stat,
        ...(gold ? styles.statGold : null),
        ...(alert ? styles.statAlert : null),
      }}
    >
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { maxWidth: 1100, margin: '0 auto', padding: '20px 16px 48px' },
  topbar: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
  actions: { marginInlineStart: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' },
  back: { background: 'transparent', border: 'none', color: '#0f766e', fontWeight: 700, cursor: 'pointer', fontSize: 15 },
  ghost: { background: '#fff', border: '1px solid #cbd5e1', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  primary: { background: '#2DD4BF', border: '1px solid #14b8a6', color: '#04312c', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 14, fontWeight: 800 },
  header: { display: 'flex', alignItems: 'flex-start', gap: 16, borderBottom: '3px solid #2DD4BF', paddingBottom: 16, marginBottom: 20, flexWrap: 'wrap' },
  brand: { fontWeight: 800, color: '#2DD4BF', fontSize: 22, letterSpacing: '.02em' },
  title: { fontSize: 26, margin: '4px 0 6px', color: '#0f172a' },
  subtitle: { margin: 0, color: '#64748b', fontSize: 14, maxWidth: 640 },
  liveBox: { marginInlineStart: 'auto', textAlign: 'end', color: '#0f766e', fontWeight: 800, fontSize: 13, letterSpacing: '.08em' },
  liveDot: { display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#22c55e', marginInlineEnd: 6 },
  updatedText: { color: '#64748b', fontWeight: 500, letterSpacing: 0, marginTop: 4, fontSize: 12 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 18, boxShadow: '0 1px 2px rgba(15,23,42,.04)' },
  panelTitle: { fontSize: 13, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', margin: '0 0 14px' },
  subhead: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', margin: '16px 0 8px' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 },
  stat: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px' },
  statGold: { borderColor: '#D4AF6A', background: '#fffdf6' },
  statAlert: { borderColor: '#fca5a5', background: '#fef2f2' },
  statValue: { fontSize: 28, fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' },
  statLabel: { fontSize: 12, color: '#64748b', marginTop: 2 },
  events: { listStyle: 'none', margin: 0, padding: 0 },
  eventRow: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid #eef2f7', fontSize: 13 },
  eventTime: { color: '#94a3b8', whiteSpace: 'nowrap' },
  muted: { color: '#64748b', fontSize: 13 },
  footnote: { marginTop: 22, color: '#94a3b8', fontSize: 12, textAlign: 'center' },
}

export default AdminOfficeDashboardPage
