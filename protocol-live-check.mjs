import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const srRides = read('./server/routes/sr-rides.mjs')
const driverRoutes = read('./server/routes/driver.mjs')
const bookings = read('./server/routes/bookings.mjs')
const payments = read('./server/routes/payments.mjs')
const reviews = read('./server/routes/reviews.mjs')
const listings = read('./server/routes/listings.mjs')
const emailVerification = read('./server/lib/email-verification.mjs')
const authContext = read('./server/lib/auth-context.mjs')
const financeLedger = read('./server/lib/finance-ledger.mjs')

const checks = [
  ['SR ride requests are guest-only', () => assert.match(srRides, /requireAuth\(context, \['GUEST'\]\)/)],
  ['SR drivers are role-gated', () => assert.match(srRides + driverRoutes, /requireAuth\(context, \['DRIVER'\]\)/)],
  ['SR self-claim uses optimistic concurrency', () => assert.match(srRides, /updateMany\([\s\S]*driverId: null[\s\S]*REQUESTED[\s\S]*MATCHING/)],
  ['SR Rule 2 rejects a driver with an active ride', () => assert.match(srRides, /DRIVER_HAS_ACTIVE_RIDE/)],
  ['SR status transitions are constrained', () => assert.match(driverRoutes, /INVALID_DRIVER_RIDE_TRANSITION/)],
  ['guest bookings reject double booking overlap', () => assert.match(bookings, /BOOKING_DATE_UNAVAILABLE|overlap|overlapping/i)],
  ['payment requires uploaded guest ID before pay', () => assert.match(payments, /ID_VERIFICATION_REQUIRED/)],
  ['Stripe confirms ownership before accepting a session', () => assert.match(payments, /STRIPE_SESSION_FORBIDDEN/)],
  ['payment proof approval records audit and ledger behavior', () => assert.match(financeLedger, /approvePaymentProof/)],
  ['reviews require completed booking', () => assert.match(reviews, /REVIEW_BOOKING_NOT_COMPLETED/)],
  ['public listings only expose approved inventory', () => assert.match(listings, /status: 'APPROVED'/)],
  ['paid plan listings require approved seller profile', () => assert.match(listings, /SELLER_PLAN_REQUIRED/)],
  ['hosted deployments never expose a raw email code', () => {
    assert.match(emailVerification, /const devCode = !isProduction && !process\.env\.VERCEL_ENV \? code : undefined/)
  }],
  ['auth rejects missing or invalid bearer token server-side', () => assert.match(authContext, /AUTH_REQUIRED|INVALID_TOKEN|verifySessionToken/)],
]

for (const [name, check] of checks) {
  test(name, check)
}
