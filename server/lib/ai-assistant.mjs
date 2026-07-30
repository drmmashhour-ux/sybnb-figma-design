// ─────────────────────────────────────────────────────────────────────────────
// SYBNB AI ASSISTANT CAPSULE (server side)
//
// A reusable, role-aware "Ask SYBNB AI" helper for EVERY user of the platform (guest, host, admin).
// It helps people USE the platform — how to book, how to list, plans, payments, navigation — and can
// speak to the signed-in user's OWN scoped context when the caller passes it in.
//
//   • Uses Claude when ANTHROPIC_API_KEY is set (shares the one client in ai-insights.mjs).
//   • Falls back to a deterministic, honest helper when there is no key — so it ALWAYS works, free.
//
// SAFETY (hard rules baked into the prompt AND the contract):
//   • Never invents prices, availability, fees, or policies that were not given as facts.
//   • Never reveals or guesses another user's data — the caller passes ONLY the signed-in user's own
//     already-authorized summary in `context`; this capsule never reads the database itself.
//   • When it doesn't know, it says so and points to human support.
//
// Reuse in another platform: copy this file + wire one authenticated, rate-limited endpoint that calls
// answerAssistant(). Depends only on the shared Anthropic client accessor — no platform/DB code.
// ─────────────────────────────────────────────────────────────────────────────
import { isAnthropicConfigured, requireAnthropic, MODEL } from './ai-insights.mjs'

const SUPPORT_EMAIL = 'info@sybnb.app'
const SUPPORT_WHATSAPP = '+963 998 191 422'

const SYSTEM_PROMPT = `You are "SYBNB AI", the assistant on SYBNB — a short-term-rental (daily stay) platform in Syria. You help the signed-in user USE the platform. You are given: the user's role (guest, host, or admin), their message, their language, and OPTIONALLY a short factual context block about THIS user's own account (never anyone else's).

What you help with:
- Guests: how to search, book, pay, use the wallet, message a host, manage their trips.
- Hosts: how to create/improve a listing, choose a plan, set price/availability, add photos, get paid.
- Admins: where to review listings, payments, and disputes.
- Light writing help for the user's own listing (title/description) from facts they give you.
- Correcting or polishing text the user pastes (spelling, grammar, punctuation, clarity) — keep the same language and meaning, and never add a fact, amenity, price, or claim that was not in their text.

SYBNB PLATFORM FACTS (these are always true — state them confidently when asked; they are NOT "made up"):
- Commission: SYBNB takes a 10% platform commission calculated on the nightly RENT only. Cleaning fees, any taxes, and optional add-on fees (breakfast, airport taxi, shuttle, etc.) pass through to the host in full with NO commission taken. So a host receives: rent + cleaning + add-ons, minus 10% of the rent.
- Tax: SYBNB currently does not automatically charge or add any tax to a booking. A host may still disclose taxes they are responsible for.
- Payments: guests pay through Sham Cash today. Credit-card payment is coming soon. Money is settled to hosts through the platform, and a host sees their earnings under the "Payments" / "Earnings" screen of the host dashboard.
- Plans: a host chooses a listing plan and pays the plan fee to publish; the full plan fee is platform revenue.
- You may explain HOW these work in general. You must NOT state the exact payout DATE/timeline or a specific listing's price/availability unless it is given to you in the context — for those, point to the right screen.

Hard rules:
- The PLATFORM FACTS above are given to you and are safe to state. Beyond them, use ONLY facts you are given. NEVER invent a specific price, availability, exact payout date, fee amount, distance, or rating. If a specific number is not in the platform facts or the context, say you don't have it and say where to find it.
- NEVER reveal, guess, or imply data about any other user. Only ever discuss the context you are given, which is the signed-in user's own.
- If the question needs account data you were not given, say so and suggest the exact screen (e.g. "Bookings", "My Listings", "Payments") or contact support: ${SUPPORT_EMAIL} / WhatsApp ${SUPPORT_WHATSAPP}.
- Stay on SYBNB topics. For unrelated, legal, medical, or financial-advice questions, politely decline and point to support.
- Reply in the user's language (Arabic or English). Be warm, concise (1–4 short sentences), plain text — no markdown, no emojis.`

// Public entry: AI when configured, safe deterministic helper otherwise. Never throws for a normal call.
export async function answerAssistant({ role = 'guest', locale = 'en', question = '', context = '' } = {}) {
  const trimmed = String(question || '').trim()
  if (!trimmed) return { answer: fallbackAnswer(role, locale), source: 'empty' }
  if (!isAnthropicConfigured()) return { answer: fallbackAnswer(role, locale), source: 'template' }
  try {
    return await answerWithAi({ role, locale, question: trimmed, context })
  } catch (err) {
    console.error('[ai-assistant] Claude call failed, using canned answer:', err?.status ?? err?.statusCode, err?.message)
    return { answer: fallbackAnswer(role, locale), source: 'template' }
  }
}

async function answerWithAi({ role, locale, question, context }) {
  const client = requireAnthropic()
  const userContent = JSON.stringify({
    role,
    language: locale === 'ar' ? 'Arabic' : 'English',
    message: question,
    // Caller-assembled, already-authorized summary of THIS user's own account (may be empty).
    yourAccountContext: context || null,
  })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  })
  const textBlock = response.content.find((block) => block.type === 'text')
  const answer = stripMarkdown(textBlock?.text?.trim())
  if (!answer) return { answer: fallbackAnswer(role, locale), source: 'template' }
  return { answer, source: 'ai', model: MODEL }
}

// The widget renders the answer as plain text, so any markdown the model emits (despite the prompt
// asking for plain text) would show up as literal **, *, `, #. Strip the common inline markers.
function stripMarkdown(text) {
  if (!text) return ''
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold**
    .replace(/(^|\s)\*(?!\s)(.+?)(?<!\s)\*/g, '$1$2') // *italic* (not bare asterisks)
    .replace(/`([^`]+)`/g, '$1') // `code`
    .replace(/^#{1,6}\s+/gm, '') // # headings
    .replace(/^\s*[-*]\s+/gm, '• ') // bullet markers -> a plain bullet
    .trim()
}

// Deterministic, honest fallback — no API key needed. Points people to the right place instead of
// pretending to know specifics.
export function fallbackAnswer(role, locale) {
  const isAr = locale === 'ar'
  if (isAr) {
    const where =
      role === 'host'
        ? 'من لوحة الاستضافة يمكنك إدارة إعلاناتك، الأسعار، الحجوزات، والمدفوعات.'
        : role === 'admin'
          ? 'من لوحة الإدارة يمكنك مراجعة الإعلانات والمدفوعات والنزاعات.'
          : 'يمكنك البحث عن إقامة، الحجز، والدفع من الصفحة الرئيسية وصفحة البحث.'
    return `يسعدني مساعدتك في استخدام منصة SYBNB. ${where} لأي سؤال يخص حسابك أو تفاصيل دقيقة، تواصل مع الدعم: ${SUPPORT_EMAIL} أو واتساب ${SUPPORT_WHATSAPP}.`
  }
  const where =
    role === 'host'
      ? 'From the hosting dashboard you can manage your listings, pricing, bookings, and payments.'
      : role === 'admin'
        ? 'From the admin dashboard you can review listings, payments, and disputes.'
        : 'You can search for a stay, book, and pay from the home and search pages.'
  return `Happy to help you use SYBNB. ${where} For anything specific to your account or exact details, reach support: ${SUPPORT_EMAIL} or WhatsApp ${SUPPORT_WHATSAPP}.`
}
