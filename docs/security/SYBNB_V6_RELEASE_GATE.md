# SYBNB V6 — Release Validation Gate

Date: 2026-07-10. Branch: `security/sybnb-v6-predeployment`. Every gate below was run against the
actual working tree on this branch, against the real local Postgres database (`sybnb_v6`), not a
mock or a stale cache.

| Gate | Command | Result |
|---|---|---|
| Working tree matches this phase's intended scope | `git status --short` | PASS — only files touched by this phase; no LECIPM, no legal-page, no unrelated changes |
| Correct branch, not `main` | `git branch --show-current` | PASS — `security/sybnb-v6-predeployment` |
| Clean install / lockfile sync | `npm install --dry-run` (full `npm ci` already verified earlier this engagement with a documented local-cache workaround) | PASS — no drift since |
| Prisma schema validity | `npx prisma validate` | PASS |
| TypeScript | `npx tsc --noEmit` | PASS — 0 errors |
| Lint | — | NOT CONFIGURED — no ESLint config exists in this repo; not introduced this phase (would be a design/tooling change beyond this order's scope) |
| Unit tests | `npx vitest run test/unit` | PASS — 21/21 |
| API tests | `npx vitest run test/api` | PASS — 60/60 |
| Security tests | `npx vitest run test/security` | PASS — 12/12 |
| Full Vitest suite | `npx vitest run` | PASS — 93/93 across 10 files |
| API smoke | `npm run smoke:api` | PASS — 8/8 |
| Route smoke (incl. frontend shell) | `SMOKE_FRONTEND_URL=http://127.0.0.1:5180 npm run smoke:routes` | PASS — 8/8 |
| Browser regression (Chromium, via Claude_Preview) | manual live pass — landing page, auth/login flow, mobile viewport | PASS — see Phase 7 notes below |
| Production build | `npx vite build` | PASS — builds cleanly, no errors |
| Dependency audit | `npm audit` (incl. dev) | PASS — 0 vulnerabilities |
| Secret scan | manual grep across this phase's diff + all new files for key/secret/password/PEM-shaped strings | PASS — no real secrets; only env-var names, doc prose, and test fixture literals (e.g. `'correct-horse-battery'`) |
| Manual live rate-limit check | direct `fetch()` against the running server: 12 rapid logins → 429 on the 11th+ with `Retry-After` | PASS |
| Manual live security-headers check | direct `fetch()` against `/api/health` | PASS — all 5 headers present as specified |

## Accessibility / cross-browser (Phase 7)

Bounded review, Chromium only (via `mcp__Claude_Preview__*`) — Safari and Firefox: **NOT RUN**, no
tooling available in this environment.

- Keyboard tab order: reaches every interactive element on the landing page and auth wizard in a
  sensible sequence. PASS.
- Focus-visible indicator: **inconclusive via automated tooling.** Chromium's `:focus-visible`
  heuristic does not reliably activate for script-dispatched (`isTrusted: false`) focus/keyboard
  events in headless automation, so scripted checks returned false negatives. No CSS anywhere in
  `src/` sets `outline` or targets `:focus`/`:focus-visible` (`grep` returned zero matches), so the
  app relies entirely on browser default focus indicators — expected to work correctly for a real
  keyboard user, but this was **not independently confirmed with a real keypress**. Recommend a
  manual keyboard spot-check before shipping.
- Labels: all 3 inputs on the auth form have accessible names (via associated `<label>`). PASS.
- Modal focus: N/A — the app uses an inline stepper/wizard pattern, not modal dialogs (`grep` for
  `role="dialog"` / `<dialog>` across `src/` returned zero matches).
- Contrast: body text (near-white on near-black) is comfortably AA-compliant. The primary CTA
  button (white text on `rgb(82,104,255)`) measures **4.39:1**, marginally below the 4.5:1 AA
  threshold for normal-size text (button text is 16px, not "large text" under WCAG's definition).
  Not fixed this phase — a color change is a design decision, not a narrow security repair, and
  this order explicitly excludes unnecessary design changes. Flagged for a follow-up design
  decision (e.g. darken the blue slightly).
- Reduced motion: `@media (prefers-reduced-motion: reduce)` is present and disables
  animations/transitions/scroll-behavior globally, plus a targeted rule for the ad marquee. PASS.
- Responsive zoom: viewport meta is `width=device-width, initial-scale=1.0` — does not disable
  pinch-zoom. PASS.
- Mobile layout (375×812): no horizontal overflow (`scrollWidth === innerWidth`). One touch target
  (a footer WhatsApp link) measured 23px tall against a 24px guideline — 1px short, informational
  only, not fixed.

## Summary

Every automated gate this phase controls (tests, build, types, schema, audit, secrets) is green.
The two non-blocking notes above (button contrast, focus-visible not independently confirmed) are
carried into `SYBNB_V6_PREDEPLOYMENT_READINESS.md` rather than resolved unilaterally, consistent
with this order's instruction not to make unnecessary design changes.
