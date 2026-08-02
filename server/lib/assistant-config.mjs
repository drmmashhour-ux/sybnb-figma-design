export function assistantEnabled(env = process.env) {
  return env.AI_BOOKING_ASSISTANT_ENABLED === '1' && env.SYBNB_DEPLOY_ENV === 'staging'
}

export function assertAssistantProductionSafe(env = process.env) {
  if (env.AI_BOOKING_ASSISTANT_ENABLED === '1' && env.SYBNB_DEPLOY_ENV !== 'staging') {
    throw new Error('AI_BOOKING_ASSISTANT_ENABLED may only be enabled when SYBNB_DEPLOY_ENV=staging.')
  }
}

export function openAiConfigured(env = process.env) {
  return assistantEnabled(env) && Boolean(env.OPENAI_API_KEY)
}

export const OPENAI_ASSISTANT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna'
