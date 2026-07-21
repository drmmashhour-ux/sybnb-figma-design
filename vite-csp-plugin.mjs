// STR launch blocker P0 (production CSP configuration, 2026-07-22): index.html's <meta> CSP used
// to hardcode two local-only dev API ports directly into connect-src, verbatim, in the committed
// HTML file -- meaning a production build shipped dev-only origins (failing "development-only
// origins must not leak into production"), and had no way to add a real production API origin if
// this deployment ever splits the API onto its own domain via VITE_API_BASE_URL. This is templated
// at build time instead: index.html carries a __CSP_CONNECT_SRC_EXTRA__ placeholder, and this
// plugin fills it in based on whether Vite is running the dev server or a real build.
//
// Kept as a small, plain, dependency-free module (rather than inline in vite.config.ts) so the pure
// decision logic (cspConnectSrcExtra) is directly unit-testable without needing to spin up Vite
// itself or reimport vite.config.ts with a mutated environment.
const DEV_ONLY_ORIGINS = 'http://127.0.0.1:3051 http://127.0.0.1:3061'

// isDev: true when Vite's dev server is running (transformIndexHtml's ctx.server is only set then,
// never during `vite build`). apiBaseUrl: the same VITE_API_BASE_URL env var
// src/shared/api/platformApi.ts already reads to decide whether the API is split onto its own
// domain -- reused here so the CSP and the actual fetch base URL can never disagree about where the
// API lives.
export function cspConnectSrcExtra({ isDev, apiBaseUrl }) {
  if (isDev) return DEV_ONLY_ORIGINS
  return apiBaseUrl ? apiBaseUrl : ''
}

export function cspConnectSrcPlugin() {
  return {
    name: 'csp-connect-src',
    transformIndexHtml(html, ctx) {
      const isDev = ctx.server !== undefined
      const extra = cspConnectSrcExtra({ isDev, apiBaseUrl: process.env.VITE_API_BASE_URL })
      return html.replace('__CSP_CONNECT_SRC_EXTRA__', extra ? ` ${extra}` : '')
    },
  }
}
