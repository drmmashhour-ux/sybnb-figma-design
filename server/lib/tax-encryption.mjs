import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Tax-compliance foundation (029): the ONLY reversible-encryption primitive in this codebase.
// Everything else in security.mjs is one-way hashing (passwords, phone lookup, email codes) --
// SIN/TIN and banking/payout identifiers need to be recoverable (for a verifier to review the real
// value, and for remittance once that's ever activated) while never being shown in full again after
// initial submission, which one-way hashing can't support. AES-256-GCM: authenticated encryption, so
// tampering with stored ciphertext is detected (decrypt throws) rather than silently corrupting data.
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96-bit IV is the AES-GCM-recommended size (not the AES block size, 16).
const KEY_LENGTH = 32 // AES-256

function loadKey() {
  const raw = process.env.TAX_PROFILE_ENCRYPTION_KEY
  if (!raw) {
    const error = new Error('TAX_PROFILE_ENCRYPTION_KEY is required to store or read encrypted tax-profile fields.')
    error.statusCode = 500
    error.code = 'MISSING_SECRET'
    error.expose = true
    throw error
  }
  const key = Buffer.from(raw, 'hex')
  if (key.length !== KEY_LENGTH) {
    const error = new Error('TAX_PROFILE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).')
    error.statusCode = 500
    error.code = 'INVALID_SECRET'
    error.expose = true
    throw error
  }
  return key
}

// Stored as iv:authTag:ciphertext, each base64 -- one TEXT column holds everything needed to decrypt.
export function encryptSensitive(plaintext) {
  const value = String(plaintext ?? '').trim()
  if (!value) {
    const error = new Error('A value is required to encrypt.')
    error.statusCode = 400
    error.code = 'ENCRYPTION_VALUE_REQUIRED'
    error.expose = true
    throw error
  }
  const key = loadKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':')
}

export function decryptSensitive(stored) {
  const parts = String(stored || '').split(':')
  if (parts.length !== 3) {
    const error = new Error('Stored value is not a recognized encrypted tax-profile field.')
    error.statusCode = 500
    error.code = 'DECRYPTION_FORMAT_INVALID'
    error.expose = false
    throw error
  }
  const [ivB64, authTagB64, ciphertextB64] = parts
  const key = loadKey()
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()])
  return plaintext.toString('utf8')
}

// The only fragment of a sensitive identifier ever kept in plaintext -- stored alongside the
// ciphertext (TaxProfile.taxIdentifierLast4 / payoutAccountLast4) so masked display never needs to
// decrypt on every page render. Non-alphanumeric characters (dashes, spaces) are stripped first so
// "123-456-789" and "123456789" mask the same way.
export function lastFour(plaintext) {
  const digits = String(plaintext || '').replace(/[^a-zA-Z0-9]/g, '')
  return digits.slice(-4)
}

// Bilingual-safe masked display -- digits/letters carry no language, so one formatter serves both.
export function maskedDisplay(last4, { groupSize = 3 } = {}) {
  const tail = String(last4 || '').slice(-4)
  if (!tail) return '••••'
  const dots = '•'.repeat(Math.max(0, groupSize * 2))
  return `${dots}${tail}`
}

// Generates a fresh 64-hex-char key for TAX_PROFILE_ENCRYPTION_KEY -- an operator convenience, not
// called by any request path. Run with: node -e "import('./server/lib/tax-encryption.mjs').then(m => console.log(m.generateEncryptionKeyHex()))"
export function generateEncryptionKeyHex() {
  return randomBytes(KEY_LENGTH).toString('hex')
}
