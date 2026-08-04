import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { safePositiveInt } from './rate-limit.mjs'

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
  if (process.env.ALLOW_PREVIEW_DEMO_LOGIN === '1' && process.env.VERCEL_ENV !== 'preview') {
    problems.push('ALLOW_PREVIEW_DEMO_LOGIN may only be "1" when VERCEL_ENV is exactly "preview".')
  }
  // The deploy target is Vercel (serverless / multi-instance). The default in-memory limiter keeps its
  // buckets in per-instance process memory, so without the shared DB store each warm instance grants a
  // fresh limit and the effective cap multiplies by the instance count — defeating the login / OTP /
  // gift-claim brute-force limits under load. Require the shared store in production; fail closed.
  if (process.env.RATE_LIMIT_STORE !== 'db') {
    problems.push('RATE_LIMIT_STORE must be "db" in production — the in-memory limiter is per-instance and does not enforce a shared limit on serverless/multi-instance.')
  }

  // A typo'd RATE_LIMIT_<NAME>_MAX/_WINDOW_MS (non-numeric, zero, negative, non-integer) would
  // silently fall back to the caller's default at request time (see
  // server/lib/rate-limit.mjs's safePositiveInt) rather than crash — safe at runtime, but a
  // production deployment should still be told loudly at startup that one of its rate-limit
  // overrides is malformed, rather than quietly running with a value nobody intended.
  const sentinel = Symbol('invalid')
  for (const [key, rawValue] of Object.entries(process.env)) {
    if (!/^RATE_LIMIT_.+_(MAX|WINDOW_MS)$/.test(key)) continue
    if (safePositiveInt(rawValue, sentinel) === sentinel) {
      problems.push(`${key}="${rawValue}" is not a valid positive integer — fix or unset it.`)
    }
  }

  // Topology-dependent, so a warning rather than a hard failure: on a proxied serverless origin,
  // TRUST_PROXY must be "1" or clientIp() falls back to the proxy's address and every unauthenticated
  // client collapses into a single per-IP bucket (self-DoS — the first N logins lock out everyone).
  // Conversely TRUST_PROXY=1 is only safe if the origin rejects direct non-proxy traffic.
  if (process.env.VERCEL && process.env.TRUST_PROXY !== '1') {
    console.warn(
      '[sybnb] WARNING: running on Vercel with TRUST_PROXY!="1" — per-IP rate limits will bucket all ' +
        'clients under the proxy address (self-DoS risk). Set TRUST_PROXY=1 and ensure the origin only ' +
        'accepts proxied traffic.',
    )
  }

  if (problems.length) {
    const message = `Refusing to start with NODE_ENV=production and unsafe configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`
    throw new Error(message)
  }
}
