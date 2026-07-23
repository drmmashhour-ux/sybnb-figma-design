// Private document download presentation (threat model STG-12).
//
// Private documents were previously served with only a content-type, so a PDF rendered INLINE in the
// reviewer's authenticated, same-origin browser session. The strict CSP on API responses
// (default-src 'none') mitigates a great deal, but CSP enforcement inside a browser's built-in PDF
// viewer is implementation-dependent, so it must not be the only defence. Private documents are now
// forced to download.
//
// Nothing here is a content guarantee. PDF signature validation is not malware scanning, and it says
// nothing about whether the document's internal structure is safe. Deep parsing, antivirus,
// sandboxing and content-disarm remain future hardening.

const EXTENSION_BY_MIME = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

// Categories are chosen by the server, never by a request. This is an allowlist rather than a
// sanitiser precisely so a caller-supplied value can never reach the header at all.
const KNOWN_CATEGORIES = new Set(['identity', 'listing', 'thread', 'verification', 'document'])

/**
 * Builds the download filename. Derived entirely from server-side values: a known category plus the
 * stored MIME type. The storage key, the owning user, and any caller input are excluded by
 * construction — there is no code path that puts them in the name.
 */
export function safeDownloadFilename({ category, mimeType }) {
  const extension = EXTENSION_BY_MIME[mimeType] || 'bin'
  const normalized = String(category || '').toLowerCase().replace(/[^a-z]/g, '')
  const safeCategory = KNOWN_CATEGORIES.has(normalized) ? normalized : 'document'
  return `sybnb-${safeCategory}.${extension}`
}

/**
 * Response headers for a private document. `byteLength` is omitted when unknown rather than guessed.
 */
export function privateDocumentDownloadHeaders({ mimeType, category, byteLength }) {
  const headers = {
    // Derived from the stored record, never from the request.
    'content-type': mimeType || 'application/octet-stream',
    'content-disposition': `attachment; filename="${safeDownloadFilename({ category, mimeType })}"`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  }
  if (typeof byteLength === 'number' && Number.isFinite(byteLength)) {
    headers['content-length'] = byteLength
  }
  return headers
}
