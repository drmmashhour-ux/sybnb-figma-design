// Québec driver/vehicle onboarding — Phase 1: data model and API foundation only. TEST MODE. This
// module does not enable real paid rides: SR ride creation and location pings stay hard-geofenced
// to Syria (assertSyriaCoords in sr-geocoding.mjs) regardless of any status recorded here. A driver
// or vehicle can only reach ACTIVE once the Québec ride-hailing jurisdiction is itself APPROVED in
// JurisdictionComplianceProfile (assertQuebecRideJurisdictionApproved below) -- the same
// "market approval gates individual approval" discipline already used for STR listings and Syria SR
// drivers (server/lib/jurisdiction-compliance.mjs).
import { assertJurisdictionApproved } from './jurisdiction-compliance.mjs'
import { encryptSensitive, lastFour, maskedDisplay } from './tax-encryption.mjs'

function fail(code, message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}

// The one Québec ride-hailing jurisdiction row this whole module cares about. Not resolveDriverJurisdiction()
// (that resolver is hardcoded to Syria by design -- see its own comment) -- Québec is a literal,
// separate jurisdiction key until SR ever supports a real per-driver country.
const QUEBEC_RIDE_JURISDICTION = { division: 'SR', countryCode: 'CA', regionCode: 'quebec' }

export async function assertQuebecRideJurisdictionApproved(db) {
  return assertJurisdictionApproved(db, QUEBEC_RIDE_JURISDICTION, { subject: 'Ride-hailing in Québec' })
}

// ---- Status-transition graphs ----
// Each key lists every status that key is allowed to move to next. ADMIN_REVIEW can send a driver
// back to any earlier *_PENDING stage ("needs more info") as well as forward to APPROVED_INACTIVE or
// out to REJECTED. REJECTED is not fully terminal -- an admin can restart a rejected applicant back
// at DRAFT, but nothing ever transitions INTO REJECTED implicitly.
export const DRIVER_STATUS_TRANSITIONS = {
  DRAFT: ['IDENTITY_PENDING'],
  IDENTITY_PENDING: ['DRIVER_DOCUMENTS_PENDING', 'REJECTED'],
  DRIVER_DOCUMENTS_PENDING: ['POLICE_CHECK_PENDING', 'REJECTED'],
  POLICE_CHECK_PENDING: ['TRAINING_PENDING', 'REJECTED'],
  TRAINING_PENDING: ['TAX_REGISTRATION_PENDING', 'REJECTED'],
  TAX_REGISTRATION_PENDING: ['VEHICLE_PENDING', 'REJECTED'],
  VEHICLE_PENDING: ['INSURANCE_PENDING', 'REJECTED'],
  INSURANCE_PENDING: ['ADMIN_REVIEW', 'REJECTED'],
  ADMIN_REVIEW: [
    'APPROVED_INACTIVE', 'REJECTED',
    'IDENTITY_PENDING', 'DRIVER_DOCUMENTS_PENDING', 'POLICE_CHECK_PENDING', 'TRAINING_PENDING',
    'TAX_REGISTRATION_PENDING', 'VEHICLE_PENDING', 'INSURANCE_PENDING',
  ],
  APPROVED_INACTIVE: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'EXPIRED', 'REJECTED'],
  EXPIRED: ['ADMIN_REVIEW', 'REJECTED'],
  REJECTED: ['DRAFT'],
}

export const VEHICLE_STATUS_TRANSITIONS = {
  DRAFT: ['DOCUMENTS_PENDING'],
  DOCUMENTS_PENDING: ['INSPECTION_PENDING', 'REJECTED'],
  INSPECTION_PENDING: ['ADMIN_REVIEW', 'REJECTED'],
  ADMIN_REVIEW: ['APPROVED_INACTIVE', 'REJECTED', 'DOCUMENTS_PENDING', 'INSPECTION_PENDING'],
  APPROVED_INACTIVE: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['SUSPENDED', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'EXPIRED', 'REJECTED'],
  EXPIRED: ['ADMIN_REVIEW', 'REJECTED'],
  REJECTED: ['DRAFT'],
}

export function assertValidStatusTransition(transitions, from, to) {
  const allowed = transitions[from]
  if (!allowed || !allowed.includes(to)) {
    fail(
      'QUEBEC_ONBOARDING_INVALID_TRANSITION',
      `Cannot move from ${from} to ${to}. Allowed next statuses from ${from}: ${(allowed || []).join(', ') || '(none -- terminal)'}.`,
      409,
    )
  }
}

