import request from 'supertest'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { discoverElevatedRoutes } from '../support/elevatedRoutes.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// A8 — staff-session role modeling (Finding 5). DECISION (locked by this test):
//
//   Authorization is derived from the SIGNED TOKEN's `roles` array on every request (requireAuth in
//   server/lib/auth-context.mjs), NOT from where the client stores the session. The only elevated roles
//   are ADMIN and SUPPORT; a HOST token carries roles: ['HOST'] and can never satisfy an ADMIN/SUPPORT
//   guard (→ 403). The frontend persisting a host under the same "staffSession" storage key as an admin is
//   a UI convenience, not a privilege boundary — it grants ZERO elevated capability. Therefore the shared
//   staffSession model is provably safe AS-IS; a host does not need a distinct session/role.
//
// This is a full sweep, not a sample: discoverElevatedRoutes() finds EVERY ADMIN/SUPPORT-gated route from
// source, and the tests below assert a HOST (and an unauthenticated caller) is rejected on all of them, so
// the proof stays complete automatically as new elevated routes are added.

const routesDir = fileURLToPath(new URL('../../server/routes', import.meta.url))
const elevated = discoverElevatedRoutes(routesDir)

const send = (app, r, headers) => {
  const req = request(app)[r.method](r.path)
  if (headers) req.set(headers)
  return r.method === 'get' ? req : req.send({})
}

describe('A8 — a HOST session reaches ZERO elevated (ADMIN/SUPPORT) capability (Finding 5)', () => {
  let app
  let hostToken

  beforeAll(async () => {
    app = testApp()
    const u = await db().user.create({
      data: { email: uniqueTestEmail('a8-host'), passwordHash: hashPassword('correct-horse-battery'), displayName: 'A8 Host', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'HOST' } }, phoneHash: `a8-${Math.random().toString(36).slice(2)}` },
    })
    trackTestUser(u.id)
    hostToken = createSessionToken(u)
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('discovers the full set of ADMIN/SUPPORT-gated routes (a sweep, not a sample)', () => {
    expect(elevated.length, 'a substantial set of elevated routes is discovered').toBeGreaterThan(40)
    const nonConcrete = elevated.filter((r) => !/^\/api\//.test(r.path) || /[\^$\\]|\[\^/.test(r.path))
    expect(nonConcrete, `every discovered path must be concrete: ${JSON.stringify(nonConcrete)}`).toEqual([])
  })

  it('rejects an UNAUTHENTICATED request on EVERY elevated route (401)', async () => {
    const failures = []
    for (const r of elevated) {
      const res = await send(app, r)
      if (res.status !== 401) failures.push(`${r.method.toUpperCase()} ${r.path} → ${res.status} (want 401)`)
    }
    expect(failures, `unauth must be 401 on every elevated route:\n${failures.join('\n')}`).toEqual([])
  })

  it('rejects a HOST session on EVERY elevated route (403) — host grants zero elevated capability', async () => {
    const failures = []
    for (const r of elevated) {
      const res = await send(app, r, { Authorization: `Bearer ${hostToken}` })
      if (res.status !== 403) failures.push(`${r.method.toUpperCase()} ${r.path} → ${res.status} (want 403)`)
    }
    expect(failures, `HOST must be 403 (FORBIDDEN) on every elevated route:\n${failures.join('\n')}`).toEqual([])
  })
})
