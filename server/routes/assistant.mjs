import { requireAuth } from '../lib/auth-context.mjs'
import { assistantEnabled } from '../lib/assistant-config.mjs'
import { db } from '../lib/prisma.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { answerAssistant } from '../lib/ai-assistant.mjs'
import { proposeAssistantAction, resolveAssistantAction } from '../lib/assistant-confirmations.mjs'

export async function handleAssistant(req, res, url, context) {
  if (!['/api/assistant/ask', '/api/assistant/actions/propose', '/api/assistant/actions/confirm'].includes(url.pathname)) return false
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
  if (url.pathname === '/api/assistant/actions/propose') {
    exactBody(body, ['action', 'payload', 'locale'])
    const locale = parseLocale(body.locale)
    const proposal = await proposeAssistantAction({ actorUserId: context.user.id, roles: context.roles, action: body.action, payload: body.payload, locale })
    return json(res, 200, { ok: true, proposal })
  }
  if (url.pathname === '/api/assistant/actions/confirm') {
    exactBody(body, ['proposalId', 'payload', 'decision', 'locale'])
    const locale = parseLocale(body.locale)
    const confirmation = await resolveAssistantAction({ actorUserId: context.user.id, roles: context.roles, proposalId: body.proposalId, payload: body.payload, decision: body.decision, locale })
    return json(res, 200, { ok: true, confirmation })
  }
  const unknown = Object.keys(body).filter((key) => !['question', 'locale', 'history'].includes(key))
  if (unknown.length) invalid(`Unknown assistant field: ${unknown[0]}.`)
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question || question.length > 1000) invalid('Question must be between 1 and 1000 characters.')
  const locale = parseLocale(body.locale)
  if (body.history != null && (!Array.isArray(body.history) || body.history.length > 12)) invalid('History is invalid.')

  await db().adminAuditLog.create({ data: { actorUserId: context.user.id, action: 'AI_ASSISTANT_REQUEST_RECEIVED', entityType: 'ai_assistant', entityId: context.user.id, after: { locale } } })
  const result = await answerAssistant({ role: roleFor(context.roles || []), locale, question, history: body.history || [], context })
  const listings = result.records.filter((record) => record.tool === 'searchListings').flatMap((record) => record.result.listings || []).slice(0, 8)
  const draft = result.records.findLast((record) => record.tool === 'createBookingDraft')?.result?.draft || null
  await db().adminAuditLog.create({ data: { actorUserId: context.user.id, action: 'AI_ASSISTANT_REQUEST_COMPLETED', entityType: 'ai_assistant', entityId: context.user.id, after: { locale, source: result.source, toolCount: result.records.length, draftPrepared: Boolean(draft) } } })
  return json(res, 200, { ok: true, answer: result.answer, source: result.source, listings, draft })
}

function parseLocale(value) { return ['ar', 'en', 'fr'].includes(value) ? value : 'en' }
function exactBody(body, allowed) { const unknown = Object.keys(body).filter((key) => !allowed.includes(key)); if (unknown.length) invalid(`Unknown assistant field: ${unknown[0]}.`) }

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
