import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cspConnectSrcExtra } from '../../vite-csp-plugin.mjs'

// STR launch blocker P0: production CSP configuration. Read-only trace found two distinct,
// independently-confirmed gaps (see docs/security/SYBNB_V6_FRONTEND_CSP_PLAN.md for the original
// baseline this corrects):
//
// 1. UNCONDITIONAL, already-real bug: no `frame-src` directive exists at all, so it falls back to
//    `default-src 'self'` -- which blocks the Google Maps embed <iframe> every listing detail page
//    renders (src/modules/listings/ListingDetailPage.tsx:601-604, googleMapsEmbedUrl ->
//    https://www.google.com/maps?...&output=embed). This breaks in EVERY environment enforcing the
//    meta CSP, not just production -- it was never caught because the existing CSP smoke tests only
//    check the landing page and an API call, never a listing detail page's map embed.
// 2. CONDITIONAL: `connect-src` hardcodes two local dev-only ports directly into the static
//    index.html template, so a production build ships dev origins verbatim (fails the "development-
//    only origins must not leak into production" requirement) and has no way to add a real
//    production API origin if the deployment ever splits the API onto its own domain.
//
// frame-ancestors remains a known, currently-unfixable-via-<meta> limitation (CSP spec behavior,
// already documented) -- addressed separately via a real HTTP header in vercel.json.
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const viteConfigSource = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
const vercelJsonSource = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')

function extractCspContent(html) {
  const match = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)
  return match ? match[1] : ''
}

describe('CSP: frame-src must allow the Google Maps embed the STR listing page actually renders', () => {
  it('the index.html CSP includes a frame-src directive allowing https://www.google.com', () => {
    const csp = extractCspContent(indexHtml)
    expect(csp).toMatch(/frame-src[^;]*https:\/\/www\.google\.com/)
  })

  it('frame-src does not fall back to a bare wildcard -- only the one origin STR actually embeds', () => {
    const csp = extractCspContent(indexHtml)
    const frameSrcMatch = csp.match(/frame-src ([^;]+)/)
    expect(frameSrcMatch).not.toBeNull()
    expect(frameSrcMatch[1]).not.toContain('*')
    expect(frameSrcMatch[1]).not.toContain("'unsafe-inline'")
  })
})

describe('CSP: connect-src must not hardcode dev-only origins into the static template', () => {
  it('index.html no longer hardcodes literal 127.0.0.1 dev ports directly in the CSP content string', () => {
    const csp = extractCspContent(indexHtml)
    // Dev origins must come from a build-time template, not be baked into the committed HTML file
    // itself -- index.html is the SOURCE Vite transforms per-build, so the raw file should carry a
    // placeholder, not a literal dev origin that would ship unchanged if anything ever served this
    // file directly without running the build step.
    expect(csp).not.toMatch(/127\.0\.0\.1:3051/)
    expect(csp).not.toMatch(/127\.0\.0\.1:3061/)
  })

  it('index.html still declares connect-src with \'self\' as the base (unconditional, always correct for same-origin API calls)', () => {
    const csp = extractCspContent(indexHtml)
    expect(csp).toMatch(/connect-src[^;]*'self'/)
  })
})

describe('CSP: build-time origin templating (vite.config.ts + vite-csp-plugin.mjs)', () => {
  it('vite.config.ts wires up the CSP connect-src plugin via transformIndexHtml', () => {
    expect(viteConfigSource).toMatch(/cspConnectSrcPlugin/)
  })

  it('a production build (no dev server) never includes the dev-only ports', () => {
    const extra = cspConnectSrcExtra({ isDev: false, apiBaseUrl: undefined })
    expect(extra).not.toMatch(/127\.0\.0\.1/)
  })

  it('the dev server includes the local dev ports', () => {
    const extra = cspConnectSrcExtra({ isDev: true, apiBaseUrl: undefined })
    expect(extra).toMatch(/127\.0\.0\.1:3051/)
    expect(extra).toMatch(/127\.0\.0\.1:3061/)
  })

  it('a production build includes a real API origin when VITE_API_BASE_URL is set, and never a wildcard', () => {
    const extra = cspConnectSrcExtra({ isDev: false, apiBaseUrl: 'https://api.sybnb.example' })
    expect(extra).toMatch(/https:\/\/api\.sybnb\.example/)
    expect(extra).not.toContain('*')
    expect(extra).not.toMatch(/127\.0\.0\.1/)
  })

  it('a production build with no configured API origin (same-origin default) adds nothing extra beyond \'self\'', () => {
    const extra = cspConnectSrcExtra({ isDev: false, apiBaseUrl: '' })
    expect(extra).toBe('')
  })
})

