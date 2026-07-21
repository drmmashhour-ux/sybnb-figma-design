// TEST-MODE-ONLY seed script for the Québec STR/SIR compliance localhost review. Creates synthetic
// accounts and a synthetic Quebec STAYS listing with an admin-approved CITQ certificate so the guest
// checkout, driver/host tax profiles, and admin compliance dashboard all have real data to inspect.
// No real SIN, banking, government ID, or insurance information is used anywhere here. Idempotent:
// re-running upserts the same rows rather than duplicating them.
import { db, disconnectDb } from '../server/lib/prisma.mjs'
import { hashPassword } from '../server/lib/security.mjs'
import { recordWalletEntry } from '../server/lib/finance-ledger.mjs'
import { retentionDeleteAfter } from '../server/lib/listing-document-retention.mjs'
import {
  DRIVER_STATUS_TRANSITIONS,
  VEHICLE_STATUS_TRANSITIONS,
  confirmQuebecDriverAttestation,
  ensureQuebecDriverOnboarding,
  ensureQuebecVehicleOnboarding,
  setQuebecDriverComplianceItemStatus,
  setQuebecDriverLegalName,
  setQuebecDriverLicenseNumber,
  setQuebecVehicleDetails,
  setQuebecVehicleVin,
  transitionDriverOnboardingStatus,
  transitionVehicleOnboardingStatus,
} from '../server/lib/quebec-driver-onboarding.mjs'
import { uploadQuebecDocument, reviewQuebecDocument } from '../server/lib/quebec-document-compliance.mjs'
import { saveQuebecDocument } from '../server/lib/quebec-document-storage.mjs'

const PASSWORD = 'SybnbTest2026!'

async function upsertUser({ email, displayName, role, extra = {} }) {
  const referralCode = `QCTEST-${email.split('@')[0]}`.toUpperCase()
  const passwordHash = hashPassword(PASSWORD)
  const user = await db().user.upsert({
    where: { email },
    create: {
      email, displayName, passwordHash, referralCode,
      roles: { create: { role } },
      wallets: { create: { currency: 'SYP' } },
      ...extra,
    },
    update: { displayName, passwordHash, ...extra },
  })
  const hasRole = await db().userRole.findFirst({ where: { userId: user.id, role } })
  if (!hasRole) await db().userRole.create({ data: { userId: user.id, role } })
  return user
}

