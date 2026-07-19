import type { Lang } from '../../engines/language/languageEngine'
import { navigate } from '../../app/routes'
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_INTL, SUPPORT_WHATSAPP_LOCAL } from '../support/contactChannels'

type Props = {
  lang: Lang
}

const copy = {
  ar: {
    about: 'عن SYBNB',
    contact: 'تواصل معنا',
    track: 'تابع رحلتك',
    terms: 'شروط الاستخدام',
    privacy: 'سياسة الخصوصية',
    rights: (year: number) => `© ${year} SYBNB. جميع الحقوق محفوظة.`,
  },
  en: {
    about: 'About SYBNB',
    contact: 'Contact us',
    track: 'Track your trip',
    terms: 'Terms of Service',
    privacy: 'Privacy Policy',
    rights: (year: number) => `© ${year} SYBNB. All rights reserved.`,
  },
}

function goToAbout() {
  navigate('/')
  window.setTimeout(() => {
    document.getElementById('platform-about')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, 50)
}

export function Footer({ lang }: Props) {
  const isAr = lang === 'ar'
  const t = copy[lang]
  const year = new Date().getFullYear()

  return (
    <footer className="app-footer" dir={isAr ? 'rtl' : 'ltr'}>
      <nav className="app-footer-links" aria-label={isAr ? 'روابط أساسية' : 'Site links'}>
        <button type="button" onClick={goToAbout}>{t.about}</button>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{t.contact}</a>
        <a href={`https://wa.me/${SUPPORT_WHATSAPP_INTL}`} target="_blank" rel="noreferrer">
          WhatsApp {SUPPORT_WHATSAPP_LOCAL}
        </a>
        <button type="button" onClick={() => navigate('/track')}>{t.track}</button>
        <button type="button" onClick={() => navigate('/terms')}>{t.terms}</button>
        <button type="button" onClick={() => navigate('/privacy')}>{t.privacy}</button>
      </nav>
      <span className="app-footer-rights">{t.rights(year)}</span>
    </footer>
  )
}
