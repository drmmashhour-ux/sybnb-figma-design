// Platform Contract Kit — security check: SECRET / test-mode value never reaches PRODUCTION.
//
// Two complementary guards. Use both.
//
// 1) STATIC (build-time): a dev-only secret display (a one-time code, a debug token) must be gated on a
//    BUILD flag, not merely on the data being present — otherwise if the value ever reaches the client in a
//    prod build (a regressed backend gate, a proxy/cache) it renders. `findUngatedDevSecrets` scans a
//    source tree and returns every `file:line` that renders the token WITHOUT the build flag (empty ⇒ all
//    gated). Defaults match a Vite client (`import.meta.env.DEV` + a `devCode` token); override for yours.
//
// 2) RUNTIME (request-time): a settlement/side-effect path must REJECT a test/sandbox reference in
//    production (e.g. a payment gateway's `livemode !== true`), and ACCEPT a real one. Write your guard as
//    a pure function `guard(obj, { isProduction })` that throws in prod on an unsafe object, then use
//    `productionGuardOutcome` to test it deterministically in both modes — no global env mutation. Also
//    drive the real settlement entry point once under a simulated production env so the guard is proven
//    WIRED (removing it makes the path fall through instead of throwing).

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// `token` (the dev-only secret variable rendered in the UI) and `buildFlag` (the build-time flag that must
// gate it) are REQUIRED — no defaults. Defaulting to SYBNB's `devCode` / `import.meta.env.DEV` on another
// client would scan for a token that doesn't exist, find nothing, and silently pass. `exts` is a neutral
// client-file default.
const NEUTRAL_DEFAULTS = {
  exts: ['.tsx', '.ts', '.jsx', '.js'],
}

export function findUngatedDevSecrets(sourceDir, options = {}) {
  if (!options.token || typeof options.token !== 'string') {
    throw new Error(
      'findUngatedDevSecrets: `token` is required — pass your dev-only secret variable name (e.g. "devCode"). ' +
        'Refusing to default to SYBNB\'s "devCode", which would scan the wrong token and silently pass.',
    )
  }
  if (!options.buildFlag || typeof options.buildFlag !== 'string') {
    throw new Error(
      'findUngatedDevSecrets: `buildFlag` is required — pass your build-time gate (e.g. "import.meta.env.DEV").',
    )
  }
  const { token, buildFlag, exts } = { ...NEUTRAL_DEFAULTS, ...options }
  const tok = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const flag = buildFlag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // A render of the token (`{ token && (` or `token &&`) that is NOT immediately preceded by the build flag.
  const gatedRe = new RegExp(`${flag}\\s*&&\\s*${tok}`)
  const rawRenderRe = new RegExp(`\\{\\s*${tok}\\s*&&\\s*\\(`)
  const offenders = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile() || !exts.some((e) => full.endsWith(e))) continue
      readFileSync(full, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (rawRenderRe.test(line) && !gatedRe.test(line)) offenders.push(`${full}:${i + 1}`)
        })
    }
  }
  walk(sourceDir)
  return offenders
}

// Call a production-rejection guard with an explicit isProduction and return the thrown error's `code`
// (or null if it did not throw). Lets you assert, deterministically and without touching process.env:
//   productionGuardOutcome(guard, unsafeObj, true)  === 'YOUR_REJECT_CODE'   // test-mode rejected in prod
//   productionGuardOutcome(guard, safeObj,   true)  === null                 // real value accepted in prod
//   productionGuardOutcome(guard, unsafeObj, false) === null                 // allowed outside prod (dev)
export function productionGuardOutcome(guard, stripeLikeObject, isProduction) {
  try {
    guard(stripeLikeObject, { isProduction })
    return null
  } catch (e) {
    return e && e.code ? e.code : 'THREW'
  }
}
