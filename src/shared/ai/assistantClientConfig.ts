export function assistantClientEnabled(env: Record<string, unknown>) {
  return env.VITE_AI_BOOKING_ASSISTANT_ENABLED === '1' && env.VITE_SYBNB_DEPLOY_ENV === 'staging'
}
