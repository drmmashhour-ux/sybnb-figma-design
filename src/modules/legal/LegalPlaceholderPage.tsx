import type { Lang } from '../../engines/language/languageEngine'
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_LOCAL } from '../../shared/support/contactChannels'

type Props = {
  lang: Lang
  page: 'terms' | 'privacy'
}

const copy = {
  ar: {
    draftBadge: 'مسودة — غير نهائية',
    terms: {
      title: 'شروط الاستخدام',
      body: 'نعمل حالياً على إعداد النسخة الكاملة من شروط الاستخدام. شروط الحجز والدفع المطبقة فعلياً على كل حجز إيجار يومي معروضة داخل صفحة الإعلان نفسها قبل إرسال طلب الحجز.',
    },
    privacy: {
      title: 'سياسة الخصوصية',
      body: 'نعمل حالياً على إعداد النسخة الكاملة من سياسة الخصوصية.',
    },
    contact: (email: string, whatsapp: string) => `لأي استفسار حول هذه الصفحة، تواصل معنا عبر البريد الإلكتروني ${email} أو واتساب ${whatsapp}.`,
  },
  en: {
    draftBadge: 'DRAFT — NOT FINAL',
    terms: {
      title: 'Terms of Service',
      body: 'The full Terms of Service are being prepared. The booking and payment terms that actually apply to every short-term-rental booking are shown on the listing page itself before you send a booking request.',
    },
    privacy: {
      title: 'Privacy Policy',
      body: 'The full Privacy Policy is being prepared.',
    },
    contact: (email: string, whatsapp: string) => `For any question about this page, reach us by email at ${email} or WhatsApp ${whatsapp}.`,
  },
}

export function LegalPlaceholderPage({ lang, page }: Props) {
  const isAr = lang === 'ar'
  const t = copy[lang]
  const section = t[page]

  return (
    <main dir={isAr ? 'rtl' : 'ltr'} style={styles.page}>
      <section style={styles.card}>
        <span style={styles.draftBadge}>{t.draftBadge}</span>
        <h1 style={styles.title}>{section.title}</h1>
        <p style={styles.body}>{section.body}</p>
        <p style={styles.contact}>{t.contact(SUPPORT_EMAIL, SUPPORT_WHATSAPP_LOCAL)}</p>
      </section>
    </main>
  )
}

const styles = {
  page: {
    display: 'flex',
    justifyContent: 'center',
    padding: '48px 16px',
  },
  card: {
    background: '#0d1322',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14,
    maxWidth: 560,
    padding: '32px 28px',
    width: '100%',
  },
  draftBadge: {
    background: 'rgba(213,169,21,0.14)',
    border: '1px solid rgba(213,169,21,0.5)',
    borderRadius: 999,
    color: '#f4d676',
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 950,
    letterSpacing: 0.5,
    margin: '0 0 14px',
    padding: '5px 12px',
    textTransform: 'uppercase',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 950,
    margin: '0 0 14px',
  },
  body: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 15,
    lineHeight: 1.6,
    margin: '0 0 16px',
  },
  contact: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    lineHeight: 1.6,
    margin: 0,
  },
} as const
