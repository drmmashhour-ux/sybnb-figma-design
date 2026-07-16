import QRCode from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  createSyrianLocalWalletQrPayload,
  SYRIAN_LOCAL_WALLET_QR_ASSET,
  SYRIAN_LOCAL_WALLET_QR_NUMBER,
  syrianLocalWalletInstructions,
  syrianLocalWalletRecipient,
} from '../../engines/payments/syrianLocalWallet'
import {
  createLocalFallbackPaymentProof,
  createStripeCheckoutSession,
  fetchStripePaymentStatus,
  type PlatformPaymentProof,
} from '../../shared/api/platformApi'
import { moneyText } from '../../shared/i18n/display'
import type { CSSVars } from '../../shared/theme/cssVars'
import { PaymentCapsule } from './PaymentCapsule'

type Props = {
  lang: Lang
  bookingId?: string
  amountMinor?: number
  currency?: string
}

const CONFIRMED_PAYMENT_STORAGE_KEY = 'sybnb_v6_confirmed_payment'

const copy = {
  ar: {
    back: 'العودة للرئيسية',
    title: 'الدفع الآمن',
    subtitle: 'اختر طريقة الدفع وأكمل الحجز مباشرة. بعد التأكيد يظهر رقم الحجز للمتابعة.',
    mode: 'دفع محمي داخل SYBNB',
    paymentMethod: 'طريقة الدفع',
    payByCard: 'بطاقة ائتمان',
    payByWallet: 'شام كاش',
    cardProcessing: 'جار فتح الدفع بالبطاقة...',
    walletProcessing: 'جار تأكيد شام كاش...',
    cardUnavailable: 'الدفع بالبطاقة غير متاح الآن. استخدم شام كاش أو جرّب لاحقاً.',
    recipient: 'معلومات شام كاش',
    receiverName: 'اسم مستلم المال',
    maskedAccount: 'الحساب',
    amountDue: 'المبلغ المستحق',
    currency: 'العملة',
    qrValue: 'رقم الدفع أسفل QR',
    qrPayload: 'محتوى QR',
    confirmedTitle: 'تم تأكيد الحجز',
    confirmedBody: 'تم حفظ الحجز والدفع بنجاح. يمكن للعميل متابعة رحلته من حسابه أو حفظ رقم المرجع.',
    bookingReference: 'رقم مرجع الحجز',
    paymentReference: 'رقم مرجع الدفع',
    followTrip: 'متابعة الرحلة',
    receipt: 'فتح الإيصال',
    apiError: 'تعذر إكمال الدفع الآن',
  },
  en: {
    back: 'Back to landing',
    title: 'Secure payment',
    subtitle: 'Choose a payment method and finish the booking. After confirmation the booking reference appears for follow-up.',
    mode: 'Protected SYBNB payment',
    paymentMethod: 'Payment method',
    payByCard: 'Credit card',
    payByWallet: 'Sham Cash',
    cardProcessing: 'Opening card payment...',
    walletProcessing: 'Confirming Sham Cash...',
    cardUnavailable: 'Card payment is not available right now. Use Sham Cash or try again later.',
    recipient: 'Sham Cash information',
    receiverName: 'Money receiver name',
    maskedAccount: 'Account',
    amountDue: 'Amount due',
    currency: 'Currency',
    qrValue: 'Payment number under QR',
    qrPayload: 'QR payload',
    confirmedTitle: 'Booking confirmed',
    confirmedBody: 'The booking and payment are saved. The guest can follow the trip from the account or keep the reference number.',
    bookingReference: 'Booking reference',
    paymentReference: 'Payment reference',
    followTrip: 'Follow trip',
    receipt: 'Open receipt',
    apiError: 'Payment could not be completed right now',
  },
}