// ---- Driver onboarding ----

// QuebecDriverOnboarding.userId is a foreign key into DriverProfile (not User directly), so a
// driver's parent DriverProfile row must exist first -- same upsert-create-if-missing pattern
// already used at the top of the existing driver-facing routes (driver.mjs).
export async function ensureQuebecDriverOnboarding(db, userId) {
  await db.driverProfile.upsert({ where: { userId }, create: { userId }, update: {} })
  return db.quebecDriverOnboarding.upsert({
    where: { userId },
    create: { userId },
    update: {},
  })
}

export async function transitionDriverOnboardingStatus(db, { userId, toStatus, actorId, reason }) {
  if (!actorId) fail('QUEBEC_ONBOARDING_ACTOR_REQUIRED', 'A recorded admin/reviewer is required to change onboarding status.')
  return db.$transaction(async (tx) => {
    const before = await tx.quebecDriverOnboarding.findUnique({ where: { userId } })
    if (!before) fail('QUEBEC_DRIVER_ONBOARDING_NOT_FOUND', 'No Québec onboarding record exists for this driver.', 404)
    assertValidStatusTransition(DRIVER_STATUS_TRANSITIONS, before.status, toStatus)
    if (toStatus === 'ACTIVE') await assertQuebecRideJurisdictionApproved(tx)
    if ((toStatus === 'REJECTED' || (before.status === 'ADMIN_REVIEW' && toStatus !== 'APPROVED_INACTIVE')) && !String(reason || '').trim()) {
      fail('QUEBEC_ONBOARDING_REASON_REQUIRED', 'A reason is required when rejecting or sending an application back for corrections.')
    }

    const after = await tx.quebecDriverOnboarding.update({
      where: { userId },
      data: { status: toStatus, statusReason: reason || null, reviewedById: actorId, reviewedAt: new Date(), version: { increment: 1 } },
    })
    await tx.adminAuditLog.create({
      data: {
        actorUserId: actorId, action: `QUEBEC_DRIVER_ONBOARDING_${toStatus}`, entityType: 'quebec_driver_onboarding', entityId: after.id,
        before: { status: before.status }, after: { status: after.status, reason: after.statusReason },
      },
    })
    return after
  })
}

export async function setQuebecDriverLicenseNumber(db, userId, licenseNumber) {
  await db.driverProfile.upsert({ where: { userId }, create: { userId }, update: {} })
  const encrypted = encryptSensitive(licenseNumber)
  const last4 = lastFour(licenseNumber)
  return db.quebecDriverOnboarding.upsert({
    where: { userId },
    create: { userId, licenseNumberEncrypted: `${last4}::${encrypted}` },
    update: { licenseNumberEncrypted: `${last4}::${encrypted}`, version: { increment: 1 } },
  })
}

// Legal identity metadata (Phase 1 expansion): stored encrypted at rest, same discipline as the
// licence number above -- never surfaced in full again after submission, only as a masked last-4
// display. Date of birth is deliberately NOT collected at all in Phase 1: age/eligibility is a
// self-attestation boolean (see confirmQuebecDriverAgeEligibility) rather than a real birthdate,
// since no code path needs the actual date -- collecting less sensitive data than would need
// encrypting is itself the more privacy-preserving design ("do not store unencrypted... when a
// masked or encrypted representation is appropriate" cuts both ways).
export async function setQuebecDriverLegalName(db, userId, legalName) {
  await db.driverProfile.upsert({ where: { userId }, create: { userId }, update: {} })
  const encrypted = encryptSensitive(legalName)
  const last4 = lastFour(legalName)
  return db.quebecDriverOnboarding.upsert({
    where: { userId },
    create: { userId, legalNameEncrypted: `${last4}::${encrypted}`, legalNameLast4: last4 },
    update: { legalNameEncrypted: `${last4}::${encrypted}`, legalNameLast4: last4, version: { increment: 1 } },
  })
}

const DRIVER_ATTESTATION_FIELDS = {
  ageEligibility: { flag: 'ageEligibilityConfirmed', at: null },
  drivingExperience: { flag: 'drivingExperienceConfirmed', at: 'drivingExperienceConfirmedAt' },
  frenchLanguage: { flag: 'frenchAttestationConfirmed', at: 'frenchAttestationConfirmedAt' },
}

