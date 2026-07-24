import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchAdminDailyReport, type PlatformAdminDailyReport } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'

type Props = { lang: Lang }

// AD3 (part 2) — renders /api/admin/daily-report: the authoritative figures (compiled from records) as stat
// cards, plus the narrative (AI when configured, else the deterministic template). It performs NO math and
// invents NO number — every figure is read from the endpoint. Advisory + admin-reviewed. Admin-only page.

const copy = {
  ar: {
    title: 'التقرير اليومي', advisory: 'استشاري — للمراجعة من الإدارة فقط. كل رقم من السجلات الفعلية.',
    loading: 'جار التحميل...', error: 'تعذر تحميل التقرير.',
    newBookings: 'حجوزات جديدة (24 ساعة)', pendingReviews: 'بانتظار المراجعة', payoutsHold: 'دفعات قيد الحجز', payoutsHoldAmount: 'قيمة الدفعات المحجوزة', openDisputes: 'نزاعات مفتوحة',
    summary: 'الملخص', templateTag: 'قالب', aiTag: 'صياغة آلية',
  },
  en: {
    title: 'Daily report', advisory: 'Advisory — for admin review only. Every figure is from the actual records.',
    loading: 'Loading...', error: 'Could not load the report.',
    newBookings: 'New bookings (24h)', pendingReviews: 'Awaiting review', payoutsHold: 'Payouts in hold', payoutsHoldAmount: 'Payouts held (amount)', openDisputes: 'Open disputes',
    summary: 'Summary', templateTag: 'template', aiTag: 'AI-phrased',
  },
}

export function AdminDailyReport({ lang }: Props) {
  const t = copy[lang === 'ar' ? 'ar' : 'en']
  const isAr = lang === 'ar'
  const [report, setReport] = useState<PlatformAdminDailyReport | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')
    try {
      setReport(await fetchAdminDailyReport())
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  const f = report?.facts
  const stats = f
    ? [
        { label: t.newBookings, value: String(f.newBookings24h) },
        { label: t.pendingReviews, value: String(f.pendingReviewsTotal) },
        { label: t.payoutsHold, value: String(f.payoutsPendingHoldCount) },
        { label: t.payoutsHoldAmount, value: moneyText(f.payoutsPendingHoldMinor, 'USD', lang) },
        { label: t.openDisputes, value: String(f.openDisputes) },
      ]
    : []
  const narrative = report ? (isAr ? report.narrative.messageAr : report.narrative.messageEn) : null

  return (
    <section style={styles.wrap} dir={isAr ? 'rtl' : 'ltr'}>
      <div style={styles.head}>
        <h2 style={styles.title}>{t.title}</h2>
        <span style={styles.advisory}>{t.advisory}</span>
      </div>
      {status === 'loading' && <span style={styles.body}>{t.loading}</span>}
      {status === 'error' && <span style={styles.error}>{t.error}</span>}
      {status === 'ready' && report && (
        <>
          <div style={styles.stats}>
            {stats.map((s) => (
              <article key={s.label} style={styles.stat}>
                <span>{s.label}</span>
                <strong>{s.value}</strong>
              </article>
            ))}
          </div>
          {narrative && (
            <p style={styles.narrative}>
              <b>{t.summary}: </b>{narrative}
              <em style={styles.tag}>{report.narrative.source === 'ai' ? t.aiTag : t.templateTag}</em>
            </p>
          )}
        </>
      )}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { border: '1px solid #242735', borderRadius: 8, background: '#101016', padding: 16, display: 'grid', gap: 12 },
  head: { display: 'grid', gap: 4 },
  title: { margin: 0, fontSize: 20 },
  advisory: { color: '#8d92a2', fontSize: 12 },
  body: { color: '#9aa6ba' },
  error: { color: '#ffd1d1' },
  stats: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' },
  stat: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#9aa6ba', display: 'grid', gap: 6, padding: 12 },
  narrative: { color: '#c7cede', margin: 0, lineHeight: 1.6, fontSize: 14 },
  tag: { marginInlineStart: 8, color: '#8d92a2', fontSize: 11, border: '1px solid #30384d', borderRadius: 6, padding: '2px 6px' },
}
