import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

async function makeAdmin() {
  const admin = await db().user.create({
    data: {
      email: uniqueTestEmail('flag-admin'), displayName: 'Flag Test Admin', referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'ADMIN' } }, wallets: { create: { currency: 'SYP' } },
    },
  })
  trackTestUser(admin.id)
  const { createSessionToken } = await import('../../server/lib/security.mjs')
  return { id: admin.id, token: createSessionToken(admin) }
}

async function makeDriver() {
  const driver = await db().user.create({
    data: {
      email: uniqueTestEmail('flag-driver'), displayName: 'Flag Test Driver', referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'DRIVER' } },
    },
  })
  trackTestUser(driver.id)
  const { createSessionToken } = await import('../../server/lib/security.mjs')
  return { id: driver.id, token: createSessionToken(driver) }
}

describe('Compliance feature flags (029): ride government remittance + Stay tax platform collection', () => {
  let app

  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })
  afterEach(async () => {
    await db().complianceFeatureFlag.updateMany({ data: { enabled: false, approvedById: null, approvedAt: null } })
  })

  it('both known flags default to disabled even before any row exists', async () => {
    const admin = await makeAdmin()
    const res = await request(app).get('/api/admin/compliance-flags').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
    expect(res.body.flags.map((f) => f.key).sort()).toEqual(['RIDE_GOVERNMENT_REMITTANCE_ACTIVE', 'STAY_TAX_PLATFORM_COLLECTION'])
    for (const flag of res.body.flags) {
      expect(flag.enabled).toBe(false)
      expect(flag.approvedById).toBeNull()
      expect(flag.approvedAt).toBeNull()
    }
  })

  it('enabling a flag records the approving admin and a timestamp', async () => {
    const admin = await makeAdmin()
    const res = await request(app).patch('/api/admin/compliance-flags/RIDE_GOVERNMENT_REMITTANCE_ACTIVE').set('Authorization', `Bearer ${admin.token}`)
      .send({ enabled: true, note: 'agreement executed' })
    expect(res.status).toBe(200)
    expect(res.body.flag.enabled).toBe(true)
    expect(res.body.flag.approvedById).toBe(admin.id)
    expect(res.body.flag.approvedAt).toBeTruthy()
    expect(res.body.flag.note).toBe('agreement executed')
  })

  it('disabling a flag clears the approval fields (a disable never needs its own approval)', async () => {
    const admin = await makeAdmin()
    await request(app).patch('/api/admin/compliance-flags/RIDE_GOVERNMENT_REMITTANCE_ACTIVE').set('Authorization', `Bearer ${admin.token}`).send({ enabled: true })
    const res = await request(app).patch('/api/admin/compliance-flags/RIDE_GOVERNMENT_REMITTANCE_ACTIVE').set('Authorization', `Bearer ${admin.token}`).send({ enabled: false })
    expect(res.body.flag.enabled).toBe(false)
    expect(res.body.flag.approvedById).toBeNull()
    expect(res.body.flag.approvedAt).toBeNull()
  })

  it('rejects an unrecognized flag key', async () => {
    const admin = await makeAdmin()
    const res = await request(app).patch('/api/admin/compliance-flags/NOT_A_REAL_FLAG').set('Authorization', `Bearer ${admin.token}`).send({ enabled: true })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('COMPLIANCE_FLAG_UNKNOWN')
  })

  it('a non-admin driver cannot enable a compliance flag', async () => {
    const driver = await makeDriver()
    const res = await request(app).patch('/api/admin/compliance-flags/RIDE_GOVERNMENT_REMITTANCE_ACTIVE').set('Authorization', `Bearer ${driver.token}`).send({ enabled: true })
    expect(res.status).toBe(403)
  })

  it('support can read flag status but cannot change it (read/write role split)', async () => {
    const support = await db().user.create({
      data: {
        email: uniqueTestEmail('flag-support'), displayName: 'Flag Test Support', referralCode: uniqueTestReferralCode(),
        roles: { create: { role: 'SUPPORT' } },
      },
    })
    trackTestUser(support.id)
    const { createSessionToken } = await import('../../server/lib/security.mjs')
    const token = createSessionToken(support)

    const read = await request(app).get('/api/admin/compliance-flags').set('Authorization', `Bearer ${token}`)
    expect(read.status).toBe(200)

    const write = await request(app).patch('/api/admin/compliance-flags/RIDE_GOVERNMENT_REMITTANCE_ACTIVE').set('Authorization', `Bearer ${token}`).send({ enabled: true })
    expect(write.status).toBe(403)
  })
})
