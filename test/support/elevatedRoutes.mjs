import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// A8 (Finding 5) — discover EVERY ADMIN/SUPPORT-gated route across server/routes so the staff-role test
// is a full sweep, not a sample, and stays complete automatically as new elevated routes are added (same
// self-maintaining pattern as the C9 audit-immutability scan).
//
// The only elevated roles in the model are ADMIN and SUPPORT (see enum RoleName). A route is "elevated"
// when its requireAuth guard lists ONLY elevated roles — a HOST token can never satisfy it. Discovery is a
// line-based scan of each route file: the current path is the most recent `url.pathname === 'lit'` or
// `url.pathname.match(/re/)`, the current method is the most recent method guard since that path, and each
// `requireAuth(context, [roles])` whose roles are all elevated emits one { method, path } to probe.

const ELEVATED = new Set(['ADMIN', 'SUPPORT'])

// Turn a route-matching regex source into a concrete sample path: drop ^/$ anchors, unescape \/, and
// replace each ([^/]+)-style capture group with a fixed placeholder segment.
function regexToSamplePath(reSource) {
  return reSource
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/')
    .replace(/\([^)]*\)/g, 'a8probe')
}

export function discoverElevatedRoutes(routesDir) {
  const routes = []
  const seen = new Set()
  for (const entry of readdirSync(routesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
    const file = join(routesDir, entry.name)
    const lines = readFileSync(file, 'utf8').split('\n')
    let curPath = null
    let curMethod = null

    lines.forEach((line, i) => {
      const exact = line.match(/url\.pathname\s*===\s*'([^']+)'/)
      if (exact) {
        curPath = exact[1]
        curMethod = null
      }
      const re = line.match(/url\.pathname\.match\(\/(.+)\/\)/)
      if (re) {
        curPath = regexToSamplePath(re[1])
        curMethod = null
      }
      // Method: the allowed method from `methodNotAllowed(res, ['GET', ...])`, or a `req.method === 'X'` branch.
      const allowed = line.match(/methodNotAllowed\(res,\s*\[\s*'([A-Z]+)'/)
      if (allowed) curMethod = allowed[1]
      const branch = line.match(/req\.method\s*===\s*'([A-Z]+)'/)
      if (branch) curMethod = branch[1]

      const ra = line.match(/requireAuth\(context,\s*\[([^\]]*)\]/)
      if (ra && curPath) {
        const roles = ra[1].split(',').map((r) => r.replace(/['"\s]/g, '')).filter(Boolean)
        if (roles.length > 0 && roles.every((r) => ELEVATED.has(r))) {
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
