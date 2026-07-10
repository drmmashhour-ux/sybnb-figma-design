export const GIFT_ROUTE_COVERAGE = [
  '/wallet/gift/claim',
  '/wallet/gift/code',
  '/wallet/gift/success',
  '/wallet/gift/error',
  '/wallet/admin/gift-audit',
]

export function isGiftFlowRoute(path: string) {
  return path === '/wallet/gift/claim'
    || /^\/wallet\/gift\/claim\/[^/]+$/.test(path)
    || path === '/wallet/gift/code'
    || /^\/wallet\/gift\/code\/[^/]+$/.test(path)
    || path === '/wallet/gift/success'
    || path === '/wallet/gift/error'
    || path === '/wallet/admin/gift-audit'
}
