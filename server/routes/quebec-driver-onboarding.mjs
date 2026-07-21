// Québec driver/vehicle onboarding API — Phase 1 foundation, expanded. TEST MODE only. Role-protected:
// drivers can only see/advance/upload against their own record; only ADMIN can approve, reject,
// suspend, activate, review documents, set legal holds, assign reviewers, or read audit history. See
// server/lib/quebec-driver-onboarding.mjs for the transition graph and jurisdiction-activation gate,
// and server/lib/quebec-document-compliance.mjs for the versioned-document/legal-hold rules.
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import {
  DRIVER_STATUS_TRANSITIONS,
  VEHICLE_STATUS_TRANSITIONS,
  assignQuebecDriverReviewer,
  assignQuebecVehicleReviewer,
  confirmQuebecDriverAttestation,
  ensureQuebecDriverOnboarding,
  ensureQuebecVehicleOnboarding,
  redactQuebecDriverOnboarding,
  redactQuebecVehicleOnboarding,
  setQuebecDriverComplianceItemStatus,
  setQuebecDriverLegalName,
  setQuebecDriverLicenseNumber,
  setQuebecVehicleDetails,
  setQuebecVehicleVin,
  transitionDriverOnboardingStatus,
  transitionVehicleOnboardingStatus,
} from '../lib/quebec-driver-onboarding.mjs'
import {
  QUEBEC_DRIVER_DOCUMENT_TYPES,
  QUEBEC_VEHICLE_DOCUMENT_TYPES,
  listCurrentQuebecDocuments,
  listQuebecDocumentHistory,
  markExpiredQuebecDocuments,
  purgeExpiredQuebecDocuments,
  reviewQuebecDocument,
  setQuebecDocumentLegalHold,
  uploadQuebecDocument,
} from '../lib/quebec-document-compliance.mjs'
import { readQuebecDocument, saveQuebecDocument } from '../lib/quebec-document-storage.mjs'

// The pre-ADMIN_REVIEW chain a driver can self-advance through by submitting the next piece of
// information. Nothing past ADMIN_REVIEW (approval, activation, suspension, rejection) is ever
// driver-self-service -- those require requireAuth(context, ['ADMIN']) below.
const DRIVER_SELF_SERVICE_STATUSES = [
  'DRAFT', 'IDENTITY_PENDING', 'DRIVER_DOCUMENTS_PENDING', 'POLICE_CHECK_PENDING',
  'TRAINING_PENDING', 'TAX_REGISTRATION_PENDING', 'VEHICLE_PENDING', 'INSURANCE_PENDING',
]
const VEHICLE_SELF_SERVICE_STATUSES = ['DRAFT', 'DOCUMENTS_PENDING', 'INSPECTION_PENDING']

function notFound(message, code) {
  const error = new Error(message)
  error.statusCode = 404
  error.code = code
  error.expose = true
  throw error
}

function forbidden(message, code) {
  const error = new Error(message)
  error.statusCode = 403
  error.code = code
  error.expose = true
  throw error
}

async function readUploadBody(req) {
  const body = await readJson(req)
  const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
  if (!fileBase64 || !mimeType) {
    const error = new Error('A document file is required.')
    error.statusCode = 400
    error.code = 'QUEBEC_DOCUMENT_REQUIRED'
    error.expose = true
    throw error
  }
  return { body, fileBase64, mimeType }
}

