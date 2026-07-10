import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import {
  fetchPrototypeAdminAuditLog,
  fetchPrototypeReviewQueue,
  type PlatformAdminAuditLog,
  type PlatformPaymentProof,
  type PlatformReviewBooking,
  type PlatformReviewQueue,
} from '../../shared/api/platformApi'
import { moneyText, providerText, statusText } from '../../shared/i18n/display'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    back: 'العودة للإدارة',
    title: 'مصالحة المال',
    subtitle: 'لوحة واحدة لمراجعة الأموال المحمية، إثباتات الدفع، الاسترداد، وتحويلات المالك.',
    protectedFunds: 'أموال محمية',
    pendingProofs: 'إثباتات بانتظار القرار',
    payoutHold: 'تحويلات مالك معلقة',
    refundReserve: 'احتياطي الاسترداد',
    officialOnly: 'الدفع الرسمي فقط',
    officialCopy: 'أي دفع خارج SYBNB لا يدخل الحماية ولا يظهر في سجل المصالحة.',
    proofQueue: 'طابور إثباتات الدفع',
    adminReviewTitle: 'مراجعة الدفعات - الإدارة',
    approve: 'موافقة',
    reject: 'رفض',
    aiConfidence: 'ثقة الذكاء',
    riskFlags: 'إشارات المخاطر',
    highTransaction: 'مبلغ غير معتاد',
    multipleFailures: 'محاولات رفض متعددة',
    ledgerStatus: 'حالة السجل المالي',
    released: 'تم صرفه',
    heldLedger: 'معلق',
    rejected: 'مرفوض',
    approved: 'موافق عليه',
    hostPayoutReview: 'مراجعة صرف المضيفين',
    payoutQueue: 'مسار تحويل المالك',
    refundQueue: 'مسار الاسترداد والنزاع',
    ledger: 'سجل المصالحة',
    risk: 'تنبيه المخاطر',
    release: 'تحرير التحويل',
    hold: 'إبقاء معلق',
    review: 'مراجعة',
    receipt: 'الإيصال',
    booking: 'الحجز',
    provider: 'المزوّد',
    amount: 'المبلغ',
    status: 'الحالة',
    empty: 'لا توجد عناصر حالياً.',
    loading: 'جار التحميل',
    error: 'تعذر تحميل بيانات المصالحة',
    lanes: ['استلام الإثبات', 'مراجعة الإدارة', 'تأكيد الحجز', 'تحرير المالك'],
    refundLanes: ['فتح النزاع', 'تجميع الأدلة', 'قرار الإدارة', 'إرجاع للمحفظة'],
  },
  en: {
    back: 'Back to admin',
    title: 'Finance Reconciliation',
    subtitle: 'One control room for protected funds, payment proofs, refunds, and owner payout release.',
    protectedFunds: 'Protected funds',
    pendingProofs: 'Proofs waiting decision',
    payoutHold: 'Owner payout holds',
    refundReserve: 'Refund reserve',
    officialOnly: 'Official payments only',
    officialCopy: 'Payments outside SYBNB are not protected and do not appear in reconciliation.',
    proofQueue: 'Payment proof queue',
    adminReviewTitle: 'Admin Payment Review',
    approve: 'Approve',
    reject: 'Reject',
    aiConfidence: 'AI Confidence',
    riskFlags: 'Risk Flags',
    highTransaction: 'High single transaction volume',
    multipleFailures: 'Multiple card failure',
    ledgerStatus: 'Ledger Status',
    released: 'Released',
    heldLedger: 'Held',
    rejected: 'Rejected',
    approved: 'Approved',
    hostPayoutReview: 'Host Payout Review',
    payoutQueue: 'Owner payout lane',
    refundQueue: 'Refund and dispute lane',
    ledger: 'Reconciliation ledger',
    risk: 'Risk alert',
    release: 'Release payout',
    hold: 'Keep held',
    review: 'Review',
    receipt: 'Receipt',
    booking: 'Booking',
    provider: 'Provider',
    amount: 'Amount',
    status: 'Status',
    empty: 'No items right now.',
    loading: 'Loading',
    error: 'Could not load reconciliation data',
    lanes: ['Proof received', 'Admin review', 'Booking confirmed', 'Owner released'],
    refundLanes: ['Dispute opened', 'Evidence collected', 'Admin decision', 'Wallet refund'],
  },
}

const payoutSamples = [
  { id: 'PO-2026-1004', ownerAr: 'مالك فيلا النخيل', ownerEn: 'Palm Villa owner', amountMinor: 187500000, statusAr: 'معلق للحماية', statusEn: 'Held for protection', risk: 'gold' },
  { id: 'PO-2026-1005', ownerAr: 'مضيف شقة المزة', ownerEn: 'Mezzeh apartment host', amountMinor: 82500000, statusAr: 'جاهز للتحرير', statusEn: 'Ready to release', risk: 'green' },
  { id: 'PO-2026-1006', ownerAr: 'مالك مشروع سكني', ownerEn: 'New project owner', amountMinor: 312000000, statusAr: 'نزاع مفتوح', statusEn: 'Open dispute', risk: 'red' },
]

