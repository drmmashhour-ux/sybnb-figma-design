export const SELLER_ROUTE_COVERAGE = [
  '/become-host',
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
  return path === '/become-host' || path === '/sell' || path.startsWith('/sell/') || path.startsWith('/advertising/')
}
