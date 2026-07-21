import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import {
  cleanupTestUsers,
  fundWallet,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  verifyEmailForTest,
  approveDriverForRides,
} from '../support/testServer.mjs'

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  if (role === 'DRIVER' || role === 'HOST') await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role, email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

function driverProfileBody(overrides = {}) {
  return {
    legalFirstName: 'Jean', legalLastName: 'Tremblay', dateOfBirth: '1990-01-01',
    addressLine1: '123 Rue Principale', city: 'Montreal', region: 'QC', postalCode: 'H2X 1Y1', country: 'CA',
    taxResidenceCountry: 'CA', taxIdentifierType: 'SIN', taxIdentifier: '123-456-789',
    payoutAccountIdentifier: 'ACC-9988776655',
    consentRegulatoryReporting: true, certifiedAccurate: true,
    ...overrides,
  }
}

describe('Tax profile API (029): driver + host onboarding, masking, admin verification', () => {
  let app

  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('a driver can create their own tax profile; the response never contains the full SIN or payout identifier', async () => {
    const driver = await registerUser(app, 'DRIVER', 'tp-driver-1')
    const res = await request(app).put('/api/tax-profile/DRIVER').set('Authorization', `Bearer ${driver.token}`).send(driverProfileBody())
    expect(res.status).toBe(200)
    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain('123-456-789')
    expect(serialized).not.toContain('9988776655')
    expect(res.body.taxProfile.taxIdentifierMasked).toMatch(/6789$/)
    expect(res.body.taxProfile.payoutAccountMasked).toMatch(/6655$/)
    expect(res.body.taxProfile.verificationStatus).toBe('PENDING_REVIEW')
  })

  it('rejects submission without consent or certification', async () => {
    const driver = await registerUser(app, 'DRIVER', 'tp-driver-2')
    const res = await request(app).put('/api/tax-profile/DRIVER').set('Authorization', `Bearer ${driver.token}`)
      .send(driverProfileBody({ consentRegulatoryReporting: false }))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('TAX_PROFILE_CONSENT_REQUIRED')
  })

  it('rejects an individual profile with no date of birth', async () => {
    const driver = await registerUser(app, 'DRIVER', 'tp-driver-3')
    const res = await request(app).put('/api/tax-profile/DRIVER').set('Authorization', `Bearer ${driver.token}`)
      .send(driverProfileBody({ dateOfBirth: undefined }))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('TAX_PROFILE_DOB_REQUIRED')
  })

  it('a driver cannot read or write a HOST tax profile role-slot', async () => {
    const driver = await registerUser(app, 'DRIVER', 'tp-driver-4')
    const res = await request(app).get('/api/tax-profile/HOST').set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(403)
  })

  it('resubmitting resets verificationStatus back to PENDING_REVIEW even if it was previously approved', async () => {
    const driver = await registerUser(app, 'DRIVER', 'tp-driver-5')
    await request(app).put('/api/tax-profile/DRIVER').set('Authorization', `Bearer ${driver.token}`).send(driverProfileBody())
    await db().taxProfile.update({
      where: { userId_subjectType: { userId: driver.user.id, subjectType: 'DRIVER' } },
      data: { verificationStatus: 'APPROVED' },
    })
    const resubmit = await request(app).put('/api/tax-profile/DRIVER').set('Authorization', `Bearer ${driver.token}`)
      .send(driverProfileBody({ legalFirstName: 'Jean-Updated' }))
    expect(resubmit.body.taxProfile.verificationStatus).toBe('PENDING_REVIEW')
    expect(resubmit.body.taxProfile.legalFirstName).toBe('Jean-Updated')
  })

  it('an admin can verify (APPROVE) a tax profile, recording who and when', async () => {
    const driver = await registerUser(app, 'DRIVER', 'tp-driver-6')
    const created = await request(app).put('/api/tax-profile/DRIVER').set('Authorization', `Bearer ${driver.token}`).send(driverProfileBody())

    const staffAdmin = await registerUser(app, 'DRIVER', 'tp-admin-1')
    await db().userRole.create({ data: { userId: staffAdmin.user.id, role: 'ADMIN' } })

    const verify = await request(app)
      .patch(`/api/admin/tax-profiles/${created.body.taxProfile.id}/verify`)
      .set('Authorization', `Bearer ${staffAdmin.token}`)
      .send({ decision: 'APPROVED', source: 'Manual document review' })
    expect(verify.status).toBe(200)
    expect(verify.body.taxProfile.verificationStatus).toBe('APPROVED')
    expect(verify.body.taxProfile.verificationSource).toBe('Manual document review')
  })

  it('a Quebec-registered driver without a verified, GST/QST-registered tax profile cannot claim a ride', async () => {
    const rider = await registerUser(app, 'GUEST', 'tp-qc-rider')
    await fundWallet(rider.user.id, 10_000_000)
    const driver = await registerUser(app, 'DRIVER', 'tp-qc-driver')
    await approveDriverForRides(driver.user.id)
    await db().driverProfile.upsert({
      where: { userId: driver.user.id },
      create: { userId: driver.user.id, country: 'CA' },
      update: { country: 'CA' },
    })

    const created = await request(app).post('/api/sr/rides').set('Authorization', `Bearer ${rider.token}`)
      .send({ pickup: 'Malki QC-gate', dropoff: 'Mezzeh QC-gate', category: 'SR Economy' })
    expect(created.status).toBe(201)

    const claim = await request(app).patch(`/api/sr/rides/${created.body.ride.id}/claim`).set('Authorization', `Bearer ${driver.token}`)
    expect(claim.status).toBe(403)
    expect(claim.body.error.code).toBe('DRIVER_GST_QST_REGISTRATION_REQUIRED')

    // Reset for test isolation (this driverProfile row may be reused by other suites' driver fixtures).
    await db().driverProfile.update({ where: { userId: driver.user.id }, data: { country: 'SY' } })
  })

  it('a HOST can record an explicit GST/QST treatment decision, with an effective date and an accountable actor', async () => {
    const host = await registerUser(app, 'HOST', 'tp-host-1')
    await request(app).put('/api/tax-profile/HOST').set('Authorization', `Bearer ${host.token}`).send(driverProfileBody())

    const decide = await request(app).put('/api/tax-profile/HOST/gst-qst-treatment').set('Authorization', `Bearer ${host.token}`)
      .send({ treatment: 'HOST_REGISTERED', effectiveAt: '2026-01-01' })
    expect(decide.status).toBe(200)
    expect(decide.body.taxProfile.gstQstTreatment).toBe('HOST_REGISTERED')
    expect(decide.body.taxProfile.gstQstTreatmentEffectiveAt.slice(0, 10)).toBe('2026-01-01')
  })

  it('never infers a GST/QST treatment -- a fresh host profile has none until explicitly decided', async () => {
    const host = await registerUser(app, 'HOST', 'tp-host-2')
    const created = await request(app).put('/api/tax-profile/HOST').set('Authorization', `Bearer ${host.token}`).send(driverProfileBody({ gstRegistered: true, gstNumber: '123456789RT0001' }))
    expect(created.body.taxProfile.gstQstTreatment).toBeNull()
  })
})
