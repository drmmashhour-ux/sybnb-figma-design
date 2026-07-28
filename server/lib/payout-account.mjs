import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

// Reversible encryption for a host/driver Sham Cash payout account number. The platform must be
// able to READ the number back when admin actually pushes the payout, so this is symmetric
// (AES-256-GCM) rather than a one-way hash. The key is derived from AUTH_SECRET — the same root
// secret the rest of the server trusts — via scrypt with a fixed, versioned salt so the derived
// key is stable across restarts and previously-stored ciphertext stays decryptable.
const ALG = 'aes-256-gcm'
const KEY_SALT = 'sybnb.payout-account.v1'

function requiredSecret(name) {
  const value = process.env[name]
  if (!value) {
    const error = new Error(`${name} is required for this operation.`)
    error.statusCode = 500
    error.code = 'MISSING_SECRET'
    error.expose = true
    throw error
  }
  return value
}

function payoutKey() {
  return scryptSync(requiredSecret('AUTH_SECRET'), KEY_SALT, 32)
}

// Returns a JSON-serializable envelope safe to store in User.payoutMethod (Json). The plaintext
// number is never persisted — only its ciphertext, iv, and auth tag.
export function encryptPayoutAccount(plaintext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, payoutKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    alg: ALG,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

// Reverse of encryptPayoutAccount. Only admin payout-release code should ever call this; it returns
// null (never throws) on a tampered/mismatched envelope so callers can fail closed.
export function decryptPayoutAccount(payload) {
  if (!payload || typeof payload !== 'object' || payload.alg !== ALG) return null
  try {
    const decipher = createDecipheriv(ALG, payoutKey(), Buffer.from(payload.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
    const out = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ])
    return out.toString('utf8')
  } catch {
    return null
  }
}

export function payoutAccountLast4(value) {
  return String(value || '').replace(/\D/g, '').slice(-4)
}
