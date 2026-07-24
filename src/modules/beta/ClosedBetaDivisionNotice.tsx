import type { Lang } from '../../engines/language/languageEngine'

// SYB-008 — governed closed-beta response shown when a guest reaches a gated (Soon) division route
// directly. The STR-only beta keeps Stays active; everything else is not available yet. This is the
// navigation/route layer; the API refuses the same divisions authoritatively.
type Props = { lang: Lang; title?: string }

const COPY = {
  ar: {
    badge: 'قريباً',
    heading: 'هذا القسم غير متاح في النسخة التجريبية',
    body: 'نُشغّل حالياً نسخة تجريبية مُدارة للإيجار اليومي (STR) فقط. سيتم تفعيل الأقسام الأخرى لاحقاً.',
    cta: 'العودة إلى الإيجار اليومي',
  },
  en: {
    badge: 'Soon',
    heading: 'This section is not available in the beta',
    body: 'We are running a managed closed beta for Daily Stays (STR) only. The other sections will open later.',
    cta: 'Back to Daily Stays',
  },
  fr: {
    badge: 'Bientôt',
    heading: "Cette section n'est pas disponible dans la bêta",
    body: 'Nous menons une bêta fermée gérée pour les séjours courts (STR) uniquement. Les autres sections ouvriront plus tard.',
    cta: 'Retour aux séjours courts',
  },
}

export function ClosedBetaDivisionNotice({ lang, title }: Props) {
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
      <h1 style={{ marginTop: 16 }}>{title ? `${title} · ${t.badge}` : t.heading}</h1>
      <p style={{ color: '#8b95ad', lineHeight: 1.6 }}>{t.body}</p>
      <button
        type="button"
        onClick={() => { window.location.hash = '/stays' }}
        style={{ marginTop: 20, padding: '10px 20px', borderRadius: 10, border: '1px solid #4f6cff', background: 'transparent', color: '#c8d2f0', cursor: 'pointer' }}
      >
        {t.cta}
      </button>
    </main>
  )
}

export default ClosedBetaDivisionNotice
