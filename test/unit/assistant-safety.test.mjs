import { afterEach, describe, expect, it, vi } from 'vitest'
import { redactAssistantText } from '../../server/lib/ai-assistant.mjs'
import { createBookingDraft, searchListings } from '../../server/lib/assistant-tools.mjs'
import { createOpenAiResponse } from '../../server/lib/openai-responses.mjs'

afterEach(() => vi.restoreAllMocks())

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
    await expect(createBookingDraft({ listingId, checkIn: '2026-09-01', checkOut: '2026-09-02', guests: 2, confirmed: true }, {})).rejects.toMatchObject({ code: 'ASSISTANT_TOOL_INVALID' })
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
})
