import { useEffect, useState, type CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { cancelBooking, fetchCountryConfig, type PlatformBooking, type PlatformCountryConfig } from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'
import { cancellationCutoffDate, freeCancellationLabel } from '../../shared/booking/cancellationPolicy'
import { guestFeeSummary } from './guestFeeSummary'
import { OpenDisputeForm } from '../disputes/OpenDisputeForm'
import { isSelfServeCancellationOffered } from '../../shared/booking/pilotScopeUi'

// STR guest cancellation + dispute entry point on the booking detail screen.
// - CONFIRMED/REQUESTED booking → policy + Cancel with a confirm dialog stating refund & withheld fee.
// - COMPLETED booking → "open a dispute".
// The fee/refund is derived client-side from the booking policy because the cancel API returns only the
// updated (CANCELLED) booking (the breakdown is audit-logged server-side, matching bookings.mjs).
const CANCELLABLE = ['REQUESTED', 'CONFIRMED']

const copy = {
  ar: {
    heading: 'إلغاء الحجز',
    cancel: 'إلغاء الحجز',
    confirmTitle: 'تأكيد الإلغاء',
    fullRefund: 'استرداد كامل',
    refund: 'المبلغ المُعاد',
    feeWithheld: 'رسوم إلغاء محتجزة',
    protectionNote: 'رسوم حماية الإلغاء غير قابلة للاسترداد.',
    confirm: 'تأكيد الإلغاء',
    cancelling: 'جار الإلغاء...',
    keep: 'تراجع',
    cancelledTitle: 'تم إلغاء الحجز',
    genericError: 'تعذر إلغاء الحجز، حاول مجددًا.',
    pilotCancelNote: 'يتم التعامل مع الإلغاء عبر الدعم خلال المرحلة التجريبية. أرسل طلبًا أدناه وسيقوم المشرف بمعالجة الإلغاء وأي استرداد.',
  },
  en: {
    heading: 'Cancel booking',
    cancel: 'Cancel booking',
    confirmTitle: 'Confirm cancellation',
    fullRefund: 'Full refund',
    refund: 'Refund',
    feeWithheld: 'Cancellation fee withheld',
    protectionNote: 'The cancellation-protection fee is non-refundable.',
    confirm: 'Confirm cancellation',
    cancelling: 'Cancelling…',
    keep: 'Keep booking',
    cancelledTitle: 'Booking cancelled',
    genericError: 'Could not cancel the booking. Please try again.',
    pilotCancelNote: 'Cancellation is handled by support during the pilot. Open a request below and an admin will process your cancellation and any refund.',
  },
}

export function BookingCancelDispute({ booking, lang, onChanged }: { booking: PlatformBooking; lang: Lang; onChanged: () => void }) {
  const isAr = lang === 'ar'
  const t = isAr ? copy.ar : copy.en
  const [country, setCountry] = useState<PlatformCountryConfig | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle')
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<{ refund: number; fee: number } | null>(null)

  useEffect(() => {
    fetchCountryConfig('SY').then(setCountry).catch(() => setCountry(null))
  }, [])

  const fees = guestFeeSummary(booking)
  const protectedPlan = booking.metadata?.cancellationProtectionPurchased === true
  const cutoff = cancellationCutoffDate(booking.checkIn || undefined, protectedPlan)
  const freeWindow = cutoff ? Date.now() < cutoff.getTime() : false
  const paid = booking.amountMinor
  const flatFee = country?.strLateCancelFee
    ? (booking.currency === 'USD' ? country.strLateCancelFee.feeMinorUsd : country.strLateCancelFee.feeMinor)
    : 0
  // Mirror bookings.mjs: waived (free window OR protected) = no cancel fee; else flat fee capped at refund.
  const protectionFee = protectedPlan ? fees.cancellationProtectionFeeMinor : 0
  const baseRefund = Math.max(0, paid - protectionFee)
  const fee = freeWindow || protectedPlan ? 0 : Math.min(flatFee, baseRefund)
  const refund = baseRefund - fee
  const waived = freeWindow || protectedPlan

  async function confirmCancel() {
    setState('saving')
    setError('')
    try {
      await cancelBooking(booking.id)
      setOutcome({ refund, fee })
      setState('done')
      onChanged()
    } catch (err) {
      setState('idle')
      setError(err instanceof Error && err.message ? err.message : t.genericError)
    }
  }

  if (state === 'done') {
    return (
      <section style={styles.box} dir={isAr ? 'rtl' : 'ltr'}>
        <h3 style={styles.title}>{t.cancelledTitle}</h3>
        <p style={styles.line}>{outcome && outcome.fee > 0
          ? `${t.refund}: ${moneyText(outcome.refund, booking.currency, lang)} · ${t.feeWithheld}: ${moneyText(outcome.fee, booking.currency, lang)}`
          : `${t.fullRefund}: ${moneyText(outcome?.refund ?? refund, booking.currency, lang)}`}</p>
      </section>
    )
  }

  if (booking.status === 'COMPLETED') {
    return <OpenDisputeForm lang={lang} bookingId={booking.id} />
  }

  if (!CANCELLABLE.includes(booking.status)) return null

  // Section B2: in the Sham-Cash-only pilot the automated self-serve cancel is deferred (its money-movement
  // is not yet fully tested). Route to the admin-handled path — open a dispute / contact support — so a
  // cancellation can still happen manually and no one is trapped. Never renders the automated cancel button.
  if (!isSelfServeCancellationOffered(country?.scope)) {
    return (
      <section style={styles.box} dir={isAr ? 'rtl' : 'ltr'}>
        <h3 style={styles.title}>{t.heading}</h3>
        <p style={styles.policy}>{t.pilotCancelNote}</p>
        <OpenDisputeForm lang={lang} bookingId={booking.id} />
      </section>
    )
  }

  return (
    <section style={styles.box} dir={isAr ? 'rtl' : 'ltr'}>
      <h3 style={styles.title}>{t.heading}</h3>
      <p style={styles.policy}>{freeCancellationLabel(booking.checkIn || undefined, protectedPlan, lang)}</p>

      {!confirming ? (
        <button style={styles.dangerButton} onClick={() => setConfirming(true)}>{t.cancel}</button>
      ) : (
        <div style={styles.confirm}>
          <strong>{t.confirmTitle}</strong>
          {waived ? (
            <p style={styles.line}>{t.fullRefund}: {moneyText(refund, booking.currency, lang)}{protectedPlan && protectionFee > 0 ? ` · ${t.protectionNote}` : ''}</p>
          ) : (
            <p style={styles.line}>{t.refund}: {moneyText(refund, booking.currency, lang)} · {t.feeWithheld}: {moneyText(fee, booking.currency, lang)}</p>
          )}
          {error && <p style={styles.error} role="alert">{error}</p>}
          <div style={styles.actions}>
            <button style={styles.dangerButton} disabled={state === 'saving'} onClick={() => void confirmCancel()}>
              {state === 'saving' ? t.cancelling : t.confirm}
            </button>
            <button style={styles.secondaryButton} disabled={state === 'saving'} onClick={() => setConfirming(false)}>{t.keep}</button>
          </div>
        </div>
      )}
    </section>
  )
}

const styles: Record<string, CSSProperties> = {
  box: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 12, border: '1px solid #f0d9d9', background: '#fff' },
  title: { fontSize: 16, margin: 0 },
  policy: { fontSize: 13, color: '#555', margin: 0 },
  line: { fontSize: 14, color: '#333', margin: 0 },
  confirm: { display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 10, background: 'rgba(179,38,30,.05)', border: '1px solid #f0d9d9' },
  actions: { display: 'flex', gap: 10 },
  dangerButton: { padding: '10px 16px', borderRadius: 10, border: 'none', background: '#b3261e', color: '#fff', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  secondaryButton: { padding: '10px 16px', borderRadius: 10, border: '1px solid #ccd', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' },
  error: { color: '#b3261e', fontSize: 13, margin: 0 },
}
