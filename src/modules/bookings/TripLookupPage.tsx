import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { lookupTripByConfirmation, type PlatformTripLookup } from '../../shared/api/platformApi'
import { divisionText, statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    title: 'تابع رحلتك',
    subtitle: 'أدخل رقم التأكيد ورقم هاتفك لمتابعة حالة حجزك من أي جهاز، بدون تسجيل دخول.',
    refLabel: 'رقم التأكيد',
    refPlaceholder: 'مثال: 3432C45D-22D',
    refHint: 'تجده في صفحة الدفع بعد إرسال طلب الحجز.',
    phoneLabel: 'رقم الهاتف',
    submit: 'عرض حالة الرحلة',
    searching: 'جار البحث...',
    notFound: 'لم نجد رحلة بهذا الرقم وهذا الهاتف. تحقق من البيانات وحاول مرة أخرى.',
    invalidInput: 'أدخل رقم التأكيد ورقم الهاتف.',
    genericError: 'تعذر البحث الآن. حاول مرة أخرى.',
    confirmationNumber: 'رقم التأكيد',
    status: 'حالة الحجز',
    payment: 'حالة الدفع',
    checkIn: 'الدخول',
    checkOut: 'الخروج',
    listing: 'الإقامة',
    division: 'القسم',
    back: 'العودة للرئيسية',
    noPaymentYet: 'لا يوجد دفع بعد',
  },
  en: {
    title: 'Track your trip',
    subtitle: 'Enter your confirmation number and phone number to check your booking status from any device, no login required.',
    refLabel: 'Confirmation number',
    refPlaceholder: 'e.g. 3432C45D-22D',
    refHint: 'Shown on the payment page after you send a booking request.',
    phoneLabel: 'Phone number',
    submit: 'Show trip status',
    searching: 'Searching...',
    notFound: 'No trip found for that confirmation number and phone number. Check the details and try again.',
    invalidInput: 'Enter both a confirmation number and a phone number.',
    genericError: 'Could not search right now. Try again.',
    confirmationNumber: 'Confirmation number',
    status: 'Booking status',
    payment: 'Payment status',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    listing: 'Stay',
    division: 'Division',
    back: 'Back to home',
    noPaymentYet: 'No payment yet',
  },
}

export function TripLookupPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [ref, setRef] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [message, setMessage] = useState('')
  const [trip, setTrip] = useState<PlatformTripLookup | null>(null)

  async function search() {
    if (!ref.trim() || !phone.trim()) {
      setStatus('error')
      setMessage(t.invalidInput)
      return
    }
    setStatus('loading')
    setMessage('')
    setTrip(null)
    try {
      const result = await lookupTripByConfirmation(ref.trim(), phone.trim())
      setTrip(result)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      const code = error instanceof Error && 'code' in error ? (error as { code?: string }).code : undefined
      setMessage(code === 'BOOKING_LOOKUP_NOT_FOUND' ? t.notFound : t.genericError)
    }
  }

  const listingTitle = trip ? (isAr ? trip.listingTitleAr || trip.listingTitleEn : trip.listingTitleEn || trip.listingTitleAr) : ''

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <section style={styles.hero}>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
      </section>

      <section style={styles.form}>
        <label style={styles.field}>
          <span>{t.refLabel}</span>
          <input
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            placeholder={t.refPlaceholder}
            style={styles.input}
            dir="ltr"
          />
          <small style={styles.hint}>{t.refHint}</small>
        </label>
        <label style={styles.field}>
          <span>{t.phoneLabel}</span>
          <input value={phone} onChange={(event) => setPhone(event.target.value)} style={styles.input} dir="ltr" type="tel" />
        </label>
        <button style={styles.primaryButton} disabled={status === 'loading'} onClick={() => void search()}>
          {status === 'loading' ? t.searching : t.submit}
        </button>
        {status === 'error' && <p style={styles.alert}>{message}</p>}
      </section>

      {status === 'ready' && trip && (
        <section style={styles.grid}>
          <Info label={t.confirmationNumber} value={trip.confirmationNumber} dir="ltr" strong />
          <Info label={t.status} value={statusText(trip.status, lang)} dir={isAr ? 'rtl' : 'ltr'} strong />
          <Info label={t.payment} value={trip.paymentStatus ? statusText(trip.paymentStatus, lang) : t.noPaymentYet} dir={isAr ? 'rtl' : 'ltr'} />
          {listingTitle && <Info label={t.listing} value={listingTitle} dir={isAr ? 'rtl' : 'ltr'} />}
          {trip.division && <Info label={t.division} value={divisionText(trip.division, lang)} dir={isAr ? 'rtl' : 'ltr'} />}
          {trip.checkIn && <Info label={t.checkIn} value={trip.checkIn.slice(0, 10)} dir="ltr" />}
          {trip.checkOut && <Info label={t.checkOut} value={trip.checkOut.slice(0, 10)} dir="ltr" />}
        </section>
      )}
    </main>
  )
}

function Info({ label, value, dir = 'ltr', strong = false }: { label: string; value: string; dir?: 'ltr' | 'rtl'; strong?: boolean }) {
  return (
    <article style={strong ? styles.infoStrong : styles.info}>
      <span>{label}</span>
      <strong dir={dir}>{value}</strong>
    </article>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 22, maxWidth: 720, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { display: 'grid', gap: 8 },
  title: { margin: 0, fontSize: 34, lineHeight: 1.1 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  form: { display: 'grid', gap: 14, border: '1px solid #30384d', borderRadius: 10, background: '#111118', padding: 18 },
  field: { display: 'grid', gap: 6 },
  input: { minHeight: 46, border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#fff', padding: '0 12px', fontFamily: 'inherit', fontSize: 15 },
  hint: { color: '#687082' },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 14px' },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 12, margin: 0 },
  grid: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' },
  info: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#9aa6ba', padding: 12, display: 'grid', gap: 6 },
  infoStrong: { border: '1px solid rgba(32,210,155,.45)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 12, display: 'grid', gap: 6 },
}
