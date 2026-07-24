import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  confirmStripePayment,
  createStripeCheckoutSession,
  fetchPrototypeBooking,
  fetchStripePaymentStatus,
  submitBookingContact,
  submitPrototypeReview,
  type PlatformBooking,
  type PlatformListing,
  type PlatformListingReview,
  type PlatformPaymentProof,
} from '../../shared/api/platformApi'
import { listingTitleText, moneyText, statusText } from '../../shared/i18n/display'
import { freeCancellationLabel } from '../../shared/booking/cancellationPolicy'
import { guestFeeSummary } from './guestFeeSummary'
import { BookingCancelDispute } from './BookingCancelDispute'

type Props = {
  bookingId: string
  lang: Lang
}

type BookingDetail = PlatformBooking & {
  listing?: PlatformListing
  payments?: PlatformPaymentProof[]
  review?: PlatformListingReview | null
}

const copy = {
  ar: {
    back: 'العودة للوحة',
    title: 'وسيلة الدفع الآمنة',
    subtitle: 'ادفع داخل SYBNB فقط ليبقى حجزك ومبلغك محميين.',
    loading: 'جار التحميل',
    error: 'تعذر تحميل الحجز',
    booking: 'رقم الحجز',
    listing: 'الإعلان',
    guest: 'الضيف',
    host: 'المضيف',
    status: 'الحالة',
    amount: 'المبلغ',
    payment: 'الدفع',
    protected: 'محمي',
    protectionTitle: 'حجزك محمي',
    protectionCopy: 'مبلغك محفوظ حتى تتم المراجعة والتأكيد.',
    aiBrainInstantTitle: 'الخطوة التالية: إتمام الدفع',
    aiBrainInstantCopy: 'استلمنا طلب حجزك. أكمل الدفع أدناه — يراجع فريق SYBNB إثبات الدفع قبل التأكيد النهائي.',
    payByCard: 'بطاقة ائتمان',
    payByWallet: 'محفظة محلية / شام كاش',
    payingByCard: 'جارٍ التحويل إلى صفحة الدفع...',
    stripeConfirming: 'جارٍ تأكيد الدفع بالبطاقة...',
    stripeConfirmError: 'تعذر تأكيد الدفع بالبطاقة. تواصل مع الدعم إذا خُصم المبلغ.',
    stripeCardNote: 'دفع فوري وآمن عبر Stripe. تأكيد تلقائي دون انتظار مراجعة الإدارة.',
    stripeWalletNote: 'تحويل يدوي عبر شام كاش، تحتاج مراجعة الإدارة بعد رفع الإثبات.',
    idGateTitle: 'معلومات التواصل قبل الدفع',
    idGateCopy: 'اكتب اسمك ورقم هاتفك حتى نتمكن من التواصل معك بخصوص هذه الرحلة، ولتتمكن لاحقاً من متابعة حجزك برقم التأكيد.',
    contactNameLabel: 'الاسم الكامل',
    contactPhoneLabel: 'رقم الهاتف',
    contactEmailLabel: 'البريد الإلكتروني',
    contactEmailConfirmLabel: 'تأكيد البريد الإلكتروني',
    contactEmailInvalid: 'أدخل بريداً إلكترونياً صالحاً.',
    contactEmailMismatch: 'البريدان الإلكترونيان غير متطابقين.',
    idGateSubmit: 'حفظ ومتابعة الدفع',
    idGateError: 'تعذر حفظ معلومات التواصل. تحقق من البيانات وحاول مرة أخرى.',
    draftTimeline: ['اختيار الاستضافة', 'ارفع إثبات الدفع', 'SYBNB يراجع', 'المضيف يوافق', 'تأكيد الحجز'],
    paidTimeline: ['تم إرسال الإثبات', 'SYBNB يراجع', 'المضيف يوافق', 'تأكيد الحجز', 'صرف المبلغ'],
    feeBreakdown: 'ملخص الدفع',
    stayAmount: 'قيمة الحجز',
    cleaningFee: 'رسوم الإزالة والتنظيف',
    taxes: 'الضرائب والرسوم المحلية',
    extraFees: 'رسوم إضافية',
    cancellationProtection: 'حماية الإلغاء',
    totalDue: 'الإجمالي المستحق',
    protectedFunds: 'مبلغك محمي بالكامل',
    guaranteeRows: ['لن يتحول المبلغ للمضيف قبل التأكيد', 'كل الإثباتات محفوظة داخل النظام', 'يمكنك فتح نزاع في أي وقت وسيراجعه فريق سيبنب'],
    noOutsidePay: 'تنبيه حماية: الدفعات خارج SYBNB غير محمية. ادفع فقط عبر المنصة لضمان أمان أموالك.',
    refund: 'طلب استرداد / نزاع',
    pay: 'دفع الآن',
    receipt: 'فتح الإيصال',
    protection: 'حماية الحجز',
    paymentStatus: 'حالة الدفع',
    dispute: 'الإبلاغ عن مشكلة',
    saving: 'جار الحفظ',
    openListing: 'فتح الإعلان',
    noPayment: 'لا يوجد إثبات دفع بعد.',
    saveBooking: 'حفظ الحجز',
    printBooking: 'طباعة الحجز',
    retention: 'يمكنك حفظ أو طباعة الحجز. معلومات الرحلة الحساسة تتم إزالتها أسبوعياً من حسابي ورحلتي.',
    leaveReview: 'أضف تقييمك',
    yourReview: 'تقييمك',
    reviewPlaceholder: 'كيف كانت إقامتك؟ (اختياري)',
    submitReview: 'إرسال التقييم',
    trackHint: 'احفظ رقم التأكيد أعلاه — استخدمه لاحقاً لمتابعة رحلتك من أي جهاز في صفحة "تابع رحلتك"',
  },
  en: {
    back: 'Back to dashboard',
    title: 'Secure Payment Method',
    subtitle: 'Pay only inside SYBNB so your booking and money stay protected.',
    loading: 'Loading',
    error: 'Could not load booking',
    booking: 'Booking ID',
    listing: 'Listing',
    guest: 'Guest',
    host: 'Host',
    status: 'Status',
    amount: 'Amount',
    payment: 'Payment',
    protected: 'Protected',
    protectionTitle: 'Your booking is protected',
    protectionCopy: 'Your money is held safely until review and confirmation.',
    aiBrainInstantTitle: 'Next step: complete payment',
    aiBrainInstantCopy: 'Your booking request was received. Complete payment below — the SYBNB team reviews the payment proof before final confirmation.',
    payByCard: 'Credit card',
    payByWallet: 'Local wallet / Sham Cash',
    payingByCard: 'Redirecting to secure checkout...',
    stripeConfirming: 'Confirming your card payment...',
    stripeConfirmError: 'Could not confirm the card payment. Contact support if you were charged.',
    stripeCardNote: 'Instant, secure payment via Stripe. Confirmed automatically, no admin wait.',
    stripeWalletNote: 'Manual Sham Cash transfer, needs admin review after you upload proof.',
    idGateTitle: 'Contact details before payment',
    idGateCopy: "Tell us your name and phone so we can reach you about this trip, and so you can track your booking later with your confirmation number.",
    contactNameLabel: 'Full name',
    contactPhoneLabel: 'Phone number',
    contactEmailLabel: 'Email',
    contactEmailConfirmLabel: 'Confirm email',
    contactEmailInvalid: 'Enter a valid email address.',
    contactEmailMismatch: 'The emails do not match.',
    idGateSubmit: 'Save and continue to payment',
    idGateError: 'Could not save your contact details. Check the fields and try again.',
    draftTimeline: ['Stay selected', 'Upload payment proof', 'SYBNB reviews', 'Host approves', 'Booking confirmed'],
    paidTimeline: ['Proof submitted', 'SYBNB reviewing', 'Host approves', 'Booking confirmed', 'Funds released'],
    feeBreakdown: 'Payment Summary',
    stayAmount: 'Booking amount',
    cleaningFee: 'Cleaning fee',
    taxes: 'Taxes and local fees',
    extraFees: 'Extra fees',
    cancellationProtection: 'Cancellation protection',
    totalDue: 'Total due',
    protectedFunds: 'Your funds are fully protected',
    guaranteeRows: ['Funds are not released before confirmation', 'All proofs are stored inside the system', 'You can open a dispute at any time and the SYBNB team will review it'],
    noOutsidePay: 'Protection warning: Payments outside SYBNB are not protected. Pay only through SYBNB.',
    refund: 'Refund / dispute request',
    pay: 'Pay now',
    receipt: 'Open receipt',
    protection: 'Booking protection',
    paymentStatus: 'Payment status',
    dispute: 'Report issue',
    saving: 'Saving',
    openListing: 'Open listing',
    noPayment: 'No payment proof yet.',
    saveBooking: 'Save booking',
    printBooking: 'Print booking',
    retention: 'You can save or print this booking. Sensitive trip data is removed weekly from My Account and Trip.',
    leaveReview: 'Leave a review',
    yourReview: 'Your review',
    reviewPlaceholder: 'How was your stay? (optional)',
    submitReview: 'Submit review',
    trackHint: 'Save the confirmation number above — use it later to track your trip from any device on the "Track your trip" page',
  },
}

