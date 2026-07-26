// Platform Contract Kit — security check: ELEVATED-ROUTE authz sweep (discovery).
//
// Proving "a non-privileged session can reach zero elevated capability" with a hand-written list is a
// sample, not a proof — and it rots as routes are added. This discovers EVERY route whose auth guard lists
// ONLY elevated roles, straight from the source, so a test built on it stays complete automatically: any
// new elevated route is swept in the next run.
//
// A route is "elevated" when its guard call lists only roles from `elevatedRoles` (a lower-privilege
// session can never satisfy it). Discovery is a line-based scan of each route file: the current path is the
// most recent `<pathVar> === 'literal'` or `<pathVar>.match(/regex/)`, the current method is the most
// recent method guard since that path, and each guard call whose role list is fully elevated emits one
// { method, path } to probe. Feed the result to a test that asserts a lower-role token gets 401/403 on
// every discovered route.
//
// `elevatedRoles` and `guardCall` are REQUIRED — no defaults. Defaulting to SYBNB's ['ADMIN','SUPPORT'] /
// 'requireAuth' on another platform would match nothing, discover ZERO elevated routes, and SILENTLY PASS
// the "no low-role access" test. `pathAccessor` / `methodAccessor` (how your router reads the URL path +
// HTTP method) and `exts` are neutral knobs that default to the common Node-http shape — verify they match
// your router, or a wrong shape also finds nothing.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const NEUTRAL_DEFAULTS = {
  pathAccessor: 'url.pathname', // e.g. if (url.pathname === '/api/admin/x') / url.pathname.match(/.../)
  methodAccessor: 'req.method', // e.g. if (req.method === 'GET') / methodNotAllowed(res, ['GET'])
  exts: ['.mjs', '.js', '.ts', '.cjs'],
}

// Turn a route-matching regex source into a concrete sample path: drop ^/$ anchors, unescape \/, and
// replace each ([^/]+)-style capture group with a fixed placeholder segment.
function regexToSamplePath(reSource) {
  return reSource
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/')
    .replace(/\([^)]*\)/g, 'idplaceholder')
}

export function discoverElevatedRoutes(routesDir, options = {}) {
  if (!Array.isArray(options.elevatedRoles) || options.elevatedRoles.length === 0) {
    throw new Error(
      'discoverElevatedRoutes: `elevatedRoles` is required — pass your platform\'s elevated roles (e.g. ["ADMIN","STAFF"]). ' +
        'Refusing to default to SYBNB\'s ["ADMIN","SUPPORT"], which would discover the wrong routes and silently pass.',
    )
  }
  if (!options.guardCall || typeof options.guardCall !== 'string') {
    throw new Error(
      'discoverElevatedRoutes: `guardCall` is required — pass your auth-guard helper name (e.g. "requireAuth"). ' +
        'Refusing to default: a wrong guard name matches nothing and silently passes.',
    )
  }
  const { elevatedRoles, guardCall, pathAccessor, methodAccessor, exts } = { ...NEUTRAL_DEFAULTS, ...options }
  const elevated = new Set(elevatedRoles)
  const pathAcc = pathAccessor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const methodAcc = methodAccessor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const exactRe = new RegExp(`${pathAcc}\\s*===\\s*'([^']+)'`)
  const regexRe = new RegExp(`${pathAcc}\\.match\\(\\/(.+)\\/\\)`)
  const notAllowedRe = /methodNotAllowed\([^,]*,\s*\[\s*'([A-Z]+)'/
  const branchRe = new RegExp(`${methodAcc}\\s*===\\s*'([A-Z]+)'`)
  const guardRe = new RegExp(`${guardCall}\\([^)]*\\[([^\\]]*)\\]`)

  const routes = []
  const seen = new Set()
  for (const entry of readdirSync(routesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !exts.some((e) => entry.name.endsWith(e))) continue
    const file = join(routesDir, entry.name)
    const lines = readFileSync(file, 'utf8').split('\n')
    let curPath = null
    let curMethod = null

    lines.forEach((line, i) => {
      const exact = line.match(exactRe)
      if (exact) {
        curPath = exact[1]
        curMethod = null
      }
      const re = line.match(regexRe)
      if (re) {
        curPath = regexToSamplePath(re[1])
        curMethod = null
      }
      const allowed = line.match(notAllowedRe)
      if (allowed) curMethod = allowed[1]
      const branch = line.match(branchRe)
      if (branch) curMethod = branch[1]

      const ra = line.match(guardRe)
      if (ra && curPath) {
        const roles = ra[1].split(',').map((r) => r.replace(/['"\s]/g, '')).filter(Boolean)
        if (roles.length > 0 && roles.every((r) => elevated.has(r))) {
          const method = (curMethod || 'GET').toLowerCase()
          const key = `${method} ${curPath}`
          if (!seen.has(key)) {
            seen.add(key)
            routes.push({ file, line: i + 1, method, path: curPath, roles })
          }
        }
      }
    })
  }
  return routes
}
