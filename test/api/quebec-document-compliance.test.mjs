// Québec compliance expansion (Phase 1, third correction pass): versioned driver/vehicle compliance
// documents, legal-hold-safe replacement (never blocks a new upload, always preserves the held row),
// environment-aware certificate verification, and the same versioning fix applied to ListingDocument.
// TEST MODE only -- nothing here enables a real paid ride or a real STR booking.
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import {
  DRIVER_STATUS_TRANSITIONS,
  ensureQuebecDriverOnboarding,
  ensureQuebecVehicleOnboarding,
  redactQuebecVehicleOnboarding,
  setQuebecVehicleVin,
  transitionDriverOnboardingStatus,
} from '../../server/lib/quebec-driver-onboarding.mjs'
import { getOperationalDocumentStatuses } from '../../server/lib/listing-document-retention.mjs'
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

async function makeAdmin(label = 'qc-doc-admin') {
  const admin = await db().user.create({
    data: {
      email: uniqueTestEmail(label), displayName: 'QC Doc Admin', referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'ADMIN' } }, wallets: { create: { currency: 'SYP' } },
    },
  })
  trackTestUser(admin.id)
  const { createSessionToken } = await import('../../server/lib/security.mjs')
  return { id: admin.id, token: createSessionToken(admin) }
}

async function driveToAdminReview(userId) {
  let status = 'DRAFT'
  while (status !== 'ADMIN_REVIEW') {
    const nextStatus = DRIVER_STATUS_TRANSITIONS[status][0]
    const updated = await transitionDriverOnboardingStatus(db(), { userId, toStatus: nextStatus, actorId: userId })
    status = updated.status
  }
}

// Carries a real %PDF signature: uploads declared as application/pdf are now validated against the
// actual file signature (server/lib/content-signature.mjs), so plain text declared as a PDF is
// correctly rejected. Still entirely synthetic — no real certificate content.
const FAKE_PDF_BASE64 = Buffer.from('%PDF-1.7\nSYNTHETIC TEST DOCUMENT - NOT A REAL CERTIFICATE').toString('base64')

describe('Driver document versioning', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('the first upload is version 1 and current; a second upload creates version 2 and preserves version 1 in history', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-doc-v1-driver')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)

    const first = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'DRIVERS_LICENSE', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    expect(first.status).toBe(201)
    expect(first.body.document.version).toBe(1)
    expect(first.body.document.isCurrent).toBe(true)

    const second = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'DRIVERS_LICENSE', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    expect(second.status).toBe(201)
    expect(second.body.document.version).toBe(2)
    expect(second.body.document.replacesId).toBe(first.body.document.id)

    const current = await request(app).get('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
    expect(current.body.documents).toHaveLength(1)
    expect(current.body.documents[0].version).toBe(2)

    const history = await request(app).get('/api/driver/quebec-onboarding/documents/DRIVERS_LICENSE/history').set('Authorization', `Bearer ${driver.token}`)
    expect(history.body.documents.map((d) => d.version).sort()).toEqual([1, 2])
  })

  it('a new document always resets to PENDING_REVIEW even if it replaces an ADMIN_REVIEWED_TEST one', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-doc-reset-driver')
    const admin = await makeAdmin('qc-doc-reset-admin')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)

    const uploaded = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'PROOF_OF_IDENTITY', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    await request(app).patch(`/api/admin/quebec-onboarding/documents/${uploaded.body.document.id}/review`).set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'ADMIN_REVIEWED_TEST' })

    const replaced = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'PROOF_OF_IDENTITY', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    expect(replaced.body.document.status).toBe('PENDING_REVIEW')
  })

  it('rejects an unsupported document type and an empty file', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-doc-invalid-driver')
    const badType = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'NOT_A_REAL_TYPE', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    expect(badType.status).toBe(400)
    expect(badType.body.error.code).toBe('QUEBEC_DOCUMENT_TYPE_INVALID')

    const noFile = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'DRIVERS_LICENSE', fileBase64: '', mimeType: 'application/pdf' })
    expect(noFile.status).toBe(400)
    expect(noFile.body.error.code).toBe('QUEBEC_DOCUMENT_REQUIRED')

    const badMime = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'DRIVERS_LICENSE', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/x-executable' })
    expect(badMime.status).toBe(400)
    expect(badMime.body.error.code).toBe('QUEBEC_DOCUMENT_TYPE_INVALID')
  })

  it('malware scan status is always PENDING -- no scanner integration exists, nothing may claim CLEAN', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-doc-malware-driver')
    const uploaded = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'DRIVERS_LICENSE', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    const row = await db().quebecDriverDocument.findUnique({ where: { id: uploaded.body.document.id } })
    expect(row.malwareScanStatus).toBe('PENDING')
  })
})

