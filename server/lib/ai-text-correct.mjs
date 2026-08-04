// ─────────────────────────────────────────────────────────────────────────────
// AI TEXT-CORRECTION CAPSULE (server side)
//
// Fixes spelling, grammar, punctuation, and clarity of text the USER already wrote — without changing
// its meaning and without inventing any new fact, amenity, price, or claim. Same language in, same
// language out. Reusable anywhere a user writes free text (listing title/description, messages).
//
//   • Uses Claude when ANTHROPIC_API_KEY is set (shares the one client in ai-insights.mjs).
//   • Without a key it returns the text tidied of stray whitespace only — honest, never a fake "fix".
//
// Reuse: copy this file + wire one authenticated, rate-limited endpoint that calls correctText().
// ─────────────────────────────────────────────────────────────────────────────
import { isAnthropicConfigured, requireAnthropic, parseJsonLoose, MODEL } from './ai-insights.mjs'

const SYSTEM_PROMPT = `You are a careful editor for SYBNB (a short-term-rental platform in Syria). Fix ONLY the spelling, grammar, punctuation, and clarity of the given text. Rules: keep the SAME language (Arabic or English); keep the same meaning and roughly the same length; NEVER add a new fact, amenity, price, number, or claim that is not already in the text; no markdown, no emojis. Reply with strict JSON: {"corrected":"..."}.`

// Tidy stray whitespace without changing wording — the honest no-AI fallback.
function tidy(text) {
  return String(text || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

// Public entry: AI when configured, whitespace-tidy otherwise. Never throws for a normal call.
export async function correctText({ text = '', locale = 'en' } = {}) {
  const trimmed = tidy(text)
  if (!trimmed) return { corrected: '', source: 'empty' }
  if (!isAnthropicConfigured()) return { corrected: trimmed, source: 'template' }
  try {
    const client = requireAnthropic()
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: JSON.stringify({ language: locale === 'ar' ? 'Arabic' : 'English', text: trimmed }) },
      ],
    })
    const block = response.content.find((b) => b.type === 'text')
    if (!block?.text) return { corrected: trimmed, source: 'template' }
    const parsed = parseJsonLoose(block.text)
    if (!parsed) {
      console.error('[ai-text-correct] Claude returned non-JSON, using original. First 120 chars:', String(block.text).slice(0, 120))
      return { corrected: trimmed, source: 'template' }
    }
    const corrected = typeof parsed.corrected === 'string' ? parsed.corrected.trim() : ''
    return { corrected: corrected || trimmed, source: 'ai', model: MODEL }
  } catch (err) {
    console.error('[ai-text-correct] Claude call failed, using original:', err?.status ?? err?.statusCode, err?.message)
    return { corrected: trimmed, source: 'template' }
  }
}
