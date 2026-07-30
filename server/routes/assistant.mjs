import { requireAuth } from '../lib/auth-context.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { answerAssistant } from '../lib/ai-assistant.mjs'

// "Ask SYBNB AI" — a role-aware assistant for every signed-in user (guest/host/admin). Grounded,
// guardrailed text help (see server/lib/ai-assistant.mjs). Cost is bounded by the ASSISTANT_ASK
// rate-limit rule. This route never reads another user's data — it only classifies the caller's own
// role from their session and passes their question to the capsule.
export async function handleAssistant(req, res, url, context) {
  if (url.pathname !== '/api/assistant/ask') return false
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  requireAuth(context)

  const body = await readJson(req)
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 1000) : ''
  const locale = body?.locale === 'ar' ? 'ar' : 'en'
  const role = roleFor(Array.isArray(context?.roles) ? context.roles : [])

  const result = await answerAssistant({ role, locale, question })
  return json(res, 200, { ok: true, answer: result.answer, source: result.source })
}

function roleFor(roles) {
  if (roles.includes('ADMIN')) return 'admin'
  if (roles.includes('HOST') || roles.includes('SELLER')) return 'host'
  return 'guest'
}
