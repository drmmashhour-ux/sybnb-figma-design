import Anthropic from '@anthropic-ai/sdk'

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null

// Cheapest current Claude model — adequate for restating a handful of already-computed real
// numbers in short, plain Arabic/English, not for anything requiring deeper reasoning. Shared with
// the isolated listing-description capsule (server/lib/ai-listing-description.mjs).
export const MODEL = 'claude-haiku-4-5-20251001'

export function requireAnthropic() {
  if (!anthropic) {
    const error = new Error('AI insights are not configured on this server yet.')
    error.statusCode = 503
    error.code = 'AI_NOT_CONFIGURED'
    error.expose = true
    throw error
  }
  return anthropic
}

export function isAnthropicConfigured() {
  return Boolean(anthropic)
}

// Tolerant JSON parse for model output. Haiku honours "reply with strict JSON" most of the time, but
// occasionally wraps the object in a ```json fence or adds a short preamble/among; a bare JSON.parse
// then throws and silently drops us to the template. This strips fences and, failing that, extracts
// the outermost {...} block before parsing. Returns null only when there is genuinely no JSON.
export function parseJsonLoose(text) {
  if (typeof text !== 'string') return null
  let s = text.trim()
  // Strip a leading/trailing markdown code fence (```json ... ``` or ``` ... ```).
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) s = fence[1].trim()
  try {
    return JSON.parse(s)
  } catch {
    // Fall back to the first balanced-looking {...} span.
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

const SYSTEM_PROMPT = `You write a single short pricing recommendation for a short-term rental host on the SYBNB platform. You are given real, already-computed facts about one listing (title, base nightly price, currency, and a count of upcoming open nights with no discount set). Restate only those facts naturally — never invent a number, date, or statistic that is not in the given facts. Suggest exactly one concrete action: adding a lower price override for some of those open nights to attract bookings during a slow period. Reply with strict JSON: {"messageAr": "...", "messageEn": "..."}. Keep each message under 240 characters, one or two sentences, no markdown.`

export async function generatePricingInsightMessage(facts) {
  const client = requireAnthropic()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          listingTitle: facts.titleAr,
          basePriceMinor: facts.priceMinor,
          currency: facts.currency,
          openNightsCount: facts.openNightsCount,
          openNightsSample: facts.openNightsSample,
        }),
      },
    ],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) {
    const error = new Error('AI response did not contain a text block.')
    error.statusCode = 502
    error.code = 'AI_RESPONSE_INVALID'
    error.expose = true
    throw error
  }

  const parsed = parseJsonLoose(textBlock.text)
  if (!parsed) {
    const error = new Error('AI response was not valid JSON.')
    error.statusCode = 502
    error.code = 'AI_RESPONSE_INVALID'
    error.expose = true
    throw error
  }

  if (!parsed.messageAr) {
    const error = new Error('AI response was missing the Arabic message.')
    error.statusCode = 502
    error.code = 'AI_RESPONSE_INVALID'
    error.expose = true
    throw error
  }

  return { messageAr: parsed.messageAr, messageEn: parsed.messageEn || null, model: MODEL }
}
