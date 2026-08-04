export const SELLER_ROUTE_COVERAGE = [
  '/sell',
  '/sell/account',
  '/sell/listing-wizard',
  '/sell/submitted',
  '/advertising/account',
  '/advertising',
  '/advertising/payment/shamCash',
  '/advertising/payment/localWallet',
  '/advertising/payment/bankTransfer',
  '/advertising/payment/creditCard',
]

export function isSellerRoute(path: string) {
  return path === '/sell' || path.startsWith('/sell/') || path === '/advertising' || path.startsWith('/advertising/')
}
