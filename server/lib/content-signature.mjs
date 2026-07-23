// Magic-byte content validation.
//
// The `mimeType` on an upload arrives inside the JSON request body and is entirely attacker-
// controlled, so an allowlist check against it alone proves nothing: a PDF, an executable, or a
// script announced as "image/png" would pass. This module decides what a file actually is by reading
// its leading bytes, and refuses any upload whose real type disagrees with its declaration.
//
// Deliberate scope limit (threat model STG-11): this validates the *signature*, not the full
// internal structure of the file. A structurally well-formed but malicious image carrying a correct
// signature is still accepted. Deep parsing, transformation, and malware scanning are FUTURE
// HARDENING and are not attempted here — no image library is approved for this phase.

function startsWith(buffer, bytes) {
  if (buffer.length < bytes.length) return false
  for (let i = 0; i < bytes.length; i += 1) if (buffer[i] !== bytes[i]) return false
  return true
}

// Ordered most-specific first. Each entry returns the canonical MIME type for its signature.
const SIGNATURES = [
  { type: 'image/jpeg', test: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { type: 'image/png', test: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  {
    // RIFF is a container: "RIFF" alone could be a WAV or AVI. The WEBP marker at offset 8 is what
    // makes it an image, so both must be present.
    type: 'image/webp',
    test: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  { type: 'application/pdf', test: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]) },
]

/** The types the media path may store. PDF is detectable but deliberately not allowed here. */
export const MEDIA_SIGNATURE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

// The types the private-document paths may store. Images are included because a photograph of a
// passport or certificate is the normal way these are submitted — see the Phase 3 checkpoint report
// for the open owner decision on restricting this to PDF only.
export const DOCUMENT_SIGNATURE_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

/** Returns the detected MIME type, or null when the content is not recognised. */
export function detectContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null
  const match = SIGNATURES.find((signature) => signature.test(buffer))
  return match ? match.type : null
}

function contentError(message, code) {
  const error = new Error(message)
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

/**
 * Throws unless `buffer` really is one of `allowedTypes` AND that matches `declaredType`.
 * Error messages describe the content only — never a bucket, endpoint, key, or credential.
 */
export function assertContentMatchesDeclaredType(buffer, declaredType, allowedTypes) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw contentError('File is empty.', 'CONTENT_EMPTY')
  }

  if (!allowedTypes.includes(declaredType)) {
    throw contentError(
      `Unsupported file type. Allowed: ${allowedTypes.join(', ')}.`,
      'CONTENT_TYPE_UNSUPPORTED',
    )
  }

  const detected = detectContentType(buffer)
  if (!detected) {
    throw contentError('File content could not be recognised as a supported type.', 'CONTENT_UNRECOGNISED')
  }

  if (!allowedTypes.includes(detected)) {
    // Honest but non-specific: naming the detected type is useful feedback and reveals nothing
    // about storage internals.
    throw contentError(`File content is ${detected}, which is not allowed here.`, 'CONTENT_TYPE_NOT_ALLOWED')
  }

  if (detected !== declaredType) {
    throw contentError(
      `File content does not match the declared type (declared ${declaredType}, detected ${detected}).`,
      'CONTENT_TYPE_MISMATCH',
    )
  }

  return detected
}
