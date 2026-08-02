import { requireAuth } from '../lib/auth-context.mjs'
import { assistantEnabled } from '../lib/assistant-config.mjs'
import { db } from '../lib/prisma.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { answerAssistant } from '../lib/ai-assistant.mjs'

export async function handleAssistant(req, res, url, context) {
  if (url.pathname !== '/api/assistant/ask') return false
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  if (!assistantEnabled()) {
    const error = new Error('Assistant is unavailable.')
    error.statusCode = 404
    error.code = 'ASSISTANT_UNAVAILABLE'
    error.expose = true
    throw error
  }
  requireAuth(context)

  const body = await readJson(req)
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Invalid assistant request.')
  const unknown = Object.keys(body).filter((key) => !['question', 'locale', 'history', 'confirmation'].includes(key))
  if (unknown.length) invalid(`Unknown assistant field: ${unknown[0]}.`)
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question || question.length > 1000) invalid('Question must be between 1 and 1000 characters.')
  const locale = ['ar', 'en', 'fr'].includes(body.locale) ? body.locale : 'en'
  if (body.history != null && (!Array.isArray(body.history) || body.history.length > 12)) invalid('History is invalid.')
  const confirmedDraftListingId = parseConfirmation(body.confirmation)

  const result = await answerAssistant({ role: roleFor(context.roles || []), locale, question, history: body.history || [], context, confirmedDraftListingId })
  const listings = result.records.filter((record) => record.tool === 'searchListings').flatMap((record) => record.result.listings || []).slice(0, 8)
  const draft = result.records.findLast((record) => record.tool === 'createBookingDraft')?.result?.draft || null
  await db().adminAuditLog.create({ data: { actorUserId: context.user.id, action: 'AI_ASSISTANT_REQUEST_COMPLETED', entityType: 'ai_assistant', entityId: context.user.id, after: { locale, source: result.source, toolCount: result.records.length, draftPrepared: Boolean(draft) } } })
  return json(res, 200, { ok: true, answer: result.answer, source: result.source, listings, draft })
}

function parseConfirmation(value) {
  if (value == null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.action !== 'createBookingDraft' || typeof value.listingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.listingId)) invalid('Confirmation is invalid.')
  return value.listingId
}

function invalid(message) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = 'ASSISTANT_REQUEST_INVALID'
  error.expose = true
  throw error
}

function roleFor(roles) {
  if (roles.includes('ADMIN')) return 'admin'
  if (roles.includes('HOST') || roles.includes('SELLER')) return 'host'
  return 'guest'
}
