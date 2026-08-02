import { createHash } from 'node:crypto'
import { db } from './prisma.mjs'
import { calculateBookingTotal, createBookingDraft } from './assistant-tools.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TTL_MS = 10 * 60_000
export const ASSISTANT_ACTIONS = Object.freeze([
  'CREATE_BOOKING_DRAFT', 'SEND_MESSAGE', 'CANCEL_BOOKING', 'REQUEST_REFUND',
  'CHANGE_DATES', 'CHANGE_GUEST_COUNT', 'INITIATE_PAYMENT',
])

const COPY = {
  en: { requested: 'Please confirm this action. The confirmation expires in 10 minutes and becomes invalid if any material detail changes.', accepted: 'Confirmation accepted.', rejected: 'The action was not confirmed.', invalid: 'This confirmation is invalid, expired, already used, or its details changed.' },
  fr: { requested: 'Veuillez confirmer cette action. La confirmation expire dans 10 minutes et devient invalide si un détail important change.', accepted: 'Confirmation acceptée.', rejected: "L’action n’a pas été confirmée.", invalid: 'Cette confirmation est invalide, expirée, déjà utilisée ou ses détails ont changé.' },
  ar: { requested: 'يرجى تأكيد هذا الإجراء. تنتهي صلاحية التأكيد خلال 10 دقائق ويصبح غير صالح إذا تغيّرت أي تفاصيل جوهرية.', accepted: 'تم قبول التأكيد.', rejected: 'لم يتم تأكيد الإجراء.', invalid: 'هذا التأكيد غير صالح أو منتهي الصلاحية أو مستخدم سابقاً أو تغيّرت تفاصيله.' },
}

