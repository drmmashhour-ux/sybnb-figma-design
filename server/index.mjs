import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { API_ENDPOINTS, PLATFORM_SECURITY_RULES } from './contracts.mjs'
import { getAuthContext } from './lib/auth-context.mjs'
import { loadEnv, validateProductionConfig } from './lib/env.mjs'
import { checkDatabase, disconnectDb } from './lib/prisma.mjs'
import { checkRateLimit, clientIp } from './lib/rate-limit.mjs'
import { CORS_ORIGINS } from './lib/allowed-origins.mjs'
import { closedBetaRouteBlocked, CLOSED_BETA_DIVISION_CODE, CLOSED_BETA_DIVISION_MESSAGE } from './lib/closed-beta-gate.mjs'
import { handleRouteError, json, notFound, publicUrl } from './lib/responses.mjs'
import { applySecurityHeaders } from './lib/security-headers.mjs'
import { handleAccommodations } from './routes/accommodations.mjs'
import { handleAdmin } from './routes/admin.mjs'
import { handleAuth } from './routes/auth.mjs'
import { handleBookings } from './routes/bookings.mjs'
import { handleCompliance } from './routes/compliance.mjs'
import { handleDriver } from './routes/driver.mjs'
import { handleHost } from './routes/host.mjs'
import { handleListings } from './routes/listings.mjs'
import { handleMe } from './routes/me.mjs'
import { handleMessages } from './routes/messages.mjs'
import { handlePayments } from './routes/payments.mjs'
import { handleDisputes } from './routes/disputes.mjs'
import { handleQuebecDriverOnboarding } from './routes/quebec-driver-onboarding.mjs'
import { handleReports } from './routes/reports.mjs'
import { handleReviews } from './routes/reviews.mjs'
import { handleSellers } from './routes/sellers.mjs'
import { handleSrRides } from './routes/sr-rides.mjs'
import { handleTaxProfile } from './routes/tax-profile.mjs'
import { handleWallet } from './routes/wallet.mjs'

loadEnv()

const PORT = Number(process.env.API_PORT || 3051)
const HOST = process.env.API_HOST || '127.0.0.1'

