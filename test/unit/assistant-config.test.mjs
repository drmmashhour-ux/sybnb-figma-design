import { describe, expect, it } from 'vitest'
import { assistantEnabled, assertAssistantProductionSafe, openAiAssistantModel, openAiConfigured } from '../../server/lib/assistant-config.mjs'
import { assistantClientEnabled } from '../../src/shared/ai/assistantClientConfig.ts'

describe('AI booking assistant configuration', () => {
  it('is enabled only by an explicit staging pair', () => {
    expect(assistantEnabled({ SYBNB_DEPLOY_ENV: 'staging', AI_BOOKING_ASSISTANT_ENABLED: '1' })).toBe(true)
    expect(assistantEnabled({ SYBNB_DEPLOY_ENV: 'production', AI_BOOKING_ASSISTANT_ENABLED: '1' })).toBe(false)
    expect(assistantEnabled({ SYBNB_DEPLOY_ENV: 'staging', AI_BOOKING_ASSISTANT_ENABLED: '0' })).toBe(false)
  })

  it('refuses an enabled non-staging process', () => {
    expect(() => assertAssistantProductionSafe({ SYBNB_DEPLOY_ENV: 'production', AI_BOOKING_ASSISTANT_ENABLED: '1' })).toThrow(/only be enabled/)
    expect(() => assertAssistantProductionSafe({ SYBNB_DEPLOY_ENV: 'staging', AI_BOOKING_ASSISTANT_ENABLED: '1' })).not.toThrow()
  })

  it('renders the client widget only with the explicit staging pair', () => {
    expect(assistantClientEnabled({ VITE_SYBNB_DEPLOY_ENV: 'staging', VITE_AI_BOOKING_ASSISTANT_ENABLED: '1' })).toBe(true)
    expect(assistantClientEnabled({ VITE_SYBNB_DEPLOY_ENV: 'production', VITE_AI_BOOKING_ASSISTANT_ENABLED: '1' })).toBe(false)
    expect(assistantClientEnabled({ VITE_AI_BOOKING_ASSISTANT_ENABLED: '1' })).toBe(false)
    expect(assistantClientEnabled({ VITE_SYBNB_DEPLOY_ENV: 'staging', VITE_AI_BOOKING_ASSISTANT_ENABLED: '0' })).toBe(false)
  })

  it('never treats a client flag as provider configuration', () => {
    expect(openAiConfigured({ SYBNB_DEPLOY_ENV: 'staging', AI_BOOKING_ASSISTANT_ENABLED: '1', VITE_OPENAI_API_KEY: 'leak' })).toBe(false)
    expect(openAiConfigured({ SYBNB_DEPLOY_ENV: 'staging', AI_BOOKING_ASSISTANT_ENABLED: '1', OPENAI_API_KEY: 'server-only' })).toBe(true)
  })

  it('reads the model after environment loading', () => {
    expect(openAiAssistantModel({ OPENAI_MODEL: 'staging-model' })).toBe('staging-model')
    expect(openAiAssistantModel({})).toBe('gpt-5.6-luna')
  })
})
