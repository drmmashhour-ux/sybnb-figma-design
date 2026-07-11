import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadEnv(path = '.env') {
  const file = resolve(process.cwd(), path)
  if (!existsSync(file)) return

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const equalsAt = trimmed.indexOf('=')
    if (equalsAt === -1) continue

    const key = trimmed.slice(0, equalsAt).trim()
    const rawValue = trimmed.slice(equalsAt + 1).trim()
    const value = rawValue.replace(/^["']|["']$/g, '')
    if (key && process.env[key] == null) {
      process.env[key] = value
    }
  }
}

// Security audit finding "production configuration validation" (Phase 6, minimum repair #8):
// fails loudly at startup rather than silently running with dev-only-safe defaults in production.
// Only called when NODE_ENV=production (see index.mjs) — local dev is unaffected.
export function validateProductionConfig() {
  const problems = []

  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 16) {
    problems.push('AUTH_SECRET must be set to a value at least 16 characters long.')
  }
  if (!process.env.PHONE_HASH_SECRET || process.env.PHONE_HASH_SECRET.length < 16) {
    problems.push('PHONE_HASH_SECRET must be set to a value at least 16 characters long.')
  }
  if (!process.env.DATABASE_URL) {
    problems.push('DATABASE_URL must be set.')
  }
  if (!process.env.CORS_ORIGIN) {
    problems.push('CORS_ORIGIN must be set explicitly in production — the built-in dev fallback only allows localhost origins.')
  }
  if (process.env.DISABLE_RATE_LIMIT === '1') {
    problems.push('DISABLE_RATE_LIMIT must not be "1" in production.')
  }

  if (problems.length) {
    const message = `Refusing to start with NODE_ENV=production and unsafe configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`
    throw new Error(message)
  }
}