// Driver self-service confirmations -- a checkbox-style attestation, not a document upload. Each one
// is independent of onboarding status (a driver can confirm these at any pre-ADMIN_REVIEW stage) and
// none of them, by themselves, advances the status graph -- only /submit does that.
export async function confirmQuebecDriverAttestation(db, userId, attestation) {
  const config = DRIVER_ATTESTATION_FIELDS[attestation]
  if (!config) fail('QUEBEC_ATTESTATION_INVALID', `Unknown attestation: ${attestation}.`, 500)
  const data = { [config.flag]: true, version: { increment: 1 } }
  if (config.at) data[config.at] = new Date()
  return db.quebecDriverOnboarding.update({ where: { userId }, data })
}

const DRIVER_COMPLIANCE_ITEM_FIELDS = ['gstStatus', 'qstStatus', 'operatorFileStatus', 'sevSrsStatus']

// GST/QST registration, the Revenu Québec operator file, and SEV/SRS ride-hailing registration are
// each tracked as an independent status line-item (server/lib/quebec-document-compliance.mjs handles
// the underlying document evidence; this just records the admin's determination on that line-item).
// Always requires a recorded admin -- there is no self-service path to ADMIN_REVIEWED_TEST/REJECTED.
export async function setQuebecDriverComplianceItemStatus(db, userId, field, status, actorId) {
  if (!DRIVER_COMPLIANCE_ITEM_FIELDS.includes(field)) fail('QUEBEC_COMPLIANCE_ITEM_INVALID', `Unknown compliance item: ${field}.`, 500)
  if (!['NOT_STARTED', 'SUBMITTED', 'ADMIN_REVIEWED_TEST', 'REJECTED'].includes(status)) {
    fail('QUEBEC_COMPLIANCE_ITEM_STATUS_INVALID', 'status must be one of NOT_STARTED, SUBMITTED, ADMIN_REVIEWED_TEST, REJECTED.')
  }
  if (['ADMIN_REVIEWED_TEST', 'REJECTED'].includes(status) && !actorId) {
    fail('QUEBEC_COMPLIANCE_ITEM_ACTOR_REQUIRED', 'A recorded admin is required to review a compliance item.')
  }
  return db.$transaction(async (tx) => {
    const before = await tx.quebecDriverOnboarding.findUnique({ where: { userId }, select: { id: true, [field]: true } })
    if (!before) fail('QUEBEC_DRIVER_ONBOARDING_NOT_FOUND', 'No Québec onboarding record exists for this driver.', 404)
    const after = await tx.quebecDriverOnboarding.update({ where: { userId }, data: { [field]: status, version: { increment: 1 } } })
    if (actorId) {
      await tx.adminAuditLog.create({
        data: {
          actorUserId: actorId, action: `QUEBEC_DRIVER_COMPLIANCE_ITEM_${field.toUpperCase()}_${status}`,
          entityType: 'quebec_driver_onboarding', entityId: after.id,
          before: { [field]: before[field] }, after: { [field]: status },
        },
      })
    }
    return after
  })
}

// Assigning a reviewer is separate from the reviewer who actually acted last (reviewedById) -- it
// records who is currently responsible for looking at this application, before any decision is made.
export async function assignQuebecDriverReviewer(db, userId, { reviewerId, actorId }) {
  if (!actorId) fail('QUEBEC_ONBOARDING_ACTOR_REQUIRED', 'A recorded admin is required to assign a reviewer.')
  return db.quebecDriverOnboarding.update({
    where: { userId },
    data: { assignedReviewerId: reviewerId || null, version: { increment: 1 } },
  })
}

// Never returns the encrypted value or the plaintext -- only a masked display built from the last4
// segment stored alongside the ciphertext, same "masked display never needs to decrypt on every page
// render" discipline as TaxProfile (server/lib/tax-profile.mjs's redactTaxProfile).
export function redactQuebecDriverOnboarding(row) {
  if (!row) return row
  const { licenseNumberEncrypted, legalNameEncrypted, ...rest } = row
  const licenseLast4 = licenseNumberEncrypted ? licenseNumberEncrypted.split('::')[0] : null
  return {
    ...rest,
    licenseNumberMasked: licenseLast4 ? maskedDisplay(licenseLast4) : null,
    legalNameMasked: rest.legalNameLast4 ? maskedDisplay(rest.legalNameLast4) : null,
  }
}

