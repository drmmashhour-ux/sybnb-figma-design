import type { Lang } from '../../engines/language/languageEngine'
import { SellerAccountPage } from './SellerAccountPage'
import { SellerAdvertisingPaymentPage } from './SellerAdvertisingPaymentPage'
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

  if (advertisingPaymentMatch) {
    return <SellerAdvertisingPaymentPage lang={lang} methodId={advertisingPaymentMatch[1]} />
  }

  if (path === '/advertising/account') {
    return <SellerAccountPage flow="advertising" lang={lang} />
  }

  if (path === '/sell/account') {
    return <SellerAccountPage flow="listing" lang={lang} />
  }

  if (path === '/sell/platform') {
    return <SellerAccountPage flow="platform-sale" lang={lang} />
  }

  if (path === '/sell/listing-wizard') {
    return <SellerListingWizard lang={lang} />
  }

  if (path === '/sell/submitted') {
    return <SellerSubmittedPage lang={lang} />
  }

  return <SellerEntryPage lang={lang} />
}
