import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchPrototypeHostOverview,
  type HostDashboardMode,
  type PlatformHostOverview,
} from '../../shared/api/platformApi'
import { moneyText, statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
  mode?: HostDashboardMode
}

type HostBooking = PlatformHostOverview['requests'][number]

const MONTHS = {
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
}

const DAYS = {
  ar: ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'],
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
}

const T = {
  ar: {
    title: 'تقويم الحجوزات',
    subtitle: 'الأيام المحجوزة من ضيوفك الحقيقيين. اضغط على يوم محجوز لعرض تفاصيل الحجز.',
    loading: 'جار التحميل...',
    error: 'تعذر تحميل الحجوزات.',
    legendBooked: 'يوم محجوز',
    todayBadge: 'اليوم',
    guest: 'الضيف',
    checkIn: 'الوصول',
    checkOut: 'المغادرة',
    status: 'الحالة',
    amount: 'المبلغ',
    reference: 'المرجع',
    listing: 'الإعلان',
    noneForDay: 'لا حجوزات في هذا اليوم.',
    pickDay: 'اختر يوماً محجوزاً لعرض التفاصيل.',
    readOnly: 'عرض فقط · لا يغيّر أي حجز',
  },
  en: {
    title: 'Bookings calendar',
    subtitle: 'Days booked by your real guests. Tap a booked day to see the booking details.',
    loading: 'Loading...',
    error: 'Could not load bookings.',
    legendBooked: 'Booked day',
    todayBadge: 'Today',
    guest: 'Guest',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    status: 'Status',
    amount: 'Amount',
    reference: 'Reference',
    listing: 'Listing',
    noneForDay: 'No bookings on this day.',
    pickDay: 'Pick a booked day to see details.',
    readOnly: 'Read-only · does not change any booking',
  },
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function toISO(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function bookingReference(id: string) {
  return `BK-${id.slice(0, 8).toUpperCase()}`
}

function listingLabel(booking: HostBooking, lang: Lang) {
  const listing = booking.listing
  if (!listing) return bookingReference(booking.id)
  if (lang === 'en') return listing.titleEn || listing.titleAr
  return listing.titleAr || listing.titleEn || bookingReference(booking.id)
}

export function HostBookingsPage({ lang, mode = 'host' }: Props) {
  const isAr = lang === 'ar'
  const t = T[lang]
  const [bookings, setBookings] = useState<HostBooking[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState('')

  useEffect(() => {
    let active = true
    setStatus('loading')
    fetchPrototypeHostOverview(mode)
      .then((overview) => {
        if (!active) return
        // Only real bookings that carry a date range and are not cancelled occupy calendar days.
        const active_bookings = overview.requests.filter(
          (request) =>
            request.checkIn &&
            request.checkOut &&
            !['CANCELLED', 'REJECTED', 'REFUNDED'].includes(request.status.toUpperCase()),
        )
        setBookings(active_bookings)
        setStatus('ready')
      })
      .catch(() => {
        if (active) setStatus('error')
      })
    return () => {
      active = false
    }
  }, [mode])

  // Map each occupied date (check-in inclusive → check-out exclusive) to the bookings covering it.
  const bookingsByDate = useMemo(() => {
    const map = new Map<string, HostBooking[]>()
    for (const booking of bookings) {
      if (!booking.checkIn || !booking.checkOut) continue
      let day = new Date(`${booking.checkIn}T00:00:00`)
      const end = new Date(`${booking.checkOut}T00:00:00`)
      while (day < end) {
        const iso = toISO(day)
        const list = map.get(iso) || []
        list.push(booking)
        map.set(iso, list)
        day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
      }
    }
    return map
  }, [bookings])

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const startOffset = first.getDay()
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    return Array.from({ length: startOffset + total }, (_, index) => {
      if (index < startOffset) return null
      return new Date(cursor.getFullYear(), cursor.getMonth(), index - startOffset + 1)
    })
  }, [cursor])

  const todayIso = toISO(new Date())
  const selectedBookings = selectedDay ? bookingsByDate.get(selectedDay) || [] : []

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.header}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.subtitle}>{t.subtitle}</p>
        <span style={styles.readOnly}>{t.readOnly}</span>
      </section>

      {status === 'error' && <p style={styles.error}>{t.error}</p>}

      <section style={styles.calendar}>
        <div style={styles.pickerHeader}>
          <button type="button" style={styles.navButton} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            ‹
          </button>
          <strong style={styles.monthTitle}>{MONTHS[lang][cursor.getMonth()]} {cursor.getFullYear()}</strong>
          <button type="button" style={styles.navButton} onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            ›
          </button>
        </div>

        <div style={styles.weekGrid}>
          {DAYS[lang].map((day, index) => (
            <span key={`${day}-${index}`} style={styles.weekDay}>{day}</span>
          ))}
        </div>

        <div style={styles.dayGrid}>
          {days.map((date, index) => {
            if (!date) return <span key={`empty-${index}`} />
            const iso = toISO(date)
            const dayBookings = bookingsByDate.get(iso) || []
            const isBooked = dayBookings.length > 0
            const isToday = iso === todayIso
            const isSelected = iso === selectedDay
            return (
              <button
                key={iso}
                type="button"
                disabled={!isBooked || status === 'loading'}
                onClick={() => setSelectedDay(iso)}
                aria-label={isBooked ? t.legendBooked : undefined}
                style={{
                  ...styles.dayButton,
                  ...(isBooked ? styles.dayBooked : {}),
                  ...(isToday ? styles.dayToday : {}),
                  ...(isSelected ? styles.daySelected : {}),
                }}
              >
                <span>{date.getDate()}</span>
                {isBooked && <small style={styles.dayCount}>{dayBookings.length}</small>}
              </button>
            )
          })}
        </div>

        <div style={styles.legend}>
          <b style={{ ...styles.dot, background: '#ff4e77' }} /> {t.legendBooked}
        </div>
      </section>

      <section style={styles.details}>
        {status === 'loading' ? (
          <p style={styles.muted}>{t.loading}</p>
        ) : !selectedDay ? (
          <p style={styles.muted}>{t.pickDay}</p>
        ) : selectedBookings.length === 0 ? (
          <p style={styles.muted}>{t.noneForDay}</p>
        ) : (
          <div style={styles.detailStack}>
            <strong style={styles.detailDay}>{selectedDay}</strong>
            {selectedBookings.map((booking) => (
              <article key={booking.id} style={styles.detailCard}>
                <div style={styles.detailHead}>
                  <strong>{listingLabel(booking, lang)}</strong>
                  <span style={styles.reference} dir="ltr">{bookingReference(booking.id)}</span>
                </div>
                <Row label={t.guest} value={booking.guest?.displayName || booking.guestId.slice(0, 8).toUpperCase()} />
                <Row label={t.checkIn} value={booking.checkIn || '-'} dir="ltr" />
                <Row label={t.checkOut} value={booking.checkOut || '-'} dir="ltr" />
                <Row label={t.status} value={statusText(booking.status, lang)} />
                <Row label={t.amount} value={moneyText(booking.amountMinor, booking.currency, lang)} dir="ltr" />
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function Row({ label, value, dir = 'ltr' }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div style={styles.row}>
      <span>{label}</span>
      <b dir={dir}>{value}</b>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '32px 16px 90px', display: 'grid', gap: 20, maxWidth: 860, margin: '0 auto' },
  header: { display: 'grid', gap: 8 },
  title: { margin: 0, fontSize: 30, lineHeight: 1.1 },
  subtitle: { margin: 0, color: '#9aa6ba', lineHeight: 1.6 },
  readOnly: { justifySelf: 'start', border: '1px solid rgba(255,78,119,.5)', borderRadius: 999, background: 'rgba(255,78,119,.1)', color: '#ff8fa8', padding: '4px 12px', fontSize: 12, fontWeight: 800 },
  error: { margin: 0, color: '#ffd1d1', fontWeight: 800 },
  calendar: { border: '1px solid #242735', borderRadius: 10, background: '#111118', padding: 16, display: 'grid', gap: 10 },
  pickerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  navButton: { minWidth: 44, minHeight: 44, borderRadius: 14, border: '1px solid #30384d', background: '#171b29', color: '#fff', fontSize: 24 },
  monthTitle: { color: '#fff', fontSize: 18 },
  weekGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 },
  weekDay: { color: '#d5a915', fontSize: 12, fontWeight: 900, textAlign: 'center' },
  dayGrid: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 },
  dayButton: { minHeight: 52, borderRadius: 13, border: '1px solid #242b3d', background: '#0c1220', color: '#5b6478', fontWeight: 900, fontSize: 15, display: 'grid', gap: 2, placeItems: 'center', padding: '4px 2px' },
  dayBooked: { background: 'rgba(255,78,119,.14)', borderColor: 'rgba(255,78,119,.5)', color: '#ff4e77' },
  dayToday: { boxShadow: '0 0 0 2px rgba(82,108,255,.65) inset' },
  daySelected: { boxShadow: '0 0 0 2px #d5a915 inset' },
  dayCount: { fontSize: 9, fontWeight: 900, color: '#ff8fa8', lineHeight: 1 },
  legend: { display: 'flex', alignItems: 'center', gap: 6, color: '#9aa6ba', fontSize: 12, fontWeight: 800 },
  dot: { width: 10, height: 10, borderRadius: 999, display: 'inline-block', marginInlineEnd: 4 },
  details: { border: '1px solid #242735', borderRadius: 10, background: '#111118', padding: 16, display: 'grid', gap: 10, minHeight: 120 },
  muted: { margin: 0, color: '#9aa6ba' },
  detailStack: { display: 'grid', gap: 12 },
  detailDay: { color: '#d5a915', fontSize: 16 },
  detailCard: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 14, display: 'grid', gap: 8 },
  detailHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  reference: { color: '#8ea0ff', fontWeight: 900, fontSize: 13 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba', fontWeight: 700 },
}
