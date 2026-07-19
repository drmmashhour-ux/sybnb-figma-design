// Single source of truth for "origins this deployment trusts" — used both for CORS response
// headers (server/index.mjs) and to validate any client-supplied `origin` value before it's
// echoed into a redirect URL (Stripe Checkout success_url/cancel_url in server/routes/payments.mjs).
// Extracted to its own module (rather than exported from index.mjs) so routes/*.mjs can import it
// without a circular import back to index.mjs, which imports every routes/*.mjs handler.
const DEFAULT_CORS_ORIGIN = [
  'http://127.0.0.1:3050',
  'http://127.0.0.1:3053',
  'http://127.0.0.1:3055',
  'http://127.0.0.1:5180',
  'http://localhost:5180',
  'http://127.0.0.1:5181',
  'http://localhost:5181',
  'http://127.0.0.1:5199',
  'http://localhost:5199',
].join(',')
// Capacitor native-app origins (mobile/capacitor-wrapper). The iOS/Android webview loads the packaged
// SYBNB app from these fixed origins — iOS uses capacitor://localhost, Android uses https://localhost
// (server.androidScheme: 'https'). They are invariant across deployments, so they are ALWAYS allowed —
// merged in even when a production CORS_ORIGIN env overrides the default list — otherwise the mobile
// app's API calls would be CORS-blocked in production. A browser page cannot forge these as its origin.
const CAPACITOR_APP_ORIGINS = ['capacitor://localhost', 'https://localhost']

export const CORS_ORIGINS = [
  ...new Set(
    [...(process.env.CORS_ORIGIN || DEFAULT_CORS_ORIGIN).split(','), ...CAPACITOR_APP_ORIGINS]
      .map((origin) => origin.trim())
      .filter(Boolean),
  ),
]

export function isAllowedOrigin(origin) {
  return typeof origin === 'string' && CORS_ORIGINS.includes(origin)
}