const refundSamples = [
  { id: 'RF-2026-421', titleAr: 'اختلاف وصف الشقة', titleEn: 'Listing description mismatch', amountMinor: 45000000, statusAr: 'تجميع الأدلة', statusEn: 'Evidence review', risk: 'gold' },
  { id: 'RF-2026-422', titleAr: 'إلغاء من المضيف', titleEn: 'Host cancellation', amountMinor: 19900000, statusAr: 'جاهز للمحفظة', statusEn: 'Ready to wallet', risk: 'green' },
]

export function FinanceReconciliationPage({ lang }: Props) {
  const t = copy[lang]
  const isAr = lang === 'ar'
  const [queue, setQueue] = useState<PlatformReviewQueue | null>(null)
  const [auditLog, setAuditLog] = useState<PlatformAdminAuditLog[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadFinance()
  }, [])

  async function loadFinance() {
    setStatus('loading')
    setMessage('')
    try {
      const [nextQueue, nextAuditLog] = await Promise.all([
        fetchPrototypeReviewQueue(),
        fetchPrototypeAdminAuditLog(10),
      ])
      setQueue(nextQueue)
      setAuditLog(nextAuditLog)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : t.error)
    }
  }

  const payments = queue?.payments || []
  const bookings = queue?.bookings || []
  const protectedMinor = useMemo(() => {
    const paymentTotal = payments.reduce((sum, payment) => sum + payment.amountMinor, 0)
    const bookingTotal = bookings.reduce((sum, booking) => sum + booking.amountMinor, 0)
    return paymentTotal + bookingTotal
  }, [bookings, payments])
  const payoutHoldMinor = payoutSamples.reduce((sum, item) => sum + item.amountMinor, 0)
  const refundReserveMinor = refundSamples.reduce((sum, item) => sum + item.amountMinor, 0)

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <button style={styles.back} onClick={() => (window.location.hash = '/admin/review')}>
        {t.back}
      </button>

      <section style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>SYBNB V6 FINANCE</p>
          <h1 style={styles.title}>{t.title}</h1>
          <p style={styles.body}>{t.subtitle}</p>
        </div>
        <article style={styles.warning}>
          <strong>{t.officialOnly}</strong>
          <span>{t.officialCopy}</span>
        </article>
      </section>

      {status === 'error' && (
        <section style={styles.error}>
          <strong>{t.error}</strong>
          <span>{message}</span>
        </section>
      )}

      <section style={styles.stats}>
        <FinanceStat label={t.protectedFunds} value={moneyText(protectedMinor, 'SYP', lang)} tone="#20d29b" />
        <FinanceStat label={t.pendingProofs} value={String(payments.length)} tone="#5268ff" />
        <FinanceStat label={t.payoutHold} value={moneyText(payoutHoldMinor, 'SYP', lang)} tone="#e5b80b" />
        <FinanceStat label={t.refundReserve} value={moneyText(refundReserveMinor, 'SYP', lang)} tone="#ff5f7d" />
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <div style={styles.reviewHeader}>
            <span style={styles.pendingPill}>{payments.length || 24} Pending</span>
            <h2 style={styles.cardTitle}>{t.adminReviewTitle}</h2>
          </div>
          {status === 'loading' && <p style={styles.empty}>{t.loading}</p>}
          {payments.length ? payments.slice(0, 4).map((payment) => (
            <PaymentProofRow key={payment.id} payment={payment} lang={lang} labels={t} />
          )) : status !== 'loading' && [12400, 3200, 1500, 45000].map((amount, index) => (
            <PaymentProofRow
              key={amount}
              payment={{
                id: `USR-${index + 7700}`,
                bookingId: `BK-${index + 42}`,
                userId: `USR-${index}`,
                provider: index % 2 === 0 ? 'SHAM_CASH' : 'BANK_TRANSFER',
                status: 'PENDING_ADMIN_REVIEW',
                amountMinor: amount,
                currency: 'SAR',
                proofAssetUrl: null,
                providerRef: `USR-${index + 7700}`,
                adminNote: null,
                reviewedById: null,
                reviewedAt: null,
              }}
              lang={lang}
              labels={t}
            />
          ))}
        </article>

        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.riskFlags}</h2>
          <section style={styles.riskGrid}>
            <article style={styles.riskCard}>
              <strong>94%</strong>
              <span>{t.highTransaction}</span>
              <button onClick={() => (window.location.hash = '/operations')}>{t.review}</button>
            </article>
            <article style={styles.riskCard}>
              <strong>88%</strong>
              <span>{t.multipleFailures}</span>
              <button onClick={() => (window.location.hash = '/admin/review')}>{t.review}</button>
            </article>
          </section>
          <h2 style={styles.cardTitle}>{t.ledgerStatus}</h2>
          <section style={styles.ledgerStats}>
            <FinanceStat label={t.released} value="14,200" tone="#5268ff" />
            <FinanceStat label={t.heldLedger} value="8,940" tone="#e5b80b" />
            <FinanceStat label={t.rejected} value="2,100" tone="#ff5f7d" />
            <FinanceStat label={t.approved} value="42,500" tone="#20d29b" />
          </section>
        </article>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{t.hostPayoutReview}</h2>
        <div style={styles.payoutTable}>
          {payoutSamples.map((payout) => (
            <article key={payout.id} style={styles.financeRow}>
              <span style={{ ...styles.riskDot, background: riskColor(payout.risk) }} />
              <div>
                <strong>{isAr ? payout.ownerAr : payout.ownerEn}</strong>
                <small dir="ltr">{payout.id}</small>
              </div>
              <b>{moneyText(payout.amountMinor, 'SYP', lang)}</b>
              <div style={styles.rowActions}>
                <button onClick={() => (window.location.hash = '/admin/review')}>{payout.risk === 'green' ? t.release : t.hold}</button>
                <button onClick={() => (window.location.hash = '/operations')}>{t.review}</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.refundQueue}</h2>
          <div style={styles.timeline}>
            {t.refundLanes.map((lane, index) => (
              <span key={lane} style={index <= 1 ? styles.timelineActive : undefined}>{lane}</span>
            ))}
          </div>
          {refundSamples.map((refund) => (
            <article key={refund.id} style={styles.financeRow}>
              <span style={{ ...styles.riskDot, background: riskColor(refund.risk) }} />
              <div>
                <strong>{isAr ? refund.titleAr : refund.titleEn}</strong>
                <small dir="ltr">{refund.id}</small>
              </div>
              <b>{moneyText(refund.amountMinor, 'SYP', lang)}</b>
              <button onClick={() => (window.location.hash = `/booking/dispute/${refund.id}`)}>{t.review}</button>
            </article>
          ))}
        </article>

        <article style={styles.card}>
          <h2 style={styles.cardTitle}>{t.ledger}</h2>
          <div style={styles.timeline}>
            {t.lanes.map((lane, index) => (
              <span key={lane} style={index <= 2 ? styles.timelineActive : undefined}>{lane}</span>
            ))}
          </div>
          <div style={styles.stack}>
            {auditLog.length ? auditLog.slice(0, 6).map((entry) => (
              <article key={entry.id} style={styles.auditRow}>
                <strong>{entry.action.replace(/_/g, ' ')}</strong>
                <span>{entry.entityType} / {entry.entityId.slice(0, 8).toUpperCase()}</span>
              </article>
            )) : <p style={styles.empty}>{t.empty}</p>}
          </div>
        </article>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{t.booking}</h2>
        <div style={styles.bookingGrid}>
          {bookings.slice(0, 4).map((booking) => (
            <BookingFinanceCard key={booking.id} booking={booking} lang={lang} labels={t} />
          ))}
          {!bookings.length && status !== 'loading' && <p style={styles.empty}>{t.empty}</p>}
        </div>
      </section>
    </main>
  )
}

function FinanceStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <article style={{ ...styles.stat, borderColor: `${tone}66` }}>
      <span>{label}</span>
      <strong style={{ color: tone }}>{value}</strong>
    </article>
  )
}

function PaymentProofRow({ payment, lang, labels }: { payment: PlatformPaymentProof; lang: Lang; labels: typeof copy.ar }) {
  const confidence = Math.min(96, Math.max(38, payment.amountMinor % 100))
  return (
    <article style={styles.financeRow}>
      <span style={{ ...styles.riskDot, background: payment.status === 'PENDING_REVIEW' ? '#e5b80b' : '#20d29b' }} />
      <div style={styles.rowActions}>
        <button style={styles.approveButton} onClick={() => (window.location.hash = '/admin/review')}>{labels.approve}</button>
        <button style={styles.rejectButton} onClick={() => (window.location.hash = '/admin/review')}>{labels.reject}</button>
      </div>
      <div>
        <strong>{payment.providerRef || payment.id.slice(0, 8).toUpperCase()}</strong>
        <small>{labels.provider}: {providerText(payment.provider, lang)}</small>
      </div>
      <div style={styles.confidence}>
        <small>{labels.aiConfidence}</small>
        <span style={styles.confidenceTrack}><b style={{ ...styles.confidenceFill, width: `${confidence}%` }} /></span>
      </div>
      <b>{moneyText(payment.amountMinor, payment.currency, lang)}</b>
      <button onClick={() => (window.location.hash = `/payment/receipt/${payment.id}`)}>{labels.receipt}</button>
    </article>
  )
}

