import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { assertBoundedString } from '../lib/validate.mjs'
import { buildRideStatement, renderRideStatementDocument, resolveStatementPeriod } from '../lib/ride-statements.mjs'
import { buildStayStatement, renderStayStatementDocument } from '../lib/stay-statements.mjs'
import {
  KNOWN_FLAGS,
  RIDE_GOVERNMENT_REMITTANCE_ACTIVE,
  isFeatureEnabled,
  listFeatureFlags,
  setFeatureFlag,
} from '../lib/compliance-feature-flags.mjs'
import {
  createCorrectionFiling,
  createDraftFiling,
  generatePartXXRecords,
  markFiled,
  recordCraResponse,
  renderPartXXAnnualStatement,
  validateFiling,
} from '../lib/part-xx.mjs'
import { upsertCommissionPolicy, upsertTaxRate } from '../lib/jurisdiction-pricing.mjs'
import {
  getOperationalDocumentStatuses,
  markExpiredListingDocuments,
  purgeExpiredListingDocuments,
} from '../lib/listing-document-retention.mjs'

function parsePeriodParams(params) {
  const periodType = String(params.get('periodType') || 'ANNUAL').toUpperCase()
  const year = params.get('year') ? Number(params.get('year')) : undefined
  const month = params.get('month') ? Number(params.get('month')) : undefined
  const quarter = params.get('quarter') ? Number(params.get('quarter')) : undefined
  if (periodType === 'TRANSACTION') {
    const from = params.get('from')
    const to = params.get('to')
    if (!from || !to) {
      const error = new Error('TRANSACTION statements require explicit from/to query params (ISO dates).')
      error.statusCode = 400
      error.code = 'STATEMENT_RANGE_REQUIRED'
      error.expose = true
      throw error
    }
    return { periodType, periodStart: new Date(from), periodEnd: new Date(to) }
  }
  const { periodStart, periodEnd } = resolveStatementPeriod(periodType, { year, month, quarter })
  return { periodType, periodStart, periodEnd }
}

function wantsDocument(params) {
  return params.get('format') === 'document'
}