describe('Legal hold never blocks a new upload -- both versions are preserved', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('driver document: a held version keeps its file and status; a new version can always be uploaded alongside it', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-doc-hold-driver')
    const admin = await makeAdmin('qc-doc-hold-admin')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)

    const first = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'POLICE_BACKGROUND_CHECK', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    const holdRes = await request(app).patch(`/api/admin/quebec-onboarding/documents/${first.body.document.id}/legal-hold`).set('Authorization', `Bearer ${admin.token}`)
      .send({ hold: true, reason: 'Under investigation for a passenger complaint.' })
    expect(holdRes.status).toBe(200)
    expect(holdRes.body.document.legalHold).toBe(true)

    // The critical behavior: uploading a NEW version never throws, even though the current version
    // is under legal hold.
    const second = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'POLICE_BACKGROUND_CHECK', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    expect(second.status).toBe(201)
    expect(second.body.document.version).toBe(2)
    expect(second.body.document.legalHold).toBe(false)

    const heldRow = await db().quebecDriverDocument.findUnique({ where: { id: first.body.document.id } })
    expect(heldRow.legalHold).toBe(true)
    expect(heldRow.isCurrent).toBe(false)
    expect(heldRow.assetUrl).toBeTruthy() // the held file's bytes were NOT deleted by the new upload

    const history = await request(app).get('/api/driver/quebec-onboarding/documents/POLICE_BACKGROUND_CHECK/history').set('Authorization', `Bearer ${driver.token}`)
    expect(history.body.documents).toHaveLength(2)
  })

  it('listing documents: the same rule applies to CITQ certificate uploads', async () => {
    const host = await registerUser(app, 'HOST', 'qc-listing-hold-host')
    const admin = await makeAdmin('qc-listing-hold-admin')
    const listing = await db().listing.create({
      data: {
        ownerId: host.user.id, division: 'STAYS', status: 'PENDING_REVIEW', titleAr: 'اختبار', titleEn: 'QC hold test listing',
        priceMinor: 100000, currency: 'SYP', metadata: { country: 'CA', governorate: 'quebec', city: 'montreal' },
      },
    })

    const first = await request(app).post(`/api/listings/${listing.id}/documents`).set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'CITQ_CERTIFICATE', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    expect(first.status).toBe(201)
    expect(first.body.document.version).toBe(1)

    await request(app).patch(`/api/admin/listing-documents/${first.body.document.id}/legal-hold`).set('Authorization', `Bearer ${admin.token}`)
      .send({ hold: true, reason: 'Registration number under dispute.' })

    // Previously this threw 409 LISTING_DOCUMENT_LEGAL_HOLD. It must now succeed.
    const second = await request(app).post(`/api/listings/${listing.id}/documents`).set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'CITQ_CERTIFICATE', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    expect(second.status).toBe(201)
    expect(second.body.document.version).toBe(2)
    expect(second.body.document.isCurrent).toBe(true)
    expect(second.body.document.legalHold).toBe(false)

    const heldRow = await db().listingDocument.findUnique({ where: { id: first.body.document.id } })
    expect(heldRow.legalHold).toBe(true)
    expect(heldRow.isCurrent).toBe(false)
    expect(heldRow.assetUrl).toBeTruthy()

    const list = await request(app).get(`/api/listings/${listing.id}/documents`).set('Authorization', `Bearer ${host.token}`)
    expect(list.body.documents).toHaveLength(2)
  })
})