export function BookingDetailPage({ bookingId, lang }: Props) {
  const t = copy[lang === 'ar' ? 'ar' : 'en']
  const isAr = lang === 'ar'
  const [booking, setBooking] = useState<BookingDetail | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewStatus, setReviewStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [reviewError, setReviewError] = useState('')
  const [stripeConfigured, setStripeConfigured] = useState(false)
  const [cardState, setCardState] = useState<'idle' | 'starting' | 'confirming' | 'error'>('idle')
  const [cardError, setCardError] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactEmailConfirm, setContactEmailConfirm] = useState('')
  const [contactSaveState, setContactSaveState] = useState<'idle' | 'saving' | 'error'>('idle')

  useEffect(() => {
    void loadBooking()
  }, [bookingId])

  useEffect(() => {
    fetchStripePaymentStatus()
      .then((result) => setStripeConfigured(result.configured))
      .catch(() => setStripeConfigured(false))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id')
    if (!sessionId) return

    setCardState('confirming')
    confirmStripePayment(sessionId)
      .then(() => {
        setCardState('idle')
        window.history.replaceState(null, '', window.location.pathname + window.location.hash)
        void loadBooking()
      })
      .catch((error) => {
        setCardState('error')
        setCardError(error instanceof Error ? error.message : t.stripeConfirmError)
      })
  }, [])

  async function payWithCard() {
    if (!booking) return
    setCardState('starting')
    setCardError('')
    try {
      const session = await createStripeCheckoutSession(booking.id)
      window.location.href = session.url
    } catch (error) {
      setCardState('error')
      setCardError(error instanceof Error ? error.message : t.stripeConfirmError)
    }
  }

  async function loadBooking() {
    setStatus('loading')
    setMessage('')

    try {
      setBooking(await fetchPrototypeBooking(bookingId))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function saveContactInfo() {
    // FIX 2: require a valid, matching email so a real confirmation can be sent.
    if (!booking || !contactName.trim() || !contactPhone.trim() || !contactEmailValid || !contactEmailsMatch) return
    setContactSaveState('saving')
    try {
      await submitBookingContact(booking.id, { guestName: contactName.trim(), guestPhone: contactPhone.trim(), guestEmail: contactEmail.trim() })
      await loadBooking()
      setContactSaveState('idle')
    } catch {
      setContactSaveState('error')
    }
  }

  async function submitReview() {
    if (!booking || reviewRating < 1) return
    setReviewStatus('saving')
    setReviewError('')

    try {
      const review = await submitPrototypeReview({ bookingId: booking.id, rating: reviewRating, comment: reviewComment.trim() || undefined })
      setBooking((current) => (current ? { ...current, review } : current))
      setShowReviewForm(false)
      setReviewStatus('idle')
    } catch (error) {
      setReviewStatus('error')
      setReviewError(error instanceof Error ? error.message : t.error)
    }
  }

  const listingTitle = booking?.listing ? listingTitleText(booking.listing, lang) : '-'
  const approvedPayment = booking?.payments?.find((payment) => payment.status === 'APPROVED')
  const latestPayment = booking?.payments?.[0]
  const isPaymentDraft = booking?.status === 'PAYMENT_PENDING' && !latestPayment
  const timeline = isPaymentDraft ? t.draftTimeline : t.paidTimeline
  const activeTimelineIndex = (() => {
    if (!booking) return 0
    if (isPaymentDraft) return 0
    if (latestPayment?.status === 'PENDING_ADMIN_REVIEW') return 1
    if (booking.status === 'REQUESTED') return 2
    if (['CONFIRMED', 'COMPLETED'].includes(booking.status)) return 3
    return latestPayment ? 1 : 0
  })()
  const fees = booking ? guestFeeSummary(booking) : undefined
  const paymentRoute = booking
    ? `/payment/local-wallet/${booking.id}/${fees?.totalMinor ?? booking.amountMinor}/${encodeURIComponent(booking.currency)}`
    : '/'
  const hasContactInfo = Boolean(booking?.metadata?.guestContactPhone)
  const isFallbackInspectionBooking = booking?.id.startsWith('fallback-booking-') === true
  const canContinueToPayment = hasContactInfo || isFallbackInspectionBooking
  // FIX 2: a valid, confirmed email is required so a real confirmation can be sent.
  const contactEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())
  const contactEmailsMatch = contactEmail === contactEmailConfirm

  function renderPaymentOptions() {
    if (!canContinueToPayment) {
      return (
        <div style={styles.idGate}>
          <strong>{t.idGateTitle}</strong>
          <small>{t.idGateCopy}</small>
          <label style={{ display: 'grid', gap: 6, width: '100%' }}>
            <span style={{ color: '#9aa6ba' }}>{t.contactNameLabel}</span>
            <input
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              style={styles.textInput}
              dir={isAr ? 'rtl' : 'ltr'}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, width: '100%' }}>
            <span style={{ color: '#9aa6ba' }}>{t.contactPhoneLabel}</span>
            <input
              value={contactPhone}
              onChange={(event) => setContactPhone(event.target.value)}
              style={styles.textInput}
              dir="ltr"
              type="tel"
            />
          </label>
          <label style={{ display: 'grid', gap: 6, width: '100%' }}>
            <span style={{ color: '#9aa6ba' }}>{t.contactEmailLabel}</span>
            <input
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
              style={styles.textInput}
              dir="ltr"
              type="email"
              autoComplete="email"
            />
          </label>
          <label style={{ display: 'grid', gap: 6, width: '100%' }}>
            <span style={{ color: '#9aa6ba' }}>{t.contactEmailConfirmLabel}</span>
            <input
              value={contactEmailConfirm}
              onChange={(event) => setContactEmailConfirm(event.target.value)}
              style={styles.textInput}
              dir="ltr"
              type="email"
              autoComplete="off"
            />
          </label>
          {contactEmail.length > 0 && !contactEmailValid && <small style={{ color: '#ff9aac' }}>{t.contactEmailInvalid}</small>}
          {contactEmailConfirm.length > 0 && !contactEmailsMatch && <small style={{ color: '#ff9aac' }}>{t.contactEmailMismatch}</small>}
          {contactSaveState === 'error' && <small style={{ color: '#ff9aac' }}>{t.idGateError}</small>}
          <button
            style={styles.primaryButton}
            disabled={!contactName.trim() || !contactPhone.trim() || !contactEmailValid || !contactEmailsMatch || contactSaveState === 'saving'}
            onClick={() => void saveContactInfo()}
          >
            {contactSaveState === 'saving' ? t.saving : t.idGateSubmit}
          </button>
        </div>
      )
    }

    if (!stripeConfigured) {
      return (
        <button style={styles.primaryButton} disabled={cardState === 'confirming'} onClick={() => (window.location.hash = paymentRoute)}>
          {t.pay}
        </button>
      )
    }

    return (
      <div style={styles.payOptions}>
        <button style={styles.payOptionCard} disabled={cardState === 'starting' || cardState === 'confirming'} onClick={() => void payWithCard()}>
          <strong>{cardState === 'starting' ? t.payingByCard : t.payByCard}</strong>
          <small>{t.stripeCardNote}</small>
        </button>
        <button style={styles.payOptionCard} disabled={cardState === 'confirming'} onClick={() => (window.location.hash = paymentRoute)}>
          <strong>{t.payByWallet}</strong>
          <small>{t.stripeWalletNote}</small>
        </button>
      </div>
    )
  }

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.flowNav} aria-label={isAr ? 'التنقل بين الخطوات' : 'Step navigation'}>
        <button
          style={styles.arrowButton}
          onClick={() => (window.location.hash = booking?.listing ? `/listing/${booking.listing.id}` : '/')}
          aria-label={isAr ? 'السابق' : 'Back'}
        >
          ‹
        </button>
        <button
          style={styles.arrowButton}
          disabled={!booking}
          onClick={() => (window.location.hash = approvedPayment ? `/payment/receipt/${approvedPayment.id}` : paymentRoute)}
          aria-label={isAr ? 'التالي' : 'Next'}
        >
          ›
        </button>
      </section>

      <section style={styles.hero}>
        <p style={styles.eyebrow}>{bookingId.slice(0, 12).toUpperCase()}</p>
        <h1 style={styles.title}>{t.title}</h1>
        <p style={styles.body}>{t.subtitle}</p>
        <button type="button" style={styles.trackLink} onClick={() => (window.location.hash = '/track')}>
          {t.trackHint}
        </button>
      </section>

      {status === 'loading' && <section style={styles.panel}>{t.loading}</section>}
      {status === 'error' && <section style={styles.alert}>{message}</section>}
      {status !== 'error' && message && <section style={styles.panel}>{message}</section>}

      {booking && (
        <>
          {cardState === 'confirming' && <section style={styles.panel}>{t.stripeConfirming}</section>}
          {cardState === 'error' && <section style={styles.alert}>{cardError}</section>}

          {isPaymentDraft && (
            <section style={styles.aiBrainPanel}>
              <div style={styles.aiBrainIcon}>✣</div>
              <div style={styles.protectionHeader}>
                <strong>{t.aiBrainInstantTitle}</strong>
                <small>{t.aiBrainInstantCopy}</small>
              </div>
              {renderPaymentOptions()}
            </section>
          )}

          <section style={styles.protectionPanel}>
            <div style={styles.shield}>♢</div>
            <div style={styles.protectionHeader}>
              <strong>{t.protectionTitle}</strong>
              <small>{t.protectionCopy}</small>
            </div>
          </section>

          <section style={styles.tunnelTimeline}>
              {timeline.map((step, index) => (
                <span key={step} style={index <= activeTimelineIndex ? styles.timelineActive : styles.timelineStep}>
                  {index <= activeTimelineIndex ? '✓' : '•'} {step}
                </span>
              ))}
          </section>

          <section style={styles.grid}>
            <Info label={t.status} value={statusText(booking.status, lang)} dir={isAr ? 'rtl' : 'ltr'} strong />
            <Info label={t.amount} value={moneyText(fees?.totalMinor ?? booking.amountMinor, booking.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} strong />
            <Info label={t.booking} value={booking.id} />
            <Info label={t.listing} value={listingTitle} />
            <Info label={t.guest} value={booking.guest?.displayName || booking.guestId.slice(0, 8).toUpperCase()} />
            <Info label={t.host} value={booking.listing?.owner?.displayName || booking.listing?.ownerId?.slice(0, 8).toUpperCase() || '-'} />
            <Info label={t.payment} value={latestPayment ? statusText(latestPayment.status, lang) : t.noPayment} dir={isAr ? 'rtl' : 'ltr'} />
          </section>

          <section style={styles.moneyTunnelGrid}>
            <article style={styles.breakdown}>
              <h2 style={styles.sectionTitle}>{t.feeBreakdown}</h2>
              <Info label={t.stayAmount} value={moneyText(fees?.stayAmountMinor ?? booking.amountMinor, booking.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} />
              {(fees?.cleaningFeeMinor ?? 0) > 0 && (
                <Info label={t.cleaningFee} value={moneyText(fees?.cleaningFeeMinor ?? 0, booking.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} />
              )}
              {(fees?.taxesMinor ?? 0) > 0 && <Info label={t.taxes} value={moneyText(fees?.taxesMinor ?? 0, booking.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} />}
              {(fees?.extraFeesMinor ?? 0) > 0 && (
                <Info label={t.extraFees} value={moneyText(fees?.extraFeesMinor ?? 0, booking.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} />
              )}
              {(fees?.cancellationProtectionFeeMinor ?? 0) > 0 && (
                <Info label={t.cancellationProtection} value={moneyText(fees?.cancellationProtectionFeeMinor ?? 0, booking.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} />
              )}
              <Info label={t.totalDue} value={moneyText(fees?.totalMinor ?? booking.amountMinor, booking.currency, lang)} dir={isAr ? 'rtl' : 'ltr'} strong />
            </article>
          </section>

          <section style={styles.actions}>
            {approvedPayment ? (
              <button style={styles.primaryButton} onClick={() => (window.location.hash = `/payment/receipt/${approvedPayment.id}`)}>
                {t.receipt}
              </button>
            ) : (
              <button
                style={styles.primaryButton}
                disabled={!canContinueToPayment}
                title={canContinueToPayment ? undefined : t.idGateTitle}
                onClick={() => canContinueToPayment && (window.location.hash = paymentRoute)}
              >
                {canContinueToPayment ? t.pay : t.idGateTitle}
              </button>
            )}
          </section>

          <BookingCancelDispute booking={booking} lang={lang} onChanged={() => void loadBooking()} />

          {booking.review && (
            <section style={styles.actions}>
              <Info label={t.yourReview} value={`${'★'.repeat(booking.review.rating)}${booking.review.comment ? ` · ${booking.review.comment}` : ''}`} dir={isAr ? 'rtl' : 'ltr'} />
            </section>
          )}

          {showReviewForm && !booking.review && (
            <section style={styles.actions}>
              <div style={{ display: 'flex', gap: 8 }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    style={{ ...styles.secondaryButton, color: star <= reviewRating ? '#e5b80b' : '#5f6472' }}
                    onClick={() => setReviewRating(star)}
                    aria-label={String(star)}
                  >
                    ★
                  </button>
                ))}
              </div>
              <textarea
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                placeholder={t.reviewPlaceholder}
                style={styles.textarea}
              />
              {reviewStatus === 'error' && <p style={styles.warning}>{reviewError}</p>}
              <button
                style={styles.primaryButton}
                disabled={reviewRating < 1 || reviewStatus === 'saving'}
                onClick={() => void submitReview()}
              >
                {reviewStatus === 'saving' ? t.saving : t.submitReview}
              </button>
            </section>
          )}
        </>
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
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 22, maxWidth: 1080, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 42, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  flowNav: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  arrowButton: { width: 54, height: 54, borderRadius: 999, border: '1px solid #30384d', background: '#111827', color: '#fff', fontSize: 34, fontWeight: 900, display: 'grid', placeItems: 'center' },
  hero: { display: 'grid', gap: 8, justifyItems: 'end' },
  eyebrow: { justifySelf: 'start', border: '1px solid rgba(229,184,11,.6)', borderRadius: 4, color: '#e5b80b', letterSpacing: 1, fontWeight: 900, fontSize: 14, margin: 0, padding: '8px 12px' },
  title: { margin: 0, fontSize: 40, lineHeight: 1.08 },
  body: { color: '#9aa6ba', margin: 0, lineHeight: 1.6 },
  trackLink: { background: 'none', border: 0, color: '#5f8fff', fontWeight: 800, padding: 0, textDecoration: 'underline', cursor: 'pointer' },
  protectionPanel: { border: '1px solid rgba(32,210,155,.35)', borderRadius: 14, background: 'rgba(32,210,155,.05)', padding: 44, display: 'grid', gap: 18, justifyItems: 'center', textAlign: 'center' },
  aiBrainPanel: { border: '1px solid rgba(213,169,21,.4)', borderRadius: 14, background: 'rgba(213,169,21,.07)', padding: 28, display: 'grid', gap: 14, justifyItems: 'center', textAlign: 'center' },
  aiBrainIcon: { width: 56, height: 56, borderRadius: 999, background: 'rgba(213,169,21,.15)', color: '#d5a915', display: 'grid', placeItems: 'center', fontSize: 26 },
  shield: { width: 92, height: 92, borderRadius: 999, background: 'rgba(32,210,155,.12)', color: '#20d29b', display: 'grid', placeItems: 'center', fontSize: 44 },
  protectionHeader: { display: 'grid', gap: 8 },
  protectedBadge: { background: 'rgba(32,210,155,.16)', borderRadius: 999, color: '#20d29b', fontWeight: 950, padding: '7px 12px' },
  timeline: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
  tunnelTimeline: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))' },
  timelineStep: { borderTop: '2px solid #30384d', color: '#687082', fontWeight: 900, padding: '16px 8px 0', textAlign: 'center' },
  timelineActive: { borderTop: '2px solid #20d29b', color: '#20d29b', fontWeight: 950, padding: '16px 8px 0', textAlign: 'center' },
  warning: { border: '1px solid rgba(255,95,125,.65)', borderRadius: 8, background: 'rgba(255,95,125,.08)', color: '#ff5f7d', fontWeight: 900, padding: 18 },
  grid: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' },
  moneyTunnelGrid: { display: 'grid', gap: 16, gridTemplateColumns: '1.2fr 1fr' },
  breakdown: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 18, display: 'grid', gap: 10 },
  guaranteeCard: { borderLeft: '5px solid #20d29b', borderRadius: 8, background: '#111118', padding: 18, display: 'grid', gap: 8 },
  sectionTitle: { gridColumn: '1 / -1', fontSize: 24, margin: 0 },
  info: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#9aa6ba', padding: 12, display: 'grid', gap: 6 },
  infoStrong: { border: '1px solid rgba(32,210,155,.45)', borderRadius: 8, background: 'rgba(32,210,155,.1)', color: '#b7ffe8', padding: 12, display: 'grid', gap: 6 },
  actions: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 14px' },
  payOptions: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', width: '100%' },
  payOptionCard: { display: 'grid', gap: 6, textAlign: 'start', border: '1px solid rgba(255,255,255,.14)', borderRadius: 10, background: 'rgba(255,255,255,.04)', padding: 16, color: '#fff', cursor: 'pointer' },
  idGate: { display: 'grid', gap: 12, width: '100%', textAlign: 'start', border: '1px solid rgba(255,96,96,.35)', borderRadius: 10, background: 'rgba(255,96,96,.06)', padding: 16, color: '#fff' },
  textInput: { minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#fff', padding: '0 12px', fontFamily: 'inherit', fontSize: 15 },
  secondaryButton: { minHeight: 48, border: '1px solid #30384d', borderRadius: 8, background: '#171b29', color: '#fff', fontWeight: 900, padding: '0 14px' },
  textarea: { minHeight: 80, border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', color: '#fff', padding: 12, fontFamily: 'inherit' },
  dangerButton: { minHeight: 48, border: '1px solid rgba(255,96,96,.5)', borderRadius: 8, background: 'rgba(255,96,96,.12)', color: '#ffd1d1', fontWeight: 900, padding: '0 14px' },
  panel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', color: '#9aa6ba', padding: 14 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
}