function fail(message = 'Assistant confirmation is invalid.', code = 'ASSISTANT_CONFIRMATION_INVALID', statusCode = 409) {
  const error = new Error(message); error.code = code; error.statusCode = statusCode; error.expose = true; throw error
}
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Action payload is invalid.', 'ASSISTANT_ACTION_INVALID', 400); return value }
function exact(value, allowed) { const unknown = Object.keys(value).filter((key) => !allowed.includes(key)); if (unknown.length) fail(`Unknown action field: ${unknown[0]}.`, 'ASSISTANT_ACTION_INVALID', 400) }
function uuid(value, name) { if (typeof value !== 'string' || !UUID_RE.test(value)) fail(`${name} is invalid.`, 'ASSISTANT_ACTION_INVALID', 400); return value }
function date(value, name) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${name} is invalid.`, 'ASSISTANT_ACTION_INVALID', 400); return value }
function integer(value, name) { if (!Number.isInteger(value) || value < 1 || value > 30) fail(`${name} is invalid.`, 'ASSISTANT_ACTION_INVALID', 400); return value }
function text(value, name, max) { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${name} is invalid.`, 'ASSISTANT_ACTION_INVALID', 400); return value.trim() }
function stable(value) { if (value instanceof Date) return JSON.stringify(value.toISOString()); if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`; return JSON.stringify(value) }
function hash(value) { return createHash('sha256').update(stable(value)).digest('hex') }
function requireGuest(roles) { if (!Array.isArray(roles) || !roles.includes('GUEST')) fail('Guest authorization is required.', 'ASSISTANT_GUEST_REQUIRED', 403) }
function isoDate(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10) }

function confirmationSummary(action, payload, snapshot) {
  if (action === 'CREATE_BOOKING_DRAFT') return { action, listingId: payload.listingId, checkIn: payload.checkIn, checkOut: payload.checkOut, guests: payload.guests, available: snapshot.facts.available, nights: snapshot.facts.nights, total: snapshot.facts.total }
  const base = { action, bookingId: payload.bookingId, status: snapshot.facts.status, currentCheckIn: isoDate(snapshot.facts.checkIn), currentCheckOut: isoDate(snapshot.facts.checkOut), currentTotal: { amountMinor: snapshot.facts.amountMinor, currency: snapshot.facts.currency } }
  if (action === 'CHANGE_DATES') return { ...base, requestedCheckIn: payload.checkIn, requestedCheckOut: payload.checkOut }
  if (action === 'CHANGE_GUEST_COUNT') return { ...base, requestedGuests: payload.guests }
  return base
}

export function assistantDraftMatchesConfirmedFacts(result, confirmedFacts) {
  const actual = result?.draft && { available: true, total: result.draft.total, guests: result.draft.guests, nights: result.draft.nights }
  const expected = { available: confirmedFacts.available, total: confirmedFacts.total, guests: confirmedFacts.guests, nights: confirmedFacts.nights }
  return Boolean(actual) && hash(actual) === hash(expected)
}

export function normalizeAssistantAction(action, raw) {
  if (!ASSISTANT_ACTIONS.includes(action)) fail('Action is not approved.', 'ASSISTANT_ACTION_INVALID', 400)
  const value = object(raw)
  if (action === 'CREATE_BOOKING_DRAFT') { exact(value, ['listingId', 'checkIn', 'checkOut', 'guests']); return { listingId: uuid(value.listingId, 'listingId'), checkIn: date(value.checkIn, 'checkIn'), checkOut: date(value.checkOut, 'checkOut'), guests: integer(value.guests, 'guests') } }
  if (action === 'SEND_MESSAGE') { exact(value, ['bookingId', 'message']); return { bookingId: uuid(value.bookingId, 'bookingId'), message: text(value.message, 'message', 1000) } }
  if (action === 'CANCEL_BOOKING') { exact(value, ['bookingId']); return { bookingId: uuid(value.bookingId, 'bookingId') } }
  if (action === 'REQUEST_REFUND') { exact(value, ['bookingId', 'reason']); return { bookingId: uuid(value.bookingId, 'bookingId'), reason: text(value.reason, 'reason', 300) } }
  if (action === 'CHANGE_DATES') { exact(value, ['bookingId', 'checkIn', 'checkOut']); const result = { bookingId: uuid(value.bookingId, 'bookingId'), checkIn: date(value.checkIn, 'checkIn'), checkOut: date(value.checkOut, 'checkOut') }; if (result.checkOut <= result.checkIn) fail('checkOut must be after checkIn.', 'ASSISTANT_ACTION_INVALID', 400); return result }
  if (action === 'CHANGE_GUEST_COUNT') { exact(value, ['bookingId', 'guests']); return { bookingId: uuid(value.bookingId, 'bookingId'), guests: integer(value.guests, 'guests') } }
  exact(value, ['bookingId']); return { bookingId: uuid(value.bookingId, 'bookingId') }
}

async function currentFacts(action, payload, actorUserId) {
  if (action === 'CREATE_BOOKING_DRAFT') {
    const quote = await calculateBookingTotal(payload)
    return { entityType: 'listing', entityId: payload.listingId, facts: { listingId: quote.listingId, available: quote.available, total: quote.total, guests: quote.guests, nights: quote.nights, breakdown: quote.breakdown || null } }
  }
  const booking = await db().booking.findFirst({ where: { id: payload.bookingId, guestId: actorUserId }, select: { id: true, listingId: true, guestId: true, status: true, checkIn: true, checkOut: true, amountMinor: true, currency: true, updatedAt: true } })
  if (!booking) fail('Booking is unavailable.', 'ASSISTANT_BOOKING_UNAVAILABLE', 404)
  return { entityType: 'booking', entityId: booking.id, facts: booking }
}

async function audit(actorUserId, action, entityType, entityId, after) {
  await db().adminAuditLog.create({ data: { actorUserId, action, entityType, entityId, after } })
}

export async function proposeAssistantAction({ actorUserId, roles, action, payload: rawPayload, locale = 'en' }) {
  requireGuest(roles)
  const payload = normalizeAssistantAction(action, rawPayload)
  const snapshot = await currentFacts(action, payload, actorUserId)
  await audit(actorUserId, 'AI_ASSISTANT_SERVER_FACT_RETRIEVED', snapshot.entityType, snapshot.entityId, { action, fields: action === 'CREATE_BOOKING_DRAFT' ? ['availability', 'total', 'fees', 'dates', 'guests'] : ['status', 'dates', 'amount', 'currency', 'updatedAt'] })
  const proposal = await db().assistantConfirmation.create({ data: { actorUserId, action, payloadHash: hash(payload), factHash: hash(snapshot.facts), entityType: snapshot.entityType, entityId: snapshot.entityId, expiresAt: new Date(Date.now() + TTL_MS) } })
  const safe = { action, proposalId: proposal.id, expiresAt: proposal.expiresAt.toISOString(), entityType: proposal.entityType, entityId: proposal.entityId, summary: confirmationSummary(action, payload, snapshot) }
  await audit(actorUserId, 'AI_ASSISTANT_TOOL_PROPOSED', proposal.entityType, proposal.entityId, { action, proposalId: proposal.id })
  await audit(actorUserId, 'AI_ASSISTANT_CONFIRMATION_REQUESTED', proposal.entityType, proposal.entityId, { action, proposalId: proposal.id, expiresAt: safe.expiresAt })
  return { ...safe, message: (COPY[locale] || COPY.en).requested }
}

export async function resolveAssistantAction({ actorUserId, roles, proposalId, payload: rawPayload, decision, locale = 'en' }) {
  requireGuest(roles)
  uuid(proposalId, 'proposalId')
  if (typeof decision !== 'boolean') fail('Confirmation decision is invalid.', 'ASSISTANT_CONFIRMATION_INVALID', 400)
  const proposal = await db().assistantConfirmation.findFirst({ where: { id: proposalId, actorUserId } })
  if (!proposal) { await audit(actorUserId, 'AI_ASSISTANT_ATTEMPT_BLOCKED', 'ai_assistant', actorUserId, { code: 'PROPOSAL_NOT_FOUND' }); fail() }
  if (decision !== true) {
    const rejected = await db().assistantConfirmation.updateMany({ where: { id: proposal.id, actorUserId, status: 'PENDING', consumedAt: null }, data: { status: 'REJECTED', consumedAt: new Date() } })
    await audit(actorUserId, 'AI_ASSISTANT_CONFIRMATION_REJECTED', proposal.entityType, proposal.entityId, { action: proposal.action, proposalId })
    return { accepted: false, executed: false, message: (COPY[locale] || COPY.en).rejected, fresh: rejected.count === 1 }
  }
  const payload = normalizeAssistantAction(proposal.action, rawPayload)
  const snapshot = await currentFacts(proposal.action, payload, actorUserId)
  await audit(actorUserId, 'AI_ASSISTANT_SERVER_FACT_RETRIEVED', snapshot.entityType, snapshot.entityId, { action: proposal.action, phase: 'confirmation_recheck' })
  const valid = proposal.status === 'PENDING' && !proposal.consumedAt && proposal.expiresAt > new Date() && proposal.payloadHash === hash(payload) && proposal.factHash === hash(snapshot.facts) && proposal.entityId === snapshot.entityId
  if (!valid) {
    await db().assistantConfirmation.updateMany({ where: { id: proposal.id, status: 'PENDING' }, data: { status: 'INVALIDATED', consumedAt: new Date() } })
    await audit(actorUserId, 'AI_ASSISTANT_ATTEMPT_BLOCKED', proposal.entityType, proposal.entityId, { action: proposal.action, proposalId, code: 'STALE_REPLAY_OR_CHANGED' })
    fail((COPY[locale] || COPY.en).invalid)
  }
  const claimed = await db().assistantConfirmation.updateMany({ where: { id: proposal.id, actorUserId, status: 'PENDING', consumedAt: null, expiresAt: { gt: new Date() } }, data: { status: 'ACCEPTED', consumedAt: new Date() } })
  if (claimed.count !== 1) { await audit(actorUserId, 'AI_ASSISTANT_ATTEMPT_BLOCKED', proposal.entityType, proposal.entityId, { action: proposal.action, proposalId, code: 'REPLAY' }); fail((COPY[locale] || COPY.en).invalid) }
  await audit(actorUserId, 'AI_ASSISTANT_CONFIRMATION_ACCEPTED', proposal.entityType, proposal.entityId, { action: proposal.action, proposalId })
  let result
  try { result = await executeConfirmed(proposal.action, payload, actorUserId, snapshot.facts) }
  catch (error) {
    await db().assistantConfirmation.update({ where: { id: proposal.id }, data: { status: 'INVALIDATED' } })
    await audit(actorUserId, 'AI_ASSISTANT_ATTEMPT_BLOCKED', proposal.entityType, proposal.entityId, { action: proposal.action, proposalId, code: error.code || 'EXECUTION_BLOCKED' })
    throw error
  }
  await audit(actorUserId, 'AI_ASSISTANT_TOOL_EXECUTED', proposal.entityType, proposal.entityId, { action: proposal.action, proposalId, outcome: result.outcome })
  return { accepted: true, message: (COPY[locale] || COPY.en).accepted, ...result }
}

async function executeConfirmed(action, payload, actorUserId, confirmedFacts) {
  if (action === 'CREATE_BOOKING_DRAFT') {
    const result = await createBookingDraft(payload, { user: { id: actorUserId }, roles: ['GUEST'], confirmationClaimed: true })
    if (!assistantDraftMatchesConfirmedFacts(result, confirmedFacts)) fail('Material booking facts changed during confirmation.', 'ASSISTANT_CONFIRMATION_CHANGED', 409)
    return { executed: true, outcome: 'DRAFT_PREPARED', result }
  }
  const routes = {
    SEND_MESSAGE: `#/bookings/${payload.bookingId}/messages`, CANCEL_BOOKING: `#/bookings/${payload.bookingId}`,
    REQUEST_REFUND: `#/bookings/${payload.bookingId}/support`, CHANGE_DATES: `#/bookings/${payload.bookingId}`,
    CHANGE_GUEST_COUNT: `#/bookings/${payload.bookingId}`, INITIATE_PAYMENT: `#/booking/payment/${payload.bookingId}`,
  }
  return { executed: true, outcome: 'EXISTING_FLOW_OPENED', result: { action, navigationLink: routes[action], notice: 'No booking, message, cancellation, refund, or payment mutation was performed by the assistant.' } }
}
