// Québec driver/vehicle onboarding — Phase 1 foundation tests. TEST MODE only: nothing here enables
// a real paid ride (SR stays geofenced to Syria regardless of onboarding status). Covers: every
// status transition, the activation gate, masked sensitive fields, role-protected APIs, and the
// immutable audit trail.
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import {
  DRIVER_STATUS_TRANSITIONS,
  VEHICLE_STATUS_TRANSITIONS,
  assertValidStatusTransition,
  ensureQuebecDriverOnboarding,
  ensureQuebecVehicleOnboarding,
  redactQuebecDriverOnboarding,
  setQuebecDriverLicenseNumber,
  transitionDriverOnboardingStatus,
  transitionVehicleOnboardingStatus,
} from '../../server/lib/quebec-driver-onboarding.mjs'
import {
  cleanupTestUsers,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
} from '../support/testServer.mjs'

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  await verifyEmailForTest(app, email, role === 'GUEST' ? 'guest-signup' : 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role, email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function makeAdmin() {
  const admin = await db().user.create({
    data: {
      email: uniqueTestEmail('qc-onboard-admin'), displayName: 'QC Onboarding Admin', referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'ADMIN' } }, wallets: { create: { currency: 'SYP' } },
    },
  })
  trackTestUser(admin.id)
  const { createSessionToken } = await import('../../server/lib/security.mjs')
  return { id: admin.id, token: createSessionToken(admin) }
}

// Drives a driver's onboarding all the way to ADMIN_REVIEW using only self-service transitions.
async function driveToAdminReview(userId) {
  let status = 'DRAFT'
  while (status !== 'ADMIN_REVIEW') {
    const nextStatus = DRIVER_STATUS_TRANSITIONS[status][0]
    const updated = await transitionDriverOnboardingStatus(db(), { userId, toStatus: nextStatus, actorId: userId })
    status = updated.status
  }
}

describe('Status-transition graph validation (pure function)', () => {
  it('accepts every documented forward edge for the driver graph', () => {
    for (const [from, tos] of Object.entries(DRIVER_STATUS_TRANSITIONS)) {
      for (const to of tos) {
        expect(() => assertValidStatusTransition(DRIVER_STATUS_TRANSITIONS, from, to)).not.toThrow()
      }
    }
  })

  it('accepts every documented forward edge for the vehicle graph', () => {
    for (const [from, tos] of Object.entries(VEHICLE_STATUS_TRANSITIONS)) {
      for (const to of tos) {
        expect(() => assertValidStatusTransition(VEHICLE_STATUS_TRANSITIONS, from, to)).not.toThrow()
      }
    }
  })

  it('rejects skipping stages (DRAFT straight to ACTIVE)', () => {
    expect(() => assertValidStatusTransition(DRIVER_STATUS_TRANSITIONS, 'DRAFT', 'ACTIVE'))
      .toThrowError(/Cannot move from DRAFT to ACTIVE/)
  })

  it('rejects transitions out of a terminal-for-this-graph status with no listed edges', () => {
    // REJECTED only ever goes back to DRAFT -- nothing else is valid.
    expect(() => assertValidStatusTransition(DRIVER_STATUS_TRANSITIONS, 'REJECTED', 'ACTIVE')).toThrow()
  })

  it('every driver status covers the 14 required values, every vehicle status covers the 8 required values', () => {
    const driverStatuses = [
      'DRAFT', 'IDENTITY_PENDING', 'DRIVER_DOCUMENTS_PENDING', 'POLICE_CHECK_PENDING', 'TRAINING_PENDING',
      'TAX_REGISTRATION_PENDING', 'VEHICLE_PENDING', 'INSURANCE_PENDING', 'ADMIN_REVIEW', 'APPROVED_INACTIVE',
      'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REJECTED',
    ]
    expect(Object.keys(DRIVER_STATUS_TRANSITIONS).sort()).toEqual(driverStatuses.sort())

    const vehicleStatuses = ['DRAFT', 'DOCUMENTS_PENDING', 'INSPECTION_PENDING', 'ADMIN_REVIEW', 'APPROVED_INACTIVE', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'REJECTED']
    expect(Object.keys(VEHICLE_STATUS_TRANSITIONS).sort()).toEqual(vehicleStatuses.sort())
  })
})

