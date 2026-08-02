import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerAssistant, redactAssistantText } from '../../server/lib/ai-assistant.mjs'
import { createBookingDraft, searchListings } from '../../server/lib/assistant-tools.mjs'
import { assistantConfirmationRetentionHours, assistantDraftMatchesConfirmedFacts } from '../../server/lib/assistant-confirmations.mjs'
import { createOpenAiResponse } from '../../server/lib/openai-responses.mjs'

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.AI_BOOKING_ASSISTANT_ENABLED
  delete process.env.SYBNB_DEPLOY_ENV
  delete process.env.OPENAI_API_KEY
})

describe('assistant safety boundaries', () => {
  it('redacts personal, payment, and bearer data before prompting', () => {
    const result = redactAssistantText('me@example.com +963 999 111 222 4111 1111 1111 1111 Bearer secret.token')
    expect(result).not.toContain('me@example.com')
    expect(result).not.toContain('4111 1111')
    expect(result).not.toContain('secret.token')
  })

  it('rejects unknown tool fields and incomplete date ranges before database access', async () => {
    await expect(searchListings({ destination: 'Damascus', rawSql: 'select *' })).rejects.toMatchObject({ code: 'ASSISTANT_TOOL_INVALID' })
    await expect(searchListings({ checkIn: '2026-09-01' })).rejects.toMatchObject({ code: 'ASSISTANT_TOOL_INVALID' })
  })

  it('rejects model-claimed booking confirmation', async () => {
    const listingId = '00000000-0000-4000-8000-000000000001'
    await expect(createBookingDraft({ listingId, checkIn: '2026-09-01', checkOut: '2026-09-02', guests: 2, confirmed: true }, { confirmationClaimed: true })).rejects.toMatchObject({ code: 'ASSISTANT_TOOL_INVALID' })
  })

  it('fails the final draft check when confirmed price or material facts change', () => {
    const facts = { available: true, total: { amountMinor: 10_000, currency: 'SYP' }, guests: 2, nights: 1 }
    const result = { draft: { total: { amountMinor: 10_000, currency: 'SYP' }, guests: 2, nights: 1 } }
    expect(assistantDraftMatchesConfirmedFacts(result, facts)).toBe(true)
    expect(assistantDraftMatchesConfirmedFacts({ draft: { ...result.draft, total: { amountMinor: 10_001, currency: 'SYP' } } }, facts)).toBe(false)
    expect(assistantDraftMatchesConfirmedFacts({ draft: { ...result.draft, guests: 3 } }, facts)).toBe(false)
    expect(assistantDraftMatchesConfirmedFacts(null, facts)).toBe(false)
  })

  it('bounds confirmation retention configuration to a privacy-minimized window', () => {
    expect(assistantConfirmationRetentionHours()).toBe(24)
    expect(assistantConfirmationRetentionHours('1')).toBe(1)
    expect(assistantConfirmationRetentionHours('720')).toBe(720)
    expect(assistantConfirmationRetentionHours('0')).toBe(24)
    expect(assistantConfirmationRetentionHours('721')).toBe(24)
    expect(assistantConfirmationRetentionHours('not-a-number')).toBe(24)
  })

  it('retries one transient OpenAI failure and keeps the key in the authorization header', async () => {
    process.env.OPENAI_API_KEY = 'server-secret'
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ output_text: 'ok' }) })
    const response = await createOpenAiResponse({ input: [] }, { fetchImpl, retries: 1, timeoutMs: 100 })
    expect(response.output_text).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer server-secret')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).store).toBe(false)
    delete process.env.OPENAI_API_KEY
  })

  it('fails closed when a tool-free model fabricates a price and availability', async () => {
    process.env.SYBNB_DEPLOY_ENV = 'staging'
    process.env.AI_BOOKING_ASSISTANT_ENABLED = '1'
    process.env.OPENAI_API_KEY = 'test-only'
    const request = vi.fn().mockResolvedValue({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Villa Dream is available for $99 with a 5-star rating.' }] }],
    })
    const result = await answerAssistant({ question: 'Find a villa', locale: 'en', context: { user: { id: 'user-1' } }, request })
    expect(result.records).toEqual([])
    expect(result.answer).not.toContain('$99')
    expect(result.answer).not.toContain('Villa Dream')
    expect(result.answer).toContain('Tell me the destination')
  })

  it('allows non-sensitive tool-free guidance after sanitizing markup', async () => {
    process.env.SYBNB_DEPLOY_ENV = 'staging'
    process.env.AI_BOOKING_ASSISTANT_ENABLED = '1'
    process.env.OPENAI_API_KEY = 'test-only'
    const request = vi.fn().mockResolvedValue({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '<b>Please share your destination and travel dates.</b>' }] }],
    })
    const result = await answerAssistant({ question: 'What do you need?', locale: 'en', context: { user: { id: 'user-1' } }, request })
    expect(result.answer).toBe('Please share your destination and travel dates.')
  })
})