export async function handleCompliance(req, res, url, context) {
  // ---- Driver: own SR earnings/tax statement ----
  if (url.pathname === '/api/driver/statements') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['DRIVER'])
    const { periodType, periodStart, periodEnd } = parsePeriodParams(url.searchParams)
    const rideGovernmentRemittanceActive = await isFeatureEnabled(db(), RIDE_GOVERNMENT_REMITTANCE_ACTIVE)
    const statement = await buildRideStatement(db(), { driverId: context.user.id, periodType, periodStart, periodEnd, rideGovernmentRemittanceActive })
    if (wantsDocument(url.searchParams)) {
      const lang = url.searchParams.get('lang') === 'fr' ? 'fr' : 'en'
      const document = renderRideStatementDocument(statement, { lang, driverName: context.user.displayName })
      return json(res, 200, { ok: true, statement, document })
    }
    return json(res, 200, { ok: true, statement })
  }

  // ---- Host: own Stay earnings/tax statement ----
  if (url.pathname === '/api/host/statements') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['HOST'])
    const { periodType, periodStart, periodEnd } = parsePeriodParams(url.searchParams)
    const statement = await buildStayStatement(db(), { hostId: context.user.id, periodType, periodStart, periodEnd })
    if (wantsDocument(url.searchParams)) {
      const lang = url.searchParams.get('lang') === 'fr' ? 'fr' : 'en'
      const document = renderStayStatementDocument(statement, { lang, hostName: context.user.displayName })
      return json(res, 200, { ok: true, statement, document })
    }
    return json(res, 200, { ok: true, statement })
  }

  // ---- Admin: any driver's SR statement ----
  const adminRideStatementMatch = url.pathname.match(/^\/api\/admin\/statements\/ride\/([^/]+)$/)
  if (adminRideStatementMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const driver = await db().user.findFirst({ where: { id: adminRideStatementMatch[1], roles: { some: { role: 'DRIVER' } } } })
    if (!driver) {
      const error = new Error('Driver not found.')
      error.statusCode = 404
      error.code = 'DRIVER_NOT_FOUND'
      error.expose = true
      throw error
    }
    const { periodType, periodStart, periodEnd } = parsePeriodParams(url.searchParams)
    const rideGovernmentRemittanceActive = await isFeatureEnabled(db(), RIDE_GOVERNMENT_REMITTANCE_ACTIVE)
    const statement = await buildRideStatement(db(), { driverId: driver.id, periodType, periodStart, periodEnd, rideGovernmentRemittanceActive })
    if (wantsDocument(url.searchParams)) {
      const lang = url.searchParams.get('lang') === 'fr' ? 'fr' : 'en'
      const document = renderRideStatementDocument(statement, { lang, driverName: driver.displayName })
      return json(res, 200, { ok: true, statement, document })
    }
    return json(res, 200, { ok: true, statement })
  }

  // ---- Admin: any host's Stay statement ----
  const adminStayStatementMatch = url.pathname.match(/^\/api\/admin\/statements\/stay\/([^/]+)$/)
  if (adminStayStatementMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const host = await db().user.findFirst({ where: { id: adminStayStatementMatch[1], roles: { some: { role: 'HOST' } } } })
    if (!host) {
      const error = new Error('Host not found.')
      error.statusCode = 404
      error.code = 'HOST_NOT_FOUND'
      error.expose = true
      throw error
    }
    const { periodType, periodStart, periodEnd } = parsePeriodParams(url.searchParams)
    const statement = await buildStayStatement(db(), { hostId: host.id, periodType, periodStart, periodEnd })
    if (wantsDocument(url.searchParams)) {
      const lang = url.searchParams.get('lang') === 'fr' ? 'fr' : 'en'
      const document = renderStayStatementDocument(statement, { lang, hostName: host.displayName })
      return json(res, 200, { ok: true, statement, document })
    }
    return json(res, 200, { ok: true, statement })
  }

  // ---- Admin: compliance feature flags (ride government remittance, Stay tax platform collection) ----
  if (url.pathname === '/api/admin/compliance-flags') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const flags = await listFeatureFlags(db())
    return json(res, 200, { ok: true, flags })
  }

  const flagMatch = url.pathname.match(/^\/api\/admin\/compliance-flags\/([^/]+)$/)
  if (flagMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const key = flagMatch[1]
    if (!KNOWN_FLAGS.includes(key)) {
      const error = new Error(`${key} is not a recognized compliance feature flag.`)
      error.statusCode = 404
      error.code = 'COMPLIANCE_FLAG_UNKNOWN'
      error.expose = true
      throw error
    }
    const body = await readJson(req)
    const enabled = body.enabled === true
    const note = assertBoundedString(body.note, { fieldName: 'note', maxLength: 500 }) || null

    const before = await db().complianceFeatureFlag.findUnique({ where: { key } })
    const updated = await db().$transaction(async (tx) => {
      const flag = await setFeatureFlag(tx, { key, enabled, note, actorId: context.user.id })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `COMPLIANCE_FLAG_${enabled ? 'ENABLED' : 'DISABLED'}`,
          entityType: 'compliance_feature_flags',
          entityId: flag.id,
          before: { enabled: before?.enabled ?? false },
          after: { enabled, note },
        },
      })
      return flag
    })
    return json(res, 200, { ok: true, flag: updated })
  }

  // ---- Seller (driver or host): own Part XX Annual Platform Statement, available on demand for any
  // completed year -- satisfies "annual seller copy available by January 31" since there's no
  // gating delay, the aggregated data is queryable as soon as the year's records exist. ----
  if (url.pathname === '/api/driver/part-xx-statement' || url.pathname === '/api/host/part-xx-statement') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const isDriver = url.pathname.startsWith('/api/driver')
    requireAuth(context, [isDriver ? 'DRIVER' : 'HOST'])
    const year = Number(url.searchParams.get('year')) || new Date().getUTCFullYear() - 1
    const records = await db().partXXRecord.findMany({ where: { sellerId: context.user.id, year } })
    const lang = url.searchParams.get('lang') === 'fr' ? 'fr' : 'en'
    const document = renderPartXXAnnualStatement(records, { year, lang, sellerName: context.user.displayName })
    return json(res, 200, { ok: true, records, document })
  }

  // ---- Admin: generate this quarter's Part XX records from the ledger ----
  if (url.pathname === '/api/admin/part-xx/generate') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const year = Number(body.year)
    const quarter = Number(body.quarter)
    const records = await generatePartXXRecords(db(), { year, quarter })
    return json(res, 200, { ok: true, records })
  }

  // ---- Admin: list Part XX records (compliance dashboard reads this) ----
  if (url.pathname === '/api/admin/part-xx/records') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const params = url.searchParams
    const where = {
      ...(params.get('year') ? { year: Number(params.get('year')) } : {}),
      ...(params.get('quarter') ? { quarter: Number(params.get('quarter')) } : {}),
      ...(params.get('status') ? { status: params.get('status') } : {}),
    }
    const records = await db().partXXRecord.findMany({ where, include: { seller: { select: { id: true, displayName: true, email: true } } }, orderBy: [{ year: 'desc' }, { quarter: 'desc' }], take: 1000 })
    return json(res, 200, { ok: true, records })
  }

  // ---- Admin: list Part XX filings ----
  if (url.pathname === '/api/admin/part-xx/filings') {
    if (req.method === 'GET') {
      requireAuth(context, ['ADMIN', 'SUPPORT'])
      const params = url.searchParams
      const where = {
        ...(params.get('year') ? { year: Number(params.get('year')) } : {}),
        ...(params.get('quarter') ? { quarter: Number(params.get('quarter')) } : {}),
      }
      const filings = await db().partXXFiling.findMany({ where, include: { records: { select: { id: true } } }, orderBy: { createdAt: 'desc' }, take: 200 })
      return json(res, 200, { ok: true, filings: filings.map((f) => ({ ...f, recordCount: f.records.length, records: undefined })) })
    }
    if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const filing = await createDraftFiling(db(), { year: Number(body.year), quarter: Number(body.quarter) })
    return json(res, 200, { ok: true, filing })
  }

  const validateMatch = url.pathname.match(/^\/api\/admin\/part-xx\/filings\/([^/]+)\/validate$/)
  if (validateMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const filing = await validateFiling(db(), validateMatch[1])
    return json(res, 200, { ok: true, filing })
  }

  const fileMatch = url.pathname.match(/^\/api\/admin\/part-xx\/filings\/([^/]+)\/file$/)
  if (fileMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const filing = await markFiled(db(), fileMatch[1], { actorId: context.user.id })
    return json(res, 200, { ok: true, filing })
  }

  const responseMatch = url.pathname.match(/^\/api\/admin\/part-xx\/filings\/([^/]+)\/response$/)
  if (responseMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const filing = await recordCraResponse(db(), responseMatch[1], { status: String(body.status || '').toUpperCase(), craResponse: body.craResponse || null, actorId: context.user.id })
    return json(res, 200, { ok: true, filing })
  }

  const correctMatch = url.pathname.match(/^\/api\/admin\/part-xx\/filings\/([^/]+)\/correct$/)
  if (correctMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const reason = assertBoundedString(body.reason, { fieldName: 'reason', maxLength: 500 })
    const correction = await createCorrectionFiling(db(), { originalFilingId: correctMatch[1], actorId: context.user.id, reason })
    return json(res, 200, { ok: true, filing: correction })
  }

  // ---- Admin: compliance dashboard -- one call, everything item F asks for ----
  if (url.pathname === '/api/admin/compliance-dashboard') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    // Housekeeping runs on the next relevant read (same pattern as expireOldListings() in
    // listing-lifecycle.mjs) -- there is no cron in this codebase. First flag stale certificates as
    // EXPIRED, then purge anything whose one-year-post-expiry retention window has passed (unless a
    // legal hold blocks it). actorId is null because these are system actions, not an admin click.
    await markExpiredListingDocuments(db())
    const retentionPurgedCount = await purgeExpiredListingDocuments(db(), { actorId: null })

    const [
      totalDrivers, totalHosts, driverProfiles, hostProfiles,
      quebecDriverIds, partXXStatusCounts, recentFilings, flags, jurisdictionProfiles, quebecListings,
    ] = await Promise.all([
      db().user.count({ where: { roles: { some: { role: 'DRIVER' } }, status: 'ACTIVE' } }),
      db().user.count({ where: { roles: { some: { role: 'HOST' } }, status: 'ACTIVE' } }),
      db().taxProfile.findMany({ where: { subjectType: 'DRIVER' }, select: { userId: true, verificationStatus: true, gstRegistered: true, qstRegistered: true } }),
      db().taxProfile.findMany({ where: { subjectType: 'HOST' }, select: { userId: true, verificationStatus: true, gstQstTreatment: true } }),
      db().driverProfile.findMany({ where: { country: 'CA' }, select: { userId: true } }),
      db().partXXRecord.groupBy({ by: ['status'], _count: { _all: true } }),
      db().partXXFiling.findMany({ orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, year: true, quarter: true, status: true, submittedAt: true, acceptedAt: true } }),
      listFeatureFlags(db()),
      db().jurisdictionComplianceProfile.findMany({ where: { countryCode: 'CA' } }),
      db().listing.findMany({
        where: { division: 'STAYS', status: { in: ['APPROVED', 'PENDING_REVIEW'] } },
        select: { id: true, titleAr: true, titleEn: true, metadata: true },
      }),
    ])

    const quebecListingIds = quebecListings.filter((l) => l.metadata?.country === 'CA').map((l) => l.id)
    const listingDocuments = quebecListingIds.length
      ? await db().listingDocument.findMany({
          where: { listingId: { in: quebecListingIds }, type: 'CITQ_CERTIFICATE', isCurrent: true },
          select: { id: true, listingId: true, status: true, legalHold: true, legalHoldReason: true, retentionDeleteAfter: true, deletedAt: true },
        })
      : []
    const documentByListing = new Map(listingDocuments.map((d) => [d.listingId, d]))

    const driverProfileByUser = new Map(driverProfiles.map((p) => [p.userId, p]))
    const hostProfileByUser = new Map(hostProfiles.map((p) => [p.userId, p]))
    const quebecDriverIdSet = new Set(quebecDriverIds.map((d) => d.userId))

    const driversMissingGstQst = [...quebecDriverIdSet].filter((id) => {
      const p = driverProfileByUser.get(id)
      return !p || !p.gstRegistered || !p.qstRegistered
    })

    const partXXStatusMap = Object.fromEntries(partXXStatusCounts.map((r) => [r.status, r._count._all]))

    // Jurisdiction pricing engine (030): a real query now that citqCertificateExpiresAt is actually
    // collected (SellerListingWizard.tsx) and enforced (listing-attributes.mjs, bookings.mjs).
    const EXPIRING_SOON_WINDOW_MS = 60 * 24 * 60 * 60 * 1000
    const now = Date.now()
    // Québec compliance review (item 1): an expiry-date-only check is no longer sufficient -- a
    // listing whose certificate FILE was never uploaded or never admin-approved is flagged too,
    // even when the self-entered expiry date looks fine.
    const certificateIssues = quebecListings
      .filter((l) => l.metadata?.country === 'CA')
      .map((l) => {
        const raw = l.metadata?.citqCertificateExpiresAt
        const expiresAt = raw ? new Date(raw) : null
        const valid = expiresAt && !Number.isNaN(expiresAt.getTime())
        const document = documentByListing.get(l.id)
        const documentStatus = document?.status || 'NOT_UPLOADED'
        const status = !valid
          ? 'MISSING'
          : expiresAt.getTime() <= now
            ? 'EXPIRED'
            : !getOperationalDocumentStatuses().includes(documentStatus)
              ? 'UNVERIFIED'
              : expiresAt.getTime() - now <= EXPIRING_SOON_WINDOW_MS
                ? 'EXPIRING_SOON'
                : null
        return status
          ? {
              listingId: l.id, title: l.titleEn || l.titleAr, status, expiresAt: valid ? expiresAt.toISOString() : null,
              documentStatus, documentId: document?.id || null, legalHold: document?.legalHold || false,
              legalHoldReason: document?.legalHoldReason || null, retentionDeleteAfter: document?.retentionDeleteAfter || null,
              documentDeleted: Boolean(document?.deletedAt),
            }
          : null
      })
      .filter(Boolean)

    const dashboard = {
      taxProfiles: {
        totalDrivers,
        totalHosts,
        driversWithoutProfile: totalDrivers - driverProfiles.length,
        hostsWithoutProfile: totalHosts - hostProfiles.length,
        driverPendingReview: driverProfiles.filter((p) => p.verificationStatus === 'PENDING_REVIEW').length,
        driverRejected: driverProfiles.filter((p) => p.verificationStatus === 'REJECTED').length,
        driverApproved: driverProfiles.filter((p) => p.verificationStatus === 'APPROVED').length,
        hostPendingReview: hostProfiles.filter((p) => p.verificationStatus === 'PENDING_REVIEW').length,
        hostRejected: hostProfiles.filter((p) => p.verificationStatus === 'REJECTED').length,
        hostApproved: hostProfiles.filter((p) => p.verificationStatus === 'APPROVED').length,
        hostsWithoutGstQstTreatmentDecision: hostProfiles.filter((p) => !p.gstQstTreatment).length,
      },
      // Quebec drivers must be GST/QST registered before their first paid ride (see
      // assertDriverGstQstRegisteredForQuebec, server/lib/tax-profile.mjs).
      driversMissingRequiredGstQst: { count: driversMissingGstQst.length, driverIds: driversMissingGstQst },
      expiringCertificates: { count: certificateIssues.length, listings: certificateIssues, retentionPurgedJustNow: retentionPurgedCount },
      partXXFilingReadiness: {
        recordsByStatus: { DRAFT: 0, VALIDATED: 0, FILED: 0, ACCEPTED: 0, REJECTED: 0, CORRECTED: 0, ...partXXStatusMap },
        recentFilings,
      },
      complianceFlags: flags,
      jurisdictionRegistrationStatus: jurisdictionProfiles.map((p) => ({
        division: p.division, regionCode: p.regionCode, status: p.status,
        transportSatisfied: p.transportSatisfied, tourismSatisfied: p.tourismSatisfied, taxSatisfied: p.taxSatisfied,
      })),
      generatedAt: new Date().toISOString(),
    }
    return json(res, 200, { ok: true, dashboard })
  }

  // ---- Admin: jurisdiction tax-rate configuration (list/create/update) ----
  if (url.pathname === '/api/admin/jurisdiction-pricing/tax-rates') {
    if (req.method === 'GET') {
      requireAuth(context, ['ADMIN', 'SUPPORT'])
      const params = url.searchParams
      const where = {
        ...(params.get('country') ? { country: params.get('country') } : {}),
        ...(params.get('province') ? { province: params.get('province') } : {}),
        ...(params.get('serviceType') ? { serviceType: params.get('serviceType') } : {}),
      }
      const rates = await db().jurisdictionTaxRate.findMany({ where, orderBy: [{ country: 'asc' }, { province: 'asc' }, { effectiveFrom: 'desc' }] })
      return json(res, 200, { ok: true, rates })
    }
    if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const rate = await upsertTaxRate(db(), {
      country: body.country, province: body.province || null, municipality: body.municipality || null,
      serviceType: body.serviceType, taxType: body.taxType, rateParts: Number(body.rateParts),
      calculationBase: body.calculationBase, collectorType: body.collectorType,
      roundingRule: body.roundingRule || 'ROUND_HALF_UP',
      effectiveFrom: new Date(body.effectiveFrom || Date.now()), effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
      active: body.active === true, legallyReviewedById: body.active === true ? context.user.id : null,
      sourceUrl: body.sourceUrl || null, note: assertBoundedString(body.note, { fieldName: 'note', maxLength: 500 }) || null,
    })
    await db().adminAuditLog.create({ data: { actorUserId: context.user.id, action: 'JURISDICTION_TAX_RATE_CREATED', entityType: 'jurisdiction_tax_rates', entityId: rate.id, before: null, after: rate } })
    return json(res, 200, { ok: true, rate })
  }

  const taxRateMatch = url.pathname.match(/^\/api\/admin\/jurisdiction-pricing\/tax-rates\/([^/]+)$/)
  if (taxRateMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const before = await db().jurisdictionTaxRate.findUnique({ where: { id: taxRateMatch[1] } })
    if (!before) {
      const error = new Error('Jurisdiction tax rate not found.')
      error.statusCode = 404
      error.code = 'JURISDICTION_TAX_RATE_NOT_FOUND'
      error.expose = true
      throw error
    }
    const body = await readJson(req)
    const rate = await upsertTaxRate(db(), {
      id: before.id,
      country: body.country ?? before.country, province: body.province !== undefined ? body.province : before.province,
      municipality: body.municipality !== undefined ? body.municipality : before.municipality,
      serviceType: body.serviceType ?? before.serviceType, taxType: body.taxType ?? before.taxType,
      rateParts: body.rateParts !== undefined ? Number(body.rateParts) : before.rateParts,
      calculationBase: body.calculationBase ?? before.calculationBase, collectorType: body.collectorType ?? before.collectorType,
      roundingRule: body.roundingRule ?? before.roundingRule,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : before.effectiveFrom,
      effectiveTo: body.effectiveTo !== undefined ? (body.effectiveTo ? new Date(body.effectiveTo) : null) : before.effectiveTo,
      active: body.active !== undefined ? body.active === true : before.active,
      legallyReviewedById: (body.active !== undefined ? body.active === true : before.active) ? context.user.id : null,
      sourceUrl: body.sourceUrl !== undefined ? body.sourceUrl : before.sourceUrl,
      note: body.note !== undefined ? assertBoundedString(body.note, { fieldName: 'note', maxLength: 500 }) : before.note,
    })
    await db().adminAuditLog.create({ data: { actorUserId: context.user.id, action: 'JURISDICTION_TAX_RATE_UPDATED', entityType: 'jurisdiction_tax_rates', entityId: rate.id, before, after: rate } })
    return json(res, 200, { ok: true, rate })
  }

  // ---- Admin: jurisdiction commission-policy configuration (list/create/update) ----
  if (url.pathname === '/api/admin/jurisdiction-pricing/commission-policies') {
    if (req.method === 'GET') {
      requireAuth(context, ['ADMIN', 'SUPPORT'])
      const params = url.searchParams
      const where = {
        ...(params.get('country') ? { country: params.get('country') } : {}),
        ...(params.get('province') ? { province: params.get('province') } : {}),
        ...(params.get('serviceType') ? { serviceType: params.get('serviceType') } : {}),
      }
      const policies = await db().jurisdictionCommissionPolicy.findMany({ where, orderBy: [{ effectiveFrom: 'desc' }] })
      return json(res, 200, { ok: true, policies })
    }
    if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const policy = await upsertCommissionPolicy(db(), {
      country: body.country || null, province: body.province || null, serviceType: body.serviceType,
      policyType: body.policyType, flatRateParts: body.flatRateParts !== undefined ? Number(body.flatRateParts) : null,
      tiers: body.tiers || null,
      effectiveFrom: new Date(body.effectiveFrom || Date.now()), effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
      active: body.active === true, legallyReviewedById: body.active === true ? context.user.id : null,
      note: assertBoundedString(body.note, { fieldName: 'note', maxLength: 500 }) || null,
    })
    await db().adminAuditLog.create({ data: { actorUserId: context.user.id, action: 'JURISDICTION_COMMISSION_POLICY_CREATED', entityType: 'jurisdiction_commission_policies', entityId: policy.id, before: null, after: policy } })
    return json(res, 200, { ok: true, policy })
  }

  const commissionPolicyMatch = url.pathname.match(/^\/api\/admin\/jurisdiction-pricing\/commission-policies\/([^/]+)$/)
  if (commissionPolicyMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const before = await db().jurisdictionCommissionPolicy.findUnique({ where: { id: commissionPolicyMatch[1] } })
    if (!before) {
      const error = new Error('Jurisdiction commission policy not found.')
      error.statusCode = 404
      error.code = 'JURISDICTION_COMMISSION_POLICY_NOT_FOUND'
      error.expose = true
      throw error
    }
    const body = await readJson(req)
    const policy = await upsertCommissionPolicy(db(), {
      id: before.id,
      country: body.country !== undefined ? body.country : before.country,
      province: body.province !== undefined ? body.province : before.province,
      serviceType: body.serviceType ?? before.serviceType, policyType: body.policyType ?? before.policyType,
      flatRateParts: body.flatRateParts !== undefined ? Number(body.flatRateParts) : before.flatRateParts,
      tiers: body.tiers !== undefined ? body.tiers : before.tiers,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : before.effectiveFrom,
      effectiveTo: body.effectiveTo !== undefined ? (body.effectiveTo ? new Date(body.effectiveTo) : null) : before.effectiveTo,
      active: body.active !== undefined ? body.active === true : before.active,
      legallyReviewedById: (body.active !== undefined ? body.active === true : before.active) ? context.user.id : null,
      note: body.note !== undefined ? assertBoundedString(body.note, { fieldName: 'note', maxLength: 500 }) : before.note,
    })
    await db().adminAuditLog.create({ data: { actorUserId: context.user.id, action: 'JURISDICTION_COMMISSION_POLICY_UPDATED', entityType: 'jurisdiction_commission_policies', entityId: policy.id, before, after: policy } })
    return json(res, 200, { ok: true, policy })
  }

  return false
}