describe('Driver onboarding: end-to-end status walk (DB-backed)', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('walks a driver from DRAFT to ADMIN_REVIEW via self-service, then admin approves to APPROVED_INACTIVE', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-walk-driver')
    const admin = await makeAdmin()

    const created = await ensureQuebecDriverOnboarding(db(), driver.user.id)
    expect(created.status).toBe('DRAFT')

    await driveToAdminReview(driver.user.id)
    const atReview = await db().quebecDriverOnboarding.findUnique({ where: { userId: driver.user.id } })
    expect(atReview.status).toBe('ADMIN_REVIEW')

    const approved = await transitionDriverOnboardingStatus(db(), {
      userId: driver.user.id, toStatus: 'APPROVED_INACTIVE', actorId: admin.id,
    })
    expect(approved.status).toBe('APPROVED_INACTIVE')
    expect(approved.reviewedById).toBe(admin.id)
  })

  it('a driver cannot self-advance past ADMIN_REVIEW (their own actorId does not bypass the self-service boundary check at the route layer)', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-noskip-driver')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)
    await driveToAdminReview(driver.user.id)

    // The lib function itself only enforces the transition GRAPH, not who is allowed to call it --
    // route-level self-service gating is enforced in quebec-driver-onboarding.mjs's route handler
    // (DRIVER_SELF_SERVICE_STATUSES), verified separately below via the real HTTP endpoint.
    const res = await request(app).post('/api/driver/quebec-onboarding/submit').set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('QUEBEC_ONBOARDING_NOT_SELF_SERVICE')
  })

  it('rejecting an application requires a reason', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-reject-reason-driver')
    const admin = await makeAdmin()
    await ensureQuebecDriverOnboarding(db(), driver.user.id)
    await driveToAdminReview(driver.user.id)

    await expect(transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'REJECTED', actorId: admin.id }))
      .rejects.toMatchObject({ code: 'QUEBEC_ONBOARDING_REASON_REQUIRED' })

    const withReason = await transitionDriverOnboardingStatus(db(), {
      userId: driver.user.id, toStatus: 'REJECTED', actorId: admin.id, reason: 'Judicial record certificate did not meet SAAQ requirements.',
    })
    expect(withReason.status).toBe('REJECTED')
  })

  it('a rejected driver can be restarted back to DRAFT by an admin', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-restart-driver')
    const admin = await makeAdmin()
    await ensureQuebecDriverOnboarding(db(), driver.user.id)
    await driveToAdminReview(driver.user.id)
    await transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'REJECTED', actorId: admin.id, reason: 'test rejection' })

    const restarted = await transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'DRAFT', actorId: admin.id })
    expect(restarted.status).toBe('DRAFT')
  })

  it('every status transition writes an immutable AdminAuditLog entry', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-audit-driver')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)
    const updated = await transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'IDENTITY_PENDING', actorId: driver.user.id })

    const auditEntry = await db().adminAuditLog.findFirst({
      where: { entityType: 'quebec_driver_onboarding', entityId: updated.id, action: 'QUEBEC_DRIVER_ONBOARDING_IDENTITY_PENDING' },
    })
    expect(auditEntry).not.toBeNull()
    expect(auditEntry.before).toEqual({ status: 'DRAFT' })
    expect(auditEntry.after).toMatchObject({ status: 'IDENTITY_PENDING' })
  })

  it('a status change without a recorded actor is rejected', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-noactor-driver')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)
    await expect(transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'IDENTITY_PENDING', actorId: null }))
      .rejects.toMatchObject({ code: 'QUEBEC_ONBOARDING_ACTOR_REQUIRED' })
  })
})

describe('Activation gate: ACTIVE requires the Québec ride jurisdiction to be APPROVED', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })
  afterEach(async () => {
    await db().jurisdictionComplianceProfile.deleteMany({ where: { division: 'SR', countryCode: 'CA', regionCode: 'quebec' } })
  })

  it('blocks APPROVED_INACTIVE -> ACTIVE when the Québec SR jurisdiction is not APPROVED (the default -- nothing seeds it active)', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-gate-blocked-driver')
    const admin = await makeAdmin()
    await ensureQuebecDriverOnboarding(db(), driver.user.id)
    await driveToAdminReview(driver.user.id)
    await transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'APPROVED_INACTIVE', actorId: admin.id })

    await expect(transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'ACTIVE', actorId: admin.id }))
      .rejects.toMatchObject({ code: 'JURISDICTION_NOT_APPROVED' })

    // Never partially applied: status stays APPROVED_INACTIVE, not silently ACTIVE.
    const after = await db().quebecDriverOnboarding.findUnique({ where: { userId: driver.user.id } })
    expect(after.status).toBe('APPROVED_INACTIVE')
  })

  it('allows APPROVED_INACTIVE -> ACTIVE once an admin has explicitly approved the Québec SR jurisdiction', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-gate-open-driver')
    const admin = await makeAdmin()
    await ensureQuebecDriverOnboarding(db(), driver.user.id)
    await driveToAdminReview(driver.user.id)
    await transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'APPROVED_INACTIVE', actorId: admin.id })

    await db().jurisdictionComplianceProfile.create({
      data: { division: 'SR', countryCode: 'CA', regionCode: 'quebec', status: 'APPROVED' },
    })

    const active = await transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'ACTIVE', actorId: admin.id })
    expect(active.status).toBe('ACTIVE')
  })

  it('the same gate applies to vehicle activation', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-gate-vehicle-driver')
    const admin = await makeAdmin()
    const vehicle = await db().driverVehicle.create({
      data: { driverId: driver.user.id, make: 'Toyota', model: 'Camry', year: 2022, plate: 'QCTEST-001', category: 'SR Comfort', country: 'CA' },
    })
    await ensureQuebecVehicleOnboarding(db(), vehicle.id)
    let status = 'DRAFT'
    while (status !== 'ADMIN_REVIEW') {
      const nextStatus = VEHICLE_STATUS_TRANSITIONS[status][0]
      const updated = await transitionVehicleOnboardingStatus(db(), { vehicleId: vehicle.id, toStatus: nextStatus, actorId: driver.user.id })
      status = updated.status
    }
    await transitionVehicleOnboardingStatus(db(), { vehicleId: vehicle.id, toStatus: 'APPROVED_INACTIVE', actorId: admin.id })

    await expect(transitionVehicleOnboardingStatus(db(), { vehicleId: vehicle.id, toStatus: 'ACTIVE', actorId: admin.id }))
      .rejects.toMatchObject({ code: 'JURISDICTION_NOT_APPROVED' })
  })
})

