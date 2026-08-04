import type { ReactNode } from 'react'
import type { Lang } from '../../engines/language/languageEngine'
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_INTL } from '../support/contactChannels'

export function StandalonePlatformShell({ children, lang }: { children: ReactNode; lang: Lang }) {
  const isAr = lang === 'ar'
  return (
    <div dir={isAr ? 'rtl' : 'ltr'}>
      <a className="skip-link" href="#standalone-main">{isAr ? 'تخطي إلى المحتوى الرئيسي' : 'Skip to main content'}</a>
      <div id="standalone-main" tabIndex={-1}>{children}</div>
      <footer className="standalone-platform-footer">
        <a href={`mailto:${SUPPORT_EMAIL}`}>{isAr ? 'الدعم' : 'Support'}</a>
        <a href={`https://wa.me/${SUPPORT_WHATSAPP_INTL}`} target="_blank" rel="noreferrer">WhatsApp</a>
        <button type="button" onClick={() => (window.location.hash = '/terms')}>{isAr ? 'الشروط' : 'Terms'}</button>
        <button type="button" onClick={() => (window.location.hash = '/privacy')}>{isAr ? 'الخصوصية' : 'Privacy'}</button>
      </footer>
    </div>
  )
}
