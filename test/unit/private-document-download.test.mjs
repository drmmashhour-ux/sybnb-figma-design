import { describe, expect, it } from 'vitest'
import {
  privateDocumentDownloadHeaders,
  safeDownloadFilename,
} from '../../server/lib/private-document-download.mjs'

// Phase 3 — private document download headers (threat model STG-12).
//
// Private documents were served with a content-type and no Content-Disposition, so a PDF rendered
// INLINE in an authenticated reviewer's browser session. These tests lock down forced download, a
// filename the caller cannot influence, and headers that reveal nothing about storage.

describe('safeDownloadFilename', () => {
  it('always produces a .pdf name for a pdf document', () => {
    expect(safeDownloadFilename({ category: 'identity', mimeType: 'application/pdf' })).toMatch(/\.pdf$/)
  })

  it('matches the extension to the stored mime type, not to a caller value', () => {
    expect(safeDownloadFilename({ category: 'identity', mimeType: 'image/png' })).toMatch(/\.png$/)
    expect(safeDownloadFilename({ category: 'identity', mimeType: 'image/jpeg' })).toMatch(/\.jpg$/)
  })

  it('never contains path separators or traversal', () => {
    const name = safeDownloadFilename({ category: '../../etc/passwd', mimeType: 'application/pdf' })
    expect(name).not.toMatch(/[/\\]/)
    expect(name).not.toContain('..')
  })

  it('never contains control characters or header-injection sequences', () => {
    const hostile = 'inv\r\noice"; X-Injected: yes'
    const name = safeDownloadFilename({ category: hostile, mimeType: 'application/pdf' })
    expect(name).not.toMatch(/[\r\n"]/)
    // eslint-disable-next-line no-control-regex
    expect(name).not.toMatch(/[\x00-\x1f]/)
  })

  it('does not expose the storage key or internal identifiers', () => {
    const key = '4d0ea46c-7f62-4345-8be8-42c440c16e63.pdf'
    const name = safeDownloadFilename({ category: 'identity', mimeType: 'application/pdf', storageKey: key })
    expect(name).not.toContain('4d0ea46c')
    expect(name).not.toContain(key)
  })

  it('falls back to a generic name when the category is unusable', () => {
    for (const category of ['', null, undefined, '///', '...']) {
      const name = safeDownloadFilename({ category, mimeType: 'application/pdf' })
      expect(name).toMatch(/^[a-z0-9-]+\.pdf$/)
    }
  })
})

describe('privateDocumentDownloadHeaders', () => {
  const headers = (over = {}) => privateDocumentDownloadHeaders({
    mimeType: 'application/pdf', category: 'identity', byteLength: 1234, ...over,
  })

  it('forces download rather than inline rendering', () => {
    expect(headers()['content-disposition']).toMatch(/^attachment; filename="[^"]+\.pdf"$/)
  })

  it('uses the stored mime type as content-type', () => {
    expect(headers()['content-type']).toBe('application/pdf')
    expect(headers({ mimeType: 'image/png' })['content-type']).toBe('image/png')
  })

  it('sets content-length when the byte length is known', () => {
    expect(headers()['content-length']).toBe(1234)
    expect(headers({ byteLength: undefined })['content-length']).toBeUndefined()
  })

  it('keeps private documents out of every cache', () => {
    expect(headers()['cache-control']).toBe('private, no-store')
  })

  it('keeps nosniff so the browser cannot re-interpret the body', () => {
    expect(headers()['x-content-type-options']).toBe('nosniff')
  })

  it('never leaks bucket, endpoint, account id, credential or filesystem path', () => {
    const serialized = JSON.stringify(headers({ category: 'identity' }))
    expect(serialized).not.toMatch(/r2\.cloudflarestorage|sybnb-(test|staging|production)-|accessKey|secretAccess|\/uploads\//i)
  })
})
