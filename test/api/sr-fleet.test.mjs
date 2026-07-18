import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { VEHICLE_AGE_LIMITS } from '../../server/lib/fleet.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

const NOW_YEAR = new Date().getFullYear()

async function bootstrapAdmin(label = 'fleet-admin') {
  const admin = await db().user.create({
    data: { email: uniqueTestEmail(label), displayName: 'Fleet Admin', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'ADMIN' } } },
    include: { roles: true },
  })
  trackTestUser(admin.id)
  return createSessionToken(admin)
}

async function registerDriver(app, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role: 'DRIVER', email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { token: res.body.token, user: res.body.user }
}

function economyVehicle(overrides = {}) {
  return { make: 'Kia', model: 'Rio', year: NOW_YEAR - 3, plate: 'ABC-1234', color: 'white', category: 'SR Economy', ...overrides }
}

describe('SR fleet: vehicle records + age gate + driver account control', () => {
  let app
  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  describe('vehicle age gate (Uber-style model-year cap)', () => {
    it('registers a vehicle within the tier age limit as PENDING_REVIEW', async () => {
      const driver = await registerDriver(app, 'veh-ok')
      const res = await request(app).post('/api/driver/vehicles').set('Authorization', `Bearer ${driver.token}`).send(economyVehicle())
      expect(res.status).toBe(201)
      expect(res.body.vehicle.status).toBe('PENDING_REVIEW')
      expect(res.body.vehicle.category).toBe('SR Economy')
    })

    it('rejects a car older than the 10-year standard limit', async () => {
      const driver = await registerDriver(app, 'veh-old')
      const tooOld = economyVehicle({ year: NOW_YEAR - (VEHICLE_AGE_LIMITS['SR Economy'] + 1) })
      const res = await request(app).post('/api/driver/vehicles').set('Authorization', `Bearer ${driver.token}`).send(tooOld)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VEHICLE_TOO_OLD')
      expect(res.body.error.details.maxAge).toBe(10)
    })

    it('rejects an unknown category', async () => {
      const driver = await registerDriver(app, 'veh-cat')
      const res = await request(app).post('/api/driver/vehicles').set('Authorization', `Bearer ${driver.token}`).send(economyVehicle({ category: 'SR Motorbike' }))
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VEHICLE_CATEGORY_INVALID')
    })

    it('registers an SR XXL vehicle within its age limit', async () => {
      const driver = await registerDriver(app, 'veh-xxl-ok')
      const res = await request(app)
        .post('/api/driver/vehicles')
        .set('Authorization', `Bearer ${driver.token}`)
        .send(economyVehicle({ category: 'SR XXL', model: 'Sedona', year: NOW_YEAR - (VEHICLE_AGE_LIMITS['SR XXL'] - 1) }))
      expect(res.status).toBe(201)
      expect(res.body.vehicle.category).toBe('SR XXL')
    })

    it('rejects an SR XXL vehicle older than its age limit', async () => {
      const driver = await registerDriver(app, 'veh-xxl-old')
      const tooOld = economyVehicle({ category: 'SR XXL', model: 'Sedona', year: NOW_YEAR - (VEHICLE_AGE_LIMITS['SR XXL'] + 1) })
      const res = await request(app).post('/api/driver/vehicles').set('Authorization', `Bearer ${driver.token}`).send(tooOld)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VEHICLE_TOO_OLD')
      expect(res.body.error.details.maxAge).toBe(VEHICLE_AGE_LIMITS['SR XXL'])
    })
  })

  describe('admin vehicle review', () => {
    it('approves a valid vehicle and rejects another', async () => {
      const adminToken = await bootstrapAdmin('veh-review-admin')
      const driver = await registerDriver(app, 'veh-review-drv')
      const vA = (await request(app).post('/api/driver/vehicles').set('Authorization', `Bearer ${driver.token}`).send(economyVehicle())).body.vehicle
      const vB = (await request(app).post('/api/driver/vehicles').set('Authorization', `Bearer ${driver.token}`).send(economyVehicle({ plate: 'XYZ-9' }))).body.vehicle

      const approve = await request(app).patch(`/api/admin/vehicles/${vA.id}`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'APPROVED' })
      expect(approve.status).toBe(200)
      expect(approve.body.vehicle.status).toBe('APPROVED')

      const reject = await request(app).patch(`/api/admin/vehicles/${vB.id}`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'REJECTED', note: 'plate unreadable' })
      expect(reject.status).toBe(200)
      expect(reject.body.vehicle.status).toBe('REJECTED')
    })
  })

  describe('driver account control (the fleet kill switch)', () => {
    it('suspends a driver — invalidating their session — then reinstates them', async () => {
      const adminToken = await bootstrapAdmin('suspend-admin')
      const driver = await registerDriver(app, 'suspend-drv')

      // Baseline: the driver can act.
      const before = await request(app).get('/api/driver/vehicles').set('Authorization', `Bearer ${driver.token}`)
      expect(before.status).toBe(200)

      const suspend = await request(app).patch(`/api/admin/drivers/${driver.user.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'SUSPENDED', reason: 'repeated cancellations' })
      expect(suspend.status).toBe(200)
      expect(suspend.body.driver.status).toBe('SUSPENDED')

      // Suspended: the driver's existing token no longer works.
      const blocked = await request(app).get('/api/driver/vehicles').set('Authorization', `Bearer ${driver.token}`)
      expect(blocked.status).toBe(401)

      const reinstate = await request(app).patch(`/api/admin/drivers/${driver.user.id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' })
      expect(reinstate.status).toBe(200)
      expect(reinstate.body.driver.status).toBe('ACTIVE')
    })

    it('a non-admin cannot suspend a driver or read the directory', async () => {
      const driver = await registerDriver(app, 'no-admin-drv')
      const target = await registerDriver(app, 'no-admin-target')
      const suspend = await request(app).patch(`/api/admin/drivers/${target.user.id}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'SUSPENDED' })
      expect(suspend.status).toBe(403)
      const dir = await request(app).get('/api/admin/drivers').set('Authorization', `Bearer ${driver.token}`)
      expect(dir.status).toBe(403)
    })
  })

  describe('admin directory + driver record', () => {
    it('lists drivers paginated and filtered', async () => {
      const adminToken = await bootstrapAdmin('dir-admin')
      await registerDriver(app, 'dir-scan-a')
      await registerDriver(app, 'dir-scan-b')

      const res = await request(app).get('/api/admin/drivers?search=dir-scan&pageSize=1&page=1').set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.total).toBeGreaterThanOrEqual(2)
      expect(res.body.pageSize).toBe(1)
      expect(res.body.drivers).toHaveLength(1)
      expect(res.body.pages).toBeGreaterThanOrEqual(2)
    })

    it('returns a full driver record with vehicles and computed standing', async () => {
      const adminToken = await bootstrapAdmin('rec-admin')
      const driver = await registerDriver(app, 'rec-drv')
      await request(app).post('/api/driver/vehicles').set('Authorization', `Bearer ${driver.token}`).send(economyVehicle())

      const res = await request(app).get(`/api/admin/drivers/${driver.user.id}`).set('Authorization', `Bearer ${adminToken}`)
      expect(res.status).toBe(200)
      expect(res.body.driver.driverVehicles).toHaveLength(1)
      expect(res.body.standing).toHaveProperty('cancellationRate')
      expect(res.body.standing).toHaveProperty('completionRate')
      expect(res.body.standing.rating).toEqual({ average: null, count: 0 }) // no ratings yet
    })
  })
})