// ---- Vehicle onboarding ----

export async function ensureQuebecVehicleOnboarding(db, vehicleId) {
  return db.quebecVehicleOnboarding.upsert({
    where: { vehicleId },
    create: { vehicleId },
    update: {},
  })
}

export async function transitionVehicleOnboardingStatus(db, { vehicleId, toStatus, actorId, reason }) {
  if (!actorId) fail('QUEBEC_ONBOARDING_ACTOR_REQUIRED', 'A recorded admin/reviewer is required to change onboarding status.')
  return db.$transaction(async (tx) => {
    const before = await tx.quebecVehicleOnboarding.findUnique({ where: { vehicleId } })
    if (!before) fail('QUEBEC_VEHICLE_ONBOARDING_NOT_FOUND', 'No Québec onboarding record exists for this vehicle.', 404)
    assertValidStatusTransition(VEHICLE_STATUS_TRANSITIONS, before.status, toStatus)
    if (toStatus === 'ACTIVE') await assertQuebecRideJurisdictionApproved(tx)
    if ((toStatus === 'REJECTED' || (before.status === 'ADMIN_REVIEW' && toStatus !== 'APPROVED_INACTIVE')) && !String(reason || '').trim()) {
      fail('QUEBEC_ONBOARDING_REASON_REQUIRED', 'A reason is required when rejecting or sending a vehicle back for corrections.')
    }

    const after = await tx.quebecVehicleOnboarding.update({
      where: { vehicleId },
      data: { status: toStatus, statusReason: reason || null, reviewedById: actorId, reviewedAt: new Date(), version: { increment: 1 } },
    })
    await tx.adminAuditLog.create({
      data: {
        actorUserId: actorId, action: `QUEBEC_VEHICLE_ONBOARDING_${toStatus}`, entityType: 'quebec_vehicle_onboarding', entityId: after.id,
        before: { status: before.status }, after: { status: after.status, reason: after.statusReason },
      },
    })
    return after
  })
}

// VIN is stored encrypted and masked-by-default, same discipline as the driver's licence number --
// never returned in full to a driver-facing endpoint. Odometer/door/seat counts and accessibility
// info carry no privacy sensitivity and are stored plainly.
export async function setQuebecVehicleVin(db, vehicleId, vin) {
  const encrypted = encryptSensitive(vin)
  const last4 = lastFour(vin)
  return db.quebecVehicleOnboarding.upsert({
    where: { vehicleId },
    create: { vehicleId, vinEncrypted: `${last4}::${encrypted}`, vinLast4: last4 },
    update: { vinEncrypted: `${last4}::${encrypted}`, vinLast4: last4, version: { increment: 1 } },
  })
}

export async function setQuebecVehicleDetails(db, vehicleId, { odometerKm, doorCount, seatCount, accessibilityInfo }) {
  const data = { version: { increment: 1 } }
  if (odometerKm !== undefined) data.odometerKm = odometerKm
  if (doorCount !== undefined) data.doorCount = doorCount
  if (seatCount !== undefined) data.seatCount = seatCount
  if (accessibilityInfo !== undefined) data.accessibilityInfo = accessibilityInfo
  return db.quebecVehicleOnboarding.update({ where: { vehicleId }, data })
}

// Same "assigned vs. last-acted reviewer" distinction as the driver side.
export async function assignQuebecVehicleReviewer(db, vehicleId, { reviewerId, actorId }) {
  if (!actorId) fail('QUEBEC_ONBOARDING_ACTOR_REQUIRED', 'A recorded admin is required to assign a reviewer.')
  return db.quebecVehicleOnboarding.update({
    where: { vehicleId },
    data: { assignedReviewerId: reviewerId || null, version: { increment: 1 } },
  })
}

// Never returns the encrypted VIN, only a masked display -- same discipline as
// redactQuebecDriverOnboarding above.
export function redactQuebecVehicleOnboarding(row) {
  if (!row) return row
  const { vinEncrypted, ...rest } = row
  return { ...rest, vinMasked: rest.vinLast4 ? maskedDisplay(rest.vinLast4) : null }
}
