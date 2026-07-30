import { isAnthropicConfigured, requireAnthropic, parseJsonLoose, MODEL } from './ai-insights.mjs'
import { validTiersFor, ruleTier } from './account-standing.mjs'

// AI LOYALTY CAPSULE — proposes a standing tier + a short human reason from a user's real stats. The AI
// may ONLY choose from the valid tier ladder; when it is unavailable or returns something off-ladder we
// fall back to the deterministic rule baseline, so a suggestion is ALWAYS well-defined. The suggestion
// is advisory only — an admin approves it before it becomes the user's live tier.

const SYSTEM_PROMPT = `You assess a SYBNB user's loyalty/trust standing from REAL stats you are given (ratings, completed bookings, disputes, honesty flags, verified ID, tenure). You are told the valid tier ladder and a rule-based baseline tier. Choose the single most appropriate tier STRICTLY from the given ladder — you may agree with the baseline or adjust by at most one step if the stats clearly warrant it; never invent a tier or a statistic. Give a short, factual, one-sentence reason grounded only in the given stats. Reply with strict JSON: {"suggestedTier":"...","reason":"..."}.`

function templateReason(kind, stats, tier) {
  if (kind === 'GUEST') {
    return `Guest: ${stats.completedBookings} completed booking(s), ${stats.disputes} dispute(s) → ${tier}.`
  }
  const rating = stats.ratingAvg != null ? `${stats.ratingAvg}★ (${stats.ratingCount})` : 'no ratings yet'
  return `Host: ${rating}, ${stats.completedBookings} completed, ${stats.verifiedId ? 'ID verified' : 'ID not verified'}, ${stats.openTruthWarnings} open honesty flag(s) → ${tier}.`
}

export async function suggestTier(kind, stats) {
  const baseline = ruleTier(kind, stats)
  const validTiers = validTiersFor(kind)
  if (!isAnthropicConfigured()) {
    return { suggestedTier: baseline, reason: templateReason(kind, stats, baseline), source: 'rule', model: null }
  }
  try {
    const client = requireAnthropic()
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify({ kind, stats, validTiers, ruleBaseline: baseline }) }],
    })
    const block = response.content.find((b) => b.type === 'text')
    const parsed = block ? parseJsonLoose(block.text) : null
    const tier = parsed && validTiers.includes(String(parsed.suggestedTier)) ? String(parsed.suggestedTier) : baseline
    const reason = parsed && typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : templateReason(kind, stats, tier)
    return { suggestedTier: tier, reason, source: 'ai', model: MODEL }
  } catch (err) {
    console.error('[ai-loyalty] Claude call failed, using rule baseline:', err?.status ?? err?.statusCode, err?.message)
    return { suggestedTier: baseline, reason: templateReason(kind, stats, baseline), source: 'rule', model: null }
  }
}
