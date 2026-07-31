import { useEffect, useState } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { fetchPrototypeOverview, submitGuestIdDocument } from '../../shared/api/platformApi'
export { isTrustProtectionRoute } from './trustRoutes'

type Props = {
  lang: Lang
  path: string
}

// This module previously showed a fabricated numeric "trust score" (94/100) with an invented
// per-category breakdown, a fake ID-verification submission that never called the real upload
// endpoint, and fake booking-protection/dispute/payment-status screens that duplicated features
// which already exist for real on the booking detail page (`/booking/:id`, via
// `BookingCancelDispute` and `PaymentProofUpload`) and the real disputes pages (`/disputes`).
// Rather than build a second, parallel implementation of features that already work, the
// booking-scoped routes now redirect to where the real feature lives. Only identity verification
// remains as its own screen here, now wired to the real upload endpoint and real status.
export function TrustProtectionRoutes({ lang, path }: Props) {
  const pathParts = path.split('/')
  const bookingId = pathParts[pathParts.length - 1]

  if (path === '/trust-center/verification') return <TrustVerification lang={lang} />
  if (path === '/trust-center/sos') return <TrustSos lang={lang} />
  if (
    (path.startsWith('/booking/guarantee/') ||
      path.startsWith('/booking/payment-status/') ||
      path.startsWith('/booking/dispute-closed/') ||
      path.startsWith('/booking/dispute/') ||
      path.startsWith('/booking/protection/')) &&
    bookingId
  ) {
    // Real cancellation, dispute, and payment-status handling all live on the booking detail
    // page itself — redirect there instead of showing a fake duplicate screen.
    window.location.hash = `/booking/${bookingId}`
    return null
  }
  return <TrustCenterHome lang={lang} />
}

