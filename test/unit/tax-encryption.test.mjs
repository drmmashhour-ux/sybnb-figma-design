import { describe, expect, it } from 'vitest'

// Self-contained on purpose: test/unit deliberately requires no .env.test / real database (see
// vitest.unit.config.ts), so this sets its own throwaway key rather than depending on any env file.
// tax-encryption.mjs reads TAX_PROFILE_ENCRYPTION_KEY lazily inside loadKey() at call time, not at
// import time, so setting it here before any encrypt/decrypt call is sufficient regardless of
// import order.
process.env.TAX_PROFILE_ENCRYPTION_KEY = 'a'.repeat(64)

const { decryptSensitive, encryptSensitive, generateEncryptionKeyHex, lastFour, maskedDisplay } = await import('../../server/lib/tax-encryption.mjs')

describe('encryptSensitive / decryptSensitive: SIN/TIN and payout identifier round-trip', () => {
  it('round-trips a value exactly', () => {
    const encrypted = encryptSensitive('123-456-789')
    expect(encrypted).not.toContain('123-456-789')
    expect(decryptSensitive(encrypted)).toBe('123-456-789')
  })

  it('never returns the plaintext as a substring of the ciphertext (basic leak check)', () => {
    const encrypted = encryptSensitive('ACC-9988776655')
    expect(encrypted.includes('9988776655')).toBe(false)
  })

  it('two encryptions of the same value produce different ciphertext (random IV per call)', () => {
    const a = encryptSensitive('same-value')
    const b = encryptSensitive('same-value')
    expect(a).not.toBe(b)
    expect(decryptSensitive(a)).toBe('same-value')
    expect(decryptSensitive(b)).toBe('same-value')
  })

  it('rejects an empty value', () => {
    expect(() => encryptSensitive('')).toThrow()
    expect(() => encryptSensitive('   ')).toThrow()
  })

  it('detects tampering: a corrupted ciphertext fails to decrypt rather than silently returning wrong data', () => {
    const encrypted = encryptSensitive('123-456-789')
    const [iv, tag, ciphertext] = encrypted.split(':')
    const tampered = [iv, tag, ciphertext.slice(0, -4) + 'AAAA'].join(':')
    expect(() => decryptSensitive(tampered)).toThrow()
  })

  it('rejects a malformed stored value (wrong shape)', () => {
    expect(() => decryptSensitive('not-a-valid-stored-value')).toThrow()
  })
})

describe('lastFour / maskedDisplay: the only plaintext fragment ever shown again', () => {
  it('extracts the last 4 alphanumeric characters, ignoring separators', () => {
    expect(lastFour('123-456-789')).toBe('6789')
    expect(lastFour('ACC-9988776655')).toBe('6655')
    expect(lastFour('AB')).toBe('AB')
    expect(lastFour('')).toBe('')
  })

  it('formats a masked display that never contains more than the last 4 characters', () => {
    const masked = maskedDisplay('6789')
    expect(masked.endsWith('6789')).toBe(true)
    expect(masked).not.toContain('123-456-789')
    expect(maskedDisplay('')).toBe('••••')
  })
})

describe('generateEncryptionKeyHex: operator convenience for provisioning TAX_PROFILE_ENCRYPTION_KEY', () => {
  it('generates a 64-hex-char (32-byte) key', () => {
    const key = generateEncryptionKeyHex()
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})