describe('Document review and rejection', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('rejecting a document requires a reason and records the reviewer', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-doc-review-driver')
    const admin = await makeAdmin('qc-doc-review-admin')
    const uploaded = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'PROOF_OF_ADDRESS', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })

    const noReason = await request(app).patch(`/api/admin/quebec-onboarding/documents/${uploaded.body.document.id}/review`).set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'REJECTED' })
    expect(noReason.status).toBe(400)
    expect(noReason.body.error.code).toBe('QUEBEC_DOCUMENT_REJECTION_REASON_REQUIRED')

    const rejected = await request(app).patch(`/api/admin/quebec-onboarding/documents/${uploaded.body.document.id}/review`).set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'REJECTED', rejectionReason: 'Address does not match SAAQ records.' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.document.status).toBe('REJECTED')
    expect(rejected.body.document.reviewedById).toBe(admin.id)
  })

  it('a driver cannot review their own document or set a legal hold', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-doc-selfreview-driver')
    const uploaded = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'DRIVING_RECORD_ABSTRACT', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })

    const reviewAttempt = await request(app).patch(`/api/admin/quebec-onboarding/documents/${uploaded.body.document.id}/review`).set('Authorization', `Bearer ${driver.token}`)
      .send({ status: 'ADMIN_REVIEWED_TEST' })
    expect(reviewAttempt.status).toBe(403)

    const holdAttempt = await request(app).patch(`/api/admin/quebec-onboarding/documents/${uploaded.body.document.id}/legal-hold`).set('Authorization', `Bearer ${driver.token}`)
      .send({ hold: true, reason: 'trying to self-hold' })
    expect(holdAttempt.status).toBe(403)
  })

  it('cannot review a document that is not currently PENDING_REVIEW', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-doc-doublereview-driver')
    const admin = await makeAdmin('qc-doc-doublereview-admin')
    const uploaded = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'GST_REGISTRATION', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    await request(app).patch(`/api/admin/quebec-onboarding/documents/${uploaded.body.document.id}/review`).set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'ADMIN_REVIEWED_TEST' })

    const again = await request(app).patch(`/api/admin/quebec-onboarding/documents/${uploaded.body.document.id}/review`).set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'REJECTED', rejectionReason: 'second look' })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('QUEBEC_DOCUMENT_NOT_REVIEWABLE')
  })
})

describe('Private document access', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('a different driver cannot fetch another driver\'s document file', async () => {
    const owner = await registerUser(app, 'DRIVER', 'qc-doc-owner-driver')
    const intruder = await registerUser(app, 'DRIVER', 'qc-doc-intruder-driver')
    const uploaded = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${owner.token}`)
      .send({ type: 'DRIVERS_LICENSE', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })

    const forbidden = await request(app).get(`/api/driver/quebec-onboarding/documents/${uploaded.body.document.id}/file`).set('Authorization', `Bearer ${intruder.token}`)
    expect(forbidden.status).toBe(403)

    const allowed = await request(app).get(`/api/driver/quebec-onboarding/documents/${uploaded.body.document.id}/file`).set('Authorization', `Bearer ${owner.token}`)
    expect(allowed.status).toBe(200)
  })

  it('an admin can fetch any driver\'s document file', async () => {
    const owner = await registerUser(app, 'DRIVER', 'qc-doc-adminread-driver')
    const admin = await makeAdmin('qc-doc-adminread-admin')
    const uploaded = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${owner.token}`)
      .send({ type: 'DRIVERS_LICENSE', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })

    const res = await request(app).get(`/api/driver/quebec-onboarding/documents/${uploaded.body.document.id}/file`).set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
  })
})

describe('No auto-reactivation: document/attestation changes never move the onboarding status', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('uploading and approving a new document while SUSPENDED does not change the onboarding status', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-doc-suspended-driver')
    const admin = await makeAdmin('qc-doc-suspended-admin')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)
    await driveToAdminReview(driver.user.id)
    await transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'APPROVED_INACTIVE', actorId: admin.id })
    await db().jurisdictionComplianceProfile.upsert({
      where: { division_countryCode_regionCode: { division: 'SR', countryCode: 'CA', regionCode: 'quebec' } },
      create: { division: 'SR', countryCode: 'CA', regionCode: 'quebec', status: 'APPROVED' },
      update: { status: 'APPROVED' },
    })
    await transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'ACTIVE', actorId: admin.id })
    await transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'SUSPENDED', actorId: admin.id })

    const uploaded = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'PROOF_OF_TRAINING_COMPLETION', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    await request(app).patch(`/api/admin/quebec-onboarding/documents/${uploaded.body.document.id}/review`).set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'ADMIN_REVIEWED_TEST' })

    const after = await db().quebecDriverOnboarding.findUnique({ where: { userId: driver.user.id } })
    expect(after.status).toBe('SUSPENDED') // still suspended -- a document approval never reactivates
    await db().jurisdictionComplianceProfile.deleteMany({ where: { division: 'SR', countryCode: 'CA', regionCode: 'quebec' } })
  })
})

