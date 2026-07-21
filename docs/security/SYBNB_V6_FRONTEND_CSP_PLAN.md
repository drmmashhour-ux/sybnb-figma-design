# SYBNB V6 — Frontend Content-Security-Policy Plan

Date: 2026-07-11. Written in response to an independent-review finding: prior documentation
(`SYBNB_V6_SECURITY_AUDIT_2026_07_10.md`, `SYBNB_V6_THREAT_MODEL.md`) said the CSP added under F-13
gave the frontend's `sessionStorage` token some containment against XSS. That was inaccurate.
`server/lib/security-headers.mjs`'s CSP is applied to **API responses only** — its own comment
already said the API never serves the frontend, but the conclusion ("this offsets some of the
sessionStorage/XSS risk") was still drawn incorrectly in the threat model. The API's CSP protects
API responses (all JSON, so `default-src 'none'` is trivially safe and correct there). It does
nothing for the React application's own HTML/JS, which is served entirely separately (Vite dev
server locally, some static host/CDN in production — not yet chosen).

## Status before this phase

**MISSING.** No CSP of any kind was applied to the frontend's own served response. Corrected in
`docs/security/SYBNB_V6_THREAT_MODEL.md` (F-06) and `SYBNB_V6_SECURITY_AUDIT_2026_07_10.md`.

## Status after this phase

**PARTIAL — a real baseline exists, with two pieces still EXTERNAL INFRASTRUCTURE REQUIRED / OWNER
DECISION REQUIRED.**

A `<meta http-equiv="Content-Security-Policy">` tag was added directly to `index.html`:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
font-src 'self' data:;
connect-src 'self' http://127.0.0.1:3051 http://127.0.0.1:3061;
base-uri 'self';
form-action 'self';
object-src 'none'
```

This was chosen over doing nothing because it is **immediately effective and locally testable**
without deploying anything or picking a hosting provider first — a `<meta>` tag works identically
wherever the built `index.html` is served from (Vite dev, `vite preview`, any static host, any
CDN), unlike a header-based policy which has to be configured per-host.

### Why each directive is what it is

- **`script-src 'self'`, no `'unsafe-inline'`/`'unsafe-eval'`** — verified directly against the
  actual production build (`npx vite build` then inspected `dist/index.html`): it emits only
  external `<script src="/assets/...">` tags, zero inline scripts. Nothing in the built output
  needs either unsafe keyword.
- **`style-src 'self' 'unsafe-inline'`** — this codebase applies React inline `style={{...}}` props
  extensively, across essentially every page component (not a handful of exceptions). Browsers
  render these as real inline `style="..."` attributes, which CSP's `style-src` (or the newer,
  less-universally-supported `style-src-attr`) must allow via `'unsafe-inline'` or the app breaks
  visually everywhere. Removing this would mean migrating the inline-style pattern to CSS
  classes/modules across the whole codebase — a large, unrelated refactor, out of scope for this
  fix. Documented as an accepted, narrower-than-ideal trade-off, not silently dropped.
- **`img-src 'self' data: https:`** — `data:` for any inline/base64 image usage (e.g. QR codes,
  per the `qrcode` dependency); `https:` kept broad for now since listing/product photos may be
  hosted externally depending on how uploads are eventually stored (no such storage decision has
  been made for this project yet) — tightening this to a specific origin is a follow-up once that
  decision is made.
- **`connect-src 'self' http://127.0.0.1:3051 http://127.0.0.1:3061`** — the two known local API
  ports (default dev API, and the Playwright/isolated-test API port). Verified empirically: loading
  the built app via a local static server and navigating to a page that calls the API
  (`GET /api/listings`) succeeded with zero console CSP violations.
- **`base-uri 'self'`, `form-action 'self'`, `object-src 'none'`** — standard hardening with no
  functional cost; nothing in this app needs a `<base>` tag pointed elsewhere, a form submitting
  cross-origin, or plugin content.
- **No wildcards, no `'unsafe-eval'`, nothing added "to be safe later."**

### Verified working (evidence)