function BookingFinanceCard({ booking, lang, labels }: { booking: PlatformReviewBooking; lang: Lang; labels: typeof copy.ar }) {
  return (
    <article style={styles.bookingCard}>
      <span>{statusText(booking.status, lang)}</span>
      <strong>{booking.id.slice(0, 8).toUpperCase()}</strong>
      <div style={styles.meta}>
        <span>{labels.amount}</span>
        <b>{moneyText(booking.amountMinor, booking.currency, lang)}</b>
      </div>
      <button onClick={() => (window.location.hash = `/booking/${booking.id}`)}>{labels.review}</button>
    </article>
  )
}

function riskColor(risk: string) {
  if (risk === 'green') return '#20d29b'
  if (risk === 'red') return '#ff5f7d'
  return '#e5b80b'
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: '100vh', background: '#08090f', color: '#fff', padding: '24px 16px 90px', display: 'grid', gap: 16, maxWidth: 1180, margin: '0 auto' },
  back: { justifySelf: 'start', minHeight: 44, border: '1px solid #30384d', borderRadius: 8, background: '#111827', color: '#fff', padding: '0 14px', fontWeight: 900 },
  hero: { border: '1px solid #1e2942', borderRadius: 8, background: 'linear-gradient(135deg, #111827, #0b1020)', padding: 18, display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) minmax(250px, 360px)' },
  eyebrow: { margin: 0, color: '#e5b80b', fontWeight: 950, letterSpacing: 2, fontSize: 11 },
  title: { margin: '6px 0', fontSize: 42, lineHeight: 1.04 },
  body: { margin: 0, color: '#9aa6ba', lineHeight: 1.65, maxWidth: 720 },
  warning: { border: '1px solid rgba(229,184,11,.45)', borderRadius: 8, background: 'rgba(229,184,11,.1)', padding: 14, display: 'grid', gap: 8, alignContent: 'center', color: '#f7d45f' },
  error: { border: '1px solid rgba(255,95,125,.5)', borderRadius: 8, background: 'rgba(255,95,125,.12)', color: '#ffd1d1', padding: 14, display: 'grid', gap: 4 },
  stats: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' },
  stat: { border: '1px solid #30384d', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 10 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))' },
  card: { border: '1px solid #1e2942', borderRadius: 8, background: '#111118', padding: 14, display: 'grid', gap: 12 },
  cardTitle: { margin: 0, fontSize: 22 },
  empty: { margin: 0, color: '#9aa6ba' },
  financeRow: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 12, display: 'grid', gap: 10, gridTemplateColumns: '14px auto minmax(0, 1fr) minmax(90px, 140px) auto auto', alignItems: 'center' },
  riskDot: { width: 10, height: 44, borderRadius: 999 },
  rowActions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  approveButton: { minHeight: 38, border: 0, borderRadius: 8, background: '#20d29b', color: '#06110e', fontWeight: 950, padding: '0 12px' },
  rejectButton: { minHeight: 38, border: 0, borderRadius: 8, background: '#ff5f7d', color: '#fff', fontWeight: 950, padding: '0 12px' },
  confidence: { display: 'grid', gap: 6, color: '#697386' },
  confidenceTrack: { height: 6, borderRadius: 999, background: '#202333', overflow: 'hidden' },
  confidenceFill: { display: 'block', height: '100%', borderRadius: 999, background: '#ff5f7d' },
  reviewHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pendingPill: { border: '1px solid rgba(229,184,11,.55)', borderRadius: 999, color: '#e5b80b', padding: '6px 10px', fontWeight: 950, fontSize: 12 },
  riskGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' },
  riskCard: { border: '1px solid rgba(255,95,125,.35)', borderRadius: 8, background: 'rgba(255,95,125,.06)', padding: 14, display: 'grid', gap: 12 },
  ledgerStats: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(4, minmax(100px, 1fr))' },
  payoutTable: { display: 'grid', gap: 10 },
  timeline: { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' },
  timelineActive: { borderColor: 'rgba(32,210,155,.5)', background: 'rgba(32,210,155,.12)', color: '#20d29b' },
  stack: { display: 'grid', gap: 8 },
  auditRow: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba' },
  bookingGrid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' },
  bookingCard: { border: '1px solid #30384d', borderRadius: 8, background: '#0c1220', padding: 12, display: 'grid', gap: 10 },
  meta: { display: 'flex', justifyContent: 'space-between', gap: 12, color: '#9aa6ba' },
}
