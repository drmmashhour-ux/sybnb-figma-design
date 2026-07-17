import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { testApp, verifyEmailForTest } from '../support/testServer.mjs'
import { seedDemoAccounts, DEMO_CUSTOMER_EMAIL, DEMO_DRIVER_EMAIL, DEMO_HOST_EMAIL } from '../../scripts/seed-demo-accounts.mjs'

// Reviewer demo accounts (024): a pre-verified customer + driver (+ host) the store reviewer logs into.
// The seed must be idempotent (re-run at every deploy) and the accounts must be verified and non-admin.
const DEMO_EMAILS = [DEMO_CUSTOMER_EMAIL, DEMO_DRIVER_EMAIL, DEMO_HOST_EMAIL]
const PASSWORD = 'DemoReview123!'

describe('Reviewer demo accounts (seed)', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    const users = await db().user.findMany({ where: { email: { in: DEMO_EMAILS } }, select: { id: true } })
    const ids = users.map((u) => u.id)
    await db().driverVehicle.deleteMany({ where: { driverId: { in: ids } } }).catch(() => {})
    await db().listing.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => {})
    await db().driverDocument.deleteMany({ where: { driverUserId: { in: ids } } }).catch(() => {})
    await db().driverProfile.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
    await db().userRole.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
    await db().user.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
  })

  it('seeds pre-verified demo accounts idempotently (no duplicates on re-run)', async () => {
    await seedDemoAccounts({ password: PASSWORD })
    await seedDemoAccounts({ password: PASSWORD }) // second run must not duplicate

    expect(await db().user.count({ where: { email: { in: DEMO_EMAILS } } })).toBe(3)

    const customer = await db().user.findUnique({ where: { email: DEMO_CUSTOMER_EMAIL }, include: { roles: true } })
    const driver = await db().user.findUnique({ where: { email: DEMO_DRIVER_EMAIL }, include: { roles: true } })
    expect(customer.isDemo).toBe(true)
    expect(customer.idDocumentStatus).toBe('APPROVED')
    expect(driver.isDemo).toBe(true)
    expect(driver.idDocumentStatus).toBe('APPROVED')

    // No admin powers on any demo account.
    for (const email of DEMO_EMAILS) {
      const u = await db().user.findUnique({ where: { email }, include: { roles: true } })
      expect(u.roles.map((r) => r.role)).not.toContain('ADMIN')
    }

    // Driver is road-ready and not duplicated: exactly 2 APPROVED docs + exactly 1 vehicle after two runs.
    const docs = await db().driverDocument.findMany({ where: { driverUserId: driver.id } })
    expect(docs).toHaveLength(2)
    expect(docs.every((d) => d.status === 'APPROVED')).toBe(true)
    expect(await db().driverVehicle.count({ where: { driverId: driver.id } })).toBe(1)
    const host = await db().user.findUnique({ where: { email: DEMO_HOST_EMAIL } })
    expect(await db().listing.count({ where: { ownerId: host.id } })).toBe(1)
  })

  it('the demo customer can log in with the seeded password', async () => {
    await seedDemoAccounts({ password: PASSWORD })
    const res = await request(app).post('/api/auth/login').send({ email: DEMO_CUSTOMER_EMAIL, password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe(DEMO_CUSTOMER_EMAIL)
    expect(res.body.token).toBeTruthy()
  })

  it('the demo driver can sign in via the staff access code and is verified', async () => {
    await seedDemoAccounts({ password: PASSWORD })
    // Staff sign-in: verify the access code (dev returns devCode) then log in.
    await verifyEmailForTest(app, DEMO_DRIVER_EMAIL, 'staff-login')
    const res = await request(app).post('/api/auth/login').send({ email: DEMO_DRIVER_EMAIL, password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.user.roles).toContain('DRIVER')
  })
})
