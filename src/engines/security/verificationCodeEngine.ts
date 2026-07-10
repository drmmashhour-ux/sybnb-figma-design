export type VerificationPurpose = 'guest-login' | 'staff-login' | 'seller-login' | 'payment-proof'

export type VerificationCodeDraft = {
  id: string
  code: string
  phone: string
  purpose: VerificationPurpose
  expiresAt: string
  messageAr: string
  messageEn: string
}

const CODE_TTL_MINUTES = 10

export function createVerificationCodeDraft(input: {
  phone: string
  purpose: VerificationPurpose
  now?: Date
}): VerificationCodeDraft {
  const now = input.now || new Date()
  const phone = normalizePhone(input.phone)
  const code = generateCode(phone, input.purpose, now)
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000).toISOString()

  return {
    id: `VC-${now.getTime().toString(36).toUpperCase()}`,
    code,
    phone,
    purpose: input.purpose,
    expiresAt,
    messageAr: `رسالة من SYBNB: أرسلنا رمز التحقق ${code} إلى رقم هاتفك ${maskPhone(phone)}. أدخل الرمز للمتابعة. صالح لمدة ${CODE_TTL_MINUTES} دقائق.`,
    messageEn: `SYBNB message: verification code ${code} was sent to your phone number ${maskPhone(phone)}. Enter the code to continue. Valid for ${CODE_TTL_MINUTES} minutes.`,
  }
}

export function verifyCodeDraft(draft: VerificationCodeDraft | null, code: string, now = new Date()) {
  if (!draft) return false
  if (new Date(draft.expiresAt).getTime() < now.getTime()) return false
  return draft.code === code.trim()
}

export function maskPhone(phone: string) {
  const normalized = normalizePhone(phone)
  if (normalized.length <= 5) return normalized
  return `${normalized.slice(0, 4)}••••${normalized.slice(-3)}`
}

function normalizePhone(phone: string) {
  return phone.trim().replace(/\s+/g, '')
}

function generateCode(phone: string, purpose: VerificationPurpose, now: Date) {
  const seed = `${phone}:${purpose}:${Math.floor(now.getTime() / 60000)}`
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  }
  return String(hash % 1000000).padStart(6, '0')
}
