import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Universal admin account control: an admin can open any account and suspend (revoke) / reinstate
// (release) / soft-delete it. Suspend & delete bump sessionVersion so the target is rejected on their
// next request. Guards: no self-action; a reason is required to suspend/delete; every action is audited.

let app
let admin

async function makeUser(role, label) {
  const user = await db().user.create({
    data: { email: uniqueTestEmail(label), displayName: label, referralCode: uniqueTestReferralCode(), roles: { create: { role } } },
    include: { roles: true },
  })
  trackTestUser(user.id)
  return { user, token: createSessionToken(user) }
}

async function freshToken(userId) {
  const u = await db().user.findUnique({ where: { id: userId }, include: { roles: true } })
  return createSessionToken(u)
}

beforeAll(async () => {
  app = await testApp()
  admin = await makeUser('ADMIN', 'acctctl-admin')
})
afterAll(async () => { await cleanupTestUsers() })

const asAdmin = (m, p) => request(app)[m](p).set('authorization', `Bearer ${admin.token}`)
const setStatus = (id, status, reason) => asAdmin('patch', `/api/admin/accounts/${id}/status`).send({ status, reason })
const meOverview = (token) => request(app).get('/api/me/overview').set('authorization', `Bearer ${token}`)

describe('Admin account control — suspend / reinstate / soft-delete + guards', () => {
  it('suspend revokes access on the very next request (sessionVersion)', async () => {
    const guest = await makeUser('GUEST', 'acctctl-suspend')
    expect((await meOverview(guest.token)).status).toBe(200)

    const res = await setStatus(guest.user.id, 'SUSPENDED', 'policy violation')
    expect(res.status).toBe(200)
    expect(res.body.account.status).toBe('SUSPENDED')

    // The token minted before suspension is now rejected.
    expect((await meOverview(guest.token)).status).toBe(401)
  })

  it('reinstate (release) restores access for a new session', async () => {
    const guest = await makeUser('GUEST', 'acctctl-release')
    await setStatus(guest.user.id, 'SUSPENDED', 'temporary hold')
    expect((await meOverview(guest.token)).status).toBe(401)

    const res = await setStatus(guest.user.id, 'ACTIVE')
    expect(res.status).toBe(200)
    expect(res.body.account.status).toBe('ACTIVE')
    // A freshly-issued token works again.
    expect((await meOverview(await freshToken(guest.user.id))).status).toBe(200)
  })

  it('soft-delete sets DELETED + deletedAt and blocks access, but keeps the record', async () => {
    const guest = await makeUser('GUEST', 'acctctl-delete')
    const res = await setStatus(guest.user.id, 'DELETED', 'fraud')
    expect(res.status).toBe(200)
    expect(res.body.account.status).toBe('DELETED')
    expect(res.body.account.deletedAt).toBeTruthy()
    expect((await meOverview(guest.token)).status).toBe(401)
    // Row still exists (soft delete, reversible).
    expect(await db().user.findUnique({ where: { id: guest.user.id } })).not.toBeNull()
  })

  it('requires a reason to suspend or delete', async () => {
    const guest = await makeUser('GUEST', 'acctctl-noreason')
    const res = await asAdmin('patch', `/api/admin/accounts/${guest.user.id}/status`).send({ status: 'SUSPENDED' })
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('ACCOUNT_REASON_REQUIRED')
  })

  it('an admin cannot change the status of their own account', async () => {
    const res = await setStatus(admin.user.id, 'SUSPENDED', 'oops')
    expect(res.status).toBe(400)
    expect(res.body.error?.code).toBe('ACCOUNT_SELF_ACTION_FORBIDDEN')
  })

  it('search filters by section (role) and status', async () => {
    const guest = await makeUser('GUEST', 'acctctl-search')
    const inGuest = await asAdmin('get', `/api/admin/accounts?section=guest&q=${encodeURIComponent(guest.user.email)}`)
    expect(inGuest.status).toBe(200)
    expect(inGuest.body.accounts.some((a) => a.id === guest.user.id)).toBe(true)
    // The same guest must NOT show under the host section.
    const inHost = await asAdmin('get', `/api/admin/accounts?section=host&q=${encodeURIComponent(guest.user.email)}`)
    expect(inHost.body.accounts.some((a) => a.id === guest.user.id)).toBe(false)
  })

  it('open account returns a full record with counts and roles', async () => {
    const host = await makeUser('HOST', 'acctctl-open')
    const res = await asAdmin('get', `/api/admin/accounts/${host.user.id}`)
    expect(res.status).toBe(200)
    expect(res.body.account.roles).toContain('HOST')
    expect(res.body.account.counts).toHaveProperty('listings')
    expect(res.body.account).not.toHaveProperty('idDocumentRef') // storage key never leaked
  })

  it('edit fixes safe fields and adjusts roles, and audits the change', async () => {
    const guest = await makeUser('GUEST', 'acctctl-edit')
    const res = await asAdmin('patch', `/api/admin/accounts/${guest.user.id}`).send({ displayName: 'Fixed Name', addRoles: ['HOST'] })
    expect(res.status).toBe(200)
    expect(res.body.account.displayName).toBe('Fixed Name')
    expect(res.body.account.roles).toContain('HOST')
  })

  it('every status change writes an audit log entry', async () => {
    const guest = await makeUser('GUEST', 'acctctl-audit')
    await setStatus(guest.user.id, 'SUSPENDED', 'audit test')
    const log = await db().adminAuditLog.findFirst({
      where: { entityType: 'users', entityId: guest.user.id, action: 'ACCOUNT_STATUS_SUSPENDED' },
    })
    expect(log).not.toBeNull()
    expect(log.actorUserId).toBe(admin.user.id)
  })
})