describe('CSP: frame-ancestors requires a real HTTP header (a <meta> CSP cannot deliver it)', () => {
  it('vercel.json now serves a real, header-based security policy for the static frontend, including frame-ancestors', () => {
    const vercelConfig = JSON.parse(vercelJsonSource)
    expect(Array.isArray(vercelConfig.headers)).toBe(true)
    const htmlHeaders = vercelConfig.headers.find((entry) => entry.source === '/(.*)')
    expect(htmlHeaders).toBeTruthy()
    const cspHeader = htmlHeaders.headers.find((h) => h.key.toLowerCase() === 'content-security-policy')
    expect(cspHeader).toBeTruthy()
    expect(cspHeader.value).toMatch(/frame-ancestors 'none'/)
  })

  it('the vercel.json header-based CSP contains no wildcard origins and no unsafe-eval', () => {
    const vercelConfig = JSON.parse(vercelJsonSource)
    const htmlHeaders = vercelConfig.headers.find((entry) => entry.source === '/(.*)')
    const cspHeader = htmlHeaders.headers.find((h) => h.key.toLowerCase() === 'content-security-policy')
    expect(cspHeader.value).not.toContain('unsafe-eval')
    expect(cspHeader.value).not.toMatch(/[^-]\*/) // no bare wildcard origin (distinct from e.g. a scheme like https:)
  })

  it('vercel.json still preserves existing security headers (X-Content-Type-Options, X-Frame-Options)', () => {
    const vercelConfig = JSON.parse(vercelJsonSource)
    const htmlHeaders = vercelConfig.headers.find((entry) => entry.source === '/(.*)')
    const keys = htmlHeaders.headers.map((h) => h.key.toLowerCase())
    expect(keys).toContain('x-content-type-options')
    expect(keys).toContain('x-frame-options')
  })

  it('vercel.json rewrites still route /api/* to the serverless function unchanged', () => {
    const vercelConfig = JSON.parse(vercelJsonSource)
    expect(vercelConfig.rewrites).toContainEqual({ source: '/api/(.*)', destination: '/api/index' })
  })
})

// vercel.json's header CSP is static JSON; index.html's meta CSP is templated at build time by
// vite-csp-plugin.mjs. These are two independently-maintained sources (see
// docs/security/SYBNB_V6_FRONTEND_CSP_PLAN.md, "2026-07-22 update", for why a single canonical
// source was investigated and not adopted: it would require migrating the entire vercel.json to
// vercel.ts, unverifiable without live Vercel access). This test is the canary for accidental
// drift between the two under today's actual, default topology (no VITE_API_BASE_URL) -- it does
// NOT catch the hypothetical future drift if VITE_API_BASE_URL is ever introduced (that requires a
// manual update to vercel.json's connect-src, documented as an explicit operational requirement).
describe('CSP: the meta tag and the header agree on connect-src under the current default topology', () => {
  it('index.html\'s templated connect-src (no VITE_API_BASE_URL) matches vercel.json\'s header connect-src', () => {
    const extra = cspConnectSrcExtra({ isDev: false, apiBaseUrl: undefined })
    const metaConnectSrc = `'self'${extra ? ` ${extra}` : ''}`

    const vercelConfig = JSON.parse(vercelJsonSource)
    const htmlHeaders = vercelConfig.headers.find((entry) => entry.source === '/(.*)')
    const cspHeader = htmlHeaders.headers.find((h) => h.key.toLowerCase() === 'content-security-policy')
    const headerConnectSrcMatch = cspHeader.value.match(/connect-src ([^;]+)/)

    expect(headerConnectSrcMatch).not.toBeNull()
    expect(headerConnectSrcMatch[1]).toBe(metaConnectSrc)
  })
})