// High-risk-endpoint rate limits (security audit F-08). Central table keyed by [method, pathname
// pattern] rather than scattering limiter calls across 12 route-handler files, so the whole policy
// is reviewable in one place. Defaults are conservative starting points, not a final production
// tuning — see docs/security/SYBNB_V6_RATE_LIMIT_POLICY.md for rationale and how to override each
// one via env vars without a code change.
//
// failMode ('closed' | 'open', STR launch blocker P0, 2026-07-22): what happens if the distributed
// rate-limit store itself is unreachable (e.g. an Upstash outage) -- see
// docs/security/SYBNB_V6_RATE_LIMIT_POLICY.md's fail-open/fail-closed table for the approved
// policy and rationale. 'closed' rejects the request rather than risk unbounded abuse on
// pre-authentication, abuse-prone endpoints; 'open' lets it through rather than take down an
// already-authenticated business action or public browsing over an unrelated storage outage. This
// property only changes behavior when the Redis backend is configured and fails -- it is inert on
// the in-memory backend (a Map read/write does not fail) used by local dev and this test suite.
const RATE_LIMIT_RULES = [
  { name: 'AUTH_LOGIN', method: 'POST', pattern: /^\/api\/auth\/login$/, max: 10, windowMs: 5 * 60 * 1000, byUser: false, failMode: 'closed' },
  { name: 'AUTH_REGISTER', method: 'POST', pattern: /^\/api\/auth\/register$/, max: 5, windowMs: 15 * 60 * 1000, byUser: false, failMode: 'closed' },
  { name: 'AUTH_EMAIL_CODE_SEND', method: 'POST', pattern: /^\/api\/auth\/email-code\/send$/, max: 5, windowMs: 15 * 60 * 1000, byUser: false, failMode: 'closed' },
  { name: 'AUTH_EMAIL_CODE_VERIFY', method: 'POST', pattern: /^\/api\/auth\/email-code\/verify$/, max: 10, windowMs: 15 * 60 * 1000, byUser: false, failMode: 'closed' },
  // H1: the reset endpoint gets its OWN per-IP throttle on top of the email-code send gate above — a
  // stolen-code or scripted-reset flood is bounded even if it reuses one already-verified code window.
  { name: 'AUTH_PASSWORD_RESET', method: 'POST', pattern: /^\/api\/auth\/password-reset$/, max: 5, windowMs: 15 * 60 * 1000, byUser: false, failMode: 'closed' },
  // Phone/SMS OTP: same per-IP caps as email — bounds SMS cost/bombing on send and brute-force on verify.
  { name: 'AUTH_PHONE_CODE_SEND', method: 'POST', pattern: /^\/api\/auth\/phone-code\/send$/, max: 5, windowMs: 15 * 60 * 1000, byUser: false, failMode: 'closed' },
  { name: 'AUTH_PHONE_CODE_VERIFY', method: 'POST', pattern: /^\/api\/auth\/phone-code\/verify$/, max: 10, windowMs: 15 * 60 * 1000, byUser: false, failMode: 'closed' },
  { name: 'PUBLIC_SEARCH', method: 'GET', pattern: /^\/api\/listings$/, max: 60, windowMs: 60 * 1000, byUser: false, failMode: 'open' },
  { name: 'MESSAGING', method: 'POST', pattern: /^\/api\/(listings|bookings)\/[^/]+\/thread\/messages$/, max: 20, windowMs: 60 * 1000, byUser: true, failMode: 'open' },
  { name: 'BOOKING_CREATE', method: 'POST', pattern: /^\/api\/bookings$/, max: 10, windowMs: 60 * 1000, byUser: true, failMode: 'open' },
  { name: 'PAYMENT_PROOF', method: 'POST', pattern: /^\/api\/payments\/(seller-plan-proof|local-wallet-proof)$/, max: 10, windowMs: 60 * 1000, byUser: true, failMode: 'open' },
  // ADMIN_DECISION/DOCUMENT_ACCESS/GEOCODING/DRIVER_STATUS: classified as "authenticated business
  // operations" per the approved fail-open bucket. GEOCODING and DRIVER_STATUS are SR-owned rules
  // included here only because they share this one central table with STR's rules -- failMode is
  // being added mechanically to every existing rule as part of this migration, not a change to
  // SR's own limits, routes, or policy.
  { name: 'ADMIN_DECISION', method: 'PATCH', pattern: /^\/api\/admin\/review-queue\/[^/]+\/[^/]+$/, max: 60, windowMs: 60 * 1000, byUser: true, failMode: 'open' },
  { name: 'DOCUMENT_ACCESS', method: 'GET', pattern: /^\/api\/(admin\/id-document|me\/id-document)\/[^/]+(\/file)?$/, max: 30, windowMs: 60 * 1000, byUser: true, failMode: 'open' },
  { name: 'GEOCODING', method: 'POST', pattern: /^\/api\/sr\/(quote|rides)$/, max: 20, windowMs: 60 * 1000, byUser: true, failMode: 'open' },
  { name: 'DRIVER_STATUS', method: 'PATCH', pattern: /^\/api\/(driver\/rides\/[^/]+\/status|sr\/rides\/[^/]+\/claim)$/, max: 30, windowMs: 60 * 1000, byUser: true, failMode: 'open' },
  // Public, unauthenticated, phone-guessable (12-char ref + phone) -- capped tightly per IP so it
  // can't be used to brute-force other guests' trip status. Classified fail-open (browsing/lookup
  // bucket, not an auth-abuse vector like login/register/OTP).
  { name: 'BOOKING_LOOKUP', method: 'GET', pattern: /^\/api\/bookings\/lookup$/, max: 20, windowMs: 15 * 60 * 1000, byUser: false, failMode: 'open' },
]

function matchRateLimitRule(req, url) {
  return RATE_LIMIT_RULES.find((rule) => rule.method === req.method && rule.pattern.test(url.pathname))
}

