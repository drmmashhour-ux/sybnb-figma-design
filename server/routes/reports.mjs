import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'

const SUBJECT_TYPES = new Set(['LISTING', 'REVIEW', 'SELLER', 'USER', 'RIDE', 'BOOKING'])
const RESOLVE_STATUSES = new Set(['REVIEWED', 'ACTIONED', 'DISMISSED'])

function fail(message, statusCode, code) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}

// UGC-safety reports (024). Any authenticated user can report content or another user; admins triage the
// OPEN queue and action each report (audited, mirroring the dispute-adjudication pattern in disputes.mjs).
export async function handleReports(req, res, url, context) {
  // ---- File a report ----
  if (url.pathname === '/api/reports') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const subjectType = String(body.subjectType || '').toUpperCase()
    const subjectId = typeof body.subjectId === 'string' ? body.subjectId.trim() : ''
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : ''
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) || null : null
    if (!SUBJECT_TYPES.has(subjectType)) fail('subjectType must be one of LISTING, REVIEW, SELLER, USER, RIDE, BOOKING.', 400, 'REPORT_SUBJECT_TYPE_INVALID')
    if (!subjectId) fail('subjectId is required.', 400, 'REPORT_SUBJECT_REQUIRED')
    if (!reason) fail('A reason is required to file a report.', 400, 'REPORT_REASON_REQUIRED')

    const report = await db().report.create({
      data: { reporterUserId: context.user.id, subjectType, subjectId, reason, note },
    })
    return json(res, 201, { ok: true, report })
  }

  // ---- Admin queue ----
  if (url.pathname === '/api/admin/reports') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const reports = await db().report.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    return json(res, 200, { ok: true, reports })
  }

  // ---- Admin action on a report ----
  const adminMatch = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)$/)
  if (adminMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const status = String(body.status || body.decision || '').toUpperCase()
    if (!RESOLVE_STATUSES.has(status)) fail('status must be REVIEWED, ACTIONED, or DISMISSED.', 400, 'REPORT_STATUS_INVALID')
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null

    const existing = await db().report.findUnique({ where: { id: adminMatch[1] } })
    if (!existing) fail('Report not found.', 404, 'REPORT_NOT_FOUND')

    const updated = await db().$transaction(async (tx) => {
      const report = await tx.report.update({
        where: { id: existing.id },
        data: { status, resolutionNote: note, resolvedById: context.user.id, resolvedAt: new Date() },
      })
      await tx.adminAuditLog.create({
        data: { actorUserId: context.user.id, action: `REPORT_${status}`, entityType: 'reports', entityId: report.id, before: { status: existing.status }, after: { status, note } },
      })
      return report
    })
    return json(res, 200, { ok: true, report: updated })
  }

  return false
}
