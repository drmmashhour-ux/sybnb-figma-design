import type { Lang } from '../../engines/language/languageEngine'
import { SellerAccountPage } from './SellerAccountPage'
import { SellerEntryPage } from './SellerEntryPage'
import { SellerListingWizard } from './SellerListingWizard'
import { SellerSubmittedPage } from './SellerSubmittedPage'
export { isSellerRoute } from './sellerRoutes'

type Props = {
  lang: Lang
  path: string
}

export function SellerDivisionRoutes({ lang, path }: Props) {
  const advertisingPaymentMatch = path.match(/^\/advertising\/payment\/([^/]+)$/)

  if (advertisingPaymentMatch || path === '/advertising' || path === '/advertising/account') {
    return (
      <main style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: 24 }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <section style={{ maxWidth: 680, padding: 28, border: '1px solid #293348', borderRadius: 20, background: '#101827' }}>
          <h1>{lang === 'ar' ? 'خدمة الحملات الإعلانية غير مفتوحة بعد' : 'Advertising campaigns are not open yet'}</h1>
          <p style={{ color: '#9aa6ba', lineHeight: 1.7 }}>
            {lang === 'ar'
              ? 'لن تستلم SYBNB أي دفعة إعلانية قبل اكتمال نظام الحملات ومرات الظهور والعملاء المحتملين والمراجعة الإدارية.'
              : 'SYBNB will not accept advertising payments until campaign delivery, impressions, leads, and administrative review are fully implemented.'}
          </p>
        </section>
      </main>
    )
  }

  if (path === '/sell/account') {
    return <SellerAccountPage flow="listing" lang={lang} />
  }

  if (path === '/sell/listing-wizard') {
    return <SellerListingWizard lang={lang} />
  }

  if (path === '/sell/submitted') {
    return <SellerSubmittedPage lang={lang} />
  }

  return <SellerEntryPage lang={lang} />
}
