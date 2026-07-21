import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { assertBoundedString, assertEnum } from '../lib/validate.mjs'
import {
  GST_QST_TREATMENTS,
  TAX_SUBJECT_TYPES,
  recordGstQstTreatment,
  redactTaxProfile,
  upsertTaxProfile,
} from '../lib/tax-profile.mjs'

const SUBJECT_ROLE = { DRIVER: 'DRIVER', HOST: 'HOST' }

function requireSubjectRole(context, subjectType) {
  requireAuth(context, [SUBJECT_ROLE[subjectType], 'ADMIN'])
}

export async function handleTaxProfile(req, res, url, context) {
  // ---- Self: read/write own tax profile (driver or host) ----
  const selfMatch = url.pathname.match(/^\/api\/tax-profile\/(DRIVER|HOST)$/)
  if (selfMatch) {
    const subjectType = selfMatch[1]

    if (req.method === 'GET') {
      requireSubjectRole(context, subjectType)
      const profile = await db().taxProfile.findUnique({ where: { userId_subjectType: { userId: context.user.id, subjectType } } })
      return json(res, 200, { ok: true, taxProfile: redactTaxProfile(profile) })
    }

    if (req.method === 'PUT') {
      requireSubjectRole(context, subjectType)
      const body = await readJson(req)
      const profile = await db().$transaction((tx) => upsertTaxProfile(tx, { userId: context.user.id, subjectType, body }))
      return json(res, 200, { ok: true, taxProfile: redactTaxProfile(profile) })
    }

    return methodNotAllowed(res, ['GET', 'PUT'])
  }

  // ---- HOST self: record the explicit GST/QST treatment decision (never inferred) ----
  const treatmentMatch = url.pathname.match(/^\/api\/tax-profile\/HOST\/gst-qst-treatment$/)
  if (treatmentMatch) {
    if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT'])
    requireSubjectRole(context, 'HOST')
    const body = await readJson(req)
    const treatment = assertEnum(String(body.treatment || '').toUpperCase(), GST_QST_TREATMENTS, 'treatment')
    const effectiveAt = body.effectiveAt ? new Date(body.effectiveAt) : new Date()
    if (Number.isNaN(effectiveAt.getTime())) {
      const error = new Error('effectiveAt is not a valid date.')
      error.statusCode = 400
      error.code = 'VALIDATION_INVALID_DATE'
      error.expose = true
      throw error
    }

    const existing = await db().taxProfile.findUnique({ where: { userId_subjectType: { userId: context.user.id, subjectType: 'HOST' } } })
    if (!existing) {
      const error = new Error('Create your host tax profile before recording a GST/QST tax treatment.')
      error.statusCode = 404
      error.code = 'TAX_PROFILE_NOT_FOUND'
      error.expose = true
      throw error
    }

    const updated = await db().$transaction((tx) =>
      recordGstQstTreatment(tx, { taxProfileId: existing.id, treatment, effectiveAt, decidedById: context.user.id }),
    )
    return json(res, 200, { ok: true, taxProfile: redactTaxProfile(updated) })
  }

  // ---- Admin: list + filter tax profiles (compliance dashboard reads this) ----
  if (url.pathname === '/api/admin/tax-profiles') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const params = url.searchParams
    const subjectType = params.get('subjectType')
    const status = params.get('status')
    const where = {
      ...(subjectType && TAX_SUBJECT_TYPES.includes(subjectType) ? { subjectType } : {}),
      ...(status ? { verificationStatus: status } : {}),
    }
    const profiles = await db().taxProfile.findMany({
      where,
      include: { user: { select: { id: true, displayName: true, email: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    })
    return json(res, 200, { ok: true, taxProfiles: profiles.map(redactTaxProfile) })
  }

  // ---- Admin: verify or reject a tax profile ----
  const verifyMatch = url.pathname.match(/^\/api\/admin\/tax-profiles\/([^/]+)\/verify$/)
  if (verifyMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const decision = String(body.decision || '').toUpperCase()
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      const error = new Error('decision must be APPROVED or REJECTED.')
      error.statusCode = 400
      error.code = 'TAX_PROFILE_DECISION_INVALID'
      error.expose = true
      throw error
    }
    const source = assertBoundedString(body.source, { fieldName: 'source', maxLength: 200 }) || 'Manual admin review'

    const profile = await db().taxProfile.findUnique({ where: { id: verifyMatch[1] } })
    if (!profile) {
      const error = new Error('Tax profile not found.')
      error.statusCode = 404
      error.code = 'TAX_PROFILE_NOT_FOUND'
      error.expose = true
      throw error
    }

    const updated = await db().$transaction(async (tx) => {
      const u = await tx.taxProfile.update({
        where: { id: profile.id },
        data: { verificationStatus: decision, verificationSource: source, verifiedById: context.user.id, verifiedAt: new Date() },
      })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `TAX_PROFILE_${decision}`,
          entityType: 'tax_profiles',
          entityId: profile.id,
          before: { verificationStatus: profile.verificationStatus },
          after: { verificationStatus: decision, source },
        },
      })
      return u
    })
    return json(res, 200, { ok: true, taxProfile: redactTaxProfile(updated) })
  }

  return false
}