export function SyrianLocalWalletPaymentPage({ lang, bookingId = 'BK-2026-0042', amountMinor = 10, currency = 'SYP' }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const amountDue = Math.max(Number(amountMinor || 10), 1)
  const transactionReference = useMemo(
    () => `SLW-${bookingId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase()}`,
    [bookingId],
  )
  const [paymentProof, setPaymentProof] = useState<PlatformPaymentProof | null>(null)
  const [stripeConfigured, setStripeConfigured] = useState(false)
  const [paymentState, setPaymentState] = useState<'idle' | 'card' | 'wallet' | 'error'>('idle')
  const [paymentError, setPaymentError] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')

  const qrPayload = useMemo(
    () =>
      createSyrianLocalWalletQrPayload({
        bookingId,
        amount: amountDue,
        currency,
        transactionReference,
      }),
    [amountDue, bookingId, currency, transactionReference],
  )

  useEffect(() => {
    let cancelled = false

    void fetchStripePaymentStatus()
      .then((status) => {
        if (!cancelled) setStripeConfigured(status.configured)
      })
      .catch(() => {
        if (!cancelled) setStripeConfigured(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 8,
      color: {
        dark: '#07111f',
        light: '#f8fbff',
      },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url)
    })

    return () => {
      cancelled = true
    }
  }, [qrPayload])

  useEffect(() => {
    if (!paymentProof) return

    window.sessionStorage.setItem(
      CONFIRMED_PAYMENT_STORAGE_KEY,
      JSON.stringify({
        confirmedAt: new Date().toISOString(),
        bookingId,
        amountMinor: amountDue,
        currency,
        transactionReference: paymentProof.providerRef,
        paymentProofId: paymentProof.id,
        status: 'APPROVED',
      }),
    )
  }, [amountDue, bookingId, currency, paymentProof, transactionReference])

  function createLocalProof(provider: 'stripe_test' | 'syrian_local_wallet') {
    return createLocalFallbackPaymentProof({
      bookingId,
      provider,
      amountMinor: amountDue,
      currency,
      providerRef: provider === 'stripe_test' ? `STRIPE-TEST-${Date.now().toString().slice(-8)}` : transactionReference,
      proofAssetUrl: provider === 'stripe_test' ? 'local-stripe-test' : 'local-sham-cash-confirmed',
    })
  }

  function confirmWalletPayment() {
    setPaymentState('wallet')
    setPaymentError('')

    try {
      const proof = createLocalProof('syrian_local_wallet')
      setPaymentProof({ ...proof, status: 'APPROVED', reviewedAt: new Date().toISOString(), reviewedById: 'local-wallet-test' })
    } catch (error) {
      setPaymentState('error')
      setPaymentError(error instanceof Error ? error.message : t.apiError)
    } finally {
      setPaymentState('idle')
    }
  }

  async function payByCreditCard() {
    setPaymentState('card')
    setPaymentError('')

    try {
      if (stripeConfigured) {
        const session = await createStripeCheckoutSession(bookingId)
        window.location.href = session.url
        return
      }

      if (bookingId.startsWith('fallback-booking-')) {
        setPaymentProof(createLocalProof('stripe_test'))
        return
      }

      throw new Error(t.cardUnavailable)
    } catch (error) {
      if (bookingId.startsWith('fallback-booking-')) {
        setPaymentProof(createLocalProof('stripe_test'))
        return
      }

      setPaymentState('error')
      setPaymentError(error instanceof Error ? error.message : t.apiError)
    } finally {
      setPaymentState('idle')
    }
  }

  const isConfirmed = Boolean(paymentProof)

  return (
    <main className="wallet-page" dir={isAr ? 'rtl' : 'ltr'} style={{ '--accent': '#19d7ff' } as CSSVars}>
      <section style={flowStyles.nav} aria-label={isAr ? 'التنقل بين الخطوات' : 'Step navigation'}>
        <button style={flowStyles.arrow} onClick={() => (window.location.hash = `/booking/${bookingId}`)} aria-label={isAr ? 'السابق' : 'Back'}>
          ‹
        </button>
        <button
          style={flowStyles.arrow}
          disabled={!isConfirmed}
          onClick={() => {
            if (paymentProof) window.location.hash = `/payment/receipt/${paymentProof.id}`
          }}
          aria-label={isAr ? 'التالي' : 'Next'}
        >
          ›
        </button>
      </section>

      <button className="back-button" onClick={() => (window.location.hash = '/')}>
        {t.back}
      </button>

      <section className="wallet-hero">
        <span className="wallet-chip">{t.mode}</span>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
      </section>

      <PaymentCapsule
        lang={lang}
        methodLabel={paymentProof?.provider === 'stripe_test' ? t.payByCard : t.payByWallet}
        amountLabel={moneyText(amountDue, currency, lang)}
        destinationCode={paymentProof?.providerRef || transactionReference}
        followCode={bookingId}
        proofCount={isConfirmed ? 1 : 0}
        status={isConfirmed ? 'confirmed' : 'ready'}
      />

      {isConfirmed ? (
        <section className="wallet-card wallet-approved-banner">
          <div>
            <strong>{t.confirmedTitle}</strong>
            <p>{t.confirmedBody}</p>
          </div>
          <div className="wallet-stat">
            <span>{t.bookingReference}</span>
            <strong dir="ltr">{bookingId}</strong>
          </div>
          <div className="wallet-stat">
            <span>{t.paymentReference}</span>
            <strong dir="ltr">{paymentProof?.providerRef}</strong>
          </div>
          <button className="wallet-primary" onClick={() => (window.location.hash = `/payment/receipt/${paymentProof?.id}`)}>
            {t.receipt}
          </button>
          <button onClick={() => (window.location.hash = '/dashboard')}>{t.followTrip}</button>
        </section>
      ) : (
        <>
          <section className="wallet-card">
            <h2>{t.paymentMethod}</h2>
            <div className="wallet-method-row" style={flowStyles.methodRow}>
              <button type="button" className="wallet-primary" disabled={paymentState === 'card'} onClick={payByCreditCard}>
                {paymentState === 'card' ? t.cardProcessing : t.payByCard}
              </button>
              <button type="button" className="wallet-secondary" disabled={paymentState === 'wallet'} onClick={confirmWalletPayment}>
                {paymentState === 'wallet' ? t.walletProcessing : t.payByWallet}
              </button>
            </div>
            {paymentState === 'error' && <p className="wallet-error">{paymentError}</p>}
          </section>

          <section className="wallet-grid" id="sham-cash-payment">
            <article className="wallet-card qr-card">
              <div className="qr-shell">
                <img src={qrDataUrl || SYRIAN_LOCAL_WALLET_QR_ASSET} alt={t.title} />
              </div>
              <div className="qr-number" aria-label={t.qrValue}>
                <span>{t.qrValue}</span>
                <strong dir="ltr">{transactionReference}</strong>
                <small dir="ltr">{SYRIAN_LOCAL_WALLET_QR_NUMBER}</small>
              </div>
              <div className="qr-payload">
                <span>{t.qrPayload}</span>
                <code dir="ltr">{qrPayload}</code>
              </div>
              <p>{syrianLocalWalletInstructions[lang]}</p>
            </article>

            <article className="wallet-card">
              <h2>{t.recipient}</h2>
              <div className="wallet-stat">
                <span>{t.receiverName}</span>
                <strong>{syrianLocalWalletRecipient.name[lang]}</strong>
              </div>
              <div className="wallet-stat">
                <span>{t.maskedAccount}</span>
                <strong dir="ltr">{syrianLocalWalletRecipient.maskedAccount}</strong>
              </div>
              <div className="wallet-stat">
                <span>{t.amountDue}</span>
                <strong dir={isAr ? 'rtl' : 'ltr'}>{moneyText(amountDue, currency, lang)}</strong>
              </div>
              <div className="wallet-stat">
                <span>{t.currency}</span>
                <strong>{isAr && currency === 'SYP' ? 'ل.س' : currency}</strong>
              </div>
            </article>
          </section>
        </>
      )}
    </main>
  )
}

const flowStyles = {
  nav: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  arrow: { width: 54, height: 54, borderRadius: 999, border: '1px solid #30384d', background: '#111827', color: '#fff', fontSize: 34, fontWeight: 900, display: 'grid', placeItems: 'center' },
  methodRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 },
} as const