- `test/browser/smoke.spec.ts`'s "content security policy" test group (3 tests, run via
  `npm run test:browser`) asserts: the `<meta>` CSP is present on the frontend HTML with the
  expected directives and no wildcards/`unsafe-eval`; the frontend's own HTTP response has **no**
  CSP header (proving the meta tag, not a header, is what's protecting it); the API origin's
  response has its own, separate, strict header-based CSP (`default-src 'none'; frame-ancestors
  'none'`) — pinning down that these are two independent mechanisms protecting two different
  origins, not one policy doing double duty.
- Manually verified against the actual production build (not dev mode): built via `vite build`,
  served via a plain static file server, loaded in a real browser via Playwright — zero console
  errors, zero CSP violations, landing page rendered correctly (Arabic text, header, skip link all
  present), and a real API call (`/api/listings`) succeeded under the policy.

## What is still not covered — classified honestly

### `frame-ancestors` — EXTERNAL INFRASTRUCTURE REQUIRED

**Browsers silently ignore `frame-ancestors` when a CSP is delivered via `<meta>`** — this is
specified behavior (CSP spec §"Delivery"), not a bug in this implementation. Clickjacking
protection for the frontend (preventing the app from being framed by a malicious site) requires a
**real HTTP response header**, which only whatever serves the built files in production can set
(there is no production static host/CDN chosen yet for this project). Until that host exists and
is configured to send either `Content-Security-Policy: frame-ancestors 'none'` or
`X-Frame-Options: DENY` as a real header, this specific protection is genuinely absent for the
frontend. The API side already sends both (F-13, unaffected by this finding).

### Production `connect-src` origin — OWNER DECISION REQUIRED

The policy above only allowlists the two known **local** API ports. A real production deployment
will have its own API origin (a real domain, not `127.0.0.1`), which isn't decided yet — there is
no production environment for this project today. Two options once that exists:
1. Keep the CSP as a `<meta>` tag and have the build process template `connect-src` with the real
   API origin at build time (a small Vite plugin, not yet written).
2. Move the whole policy to a response header set by the production host/CDN instead of a `<meta>`
   tag — the more standard, more capable approach (also unlocks `frame-ancestors`, `report-uri`,
   and per-environment values without a build-time template step). **Recommended long-term
   approach**, deferred here only because it depends on a hosting choice that hasn't been made.

### Payment-provider frame/script sources — not yet needed, noted for later

No `@stripe/stripe-js`/`js.stripe.com` script or frame is currently loaded by the frontend —
confirmed by search (`grep` for `stripe` across `src/` finds only server-side API-call plumbing in
`platformApi.ts`, no client-side Stripe SDK). If/when a client-side Stripe integration (Elements,
embedded Checkout) is added, `script-src` and `frame-src` will need `https://js.stripe.com` /
`https://checkout.stripe.com` added at that time — not added now since "no unsafe third-party
defaults" means not pre-authorizing a source this app doesn't currently use.

## Do not

This phase does not configure Cloudflare, DNS, or any production hosting. Nothing here was applied
to any live/public environment; the `<meta>` tag lives in source and only takes effect wherever
this repository's own build output is served (currently: local dev/test only).

## 2026-07-22 update — P0 production CSP fix

STR launch-blocker P0 ("production CSP configuration breaks API calls after deployment") closed two
of the three items above and confirmed the third was mischaracterized:

- **`frame-src` was completely absent** (not previously flagged in this doc — found during the P0
  trace), which fell back to `default-src 'self'` and blocked the Google Maps embed `<iframe>` every
  listing detail page renders. Fixed: `frame-src https://www.google.com` added to `index.html`.
- **`connect-src`'s local dev ports were hardcoded directly in `index.html`** (this doc's original
  `OWNER DECISION REQUIRED` note above). Fixed via option 1 above: [`vite-csp-plugin.mjs`](../../vite-csp-plugin.mjs)
  templates `index.html`'s `__CSP_CONNECT_SRC_EXTRA__` placeholder at build time — dev server gets
  the two local ports, a production build gets nothing extra unless `VITE_API_BASE_URL` is set (the
  same env var `platformApi.ts` reads), and never ships a dev origin into a real build.
