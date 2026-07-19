export const SELLER_ROUTE_COVERAGE = [
  '/become-host',
  '/list-for-rent',
  '/sell-property',
  '/sell-car',
  '/list-project',
  '/sell',
  '/sell/account',
  '/sell/platform',
  '/sell/listing-wizard',
  '/sell/submitted',
  '/advertising/account',
  '/advertising/payment/shamCash',
  '/advertising/payment/localWallet',
  '/advertising/payment/bankTransfer',
  '/advertising/payment/creditCard',
]

export function isSellerRoute(path: string) {
  return (
    path === '/become-host' ||
    path === '/list-for-rent' ||
    path === '/sell-property' ||
    path === '/sell-car' ||
    path === '/list-project' ||
    path === '/sell' ||
    path.startsWith('/sell/') ||
    path.startsWith('/advertising/')
  )
}
