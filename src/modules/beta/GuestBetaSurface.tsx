import type { Lang } from '../../engines/language/languageEngine'

// SYB-010 — honest closed-beta guest surface. `/account` and `/dashboard` previously rendered the
// marketing landing page silently, and the real guest account pages are unfinished orphans. During the
// managed closed beta there is no full guest account; the official self-service entry point is booking
// lookup (/track), supported by transactional email and manual support. This governed response says so
// truthfully instead of pretending a destination exists.
type Props = { lang: Lang }

const COPY = {
  ar: {
    badge: 'نسخة تجريبية',
    heading: 'لا يوجد حساب ضيف كامل في النسخة التجريبية',
    body: 'نُشغّل نسخة تجريبية مُدارة. لمتابعة حجزك استخدم صفحة تتبّع الحجز برقم التأكيد ورقم الهاتف. ستصلك رسائل بريدية بتحديثات حالة الحجز والدفع.',
    trackCta: 'تتبّع حجزي',
    supportNote: 'للمساعدة، تواصل مع الدعم عبر القنوات الموضّحة في رسائل التأكيد.',
  },
  en: {
    badge: 'Beta',
    heading: 'There is no full guest account in the beta',
    body: 'We are running a managed closed beta. To follow your booking, use booking lookup with your confirmation number and phone. You will receive email updates on booking and payment status.',
    trackCta: 'Track my booking',
    supportNote: 'For help, contact support through the channels shown in your confirmation emails.',
  },
  fr: {
    badge: 'Bêta',
    heading: "Il n'y a pas de compte invité complet dans la bêta",
    body: "Nous menons une bêta fermée gérée. Pour suivre votre réservation, utilisez la recherche de réservation avec votre numéro de confirmation et votre téléphone. Vous recevrez des e-mails sur l'état de la réservation et du paiement.",
    trackCta: 'Suivre ma réservation',
    supportNote: 'Pour de l’aide, contactez le support via les canaux indiqués dans vos e-mails de confirmation.',
  },
}

export function GuestBetaSurface({ lang }: Props) {
  const t = COPY[lang] || COPY.en
  const isAr = lang === 'ar'
  return (
    <main
      dir={isAr ? 'rtl' : 'ltr'}
      style={{ maxWidth: 560, margin: '10vh auto', padding: '2rem', textAlign: 'center' }}
      aria-label={t.heading}
    >
      <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 999, background: '#30384d', color: '#c8d2f0', fontSize: 13 }}>
        {t.badge}
      </span>
      <h1 style={{ marginTop: 16 }}>{t.heading}</h1>
      <p style={{ color: '#8b95ad', lineHeight: 1.6 }}>{t.body}</p>
      <button
        type="button"
        onClick={() => { window.location.hash = '/track' }}
        style={{ marginTop: 20, padding: '10px 20px', borderRadius: 10, border: '1px solid #4f6cff', background: 'transparent', color: '#c8d2f0', cursor: 'pointer' }}
      >
        {t.trackCta}
      </button>
      <p style={{ marginTop: 16, color: '#6b7590', fontSize: 13 }}>{t.supportNote}</p>
    </main>
  )
}

export default GuestBetaSurface