export async function handleQuebecDriverOnboarding(req, res, url, context) {
  // ---- Driver: own onboarding record ----
  if (url.pathname === '/api/driver/quebec-onboarding') {
    requireAuth(context, ['DRIVER'])
    if (req.method === 'GET') {
      const record = await ensureQuebecDriverOnboarding(db(), context.user.id)
      return json(res, 200, { ok: true, onboarding: redactQuebecDriverOnboarding(record) })
    }
    if (req.method === 'PATCH') {
      const body = await readJson(req)
      const record = await ensureQuebecDriverOnboarding(db(), context.user.id)
      if (!DRIVER_SELF_SERVICE_STATUSES.includes(record.status)) {
        const error = new Error(`Cannot edit onboarding details while status is ${record.status}.`)
        error.statusCode = 409
        error.code = 'QUEBEC_ONBOARDING_NOT_EDITABLE'
        error.expose = true
        throw error
      }
      if (typeof body.licenseNumber === 'string' && body.licenseNumber.trim()) {
        await setQuebecDriverLicenseNumber(db(), context.user.id, body.licenseNumber.trim())
      }
      if (typeof body.legalName === 'string' && body.legalName.trim()) {
        await setQuebecDriverLegalName(db(), context.user.id, body.legalName.trim())
      }
      const data = {}
      if (typeof body.licenseClass === 'string' && body.licenseClass.trim()) data.licenseClass = body.licenseClass.trim()
      if (body.licenseExpiresAt) data.licenseExpiresAt = new Date(body.licenseExpiresAt)
      if (body.policeCheckExpiresAt) data.policeCheckExpiresAt = new Date(body.policeCheckExpiresAt)
      if (body.trainingCompletedAt) data.trainingCompletedAt = new Date(body.trainingCompletedAt)
      const updated = Object.keys(data).length
        ? await db().quebecDriverOnboarding.update({ where: { userId: context.user.id }, data: { ...data, version: { increment: 1 } } })
        : await db().quebecDriverOnboarding.findUnique({ where: { userId: context.user.id } })
      return json(res, 200, { ok: true, onboarding: redactQuebecDriverOnboarding(updated) })
    }
    return methodNotAllowed(res, ['GET', 'PATCH'])
  }

  // Driver self-attestation confirmations -- checkbox-style, independently timestamped.
  const attestationMatch = url.pathname.match(/^\/api\/driver\/quebec-onboarding\/confirm\/(age-eligibility|driving-experience|french-attestation)$/)
  if (attestationMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['DRIVER'])
    await ensureQuebecDriverOnboarding(db(), context.user.id)
    const key = { 'age-eligibility': 'ageEligibility', 'driving-experience': 'drivingExperience', 'french-attestation': 'frenchLanguage' }[attestationMatch[1]]
    const updated = await confirmQuebecDriverAttestation(db(), context.user.id, key)
    return json(res, 200, { ok: true, onboarding: redactQuebecDriverOnboarding(updated) })
  }

  // Driver self-service: advance to the next pending stage. Never reaches ADMIN_REVIEW's onward
  // transitions (approve/reject/activate) -- those are admin-only, below.
  if (url.pathname === '/api/driver/quebec-onboarding/submit') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['DRIVER'])
    const record = await ensureQuebecDriverOnboarding(db(), context.user.id)
    if (!DRIVER_SELF_SERVICE_STATUSES.includes(record.status)) {
      const error = new Error(`Status ${record.status} cannot be advanced by the driver -- it requires admin review.`)
      error.statusCode = 409
      error.code = 'QUEBEC_ONBOARDING_NOT_SELF_SERVICE'
      error.expose = true
      throw error
    }
    const nextStatus = DRIVER_STATUS_TRANSITIONS[record.status][0]
    const updated = await transitionDriverOnboardingStatus(db(), { userId: context.user.id, toStatus: nextStatus, actorId: context.user.id })
    return json(res, 200, { ok: true, onboarding: redactQuebecDriverOnboarding(updated) })
  }

  // ---- Driver: own compliance documents ----
  if (url.pathname === '/api/driver/quebec-onboarding/documents') {
    requireAuth(context, ['DRIVER'])
    if (req.method === 'POST') {
      const { body, fileBase64, mimeType } = await readUploadBody(req)
      const type = String(body.type || '')
      if (!QUEBEC_DRIVER_DOCUMENT_TYPES.includes(type)) {
        const error = new Error(`type must be one of: ${QUEBEC_DRIVER_DOCUMENT_TYPES.join(', ')}.`)
        error.statusCode = 400
        error.code = 'QUEBEC_DOCUMENT_TYPE_INVALID'
        error.expose = true
        throw error
      }
      await ensureQuebecDriverOnboarding(db(), context.user.id)
      const assetUrl = await saveQuebecDocument(fileBase64, mimeType)
      const document = await uploadQuebecDocument(db(), 'driver', {
        ownerId: context.user.id, type, assetUrl, mimeType,
        issuer: body.issuer, issuedAt: body.issuedAt, expiresAt: body.expiresAt,
      })
      return json(res, 201, { ok: true, document })
    }
    if (req.method === 'GET') {
      const documents = await listCurrentQuebecDocuments(db(), 'driver', context.user.id)
      return json(res, 200, { ok: true, documents })
    }
    return methodNotAllowed(res, ['POST', 'GET'])
  }

  const driverDocHistoryMatch = url.pathname.match(/^\/api\/driver\/quebec-onboarding\/documents\/([^/]+)\/history$/)
  if (driverDocHistoryMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['DRIVER'])
    const type = driverDocHistoryMatch[1]
    const documents = await listQuebecDocumentHistory(db(), 'driver', context.user.id, type)
    return json(res, 200, { ok: true, documents })
  }

  const driverDocFileMatch = url.pathname.match(/^\/api\/driver\/quebec-onboarding\/documents\/([^/]+)\/file$/)
  if (driverDocFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const document = await db().quebecDriverDocument.findUnique({
      where: { id: driverDocFileMatch[1] }, select: { onboardingUserId: true, assetUrl: true, mimeType: true },
    })
    if (!document) notFound('Document not found.', 'QUEBEC_DOCUMENT_NOT_FOUND')
    const isOwner = document.onboardingUserId === context.user.id
    const isStaff = context.roles.includes('ADMIN') || context.roles.includes('SUPPORT')
    if (!isOwner && !isStaff) forbidden('This document is not available for this account.', 'QUEBEC_DOCUMENT_FORBIDDEN')
    if (!document.assetUrl) notFound('This document version has been deleted (retention purge).', 'QUEBEC_DOCUMENT_DELETED')
    const buffer = await readQuebecDocument(document.assetUrl)
    res.writeHead(200, { 'content-type': document.mimeType || 'application/octet-stream', 'cache-control': 'private, no-store' })
    res.end(buffer)
    return true
  }

  // ---- Admin: list + review driver onboarding ----
  if (url.pathname === '/api/admin/quebec-onboarding') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const statusFilter = url.searchParams.get('status')
    const records = await db().quebecDriverOnboarding.findMany({
      where: statusFilter ? { status: statusFilter } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { driverProfile: { select: { userId: true, country: true, active: true } } },
    })
    return json(res, 200, { ok: true, onboardings: records.map(redactQuebecDriverOnboarding) })
  }

  // Admin: platform-wide compliance summary across driver + vehicle onboarding and their documents.
  if (url.pathname === '/api/admin/quebec-onboarding/compliance-summary') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    await markExpiredQuebecDocuments(db())
    const [driverStatusCounts, vehicleStatusCounts, driverDocStatusCounts, vehicleDocStatusCounts, driverDocLegalHolds, vehicleDocLegalHolds] = await Promise.all([
      db().quebecDriverOnboarding.groupBy({ by: ['status'], _count: { _all: true } }),
      db().quebecVehicleOnboarding.groupBy({ by: ['status'], _count: { _all: true } }),
      db().quebecDriverDocument.groupBy({ by: ['status'], where: { isCurrent: true }, _count: { _all: true } }),
      db().quebecVehicleDocument.groupBy({ by: ['status'], where: { isCurrent: true }, _count: { _all: true } }),
      db().quebecDriverDocument.count({ where: { legalHold: true } }),
      db().quebecVehicleDocument.count({ where: { legalHold: true } }),
    ])
    return json(res, 200, {
      ok: true,
      summary: {
        driversByStatus: Object.fromEntries(driverStatusCounts.map((r) => [r.status, r._count._all])),
        vehiclesByStatus: Object.fromEntries(vehicleStatusCounts.map((r) => [r.status, r._count._all])),
        driverDocumentsByStatus: Object.fromEntries(driverDocStatusCounts.map((r) => [r.status, r._count._all])),
        vehicleDocumentsByStatus: Object.fromEntries(vehicleDocStatusCounts.map((r) => [r.status, r._count._all])),
        driverDocumentsUnderLegalHold: driverDocLegalHolds,
        vehicleDocumentsUnderLegalHold: vehicleDocLegalHolds,
      },
    })
  }

  // Admin: current documents (driver + vehicle) expiring within 60 days, already expired, or pending
  // review -- the queue an admin actually needs to work from.
  if (url.pathname === '/api/admin/quebec-onboarding/expiring-documents') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const windowDays = Number(url.searchParams.get('windowDays') || 60)
    const now = new Date()
    const soon = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000)
    const [driverDocuments, vehicleDocuments] = await Promise.all([
      db().quebecDriverDocument.findMany({
        where: { isCurrent: true, deletedAt: null, OR: [{ expiresAt: { lte: soon } }, { status: 'PENDING_REVIEW' }] },
        select: { id: true, onboardingUserId: true, type: true, status: true, expiresAt: true, legalHold: true },
        orderBy: { expiresAt: 'asc' },
      }),
      db().quebecVehicleDocument.findMany({
        where: { isCurrent: true, deletedAt: null, OR: [{ expiresAt: { lte: soon } }, { status: 'PENDING_REVIEW' }] },
        select: { id: true, onboardingVehicleId: true, type: true, status: true, expiresAt: true, legalHold: true },
        orderBy: { expiresAt: 'asc' },
      }),
    ])
    return json(res, 200, { ok: true, driverDocuments, vehicleDocuments })
  }

  // Admin: retention purge (secure-deletion queue) for both document kinds -- mirrors the
  // ListingDocument purge job's "run on the next relevant read" design; safe to also expose as an
  // explicit action for the admin dashboard to trigger.
  if (url.pathname === '/api/admin/quebec-onboarding/purge-expired-documents') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const purgedCount = await purgeExpiredQuebecDocuments(db(), { actorId: context.user.id })
    return json(res, 200, { ok: true, purgedCount })
  }

  const driverAuditHistoryMatch = url.pathname.match(/^\/api\/admin\/quebec-onboarding\/([^/]+)\/audit-history$/)
  if (driverAuditHistoryMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const userId = driverAuditHistoryMatch[1]
    const onboarding = await db().quebecDriverOnboarding.findUnique({ where: { userId }, select: { id: true } })
    if (!onboarding) notFound('No Québec onboarding record for this driver.', 'QUEBEC_DRIVER_ONBOARDING_NOT_FOUND')
    const documents = await db().quebecDriverDocument.findMany({ where: { onboardingUserId: userId }, select: { id: true } })
    const entityIds = [onboarding.id, ...documents.map((d) => d.id)]
    const events = await db().adminAuditLog.findMany({
      where: { entityId: { in: entityIds } }, orderBy: { createdAt: 'desc' }, take: 200,
    })
    return json(res, 200, { ok: true, events })
  }

  const driverAssignReviewerMatch = url.pathname.match(/^\/api\/admin\/quebec-onboarding\/([^/]+)\/assign-reviewer$/)
  if (driverAssignReviewerMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const updated = await assignQuebecDriverReviewer(db(), driverAssignReviewerMatch[1], { reviewerId: body.reviewerId || null, actorId: context.user.id })
    return json(res, 200, { ok: true, onboarding: redactQuebecDriverOnboarding(updated) })
  }

  const driverComplianceItemMatch = url.pathname.match(/^\/api\/admin\/quebec-onboarding\/([^/]+)\/compliance-item$/)
  if (driverComplianceItemMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const updated = await setQuebecDriverComplianceItemStatus(db(), driverComplianceItemMatch[1], String(body.field || ''), String(body.status || ''), context.user.id)
    return json(res, 200, { ok: true, onboarding: redactQuebecDriverOnboarding(updated) })
  }

  const driverDocReviewMatch = url.pathname.match(/^\/api\/admin\/quebec-onboarding\/documents\/([^/]+)\/review$/)
  if (driverDocReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const document = await reviewQuebecDocument(db(), 'driver', driverDocReviewMatch[1], {
      status: String(body.status || ''), reviewerId: context.user.id, rejectionReason: body.rejectionReason,
    })
    return json(res, 200, { ok: true, document })
  }

  const driverDocLegalHoldMatch = url.pathname.match(/^\/api\/admin\/quebec-onboarding\/documents\/([^/]+)\/legal-hold$/)
  if (driverDocLegalHoldMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const document = await setQuebecDocumentLegalHold(db(), 'driver', driverDocLegalHoldMatch[1], {
      hold: body.hold === true, reason: typeof body.reason === 'string' ? body.reason : '', actorId: context.user.id,
    })
    return json(res, 200, { ok: true, document })
  }

  const driverDetailMatch = url.pathname.match(/^\/api\/admin\/quebec-onboarding\/([^/]+)$/)
  if (driverDetailMatch) {
    const userId = driverDetailMatch[1]
    if (req.method === 'GET') {
      requireAuth(context, ['ADMIN', 'SUPPORT'])
      const record = await db().quebecDriverOnboarding.findUnique({ where: { userId } })
      if (!record) notFound('No Québec onboarding record for this driver.', 'QUEBEC_DRIVER_ONBOARDING_NOT_FOUND')
      return json(res, 200, { ok: true, onboarding: redactQuebecDriverOnboarding(record) })
    }
    if (req.method === 'PATCH') {
      requireAuth(context, ['ADMIN'])
      const body = await readJson(req)
      const updated = await transitionDriverOnboardingStatus(db(), {
        userId, toStatus: String(body.status || ''), actorId: context.user.id, reason: body.reason,
      })
      return json(res, 200, { ok: true, onboarding: redactQuebecDriverOnboarding(updated) })
    }
    return methodNotAllowed(res, ['GET', 'PATCH'])
  }

  // ---- Driver: own vehicle onboarding record ----
  const vehicleOwnMatch = url.pathname.match(/^\/api\/driver\/quebec-vehicle-onboarding\/([^/]+)$/)
  if (vehicleOwnMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['DRIVER'])
    const vehicle = await db().driverVehicle.findFirst({ where: { id: vehicleOwnMatch[1], driverId: context.user.id } })
    if (!vehicle) notFound('Vehicle not found for this account.', 'DRIVER_VEHICLE_NOT_FOUND')
    const record = await ensureQuebecVehicleOnboarding(db(), vehicle.id)
    return json(res, 200, { ok: true, onboarding: redactQuebecVehicleOnboarding(record) })
  }

  const vehicleDetailsPatchMatch = url.pathname.match(/^\/api\/driver\/quebec-vehicle-onboarding\/([^/]+)\/details$/)
  if (vehicleDetailsPatchMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['DRIVER'])
    const vehicle = await db().driverVehicle.findFirst({ where: { id: vehicleDetailsPatchMatch[1], driverId: context.user.id } })
    if (!vehicle) notFound('Vehicle not found for this account.', 'DRIVER_VEHICLE_NOT_FOUND')
    const body = await readJson(req)
    await ensureQuebecVehicleOnboarding(db(), vehicle.id)
    if (typeof body.vin === 'string' && body.vin.trim()) await setQuebecVehicleVin(db(), vehicle.id, body.vin.trim())
    const updated = await setQuebecVehicleDetails(db(), vehicle.id, {
      odometerKm: typeof body.odometerKm === 'number' ? body.odometerKm : undefined,
      doorCount: typeof body.doorCount === 'number' ? body.doorCount : undefined,
      seatCount: typeof body.seatCount === 'number' ? body.seatCount : undefined,
      accessibilityInfo: body.accessibilityInfo !== undefined ? body.accessibilityInfo : undefined,
    })
    return json(res, 200, { ok: true, onboarding: redactQuebecVehicleOnboarding(updated) })
  }

  const vehicleSubmitMatch = url.pathname.match(/^\/api\/driver\/quebec-vehicle-onboarding\/([^/]+)\/submit$/)
  if (vehicleSubmitMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['DRIVER'])
    const vehicle = await db().driverVehicle.findFirst({ where: { id: vehicleSubmitMatch[1], driverId: context.user.id } })
    if (!vehicle) notFound('Vehicle not found for this account.', 'DRIVER_VEHICLE_NOT_FOUND')
    const record = await ensureQuebecVehicleOnboarding(db(), vehicle.id)
    if (!VEHICLE_SELF_SERVICE_STATUSES.includes(record.status)) {
      const error = new Error(`Status ${record.status} cannot be advanced by the driver -- it requires admin review.`)
      error.statusCode = 409
      error.code = 'QUEBEC_ONBOARDING_NOT_SELF_SERVICE'
      error.expose = true
      throw error
    }
    const nextStatus = VEHICLE_STATUS_TRANSITIONS[record.status][0]
    const updated = await transitionVehicleOnboardingStatus(db(), { vehicleId: vehicle.id, toStatus: nextStatus, actorId: context.user.id })
    return json(res, 200, { ok: true, onboarding: redactQuebecVehicleOnboarding(updated) })
  }

  // ---- Driver: own vehicle's compliance documents ----
  const vehicleDocsMatch = url.pathname.match(/^\/api\/driver\/quebec-vehicle-onboarding\/([^/]+)\/documents$/)
  if (vehicleDocsMatch) {
    requireAuth(context, ['DRIVER'])
    const vehicle = await db().driverVehicle.findFirst({ where: { id: vehicleDocsMatch[1], driverId: context.user.id } })
    if (!vehicle) notFound('Vehicle not found for this account.', 'DRIVER_VEHICLE_NOT_FOUND')
    if (req.method === 'POST') {
      const { body, fileBase64, mimeType } = await readUploadBody(req)
      const type = String(body.type || '')
      if (!QUEBEC_VEHICLE_DOCUMENT_TYPES.includes(type)) {
        const error = new Error(`type must be one of: ${QUEBEC_VEHICLE_DOCUMENT_TYPES.join(', ')}.`)
        error.statusCode = 400
        error.code = 'QUEBEC_DOCUMENT_TYPE_INVALID'
        error.expose = true
        throw error
      }
      await ensureQuebecVehicleOnboarding(db(), vehicle.id)
      const assetUrl = await saveQuebecDocument(fileBase64, mimeType)
      const document = await uploadQuebecDocument(db(), 'vehicle', {
        ownerId: vehicle.id, type, assetUrl, mimeType,
        issuer: body.issuer, issuedAt: body.issuedAt, expiresAt: body.expiresAt,
      })
      return json(res, 201, { ok: true, document })
    }
    if (req.method === 'GET') {
      const documents = await listCurrentQuebecDocuments(db(), 'vehicle', vehicle.id)
      return json(res, 200, { ok: true, documents })
    }
    return methodNotAllowed(res, ['POST', 'GET'])
  }

  const vehicleDocFileMatch = url.pathname.match(/^\/api\/driver\/quebec-vehicle-onboarding\/documents\/([^/]+)\/file$/)
  if (vehicleDocFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const document = await db().quebecVehicleDocument.findUnique({
      where: { id: vehicleDocFileMatch[1] },
      select: { onboardingVehicleId: true, assetUrl: true, mimeType: true, onboarding: { select: { vehicle: { select: { driverId: true } } } } },
    })
    if (!document) notFound('Document not found.', 'QUEBEC_DOCUMENT_NOT_FOUND')
    const isOwner = document.onboarding?.vehicle?.driverId === context.user.id
    const isStaff = context.roles.includes('ADMIN') || context.roles.includes('SUPPORT')
    if (!isOwner && !isStaff) forbidden('This document is not available for this account.', 'QUEBEC_DOCUMENT_FORBIDDEN')
    if (!document.assetUrl) notFound('This document version has been deleted (retention purge).', 'QUEBEC_DOCUMENT_DELETED')
    const buffer = await readQuebecDocument(document.assetUrl)
    res.writeHead(200, { 'content-type': document.mimeType || 'application/octet-stream', 'cache-control': 'private, no-store' })
    res.end(buffer)
    return true
  }

  // ---- Admin: list + review vehicle onboarding ----
  if (url.pathname === '/api/admin/quebec-vehicle-onboarding') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const statusFilter = url.searchParams.get('status')
    const records = await db().quebecVehicleOnboarding.findMany({
      where: statusFilter ? { status: statusFilter } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { vehicle: { select: { id: true, make: true, model: true, year: true, plate: true, driverId: true } } },
    })
    return json(res, 200, { ok: true, onboardings: records.map(redactQuebecVehicleOnboarding) })
  }

  const vehicleAuditHistoryMatch = url.pathname.match(/^\/api\/admin\/quebec-vehicle-onboarding\/([^/]+)\/audit-history$/)
  if (vehicleAuditHistoryMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const vehicleId = vehicleAuditHistoryMatch[1]
    const onboarding = await db().quebecVehicleOnboarding.findUnique({ where: { vehicleId }, select: { id: true } })
    if (!onboarding) notFound('No Québec onboarding record for this vehicle.', 'QUEBEC_VEHICLE_ONBOARDING_NOT_FOUND')
    const documents = await db().quebecVehicleDocument.findMany({ where: { onboardingVehicleId: vehicleId }, select: { id: true } })
    const entityIds = [onboarding.id, ...documents.map((d) => d.id)]
    const events = await db().adminAuditLog.findMany({
      where: { entityId: { in: entityIds } }, orderBy: { createdAt: 'desc' }, take: 200,
    })
    return json(res, 200, { ok: true, events })
  }

  const vehicleAssignReviewerMatch = url.pathname.match(/^\/api\/admin\/quebec-vehicle-onboarding\/([^/]+)\/assign-reviewer$/)
  if (vehicleAssignReviewerMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const updated = await assignQuebecVehicleReviewer(db(), vehicleAssignReviewerMatch[1], { reviewerId: body.reviewerId || null, actorId: context.user.id })
    return json(res, 200, { ok: true, onboarding: redactQuebecVehicleOnboarding(updated) })
  }

  const vehicleDocReviewMatch = url.pathname.match(/^\/api\/admin\/quebec-vehicle-onboarding\/documents\/([^/]+)\/review$/)
  if (vehicleDocReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const document = await reviewQuebecDocument(db(), 'vehicle', vehicleDocReviewMatch[1], {
      status: String(body.status || ''), reviewerId: context.user.id, rejectionReason: body.rejectionReason,
    })
    return json(res, 200, { ok: true, document })
  }

  const vehicleDocLegalHoldMatch = url.pathname.match(/^\/api\/admin\/quebec-vehicle-onboarding\/documents\/([^/]+)\/legal-hold$/)
  if (vehicleDocLegalHoldMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const document = await setQuebecDocumentLegalHold(db(), 'vehicle', vehicleDocLegalHoldMatch[1], {
      hold: body.hold === true, reason: typeof body.reason === 'string' ? body.reason : '', actorId: context.user.id,
    })
    return json(res, 200, { ok: true, document })
  }

  const vehicleDetailMatch = url.pathname.match(/^\/api\/admin\/quebec-vehicle-onboarding\/([^/]+)$/)
  if (vehicleDetailMatch) {
    const vehicleId = vehicleDetailMatch[1]
    if (req.method === 'GET') {
      requireAuth(context, ['ADMIN', 'SUPPORT'])
      const record = await db().quebecVehicleOnboarding.findUnique({ where: { vehicleId } })
      if (!record) notFound('No Québec onboarding record for this vehicle.', 'QUEBEC_VEHICLE_ONBOARDING_NOT_FOUND')
      return json(res, 200, { ok: true, onboarding: redactQuebecVehicleOnboarding(record) })
    }
    if (req.method === 'PATCH') {
      requireAuth(context, ['ADMIN'])
      const body = await readJson(req)
      const updated = await transitionVehicleOnboardingStatus(db(), {
        vehicleId, toStatus: String(body.status || ''), actorId: context.user.id, reason: body.reason,
      })
      return json(res, 200, { ok: true, onboarding: redactQuebecVehicleOnboarding(updated) })
    }
    return methodNotAllowed(res, ['GET', 'PATCH'])
  }

  return false
}