describe('Vehicle VIN masking', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('VIN is stored encrypted and only ever exposed masked', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-vin-driver')
    const vehicle = await db().driverVehicle.create({
      data: { driverId: driver.user.id, make: 'Honda', model: 'CR-V', year: 2021, plate: 'QCVIN-001', category: 'SR Comfort', country: 'CA' },
    })
    await ensureQuebecVehicleOnboarding(db(), vehicle.id)
    await setQuebecVehicleVin(db(), vehicle.id, '1HGCM82633A123456')

    const raw = await db().quebecVehicleOnboarding.findUnique({ where: { vehicleId: vehicle.id } })
    expect(raw.vinEncrypted).toBeTruthy()
    expect(raw.vinEncrypted).not.toContain('1HGCM82633A123456')

    const redacted = redactQuebecVehicleOnboarding(raw)
    expect(redacted.vinEncrypted).toBeUndefined()
    expect(redacted.vinMasked).toMatch(/••••3456$/)
  })
})

describe('Environment-aware certificate verification', () => {
  const originalEnv = process.env.NODE_ENV
  afterEach(() => { process.env.NODE_ENV = originalEnv })

  it('test/local mode accepts ADMIN_REVIEWED_TEST; production accepts only DIGITALLY_VERIFIED', () => {
    process.env.NODE_ENV = 'test'
    expect(getOperationalDocumentStatuses()).toEqual(['ADMIN_REVIEWED_TEST', 'DIGITALLY_VERIFIED'])

    process.env.NODE_ENV = 'production'
    expect(getOperationalDocumentStatuses()).toEqual(['DIGITALLY_VERIFIED'])
    expect(getOperationalDocumentStatuses()).not.toContain('ADMIN_REVIEWED_TEST')
  })
})

describe('Admin compliance-summary / expiring-documents / audit-history endpoints', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('compliance-summary and expiring-documents are admin/support-only and return the expected shape', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-summary-driver')
    const admin = await makeAdmin('qc-summary-admin')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)

    const forbidden = await request(app).get('/api/admin/quebec-onboarding/compliance-summary').set('Authorization', `Bearer ${driver.token}`)
    expect(forbidden.status).toBe(403)

    const summary = await request(app).get('/api/admin/quebec-onboarding/compliance-summary').set('Authorization', `Bearer ${admin.token}`)
    expect(summary.status).toBe(200)
    expect(summary.body.summary).toHaveProperty('driversByStatus')
    expect(summary.body.summary).toHaveProperty('vehicleDocumentsByStatus')

    const expiring = await request(app).get('/api/admin/quebec-onboarding/expiring-documents').set('Authorization', `Bearer ${admin.token}`)
    expect(expiring.status).toBe(200)
    expect(Array.isArray(expiring.body.driverDocuments)).toBe(true)
    expect(Array.isArray(expiring.body.vehicleDocuments)).toBe(true)
  })

  it('audit-history returns onboarding transitions and document review events for one driver, and is role-gated', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-audit-history-driver')
    const admin = await makeAdmin('qc-audit-history-admin')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)
    await transitionDriverOnboardingStatus(db(), { userId: driver.user.id, toStatus: 'IDENTITY_PENDING', actorId: driver.user.id })
    const uploaded = await request(app).post('/api/driver/quebec-onboarding/documents').set('Authorization', `Bearer ${driver.token}`)
      .send({ type: 'DRIVERS_LICENSE', fileBase64: FAKE_PDF_BASE64, mimeType: 'application/pdf' })
    await request(app).patch(`/api/admin/quebec-onboarding/documents/${uploaded.body.document.id}/review`).set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'ADMIN_REVIEWED_TEST' })

    const forbidden = await request(app).get(`/api/admin/quebec-onboarding/${driver.user.id}/audit-history`).set('Authorization', `Bearer ${driver.token}`)
    expect(forbidden.status).toBe(403)

    const history = await request(app).get(`/api/admin/quebec-onboarding/${driver.user.id}/audit-history`).set('Authorization', `Bearer ${admin.token}`)
    expect(history.status).toBe(200)
    const actions = history.body.events.map((e) => e.action)
    expect(actions).toContain('QUEBEC_DRIVER_ONBOARDING_IDENTITY_PENDING')
    expect(actions).toContain('QUEBEC_DRIVER_DOCUMENTS_ADMIN_REVIEWED_TEST')
  })
})

