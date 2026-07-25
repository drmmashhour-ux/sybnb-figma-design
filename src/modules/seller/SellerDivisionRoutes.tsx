import type { Lang } from '../../engines/language/languageEngine'
import { SellerAccountPage } from './SellerAccountPage'
import { SellerAdvertisingPaymentPage } from './SellerAdvertisingPaymentPage'
import { SellerEntryPage } from './SellerEntryPage'
import { SellerIntentPage } from './SellerIntentPage'
import { SellerListingWizard } from './SellerListingWizard'
import { SellerSubmittedPage } from './SellerSubmittedPage'
export { isSellerRoute } from './sellerRoutes'

type Props = {
  lang: Lang
  path: string
}

export function SellerDivisionRoutes({ lang, path }: Props) {
  const advertisingPaymentMatch = path.match(/^\/advertising\/payment\/([^/]+)$/)

  if (path === '/become-host') {
    return <SellerIntentPage intent="host" lang={lang} />
  }

  if (path === '/list-for-rent') {
    return <SellerIntentPage intent="rent" lang={lang} />
  }

  if (path === '/sell-property') {
    return <SellerIntentPage intent="sell" lang={lang} />
  }

  if (path === '/sell-car') {
    return <SellerIntentPage intent="car" lang={lang} />
  }

  if (path === '/list-project') {
    return <SellerIntentPage intent="project" lang={lang} />
  }

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

  // A3.1 — STR carve-out: the stay-listing wizard is open during the STR closed beta, locked to STAYS
  // so no non-STR vertical can be selected. The generic /sell/listing-wizard entry below stays gated.
  if (path === '/sell/listing-wizard/stays') {
    return <SellerListingWizard lang={lang} lockedDivision="STAYS" />
  }

  if (path === '/sell/listing-wizard') {
    return <SellerListingWizard lang={lang} />
  }

  if (path === '/sell/submitted') {
    return <SellerSubmittedPage lang={lang} />
  }

  return <SellerEntryPage lang={lang} />
}
