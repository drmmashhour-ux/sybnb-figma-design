// Platform Contract Kit — security check: APPEND-ONLY audit immutability (static scan).
//
// An audit log is only trustworthy if it is append-only: the ONLY database operation any server code may
// run on the audit model is `.create`. Any `.update / .updateMany / .delete / .deleteMany / .upsert` on it
// would make an audit row mutable and break immutability. This scans a source tree and returns every
// offending `file:line` (empty ⇒ append-only). It is self-maintaining — a new mutation added anywhere in
// the tree turns the check red without anyone updating a list.
//
// `model` is REQUIRED — it is your ORM's accessor for the audit table (e.g. Prisma's `auditLog`). There is
// no default ON PURPOSE: defaulting to SYBNB's `adminAuditLog` would scan the wrong model on any other
// platform, find nothing, and SILENTLY PASS. `methods` (the ORM mutation verbs) and `exts` (source file
// extensions) are neutral and default sensibly. Full-line comments are ignored so a commented-out call is
// not a false positive.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_METHODS = ['update', 'updateMany', 'delete', 'deleteMany', 'upsert']
const DEFAULT_SOURCE_EXTS = ['.mjs', '.js', '.ts', '.cjs']

export function findAuditMutationPaths(sourceDir, { model, methods = DEFAULT_METHODS, exts = DEFAULT_SOURCE_EXTS } = {}) {
  if (!model || typeof model !== 'string') {
    throw new Error(
      'findAuditMutationPaths: `model` is required — pass your audit table\'s ORM accessor (e.g. "auditLog"). ' +
        'Refusing to default to SYBNB\'s "adminAuditLog", which would scan the wrong model and silently pass.',
    )
  }
  const mutationRe = new RegExp(`${model}\\s*\\.\\s*(${methods.join('|')})\\b`)
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
          if (line.trim().startsWith('//')) return
          if (mutationRe.test(line)) offenders.push(`${full}:${i + 1}`)
        })
    }
  }
  walk(sourceDir)
  return offenders
}
