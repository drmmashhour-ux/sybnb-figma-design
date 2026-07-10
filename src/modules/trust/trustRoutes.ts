export const TRUST_ROUTE_COVERAGE = [
  '/trust-center',
  '/trust-center/verification',
  '/trust-center/score',
  '/trust-center/sos',
  '/booking/protection/',
  '/booking/guarantee/',
  '/booking/payment-status/',
  '/booking/dispute/',
  '/booking/dispute-closed/',
]

export function isTrustProtectionRoute(path: string) {
  return path === '/trust-center'
    || path === '/trust-center/verification'
    || path === '/trust-center/score'
    || path === '/trust-center/sos'
    || /^\/booking\/protection\/[^/]+$/.test(path)
    || /^\/booking\/guarantee\/[^/]+$/.test(path)
    || /^\/booking\/payment-status\/[^/]+$/.test(path)
    || /^\/booking\/dispute\/[^/]+$/.test(path)
    || /^\/booking\/dispute-closed\/[^/]+$/.test(path)
}
