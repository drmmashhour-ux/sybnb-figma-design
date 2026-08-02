import { OPENAI_ASSISTANT_MODEL } from './assistant-config.mjs'

const ENDPOINT = 'https://api.openai.com/v1/responses'
const TRANSIENT = new Set([408, 409, 429, 500, 502, 503, 504])

export async function createOpenAiResponse(payload, { fetchImpl = fetch, timeoutMs = 12_000, retries = 1 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: OPENAI_ASSISTANT_MODEL, store: false, ...payload }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const error = new Error(`OpenAI request failed (${response.status}).`)
        error.statusCode = response.status
        if (!TRANSIENT.has(response.status) || attempt === retries) throw error
        lastError = error
        continue
      }
      return body
    } catch (error) {
      lastError = error
      if (attempt === retries || (error?.name !== 'AbortError' && error?.statusCode && !TRANSIENT.has(error.statusCode))) throw error
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError || new Error('OpenAI request failed.')
}
