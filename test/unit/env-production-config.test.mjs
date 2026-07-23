import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateProductionConfig } from '../../server/lib/env.mjs'

const REQUIRED_KEYS = [
  'AUTH_SECRET',
  'PHONE_HASH_SECRET',
  'DATABASE_URL',
  'CORS_ORIGIN',
  'DISABLE_RATE_LIMIT',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'EMAIL_PROVIDER',
  'RESEND_API_KEY',
  'SMTP_HOST',
  // Persistent object storage (ADR-0010) — a production deployment without durable object storage
  // silently loses every uploaded photo and identity document, so these are part of the baseline.
  'STORAGE_DRIVER',
  'STORAGE_S3_ENDPOINT',
  'STORAGE_S3_REGION',
  'STORAGE_S3_ACCESS_KEY_ID',
  'STORAGE_S3_SECRET_ACCESS_KEY',
  'STORAGE_BUCKET_MEDIA',
  'STORAGE_BUCKET_DOCUMENTS',
]

function setValidBaseline() {
  process.env.AUTH_SECRET = 'a'.repeat(32)
  process.env.PHONE_HASH_SECRET = 'b'.repeat(32)
  process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/placeholder'
  process.env.CORS_ORIGIN = 'https://example.com'
  delete process.env.DISABLE_RATE_LIMIT
  // STR launch blocker P0 (distributed rate limiting, 2026-07-22): production now requires a real
  // shared rate-limit store -- the in-memory Map is dev/test-only (server/lib/rate-limit-store.mjs).
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'placeholder-token'
  // Resend hardening item 1: email is the sole launch verification channel, so a configured mailer
  // is part of a valid production baseline — otherwise every verification email silently fails.
  process.env.EMAIL_PROVIDER = 'resend'
  process.env.RESEND_API_KEY = 're_placeholder_key'
  delete process.env.SMTP_HOST
  // Persistent object storage (ADR-0010, 2026-07-22): production must use the S3/R2 driver against
  // production-named buckets. The local filesystem driver is dev/test-only — on this deployment
  // target it loses every uploaded object at instance replacement.
  process.env.STORAGE_DRIVER = 's3'
  process.env.STORAGE_S3_ENDPOINT = 'https://placeholder.eu.r2.cloudflarestorage.com'
  process.env.STORAGE_S3_REGION = 'auto'
  process.env.STORAGE_S3_ACCESS_KEY_ID = 'a'.repeat(32)
  process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'b'.repeat(64)
  process.env.STORAGE_BUCKET_MEDIA = 'sybnb-production-media'
  process.env.STORAGE_BUCKET_DOCUMENTS = 'sybnb-production-documents'
}

describe('SYB-018 — .env.production.example documents every production-required variable', () => {
  // SYB-018 was exactly a drift between the validator and the committed template: the template omitted
  // STORAGE_* and UPSTASH_* while validateProductionConfig required them, so an operator following the
  // template would ship a deployment that fails to boot (or silently loses uploads). This test binds
  // the two together — REQUIRED_KEYS above is the validator's contract; the template must document each.
  const template = readFileSync(new URL('../../.env.production.example', import.meta.url), 'utf8')

  // A key counts as "documented" whether active (KEY=) or a commented alternative/guard (# KEY=),
  // since SMTP_HOST is an alternative to Resend and DISABLE_RATE_LIMIT is a must-not-set guard.
  const documents = (key) => new RegExp(`^\\s*#?\\s*${key}=`, 'm').test(template)

  for (const key of REQUIRED_KEYS) {
    it(`documents ${key}`, () => {
      expect(documents(key), `${key} is required in production but missing from .env.production.example`).toBe(true)
    })
  }

  it('sets STORAGE_DRIVER to s3 in the production template (placeholder guidance, not local)', () => {
    expect(/^\s*STORAGE_DRIVER="s3"/m.test(template)).toBe(true)
  })

  it('carries no obviously-real secret values (placeholders only)', () => {
    // Guard against a real key being pasted into the committed template. Placeholders use replace_me /
    // <...> / example hosts; a real Resend key (re_ + long) or R2 secret would trip this.
    expect(template).not.toMatch(/re_[A-Za-z0-9]{20,}/)
    expect(template).not.toMatch(/sk-ant-[A-Za-z0-9]{20,}/)
  })
})