// Extracted so both the local dev server below (http.createServer) and the Vercel serverless
// entry (api/[...path].mjs) run the exact same request-handling logic — no behavioral drift
// between "npm run api:dev" and production between the two entry points.
export async function handleRequest(req, res) {
  const url = publicUrl(req)

  try {
    setCors(req, res)
    applySecurityHeaders(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }

    if (url.pathname === '/api/health') {
      const db = await databaseStatus()
      return json(res, db.ok ? 200 : 503, {
        ok: db.ok,
        service: 'sybnb-v6-api',
        database: db,
      })
    }

    if (url.pathname === '/api/contracts') {
      return json(res, 200, {
        ok: true,
        endpoints: API_ENDPOINTS,
        securityRules: PLATFORM_SECURITY_RULES,
      })
    }

    const context = await getAuthContext(req)

    const rule = matchRateLimitRule(req, url)
    if (rule) {
      // Authenticated high-risk actions are limited per-account (a shared office IP shouldn't
      // throttle every user behind it); unauthenticated ones (login, register, public search) are
      // limited per-IP, since there's no account yet to key on.
      const bucketKey = rule.byUser && context?.user ? `user:${context.user.id}` : `ip:${clientIp(req)}`
      const result = await checkRateLimit({ bucketKey, name: rule.name, defaultMax: rule.max, defaultWindowMs: rule.windowMs, failMode: rule.failMode })
      if (!result.allowed) {
        res.setHeader('retry-after', String(result.retryAfterSeconds))
        return json(res, 429, {
          ok: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
          },
        })
      }
    }

    const handled = await dispatch(req, res, url, context)
    if (handled === false) return notFound(res)
  } catch (error) {
    handleRouteError(res, error)
  }
}

const server = createServer(handleRequest)

async function dispatch(req, res, url, context) {
  // SYB-008: STR-only closed-beta API gate. Refuse gated-division API families (Ride/SR) at the entry,
  // before any handler runs, so a direct call can't bypass the hidden navigation. Enforced in
  // beta/production; relaxed only under the explicit CLOSED_BETA_ALLOW_GATED_ROUTES=1 test flag.
  if (closedBetaRouteBlocked(url.pathname)) {
    json(res, 403, { ok: false, error: { code: CLOSED_BETA_DIVISION_CODE, message: CLOSED_BETA_DIVISION_MESSAGE } })
    return true
  }

  for (const handler of [
    handleAuth,
    handleAccommodations,
    handleListings,
    handleBookings,
    handlePayments,
    handleWallet,
    handleMe,
    handleHost,
    handleDriver,
    handleQuebecDriverOnboarding,
    handleAdmin,
    handleSrRides,
    handleReviews,
    handleSellers,
    handleDisputes,
    handleReports,
    handleMessages,
    handleTaxProfile,
    handleCompliance,
  ]) {
    const handled = await handler(req, res, url, context)
    if (handled !== false) return handled
  }
  return false
}

async function databaseStatus() {
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      code: 'DATABASE_URL_MISSING',
      message: 'Set DATABASE_URL before using database-backed V6 API routes.',
    }
  }

  try {
    await checkDatabase()
    return { ok: true, code: 'DATABASE_CONNECTED' }
  } catch (error) {
    return {
      ok: false,
      code: 'DATABASE_UNAVAILABLE',
      message: error.message,
    }
  }
}

function setCors(req, res) {
  const requestedOrigin = req.headers.origin
  res.setHeader('vary', 'origin')
  // Security audit finding F-14: previously fell back to the first configured allowed origin for
  // any disallowed requester. Browsers only grant page JS access to the response when the header
  // matches the *actual* requesting origin, so that was never an actual bypass — but omitting the
  // header entirely for a disallowed origin is the correct, unambiguous behavior instead of
  // returning a value that looks like a grant but isn't one.
  if (requestedOrigin && CORS_ORIGINS.includes(requestedOrigin)) {
    res.setHeader('access-control-allow-origin', requestedOrigin)
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type,authorization')
}

// Exported (not just listened-on) so API tests can bind this same request-handling server to an
// ephemeral port via Supertest, instead of re-implementing routing or requiring a separate running
// process. Only auto-listens on the configured PORT/HOST when this file is the actual entrypoint
// (`npm run api:dev`), not when imported by a test.
export { server }

// pathToFileURL correctly percent-encodes spaces/special characters in the path (this repo lives
// under a path containing spaces) — naive `file://${process.argv[1]}` string interpolation doesn't
// match import.meta.url's encoding and silently never detects direct execution.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) {
  if (process.env.NODE_ENV === 'production') {
    validateProductionConfig()
  }

  server.listen(PORT, HOST, () => {
    console.log(`SYBNB V6 API listening on http://${HOST}:${PORT}`)
  })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
      await disconnectDb()
      server.close(() => process.exit(0))
    })
  }
}
