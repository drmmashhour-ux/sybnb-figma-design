import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchAdminHostingCalendar, type PlatformAdminHosting } from '../../shared/api/platformApi'

type Props = { lang: Lang }

// AD1 (part 2) — the admin "Hosting" group: what's booked vs vacant across ALL hosts. It renders ONLY the
// /api/admin/hosting-calendar endpoint (the single availability source shared with the guest picker, host
// calendar, and booking guard) — no divergent data. Admin-only (the page it lives on is behind the gate).

const copy = {
  ar: {
    title: 'الاستضافة — محجوز عبر كل المضيفين',
    subtitle: 'من مصدر التوفر الوحيد (نفس ما يراه الضيف والمضيف ومانع الحجز المزدوج).',
    loading: 'جار التحميل...', error: 'تعذر تحميل تقويم الاستضافة.', empty: 'لا إعلانات إقامة بعد.',
    host: 'المضيف', booked: 'محجوز', blocked: 'محجوب', vacant: 'شاغر', nights: 'ليالٍ',
  },
  en: {
    title: 'Hosting — booked across all hosts',
    subtitle: 'From the single availability source (the same one the guest, host, and double-book guard read).',
    loading: 'Loading...', error: 'Could not load the hosting calendar.', empty: 'No stay listings yet.',
    host: 'Host', booked: 'Booked', blocked: 'Blocked', vacant: 'Vacant', nights: 'nights',
  },
}

function nightsBetween(checkIn: string, checkOut: string) {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime()
  return Math.max(1, Math.round(ms / 86_400_000))
}

export function AdminHostingCalendar({ lang }: Props) {
  const t = copy[lang === 'ar' ? 'ar' : 'en']
  const [data, setData] = useState<PlatformAdminHosting | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setStatus('loading')
    try {
      setData(await fetchAdminHostingCalendar())
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="operations-signals" style={styles.wrap} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div>
        <p>{t.title}</p>
        <span>{t.subtitle}</span>
      </div>
      {status === 'loading' && <span>{t.loading}</span>}
      {status === 'error' && <span style={styles.error}>{t.error}</span>}
      {status === 'ready' && data && (
        data.listings.length === 0 ? (
          <span>{t.empty}</span>
        ) : (
          <div style={styles.list}>
            {data.listings.map((row) => {
              const bookedNights = row.bookedRanges.reduce((sum, r) => sum + nightsBetween(r.checkIn, r.checkOut), 0)
              const isVacant = bookedNights === 0 && row.blockedDates.length === 0
              return (
                <article key={row.listingId} style={styles.row}>
                  <div style={styles.rowHead}>
                    <strong>{row.title}</strong>
                    <small>{t.host}: {row.hostName || '—'}</small>
                  </div>
                  <div style={styles.pills}>
                    {row.bookedRanges.map((r, i) => (
                      <span key={`b${i}`} style={{ ...styles.pill, ...styles.booked }} dir="ltr">
                        {t.booked}: {r.checkIn} → {r.checkOut} ({nightsBetween(r.checkIn, r.checkOut)} {t.nights})
                      </span>
                    ))}
                    {row.blockedDates.map((d) => (
                      <span key={`k${d}`} style={{ ...styles.pill, ...styles.blocked }} dir="ltr">{t.blocked}: {d}</span>
                    ))}
                    {isVacant && <span style={{ ...styles.pill, ...styles.vacant }}>{t.vacant}</span>}
                  </div>
                </article>
              )
            })}
          </div>
        )
      )}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'grid', gap: 12 },
  error: { color: '#ffd1d1' },
  list: { display: 'grid', gap: 8 },
  row: { border: '1px solid #242735', borderRadius: 8, background: '#0c1220', padding: 12, display: 'grid', gap: 8 },
  rowHead: { display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', color: '#9aa6ba' },
  pills: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  pill: { borderRadius: 6, padding: '4px 8px', fontSize: 12, fontWeight: 700 },
  booked: { background: 'rgba(82,108,255,.14)', color: '#8ea0ff', border: '1px solid rgba(82,108,255,.4)' },
  blocked: { background: 'rgba(229,184,11,.13)', color: '#e5b80b', border: '1px solid rgba(229,184,11,.4)' },
  vacant: { background: 'rgba(32,210,155,.12)', color: '#20d29b', border: '1px solid rgba(32,210,155,.4)' },
}
