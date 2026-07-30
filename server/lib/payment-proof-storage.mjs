import { db } from './prisma.mjs'

// Persistent storage for an uploaded payment receipt (e.g. a Sham Cash plan-fee transfer proof).
//
// Unlike id-document-storage.mjs / listing-media-storage.mjs (which write to a local directory), this
// stores the bytes in the DATABASE. The runtime filesystem is ephemeral on serverless, so a disk-written
// proof would not reliably survive to admin-review time; a payment proof MUST persist, so it lives in
// its own `payment_proof_files` row keyed to the PaymentProof. Reading is admin-only (enforced by the
// route), and the bytes are never dragged into ordinary proof/listing queries.
export const ALLOWED_PAYMENT_PROOF_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export const MAX_PAYMENT_PROOF_BYTES = 8 * 1024 * 1024 // 8MB

function toValidatedBuffer(base64Data, mimeType) {
  if (!ALLOWED_PAYMENT_PROOF_TYPES[mimeType]) {
    const error = new Error('Payment proof must be a JPEG, PNG, or PDF file.')
    error.statusCode = 400
    error.code = 'PAYMENT_PROOF_TYPE_INVALID'
    error.expose = true
    throw error
  }
  const buffer = Buffer.from(base64Data || '', 'base64')
  if (!buffer.length) {
    const error = new Error('Payment proof file is empty.')
    error.statusCode = 400
    error.code = 'PAYMENT_PROOF_EMPTY'
    error.expose = true
    throw error
  }
  if (buffer.length > MAX_PAYMENT_PROOF_BYTES) {
    const error = new Error('Payment proof file must be smaller than 8MB.')
    error.statusCode = 400
    error.code = 'PAYMENT_PROOF_TOO_LARGE'
    error.expose = true
    throw error
  }
  return buffer
}

// Persist the proof bytes for a proof row. `client` is a Prisma client or transaction handle so the
// caller can create the proof + its file atomically. Validates type/size before writing.
export async function savePaymentProofFile(client, proofId, base64Data, mimeType) {
  const buffer = toValidatedBuffer(base64Data, mimeType)
  await client.paymentProofFile.create({
    data: { proofId, mimeType, data: buffer },
  })
}

// Read the stored bytes for a proof (admin-only path). Returns { data: Buffer, mimeType } or null.
export async function readPaymentProofFile(proofId) {
  const file = await db().paymentProofFile.findUnique({ where: { proofId } })
  if (!file) return null
  return { data: Buffer.from(file.data), mimeType: file.mimeType }
}