describe('validateProductionConfig: pre-existing checks still pass with a valid baseline', () => {
  const snapshot = {}

  beforeEach(() => {
    for (const key of [...REQUIRED_KEYS, ...Object.keys(process.env).filter((k) => k.startsWith('RATE_LIMIT_'))]) {
      snapshot[key] = process.env[key]
      delete process.env[key]
    }
    setValidBaseline()
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('RATE_LIMIT_') && !(key in snapshot)) delete process.env[key]
    }
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('does not throw with a fully valid baseline', () => {
    expect(() => validateProductionConfig()).not.toThrow()
  })

  it('throws when AUTH_SECRET is missing', () => {
    delete process.env.AUTH_SECRET
    expect(() => validateProductionConfig()).toThrow(/AUTH_SECRET/)
  })

  it('throws when DISABLE_RATE_LIMIT=1', () => {
    process.env.DISABLE_RATE_LIMIT = '1'
    expect(() => validateProductionConfig()).toThrow(/DISABLE_RATE_LIMIT/)
  })

  describe('new: email provider must be configured in production (Resend hardening item 1)', () => {
    it('throws when no email provider is configured', () => {
      delete process.env.EMAIL_PROVIDER
      delete process.env.RESEND_API_KEY
      delete process.env.SMTP_HOST
      expect(() => validateProductionConfig()).toThrow(/EMAIL|RESEND|mail/i)
    })

    it('throws when resend is selected but RESEND_API_KEY is missing', () => {
      process.env.EMAIL_PROVIDER = 'resend'
      delete process.env.RESEND_API_KEY
      delete process.env.SMTP_HOST
      expect(() => validateProductionConfig()).toThrow(/EMAIL|RESEND|mail/i)
    })

    it('does not throw when Resend is fully configured', () => {
      // baseline already sets EMAIL_PROVIDER=resend + RESEND_API_KEY
      expect(() => validateProductionConfig()).not.toThrow()
    })

    it('does not throw when SMTP is configured instead', () => {
      delete process.env.EMAIL_PROVIDER
      delete process.env.RESEND_API_KEY
      process.env.SMTP_HOST = 'smtp.example.test'
      expect(() => validateProductionConfig()).not.toThrow()
    })
  })

  describe('new: distributed rate-limit store is required in production (STR P0, 2026-07-22)', () => {
    it('throws when UPSTASH_REDIS_REST_URL is missing', () => {
      delete process.env.UPSTASH_REDIS_REST_URL
      expect(() => validateProductionConfig()).toThrow(/UPSTASH_REDIS_REST_URL/)
    })

    it('throws when UPSTASH_REDIS_REST_TOKEN is missing', () => {
      delete process.env.UPSTASH_REDIS_REST_TOKEN
      expect(() => validateProductionConfig()).toThrow(/UPSTASH_REDIS_REST_TOKEN/)
    })

    it('storage: throws when STORAGE_DRIVER is the local filesystem driver', () => {
      // The defect ADR-0010 exists to fix: local disk is not durable on this deployment target, so a
      // production process using it loses every upload while still reporting success.
      process.env.STORAGE_DRIVER = 'local'
      expect(() => validateProductionConfig()).toThrow(/STORAGE_DRIVER|local/i)
    })

    it('storage: throws when a required storage value is missing', () => {
      for (const key of [
        'STORAGE_S3_ENDPOINT',
        'STORAGE_S3_ACCESS_KEY_ID',
        'STORAGE_S3_SECRET_ACCESS_KEY',
        'STORAGE_BUCKET_MEDIA',
        'STORAGE_BUCKET_DOCUMENTS',
      ]) {
        setValidBaseline()
        delete process.env[key]
        expect(() => validateProductionConfig()).toThrow(new RegExp(key))
      }
    })

    it('storage: throws when a bucket name looks non-production', () => {
      process.env.STORAGE_BUCKET_DOCUMENTS = 'sybnb-test-documents'
      expect(() => validateProductionConfig()).toThrow(/test/i)
    })

    it('does not throw when both Upstash vars are set alongside an otherwise-valid baseline', () => {
      expect(() => validateProductionConfig()).not.toThrow()
    })
  })

  describe('new: RATE_LIMIT_* override validation', () => {
    it('does not throw when no RATE_LIMIT_* overrides are set', () => {
      expect(() => validateProductionConfig()).not.toThrow()
    })

    it('does not throw when a RATE_LIMIT_* override is a valid positive integer', () => {
      process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '10'
      expect(() => validateProductionConfig()).not.toThrow()
    })

    it('throws when a RATE_LIMIT_*_MAX override is non-numeric', () => {
      process.env.RATE_LIMIT_AUTH_LOGIN_MAX = 'not-a-number'
      expect(() => validateProductionConfig()).toThrow(/RATE_LIMIT_AUTH_LOGIN_MAX/)
    })

    it('throws when a RATE_LIMIT_*_MAX override is zero', () => {
      process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '0'
      expect(() => validateProductionConfig()).toThrow(/RATE_LIMIT_AUTH_LOGIN_MAX/)
    })

    it('throws when a RATE_LIMIT_*_MAX override is negative', () => {
      process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '-1'
      expect(() => validateProductionConfig()).toThrow(/RATE_LIMIT_AUTH_LOGIN_MAX/)
    })

    it('throws when a RATE_LIMIT_*_WINDOW_MS override is non-integer', () => {
      process.env.RATE_LIMIT_PUBLIC_SEARCH_WINDOW_MS = '60000.5'
      expect(() => validateProductionConfig()).toThrow(/RATE_LIMIT_PUBLIC_SEARCH_WINDOW_MS/)
    })

    it('reports every invalid RATE_LIMIT_* key, not just the first', () => {
      process.env.RATE_LIMIT_AUTH_LOGIN_MAX = 'bad'
      process.env.RATE_LIMIT_AUTH_REGISTER_WINDOW_MS = '-1'
      let caught
      try {
        validateProductionConfig()
      } catch (error) {
        caught = error
      }
      expect(caught).toBeDefined()
      expect(caught.message).toMatch(/RATE_LIMIT_AUTH_LOGIN_MAX/)
      expect(caught.message).toMatch(/RATE_LIMIT_AUTH_REGISTER_WINDOW_MS/)
    })
  })
})