- **`frame-ancestors` via a real HTTP header** — this doc's option 2 above, previously deferred only
  because no production host was chosen. `vercel.json` now has a `headers` block applying
  `frame-ancestors 'none'` (plus `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) to
  every route, since this project's production host (Vercel) is now known.
- **The original P0 framing ("CSP breaks API calls") was conditional, not universal.** Under this
  project's actual topology — `vercel.json`'s existing `rewrites` route `/api/*` to the same
  deployment as the static frontend — `connect-src 'self'` already covers real production API calls
  today. The hardcoded dev ports were a real defect (dev-only origins shipping in a production
  build), but they were never actually blocking a production API call, since no production API call
  ever went to `127.0.0.1`.

### Investigated and rejected (for now): a single canonical CSP source

Adding the header (`vercel.json`) alongside the already-build-templated meta tag (`index.html` +
`vite-csp-plugin.mjs`) reintroduces exactly the kind of two-source duplication this doc has been
tracking since 2026-07-11 — now with an additional, concrete drift risk: if `VITE_API_BASE_URL` is
ever set (splitting the API onto its own domain), `vite-csp-plugin.mjs` would correctly add that
origin to the meta tag's `connect-src`, but `vercel.json`'s header `connect-src` is static JSON and
would still say `'self'` only. Per the CSP spec, when a header CSP and a meta CSP are both present,
browsers enforce the **intersection** of the two — so the static header would end up blocking real
API calls the meta tag correctly permits.

A single canonical source generating both was investigated before closing this fix:

- **Vercel genuinely has a mechanism for this**: `vercel.ts` (`@vercel/config` on npm, confirmed to
  exist — versions 0.0.37 through 0.5.5 as of this writing) replaces `vercel.json` with a TypeScript
  config that executes at build time and can read `process.env` directly (confirmed against
  Vercel's current docs, e.g. `outputDirectory: \`.${process.env.framework}\``). In principle,
  `vercel.ts` could import the exact same `cspConnectSrcExtra()` decision function from
  `vite-csp-plugin.mjs` that drives the meta tag, making both genuinely derive from one source.
- **Not adopted in this fix, for two concrete reasons, not just caution:**
  1. Vercel requires **exactly one** config file per project (`vercel.ts` *or* `vercel.json`, never
     both) — adopting it means migrating `buildCommand`, `outputDirectory`, `framework`,
     `functions`, and `rewrites` into the new format too, not just `headers`. That is materially
     larger than "CSP generation" and a disproportionate blast radius for what this task scoped as
     the smallest safe correction.
  2. It cannot be verified end-to-end in the environment this fix was built in: there was no
     authenticated Vercel access available, and the locally installed Vercel CLI (52.0.0) predates
     `vercel.ts`'s documented rollout. A parse/compatibility failure on a config-file-format swap
     would silently drop **all** routing configuration at once in production — rewrites, functions,
     and headers together, not just the CSP header — which is not a risk to take unverified on a
     security-critical config file without a real preview-deployment test first.

**Chosen instead**: keep the two sources (`vite-csp-plugin.mjs` and `vercel.json`), but added an
automated canary — `test/unit/csp-config.test.mjs`'s "the two CSPs agree" test asserts the meta
tag's and the header's `connect-src` values are identical under today's actual, default topology (no
`VITE_API_BASE_URL` set). This does not prevent the *hypothetical future* drift described above, but
it does catch any *accidental* divergence between the two files the moment either one is edited.

### Operational requirement (read this before ever setting `VITE_API_BASE_URL`)

If the API is ever split onto its own domain via `VITE_API_BASE_URL`, **`vercel.json`'s
`Content-Security-Policy` header's `connect-src` must be manually updated to include that same
origin in the same change** — it will not happen automatically. Forgetting this will not show up as
a broken build or a failing test (the canary test above only checks today's no-origin-set case); it
will show up as production API calls failing under the header CSP despite the meta tag looking
correct. If/when this becomes a real, current need (not hypothetical), that is the point to revisit
the `vercel.ts` + `@vercel/config` migration above properly — as its own scoped, preview-tested
change, not bundled into whatever change introduces `VITE_API_BASE_URL`.
