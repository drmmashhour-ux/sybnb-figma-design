import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createPrototypeBooking,
  fetchListingQuote,
  fetchPrototypeListing,
  type PlatformListing,
  type PlatformStayQuoteBreakdown,
} from '../../shared/api/platformApi'
import { listingTitleText, moneyText } from '../../shared/i18n/display'
import { freeCancellationLabel } from '../../shared/booking/cancellationPolicy'
import { dropPastDates, isValidDate, nightsBetween, type DateRange } from '../search/DateRangePicker'
import { sypMinorToRoundedUsdMinor } from '../../shared/currency'

type Props = {
  listingId: string
  lang: Lang
}

// This page is SYBNB's equivalent of Airbnb's "Request to book" / Booking.com's checkout step —
// the one deliberate point of no return. ListingDetailPage (the PDP) only ever lets a guest
// browse and configure a stay; the real reservation is created here, and only here, right next
// to the terms checkbox and the single unambiguous confirm button. Keeping this on its own route
// (rather than a section of the PDP) is what makes "still deciding" and "about to pay" visibly
// different screens, the way real platforms do it.

const copy = {
  ar: {
    back: 'العودة إلى الإعلان',
    loading: 'جار التحميل',
    error: 'تعذر تحميل تفاصيل الحجز',
    title: 'مراجعة الحجز',
    subtitle: 'راجع تفاصيل إقامتك والسعر قبل إرسال طلب الحجز.',
    tripSummary: 'ملخص الرحلة',
    checkIn: 'تاريخ الدخول',
    checkOut: 'تاريخ الخروج',
    nights: (n: number) => `${n} ${n === 1 ? 'ليلة' : 'ليالٍ'}`,
    priceBreakdown: 'تفاصيل السعر',
    stayAmount: 'قيمة الحجز',
    nightlySubtotal: 'قيمة الإقامة (قبل التنظيف)',
    cleaningFee: 'رسوم التنظيف',
    guestServiceFee: 'رسوم خدمة الضيف',
    guestServiceFeeNotCharged: 'لا تُحصَّل حالياً',
    refundableDeposit: 'تأمين قابل للاسترداد',
    refundableDepositNotApplicable: 'غير مطبَّق حالياً',
    lodgingTax: 'ضريبة الإقامة في كيبيك (3.5%، تقديرية)',
    gst: 'ضريبة السلع والخدمات الفيدرالية GST (5%، تقديرية)',
    qst: 'ضريبة كيبيك على المبيعات QST (9.975%، تقديرية)',
    taxIncludedHint: 'المعدلات المعروضة هي المعدلات الرسمية المنشورة (3.5% إقامة، 5% GST، 9.975% QST)، لكن SYBNB لا تُحصّلها أو تُحوّلها فعلياً بعد — وضع اختبار فقط.',
    testModeBadge: 'وضع الاختبار',
    taxDisclosureBanner: 'وضع الاختبار — تقدير ضريبي لأغراض إعلامية فقط. لا يُحوَّل ولا يُسدَّد أي مبلغ لأي جهة حكومية.',
    collectedTax: 'الضريبة المحصَّلة فعلياً',
    remittedTax: 'الضريبة المحوَّلة فعلياً للحكومة',
    zeroTestMode: '0 (وضع الاختبار)',
    cancellationProtection: 'حماية الإلغاء',
    totalDue: 'الإجمالي المستحق',
    agreementTitle: 'اتفاقية الإيجار اليومي',
    agreementCopy: 'أوافق على صحة بياناتي، احترام سياسة الحجز والإلغاء، الدفع داخل SYBNB فقط، عدم الاتفاق خارج المنصة، والالتزام بقواعد الاستضافة. نرجو منك التواصل مع فريق SYBNB أولاً لنحل مشكلتك بسرعة. هذا لا يحدّ من حقك في التواصل مع جهة حماية المستهلك أو اللجوء إلى القضاء في أي وقت.',
    agreementRequired: 'يجب قبول اتفاقية الإيجار اليومي قبل إرسال طلب الحجز.',
    agreementVersion: 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1',
    agreementVersionLabel: '',
    confirm: 'تأكيد وإرسال طلب الحجز',
    saving: 'جار الإرسال',
    datesMissing: 'استخدم أداة اختيار التواريخ في صفحة الإعلان لتحديد تاريخ الوصول والمغادرة، ثم تابع.',
    freeCancellation: 'إلغاء مجاني',
  },
  en: {
    back: 'Back to listing',
    loading: 'Loading',
    error: 'Could not load booking details',
    title: 'Review your booking',
    subtitle: 'Review your stay details and price before sending the booking request.',
    tripSummary: 'Trip summary',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    nights: (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`,
    priceBreakdown: 'Price breakdown',
    stayAmount: 'Booking amount',
    nightlySubtotal: 'Accommodation (before cleaning)',
    cleaningFee: 'Cleaning fee',
    guestServiceFee: 'Guest service fee',
    guestServiceFeeNotCharged: 'Not charged today',
    refundableDeposit: 'Refundable deposit',
    refundableDepositNotApplicable: 'Not applicable today',
    lodgingTax: 'Québec lodging tax (3.5%, estimated)',
    gst: 'Federal GST (5%, estimated)',
    qst: 'Québec QST (9.975%, estimated)',
    taxIncludedHint: 'These are the real published rates (3.5% lodging, 5% GST, 9.975% QST), but SYBNB is not yet actually collecting or remitting them — test mode only.',
    testModeBadge: 'TEST MODE',
    taxDisclosureBanner: 'TEST MODE — Tax estimate for information only. No amount is transmitted or remitted to a government authority.',
    collectedTax: 'Actually collected',
    remittedTax: 'Actually remitted to government',
    zeroTestMode: '0 (test mode)',
    cancellationProtection: 'Cancellation protection',
    totalDue: 'Total due',
    agreementTitle: 'Short-Term Rental Agreement',
    agreementCopy: 'I agree that my information is accurate, booking and cancellation rules apply, payment happens only inside SYBNB, no outside-platform agreement is allowed, and stay rules must be respected. We ask you to contact the SYBNB team first so we can resolve your issue quickly. This does not limit your right to contact a consumer-protection regulator or a court at any time.',
    agreementRequired: 'You must accept the short-term rental agreement before sending the booking request.',
    agreementVersion: 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1',
    agreementVersionLabel: '',
    confirm: 'Confirm and send booking request',
    saving: 'Sending',
    datesMissing: 'Use the date selector on the listing page to choose your check-in and check-out dates, then continue.',
    freeCancellation: 'Free cancellation',
  },
  fr: {
    back: "Retour à l'annonce",
    loading: 'Chargement',
    error: 'Impossible de charger les détails de la réservation',
    title: 'Vérifiez votre réservation',
    subtitle: 'Vérifiez les détails de votre séjour et le prix avant d\'envoyer la demande de réservation.',
    tripSummary: 'Résumé du séjour',
    checkIn: "Date d'arrivée",
    checkOut: 'Date de départ',
    nights: (n: number) => `${n} ${n === 1 ? 'nuit' : 'nuits'}`,
    priceBreakdown: 'Détail du prix',
    stayAmount: 'Montant de la réservation',
    nightlySubtotal: "Hébergement (avant le ménage)",
    cleaningFee: 'Frais de ménage',
    guestServiceFee: 'Frais de service du client',
    guestServiceFeeNotCharged: "Non facturés actuellement",
    refundableDeposit: 'Dépôt remboursable',
    refundableDepositNotApplicable: 'Non applicable actuellement',
    lodgingTax: "Taxe sur l'hébergement du Québec (3,5%, estimée)",
    gst: 'TPS fédérale (5%, estimée)',
    qst: 'TVQ du Québec (9,975%, estimée)',
    taxIncludedHint: "Il s'agit des taux officiels publiés (3,5% hébergement, 5% TPS, 9,975% TVQ), mais SYBNB ne les perçoit ni ne les remet encore réellement — mode test uniquement.",
    testModeBadge: 'MODE TEST',
    taxDisclosureBanner: "MODE TEST — Estimation fiscale fournie à titre informatif seulement. Aucun montant n'est transmis ou remis à une autorité gouvernementale.",
    collectedTax: 'Réellement perçue',
    remittedTax: 'Réellement remise au gouvernement',
    zeroTestMode: '0 (mode test)',
    cancellationProtection: "Protection d'annulation",
    totalDue: 'Total dû',
    agreementTitle: 'Entente de location à court terme',
    agreementCopy: "J'accepte que mes renseignements soient exacts, que les règles de réservation et d'annulation s'appliquent, que le paiement se fasse uniquement à l'intérieur de SYBNB, qu'aucune entente hors plateforme ne soit permise et que les règles de séjour soient respectées. Nous vous invitons à contacter d'abord l'équipe SYBNB afin de résoudre rapidement votre problème. Cela ne limite pas votre droit de contacter un organisme de protection du consommateur ou un tribunal à tout moment.",
    agreementRequired: "Vous devez accepter l'entente de location à court terme avant d'envoyer la demande de réservation.",
    agreementVersion: 'SYBNB_SHORT_TERM_RENTAL_GUEST_AGREEMENT_V1',
    agreementVersionLabel: '',
    confirm: 'Confirmer et envoyer la demande de réservation',
    saving: 'Envoi en cours',
    datesMissing: "Utilisez le sélecteur de dates sur la page de l'annonce pour choisir vos dates d'arrivée et de départ, puis continuez.",
    freeCancellation: 'Annulation gratuite',
  },
}

const DIVISION_IMAGES: Record<string, string> = {
  STAYS: '/assets/divisions/daily-rental.webp',
}

export function BookingReviewPage({ listingId, lang }: Props) {
  const t = copy[lang] ?? copy.en
  const isAr = lang === 'ar'
  const [listing, setListing] = useState<PlatformListing | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const draft = useMemo(() => loadBookingDraft(listingId), [listingId])
  const [acceptedGuestAgreement, setAcceptedGuestAgreement] = useState(false)
  const [stayQuote, setStayQuote] = useState<{ totalMinor: number; nights: number } | null>(null)
  const [stayBreakdown, setStayBreakdown] = useState<PlatformStayQuoteBreakdown | null>(null)
  // FIX MINOR: drop any persisted past range so the review header never shows dates earlier than today.
  const dateRange: DateRange = dropPastDates(draft.dateRange)
  const cancellationProtection = draft.cancellationProtection ?? false
  // M4: guest currency is USD-only for launch (the listing page already forces USD). Default to USD so a
  // draft that somehow lacks a currency can never fall back to a SYP guest display.
  const payCurrency = draft.payCurrency ?? 'USD'

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (!isValidDate(dateRange.checkIn) || !isValidDate(dateRange.checkOut) || nightsBetween(dateRange.checkIn, dateRange.checkOut) < 1) {
        window.location.hash = `/listing/${listingId}`
        return
      }
    }
    void loadListing()
    void loadQuote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId])

  async function loadListing() {
    setStatus('loading')
    setMessage('')
    try {
      setListing(await fetchPrototypeListing(listingId))
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  async function loadQuote() {
    try {
      const response = await fetchListingQuote(listingId, dateRange.checkIn, dateRange.checkOut, payCurrency === 'USD' ? 'USD' : undefined)
      setStayQuote({ totalMinor: response.totalMinor, nights: response.nights })
      setStayBreakdown(response.breakdown ?? null)
    } catch {
      setStayQuote(null)
      setStayBreakdown(null)
    }
  }

  const nights = stayQuote?.nights ?? (isValidDate(dateRange.checkIn) && isValidDate(dateRange.checkOut) ? nightsBetween(dateRange.checkIn, dateRange.checkOut) : 0)
  const billableNights = Math.max(nights, 1)
  const fallbackNightlyMinor = payCurrency === 'USD' && listing?.currency === 'SYP'
    ? sypMinorToRoundedUsdMinor(listing.priceMinor)
    : listing?.priceMinor ?? 0
  const stayAmountMinor = stayQuote?.totalMinor ?? fallbackNightlyMinor * billableNights
  const protectionFeeMinor = cancellationProtection ? Math.round(stayAmountMinor * 0.03) : 0
  const totalDueMinor = stayAmountMinor + protectionFeeMinor

  async function confirmBooking() {
    if (!listing) return
    if (!acceptedGuestAgreement) {
      setMessage(t.agreementRequired)
      return
    }
    setStatus('saving')
    setMessage('')
    try {
      const booking = await createPrototypeBooking({
        listingId: listing.id,
        amountMinor: totalDueMinor,
        currency: payCurrency,
        checkIn: dateRange.checkIn,
        checkOut: dateRange.checkOut,
        cancellationProtectionPurchased: cancellationProtection,
        cancellationProtectionFeeMinor: cancellationProtection ? protectionFeeMinor : undefined,
        acceptedTerms: true,
        termsVersion: t.agreementVersion,
      })
      clearBookingDraft(listing.id)
      window.location.hash = `/booking/${booking.id}`
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  const title = listing ? listingTitleText(listing, lang) : ''

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.flowNav}>
        <button style={styles.arrowButton} onClick={() => (window.location.hash = `/listing/${listingId}`)} aria-label={t.back}>
          ‹
        </button>
      </section>

      {status === 'loading' && <section style={styles.panel}>{t.loading}</section>}
      {message && <section style={styles.alert}>{message}</section>}

      {listing && (
        <>
          <div style={styles.titleBlock}>
            <h1 style={styles.title}>{t.title}</h1>
            <p style={styles.subtitle}>{t.subtitle}</p>
          </div>

          <section style={styles.listingRecap}>
            <img
              src={listingImage(listing)}
              alt={title}
              style={styles.recapImage}
              onError={(event) => {
                const fallback = DIVISION_IMAGES.STAYS
                if (event.currentTarget.src.endsWith(fallback)) return
                event.currentTarget.src = fallback
              }}
            />
            <div>
              <strong>{title}</strong>
              <span>{listing.owner?.displayName || (isAr ? 'مضيف SYBNB' : 'SYBNB Host')}</span>
            </div>
          </section>

          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>{t.tripSummary}</h2>
            <div style={styles.grid}>
              <Info label={t.checkIn} value={dateRange.checkIn} />
              <Info label={t.checkOut} value={dateRange.checkOut} />
              {/* Money-model correction (2026-07-22): stayAmountMinor is now the all-inclusive total
                  (nightly + cleaning fee), so dividing IT by nights would inflate the shown per-night
                  rate whenever a cleaning fee applies. Use the breakdown's real nightly-only subtotal
                  once it's loaded; fall back to the inclusive figure only before the quote resolves. */}
              <Info
                label={t.nights(nights)}
                value={moneyText((stayBreakdown?.nightlySubtotalMinor ?? stayAmountMinor) / Math.max(nights, 1), payCurrency, lang)}
              />
            </div>
            <em style={styles.cancellationCutoff}>
              {t.freeCancellation}: {freeCancellationLabel(dateRange.checkIn, cancellationProtection, lang)}
            </em>
          </section>

          <section style={styles.card}>
            <h2 style={styles.sectionTitle}>{t.priceBreakdown}</h2>
            {stayBreakdown ? (
              <>
                <Info label={t.nightlySubtotal} value={moneyText(stayBreakdown.nightlySubtotalMinor, payCurrency, lang)} />
                {stayBreakdown.cleaningFeeMinor > 0 && (
                  <Info label={t.cleaningFee} value={moneyText(stayBreakdown.cleaningFeeMinor, payCurrency, lang)} />
                )}
                <Info
                  label={t.guestServiceFee}
                  value={stayBreakdown.guestServiceFeeMinor > 0 ? moneyText(stayBreakdown.guestServiceFeeMinor, payCurrency, lang) : t.guestServiceFeeNotCharged}
                />
                {stayBreakdown.taxSource && (
                  <>
                    <p style={styles.taxDisclosureBanner}>{t.taxDisclosureBanner}</p>
                    <div style={styles.testModeRow}>
                      <span style={styles.testModeBadge}>{t.testModeBadge}</span>
                      <Info label={t.lodgingTax} value={moneyText(stayBreakdown.lodgingTaxMinor, payCurrency, lang)} />
                    </div>
                    <div style={styles.testModeRow}>
                      <span style={styles.testModeBadge}>{t.testModeBadge}</span>
                      <Info label={t.gst} value={moneyText(stayBreakdown.gstMinor, payCurrency, lang)} />
                    </div>
                    <div style={styles.testModeRow}>
                      <span style={styles.testModeBadge}>{t.testModeBadge}</span>
                      <Info label={t.qst} value={moneyText(stayBreakdown.qstMinor, payCurrency, lang)} />
                    </div>
                    {/* Second correction pass: estimated / collected / remitted are three distinct
                        figures, never conflated. Collected and remitted stay zero and visibly
                        marked "test mode" while STAY_TAX_PLATFORM_COLLECTION is inactive. */}
                    <Info label={t.collectedTax} value={t.zeroTestMode} />
                    <Info label={t.remittedTax} value={t.zeroTestMode} />
                  </>
                )}
                <Info
                  label={t.refundableDeposit}
                  value={stayBreakdown.refundableDepositMinor > 0 ? moneyText(stayBreakdown.refundableDepositMinor, payCurrency, lang) : t.refundableDepositNotApplicable}
                />
              </>
            ) : (
              <Info label={t.stayAmount} value={moneyText(stayAmountMinor, payCurrency, lang)} />
            )}
            {protectionFeeMinor > 0 && <Info label={t.cancellationProtection} value={moneyText(protectionFeeMinor, payCurrency, lang)} />}
            <Info label={t.totalDue} value={moneyText(totalDueMinor, payCurrency, lang)} strong />
            {stayBreakdown?.taxSource && <p style={styles.taxHint}>{t.taxIncludedHint}</p>}
          </section>

          <section style={styles.bottomActionBar}>
            <label style={styles.agreementBox}>
              <input
                checked={acceptedGuestAgreement}
                onChange={(event) => {
                  setAcceptedGuestAgreement(event.target.checked)
                  if (event.target.checked && message === t.agreementRequired) setMessage('')
                }}
                style={styles.agreementInput}
                type="checkbox"
              />
              <span>
                <strong>{t.agreementTitle}</strong>
                <small>{t.agreementCopy}</small>
                {t.agreementVersionLabel && <em>{t.agreementVersionLabel}</em>}
              </span>
            </label>
            <button disabled={status === 'saving'} style={styles.primaryButton} onClick={() => void confirmBooking()}>
              {status === 'saving' ? t.saving : t.confirm}
            </button>
          </section>
        </>
      )}
    </main>
  )
}

function listingImage(listing: PlatformListing) {
  const mediaUrl = listing.media?.map((item) => item.url || item.src || item.assetUrl).find((value) => typeof value === 'string')
  if (typeof mediaUrl === 'string') return mediaUrl
  return DIVISION_IMAGES.STAYS
}

function Info({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <article style={styles.info}>
      <span>{label}</span>
      <strong style={strong ? styles.infoStrong : undefined}>{value}</strong>
    </article>
  )
}

function bookingDraftKey(listingId: string) {
  return `sybnb-v6-booking-draft:${listingId}`
}

type BookingDraft = {
  dateRange: DateRange
  cancellationProtection: boolean
  payCurrency: 'SYP' | 'USD'
}

function loadBookingDraft(listingId: string): Partial<BookingDraft> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(bookingDraftKey(listingId))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function clearBookingDraft(listingId: string) {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(bookingDraftKey(listingId))
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', padding: '24px 16px 360px', display: 'grid', gap: 16, maxWidth: 720, margin: '0 auto' },
  flowNav: { display: 'flex', gap: 12, alignItems: 'center' },
  arrowButton: { width: 54, height: 54, borderRadius: 999, border: '1px solid #30384d', background: '#111827', color: '#fff', fontSize: 34, fontWeight: 900, display: 'grid', placeItems: 'center' },
  titleBlock: { display: 'grid', gap: 6 },
  title: { margin: 0, fontSize: 28 },
  subtitle: { margin: 0, color: '#9aa6ba' },
  listingRecap: { display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', gap: 14, alignItems: 'center', border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 14 },
  recapImage: { width: 84, height: 84, borderRadius: 8, objectFit: 'cover' },
  card: { border: '1px solid #1e1e2a', borderRadius: 8, background: '#111118', padding: 18, display: 'grid', gap: 12 },
  sectionTitle: { margin: 0, fontSize: 18 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' },
  info: { display: 'grid', gap: 4, color: '#9aa6ba' },
  infoStrong: { color: '#20d29b', fontSize: 18 },
  cancellationCutoff: { color: '#20d29b', fontStyle: 'normal', fontWeight: 800, fontSize: 13 },
  taxHint: { color: '#9aa6ba', fontSize: 12, margin: '8px 0 0' },
  testModeRow: { display: 'flex', alignItems: 'center', gap: 8 },
  testModeBadge: {
    fontSize: 10, fontWeight: 800, letterSpacing: '.04em', color: '#1a1a1a', background: '#f5c451',
    borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase', flexShrink: 0,
  },
  taxDisclosureBanner: {
    fontSize: 12, fontWeight: 700, color: '#1a1a1a', background: '#f5c451', borderRadius: 6,
    padding: '8px 10px', margin: '4px 0',
  },
  panel: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', color: '#fff', padding: 14 },
  alert: { border: '1px solid rgba(255,96,96,.45)', borderRadius: 8, background: 'rgba(255,96,96,.1)', color: '#ffd1d1', padding: 14 },
  // Fixed to the viewport bottom (not sticky within the page's grid flow) -- sticky positioning here
  // caused this bar to pin partway up the page and overlap the price-breakdown card once that card
  // grew tall enough (item 6 of the compliance-review localhost check: mobile appearance). Matches
  // the same fixed-bar pattern already used on ListingDetailPage.tsx for the equivalent bug.
  bottomActionBar: {
    position: 'fixed', insetInline: 0, bottom: 0, zIndex: 30, maxWidth: 720, margin: '0 auto',
    border: '1px solid #242a3b', borderRadius: '8px 8px 0 0', background: 'rgba(13,15,24,.96)',
    boxShadow: '0 -16px 40px rgba(0,0,0,.35)', backdropFilter: 'blur(16px)', padding: 12, display: 'grid', gap: 12,
  },
  agreementBox: { border: '1px solid rgba(229,184,11,.58)', borderRadius: 8, background: 'rgba(229,184,11,.08)', color: '#f7d45f', padding: 14, display: 'grid', gap: 12, gridTemplateColumns: '34px minmax(0, 1fr)', alignItems: 'start', lineHeight: 1.5 },
  agreementInput: { width: 28, height: 28, accentColor: '#20d29b', margin: 0 },
  primaryButton: { minHeight: 48, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 14px' },
}