function TrustCenterHome({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const [idStatus, setIdStatus] = useState<'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null | 'loading'>('loading')

  useEffect(() => {
    let cancelled = false
    fetchPrototypeOverview()
      .then((overview) => {
        if (!cancelled) setIdStatus(overview.user.idDocumentStatus ?? null)
      })
      .catch(() => {
        if (!cancelled) setIdStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const idLabel =
    idStatus === 'loading'
      ? isAr ? 'جارٍ التحميل...' : 'Loading...'
      : idStatus === 'APPROVED'
        ? isAr ? 'موثقة' : 'Verified'
        : idStatus === 'PENDING_REVIEW'
          ? isAr ? 'قيد المراجعة' : 'Under review'
          : idStatus === 'REJECTED'
            ? isAr ? 'مرفوضة - أعد الإرسال' : 'Rejected - resubmit'
            : isAr ? 'غير موثقة' : 'Not submitted'

  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'مركز الثقة' : 'Trust Center'} />
      <section className="trust-list">
        <TrustRow
          done={idStatus === 'APPROVED'}
          active={idStatus === 'PENDING_REVIEW'}
          label={`${isAr ? 'الهوية الوطنية' : 'National ID'} — ${idLabel}`}
          href="/trust-center/verification"
        />
      </section>

      <section className="trust-action-grid">
        <button className="danger" onClick={() => (window.location.hash = '/trust-center/sos')}><b>!</b>{isAr ? 'طوارئ SOS' : 'SOS'}</button>
        <button onClick={() => (window.location.hash = '/immocontact')}><b>⚑</b>{isAr ? 'تقرير صامت' : 'Silent report'}</button>
        <button onClick={() => (window.location.hash = '/trust-center/sos')}><b>⌖</b>{isAr ? 'مشاركة الموقع' : 'Share location'}</button>
      </section>

      <p className="trust-note">
        {isAr
          ? 'حماية الحجز، النزاعات، وحالة الدفع متاحة الآن من صفحة تفاصيل كل حجز.'
          : 'Booking protection, disputes, and payment status are available from each booking\'s detail page.'}
      </p>
    </main>
  )
}

function TrustVerification({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [idDocumentStatus, setIdDocumentStatus] = useState<'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null>(null)

  useEffect(() => {
    fetchPrototypeOverview()
      .then((overview) => setIdDocumentStatus(overview.user.idDocumentStatus ?? null))
      .catch(() => setIdDocumentStatus(null))
  }, [])

  async function submit() {
    if (!file) return
    setStatus('saving')
    try {
      const user = await submitGuestIdDocument(file)
      setIdDocumentStatus((user.idDocumentStatus as 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED') ?? 'PENDING_REVIEW')
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  return (
    <main className="trust-phone" dir={isAr ? 'rtl' : 'ltr'}>
      <TrustHeader title={isAr ? 'توثيق الهوية' : 'Identity Verification'} />
      <h2 className="trust-section-title">{isAr ? 'صورة الهوية الوطنية' : 'National ID photo'}</h2>
      <label className="trust-upload active" style={{ cursor: 'pointer' }}>
        ▣<span>{file ? file.name : isAr ? 'اختر صورة الهوية' : 'Choose ID photo'}</span>
        <input
          type="file"
          accept="image/*,.pdf"
          style={{ display: 'none' }}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <p className="trust-note">ⓘ {isAr ? 'بياناتك مشفرة بالكامل ولن يتم مشاركتها مع أي طرف ثالث.' : 'Your data is encrypted and will not be shared with third parties.'}</p>
      {idDocumentStatus === 'APPROVED' && (
        <p className="trust-note">✓ {isAr ? 'هويتك موثقة بالفعل.' : 'Your ID is already verified.'}</p>
      )}
      {idDocumentStatus === 'PENDING_REVIEW' && status !== 'saved' && (
        <p className="trust-note">◷ {isAr ? 'طلب سابق قيد المراجعة.' : 'A previous submission is under review.'}</p>
      )}
      {status === 'saved' && (
        <p className="trust-note">✓ {isAr ? 'تم رفع الوثيقة فعلياً وهي الآن قيد المراجعة.' : 'The document was actually uploaded and is now under review.'}</p>
      )}
      {status === 'error' && (
        <p className="trust-note">✕ {isAr ? 'تعذر رفع الوثيقة، حاول مجدداً.' : 'Could not upload the document, try again.'}</p>
      )}
      <button
        className="trust-primary"
        disabled={!file || status === 'saving'}
        onClick={() => void submit()}
      >
        {status === 'saving' ? (isAr ? 'جارٍ الرفع...' : 'Uploading...') : isAr ? 'إرسال للمراجعة' : 'Submit for review'}
      </button>
    </main>
  )
}

function TrustSos({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  return (
    <main className="trust-phone trust-sos-page" dir={isAr ? 'rtl' : 'ltr'}>
      <h1>{isAr ? 'طوارئ SOS' : 'SOS Emergency'}</h1>
      <p>{isAr ? 'هل تشعر بعدم الأمان؟ نحن هنا للمساعدة.' : 'Feeling unsafe? We are here to help.'}</p>
      <button className="sos-pulse" onClick={() => (window.location.hash = '/immocontact')}>SOS</button>
      <strong>{isAr ? 'اضغط مطولاً لمدة 3 ثوان' : 'Hold for 3 seconds'}</strong>
      <span>{isAr ? 'سيتواصل فريق دعم SYBNB معك في أقرب وقت ممكن' : 'The SYBNB support team will reach out to you as soon as possible.'}</span>
      <div className="trust-sos-actions">
        <button onClick={() => (window.location.hash = '/immocontact')}>{isAr ? 'تقديم بلاغ صامت' : 'Submit silent report'} <b>⌁</b></button>
        <button onClick={() => (window.location.hash = '/immocontact')}>{isAr ? 'تحدث مع الدعم الفني' : 'Talk to support'} <b>○</b></button>
      </div>
    </main>
  )
}

function TrustHeader({ title }: { title: string }) {
  return (
    <header className="trust-header">
      <button onClick={() => window.history.back()}>‹</button>
      <h1>{title}</h1>
      <span>♢</span>
    </header>
  )
}

function TrustRow({ label, done = false, active = false, href }: { label: string; done?: boolean; active?: boolean; href?: string }) {
  return (
    <button className={active ? 'active' : ''} onClick={() => href && (window.location.hash = href)}>
      <b>{done ? '✓' : active ? '◷' : '○'}</b>
      <span>{label}</span>
      <small>‹</small>
    </button>
  )
}