describe('Driver self-attestation confirmations', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('confirms age eligibility, driving experience, and French attestation independently, each timestamped', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-attest-driver')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)

    const age = await request(app).post('/api/driver/quebec-onboarding/confirm/age-eligibility').set('Authorization', `Bearer ${driver.token}`)
    expect(age.status).toBe(200)
    expect(age.body.onboarding.ageEligibilityConfirmed).toBe(true)

    const experience = await request(app).post('/api/driver/quebec-onboarding/confirm/driving-experience').set('Authorization', `Bearer ${driver.token}`)
    expect(experience.body.onboarding.drivingExperienceConfirmed).toBe(true)
    expect(experience.body.onboarding.drivingExperienceConfirmedAt).toBeTruthy()

    const french = await request(app).post('/api/driver/quebec-onboarding/confirm/french-attestation').set('Authorization', `Bearer ${driver.token}`)
    expect(french.body.onboarding.frenchAttestationConfirmed).toBe(true)
    expect(french.body.onboarding.frenchAttestationConfirmedAt).toBeTruthy()
  })
})

describe('Compliance-item status (GST/QST/operator file/SEV-SRS)', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('requires a recorded admin to move a compliance item to ADMIN_REVIEWED_TEST or REJECTED', async () => {
    const driver = await registerUser(app, 'DRIVER', 'qc-item-driver')
    const admin = await makeAdmin('qc-item-admin')
    await ensureQuebecDriverOnboarding(db(), driver.user.id)

    const forbidden = await request(app).patch(`/api/admin/quebec-onboarding/${driver.user.id}/compliance-item`).set('Authorization', `Bearer ${driver.token}`)
      .send({ field: 'gstStatus', status: 'ADMIN_REVIEWED_TEST' })
    expect(forbidden.status).toBe(403)

    const updated = await request(app).patch(`/api/admin/quebec-onboarding/${driver.user.id}/compliance-item`).set('Authorization', `Bearer ${admin.token}`)
      .send({ field: 'gstStatus', status: 'ADMIN_REVIEWED_TEST' })
    expect(updated.status).toBe(200)
    expect(updated.body.onboarding.gstStatus).toBe('ADMIN_REVIEWED_TEST')
  })
})

describe('Retention purge respects legal hold', () => {
  afterEach(async () => {
    await db().quebecDriverDocument.deleteMany({ where: { assetUrl: { contains: 'retention-test' } } })
  })

  it('purges a non-held expired document but leaves a held one untouched', async () => {
    const { purgeExpiredQuebecDocuments } = await import('../../server/lib/quebec-document-compliance.mjs')
    const driver = await db().user.create({
      data: {
        email: uniqueTestEmail('qc-purge-driver'), displayName: 'QC Purge Driver', referralCode: uniqueTestReferralCode(),
        roles: { create: { role: 'DRIVER' } },
      },
    })
    trackTestUser(driver.id)
    await ensureQuebecDriverOnboarding(db(), driver.id)
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const heldDoc = await db().quebecDriverDocument.create({
      data: {
        onboardingUserId: driver.id, type: 'DRIVERS_LICENSE', assetUrl: 'retention-test-held.pdf', mimeType: 'application/pdf',
        status: 'ADMIN_REVIEWED_TEST', retentionDeleteAfter: past, legalHold: true, legalHoldReason: 'dispute', legalHoldSetAt: new Date(),
      },
    })
    const purgeableDoc = await db().quebecDriverDocument.create({
      data: {
        onboardingUserId: driver.id, type: 'PROOF_OF_IDENTITY', assetUrl: 'retention-test-purgeable.pdf', mimeType: 'application/pdf',
        status: 'ADMIN_REVIEWED_TEST', retentionDeleteAfter: past, legalHold: false,
      },
    })

    await purgeExpiredQuebecDocuments(db(), { actorId: null })

    const heldAfter = await db().quebecDriverDocument.findUnique({ where: { id: heldDoc.id } })
    expect(heldAfter.assetUrl).toBe('retention-test-held.pdf') // untouched
    expect(heldAfter.deletedAt).toBeNull()

    const purgedAfter = await db().quebecDriverDocument.findUnique({ where: { id: purgeableDoc.id } })
    expect(purgedAfter.assetUrl).toBeNull()
    expect(purgedAfter.deletedAt).not.toBeNull()

    const auditEntry = await db().adminAuditLog.findFirst({ where: { entityType: 'quebec_driver_documents', entityId: purgeableDoc.id, action: 'QUEBEC_DRIVER_DOCUMENTS_RETENTION_PURGED' } })
    expect(auditEntry).not.toBeNull()
  })
})