describe('Masked sensitive fields', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('a driver license number is stored encrypted and only ever exposed as a masked last-4 display', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-mask-driver')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)
    await setQuebecDriverLicenseNumber(db(), driver.user.id, 'S1234-567890-12')

    const raw = await db().quebecDriverOnboarding.findUnique({ where: { userId: driver.user.id } })
    expect(raw.licenseNumberEncrypted).toBeTruthy()
    expect(raw.licenseNumberEncrypted).not.toContain('567890') // never stored in plaintext

    const redacted = redactQuebecDriverOnboarding(raw)
    expect(redacted.licenseNumberEncrypted).toBeUndefined() // the encrypted value never leaves this function
    expect(redacted.licenseNumberMasked).toMatch(/••••90\d\d$/) // last 4 characters only
  })

  it('the driver-facing GET endpoint never returns the encrypted field, only the masked display', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-mask-api-driver')
    await setQuebecDriverLicenseNumber(db(), driver.user.id, 'S9999-000000-99')

    const res = await request(app).get('/api/driver/quebec-onboarding').set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(200)
    expect(res.body.onboarding.licenseNumberEncrypted).toBeUndefined()
    expect(res.body.onboarding.licenseNumberMasked).toBeTruthy()
  })
})

describe('Role-protected APIs', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('a guest cannot read or write another role\'s onboarding endpoint', async () => {
    const guest = await registerUser(app, 'GUEST', 'qc-role-guest')
    const res = await request(app).get('/api/driver/quebec-onboarding').set('Authorization', `Bearer ${guest.token}`)
    expect(res.status).toBe(403)
  })

  it('a driver cannot access the admin review endpoints', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-role-driver')
    const other = await registerUser(app, 'DRIVER', 'qc-role-driver-target')
    const res = await request(app).patch(`/api/admin/quebec-onboarding/${other.user.id}`).set('Authorization', `Bearer ${driver.token}`)
      .send({ status: 'IDENTITY_PENDING' })
    expect(res.status).toBe(403)
  })

  it('a driver cannot read another driver\'s onboarding record via the admin list endpoint', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-role-nolist-driver')
    const res = await request(app).get('/api/admin/quebec-onboarding').set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(403)
  })

  it('SUPPORT can view but not decide (PATCH still requires ADMIN specifically)', async () => {
    const support = await db().user.create({
      data: {
        email: uniqueTestEmail('qc-support'), displayName: 'QC Support', referralCode: uniqueTestReferralCode(),
        roles: { create: { role: 'SUPPORT' } },
      },
    })
    trackTestUser(support.id)
    const { createSessionToken } = await import('../../server/lib/security.mjs')
    const supportToken = createSessionToken(support)

    const listRes = await request(app).get('/api/admin/quebec-onboarding').set('Authorization', `Bearer ${supportToken}`)
    expect(listRes.status).toBe(200)

    const driver = await registerUser(app, 'DRIVER', 'qc-support-target-driver')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)
    const patchRes = await request(app).patch(`/api/admin/quebec-onboarding/${driver.user.id}`).set('Authorization', `Bearer ${supportToken}`)
      .send({ status: 'IDENTITY_PENDING' })
    expect(patchRes.status).toBe(403)
  })
})

describe('Synthetic test data only', () => {
  it('the seed script never writes a real-looking SIN, banking, or government-ID value', async () => {
    const fs = await import('node:fs/promises')
    const seedSource = await fs.readFile(new URL('../../scripts/seed-quebec-compliance-review.mjs', import.meta.url), 'utf8')
    expect(seedSource).not.toMatch(/\b\d{3}-\d{3}-\d{3}\b/) // no SIN-shaped literal
    expect(seedSource).toContain('No real SIN, banking, government ID, or insurance information')
  })
})