async function main() {
  const guest = await upsertUser({ email: 'quebec-test-guest@sybnb.test', displayName: 'QC Test Guest', role: 'GUEST' })
  const passenger = await upsertUser({ email: 'quebec-test-passenger@sybnb.test', displayName: 'QC Test Passenger', role: 'GUEST' })
  // Fund the passenger's wallet so a real SIR ride can be requested end-to-end.
  await db().$transaction(async (tx) => {
    await recordWalletEntry(tx, {
      userId: passenger.id, type: 'CREDIT', amountMinor: 5_000_000, currency: 'SYP',
      referenceType: 'seed', referenceId: `seed-quebec-passenger-fund-${passenger.id}`,
      keyParts: ['seed-quebec-passenger-fund', passenger.id], note: 'TEST MODE seed funding for localhost review.',
    })
  })

  const driver = await upsertUser({ email: 'quebec-test-driver@sybnb.test', displayName: 'QC Test Driver', role: 'DRIVER' })
  await db().driverProfile.upsert({
    where: { userId: driver.id },
    create: { userId: driver.id, country: 'CA' },
    update: { country: 'CA' },
  })
  await db().user.update({ where: { id: driver.id }, data: { idDocumentStatus: 'APPROVED' } })
  for (const type of ['LICENSE', 'VEHICLE_REGISTRATION', 'SAAQ_AUTHORIZED_DRIVER_PERMIT']) {
    await db().driverDocument.upsert({
      where: { driverUserId_type: { driverUserId: driver.id, type } },
      create: { driverUserId: driver.id, type, assetUrl: `seed-${type}.pdf`, status: 'APPROVED' },
      update: { status: 'APPROVED' },
    })
  }

  const host = await upsertUser({ email: 'quebec-test-host@sybnb.test', displayName: 'QC Test Host', role: 'HOST' })
  const senior = await upsertUser({ email: 'quebec-test-admin@sybnb.test', displayName: 'QC Test Compliance Admin', role: 'ADMIN' })
  const farFuture = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString()

  // Phase 1 driver/vehicle onboarding foundation: populate the expanded compliance profile with
  // synthetic-only data (a fictional name/licence, never a real SIN/licence/police record), then walk
  // the test driver's onboarding record to ADMIN_REVIEW (self-service stages only) so the admin
  // console has a real record to act on. Deliberately NOT activated -- nothing here enables a real
  // paid ride, and ACTIVE is blocked anyway unless the Québec SR jurisdiction is explicitly approved
  // (it isn't seeded here).
  await setQuebecDriverLegalName(db(), driver.id, 'Jordan Test-Tremblay')
  await setQuebecDriverLicenseNumber(db(), driver.id, 'T1234-567890-12')
  await db().quebecDriverOnboarding.update({ where: { userId: driver.id }, data: { licenseClass: 'Class 5' } })
  await confirmQuebecDriverAttestation(db(), driver.id, 'ageEligibility')
  await confirmQuebecDriverAttestation(db(), driver.id, 'drivingExperience')
  await confirmQuebecDriverAttestation(db(), driver.id, 'frenchLanguage')
  for (const field of ['gstStatus', 'qstStatus', 'operatorFileStatus', 'sevSrsStatus']) {
    await setQuebecDriverComplianceItemStatus(db(), driver.id, field, 'ADMIN_REVIEWED_TEST', senior.id)
  }
  {
    const existing = await ensureQuebecDriverOnboarding(db(), driver.id)
    let onboardingStatus = existing.status
    const selfServiceStatuses = ['DRAFT', 'IDENTITY_PENDING', 'DRIVER_DOCUMENTS_PENDING', 'POLICE_CHECK_PENDING', 'TRAINING_PENDING', 'TAX_REGISTRATION_PENDING', 'VEHICLE_PENDING', 'INSURANCE_PENDING']
    while (selfServiceStatuses.includes(onboardingStatus)) {
      const nextStatus = DRIVER_STATUS_TRANSITIONS[onboardingStatus][0]
      const updated = await transitionDriverOnboardingStatus(db(), { userId: driver.id, toStatus: nextStatus, actorId: driver.id })
      onboardingStatus = updated.status
    }
  }

  // One versioned driver compliance document, admin-reviewed, so the admin console has a real
  // document-review example to inspect (not just a bare status record). Idempotency guard: only
  // upload+review on the FIRST run -- a second run would otherwise create a new version every time.
  const existingDriverLicenseDoc = await db().quebecDriverDocument.findFirst({
    where: { onboardingUserId: driver.id, type: 'DRIVERS_LICENSE', isCurrent: true },
  })
  if (!existingDriverLicenseDoc) {
    const driverLicenseAsset = await saveQuebecDocument(
      Buffer.from('SYNTHETIC TEST DOCUMENT - NOT A REAL DRIVERS LICENSE').toString('base64'), 'application/pdf',
    )
    const driverLicenseDoc = await uploadQuebecDocument(db(), 'driver', {
      ownerId: driver.id, type: 'DRIVERS_LICENSE', assetUrl: driverLicenseAsset, mimeType: 'application/pdf',
      issuer: 'SAAQ (synthetic)', expiresAt: farFuture,
    })
    await reviewQuebecDocument(db(), 'driver', driverLicenseDoc.id, { status: 'ADMIN_REVIEWED_TEST', reviewerId: senior.id })
  }

  const seedVehicle = await db().driverVehicle.upsert({
    where: { id: '00000000-0000-4000-8000-000000000101' },
    create: {
      id: '00000000-0000-4000-8000-000000000101', driverId: driver.id, make: 'Toyota', model: 'Camry', year: 2022,
      plate: 'QCTEST-001', category: 'SR Comfort', country: 'CA',
    },
    update: {},
  })
  await ensureQuebecVehicleOnboarding(db(), seedVehicle.id)
  await setQuebecVehicleVin(db(), seedVehicle.id, '1HGCM82633A123456')
  await setQuebecVehicleDetails(db(), seedVehicle.id, {
    odometerKm: 42000, doorCount: 4, seatCount: 5, accessibilityInfo: { wheelchairAccessible: false },
  })
  {
    const existingVehicle = await ensureQuebecVehicleOnboarding(db(), seedVehicle.id)
    let vehicleStatus = existingVehicle.status
    const selfServiceVehicleStatuses = ['DRAFT', 'DOCUMENTS_PENDING', 'INSPECTION_PENDING']
    while (selfServiceVehicleStatuses.includes(vehicleStatus)) {
      const nextStatus = VEHICLE_STATUS_TRANSITIONS[vehicleStatus][0]
      const updated = await transitionVehicleOnboardingStatus(db(), { vehicleId: seedVehicle.id, toStatus: nextStatus, actorId: driver.id })
      vehicleStatus = updated.status
    }
  }

  const existingVehicleRegistrationDoc = await db().quebecVehicleDocument.findFirst({
    where: { onboardingVehicleId: seedVehicle.id, type: 'VEHICLE_REGISTRATION', isCurrent: true },
  })
  if (!existingVehicleRegistrationDoc) {
    const vehicleRegistrationAsset = await saveQuebecDocument(
      Buffer.from('SYNTHETIC TEST DOCUMENT - NOT A REAL VEHICLE REGISTRATION').toString('base64'), 'application/pdf',
    )
    const vehicleRegistrationDoc = await uploadQuebecDocument(db(), 'vehicle', {
      ownerId: seedVehicle.id, type: 'VEHICLE_REGISTRATION', assetUrl: vehicleRegistrationAsset, mimeType: 'application/pdf',
      issuer: 'SAAQ (synthetic)', expiresAt: farFuture,
    })
    await reviewQuebecDocument(db(), 'vehicle', vehicleRegistrationDoc.id, { status: 'ADMIN_REVIEWED_TEST', reviewerId: senior.id })
  }

  const listing = await db().listing.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      ownerId: host.id, division: 'STAYS', status: 'APPROVED',
      titleAr: 'شقة اختبار في مونتريال', titleEn: 'Test apartment in Montreal',
      description: 'Synthetic Québec test listing for the compliance-review localhost session. Not a real property.',
      priceMinor: 150000, currency: 'SYP',
      metadata: {
        country: 'CA', governorate: 'quebec', city: 'montreal', area: 'Plateau',
        citqRegistrationNumber: 'CITQ-TEST-000001', citqCertificateExpiresAt: farFuture,
        residencyType: 'principal', bedrooms: 2, bathrooms: 1, guestCapacity: 4,
        guestVisibleFees: { nightlyPriceMinor: 150000 }, taxFeeMinor: 5250,
      },
    },
    update: {
      status: 'APPROVED',
      metadata: {
        country: 'CA', governorate: 'quebec', city: 'montreal', area: 'Plateau',
        citqRegistrationNumber: 'CITQ-TEST-000001', citqCertificateExpiresAt: farFuture,
        residencyType: 'principal', bedrooms: 2, bathrooms: 1, guestCapacity: 4,
        guestVisibleFees: { nightlyPriceMinor: 150000 }, taxFeeMinor: 5250,
      },
    },
  })

  const existingCertificateDoc = await db().listingDocument.findFirst({
    where: { listingId: listing.id, type: 'CITQ_CERTIFICATE', isCurrent: true },
  })
  if (existingCertificateDoc) {
    await db().listingDocument.update({
      where: { id: existingCertificateDoc.id },
      data: {
        status: 'ADMIN_REVIEWED_TEST', reviewedById: senior.id, reviewedAt: new Date(),
        expiresAt: new Date(farFuture), retentionDeleteAfter: retentionDeleteAfter(farFuture),
      },
    })
  } else {
    await db().listingDocument.create({
      data: {
        listingId: listing.id, type: 'CITQ_CERTIFICATE', assetUrl: 'seed-citq-certificate.pdf', mimeType: 'application/pdf',
        status: 'ADMIN_REVIEWED_TEST', reviewedById: senior.id, reviewedAt: new Date(),
        expiresAt: new Date(farFuture), retentionDeleteAfter: retentionDeleteAfter(farFuture),
      },
    })
  }

  // A second Quebec listing that is deliberately UNVERIFIED (uploaded, not yet reviewed) so the
  // admin certificate-review queue has something real to act on during the walkthrough.
  const pendingListing = await db().listing.upsert({
    where: { id: '00000000-0000-4000-8000-000000000002' },
    create: {
      id: '00000000-0000-4000-8000-000000000002',
      ownerId: host.id, division: 'STAYS', status: 'PENDING_REVIEW',
      titleAr: 'استوديو اختبار في كيبك سيتي', titleEn: 'Test studio in Quebec City',
      description: 'Synthetic Québec test listing with a certificate still pending admin review.',
      priceMinor: 90000, currency: 'SYP',
      metadata: {
        country: 'CA', governorate: 'quebec', city: 'quebec-city',
        citqRegistrationNumber: 'CITQ-TEST-000002', citqCertificateExpiresAt: farFuture,
        residencyType: 'principal', bedrooms: 1, bathrooms: 1, guestCapacity: 2,
        guestVisibleFees: { nightlyPriceMinor: 90000 }, taxFeeMinor: 3150,
      },
    },
    update: {},
  })
  const existingPendingDoc = await db().listingDocument.findFirst({
    where: { listingId: pendingListing.id, type: 'CITQ_CERTIFICATE', isCurrent: true },
  })
  if (existingPendingDoc) {
    await db().listingDocument.update({ where: { id: existingPendingDoc.id }, data: { status: 'PENDING_REVIEW', reviewedById: null, reviewedAt: null } })
  } else {
    await db().listingDocument.create({
      data: { listingId: pendingListing.id, type: 'CITQ_CERTIFICATE', assetUrl: 'seed-citq-pending.pdf', mimeType: 'application/pdf', status: 'PENDING_REVIEW' },
    })
  }

  console.log(JSON.stringify({
    ok: true,
    accounts: {
      guest: { email: 'quebec-test-guest@sybnb.test', password: PASSWORD },
      passenger: { email: 'quebec-test-passenger@sybnb.test', password: PASSWORD, note: 'wallet pre-funded 5,000,000 SYP' },
      driver: {
        email: 'quebec-test-driver@sybnb.test', password: PASSWORD,
        note: 'Quebec, documents pre-approved, onboarding at ADMIN_REVIEW (admin can approve/reject via /api/admin/quebec-onboarding/:userId)',
      },
      host: { email: 'quebec-test-host@sybnb.test', password: PASSWORD },
      admin: { email: 'quebec-test-admin@sybnb.test', password: PASSWORD },
    },
    listings: {
      approvedQuebecStay: listing.id,
      pendingCertificateQuebecStay: pendingListing.id,
    },
    quebecOnboarding: {
      driverUserId: driver.id,
      vehicleId: seedVehicle.id,
      note: 'Both at ADMIN_REVIEW. Nothing is ACTIVE -- the Québec SR jurisdiction is not seeded APPROVED.',
    },
  }, null, 2))
  await disconnectDb()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
