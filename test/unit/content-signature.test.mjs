import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_SIGNATURE_TYPES,
  MEDIA_SIGNATURE_TYPES,
  assertContentMatchesDeclaredType,
  detectContentType,
} from '../../server/lib/content-signature.mjs'

// Phase 2 — magic-byte validation. The declared MIME type arrives in the request body and is fully
// attacker-controlled, so it cannot be the only thing deciding what gets stored. These tests lock
// down that the DECODED BYTES are what determines the verdict.
//
// Scope limit stated honestly: this validates the file *signature*, not the full internal structure
// of the image. A well-formed-but-malicious image that carries a correct signature is still stored.
// Deep parsing and malware scanning are FUTURE HARDENING (threat model STG-11) and are deliberately
// not attempted here.

const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)])
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBP'), Buffer.alloc(64, 1)])
const pdf = () => Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(64, 1)])

describe('detectContentType reads the bytes, not the caller', () => {
  it('identifies each approved media type from its signature', () => {
    expect(detectContentType(jpeg())).toBe('image/jpeg')
    expect(detectContentType(png())).toBe('image/png')
    expect(detectContentType(webp())).toBe('image/webp')
  })

  it('identifies PDF so the media path can reject it explicitly', () => {
    expect(detectContentType(pdf())).toBe('application/pdf')
  })

  it('returns null for content it cannot identify', () => {
    expect(detectContentType(Buffer.from('#!/bin/sh\necho hi'))).toBeNull()
    expect(detectContentType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(detectContentType(Buffer.alloc(64, 0))).toBeNull()
  })

  it('does not mistake a truncated header for a valid type', () => {
    expect(detectContentType(Buffer.from([0xff, 0xd8]))).toBeNull()
    expect(detectContentType(Buffer.from('RIFF'))).toBeNull()
    // RIFF container that is not WebP (e.g. a WAV) must not pass as an image.
    expect(detectContentType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WAVE')]))).toBeNull()
  })
})

describe('assertContentMatchesDeclaredType — media path', () => {
  const allowed = MEDIA_SIGNATURE_TYPES

  it('accepts each approved type when the declaration matches the bytes', () => {
    expect(() => assertContentMatchesDeclaredType(jpeg(), 'image/jpeg', allowed)).not.toThrow()
    expect(() => assertContentMatchesDeclaredType(png(), 'image/png', allowed)).not.toThrow()
    expect(() => assertContentMatchesDeclaredType(webp(), 'image/webp', allowed)).not.toThrow()
  })

  it('rejects a declaration that disagrees with the bytes', () => {
    // A PNG announced as a JPEG: the declared type is plausible and allowlisted, but the bytes say
    // otherwise. Trusting the declaration is exactly the failure this check exists to prevent.
    expect(() => assertContentMatchesDeclaredType(png(), 'image/jpeg', allowed)).toThrow(/does not match/i)
    expect(() => assertContentMatchesDeclaredType(jpeg(), 'image/webp', allowed)).toThrow(/does not match/i)
  })

  it('rejects a PDF submitted through the media path even when honestly declared', () => {
    expect(() => assertContentMatchesDeclaredType(pdf(), 'application/pdf', allowed)).toThrow()
  })

  it('rejects a PDF disguised as an image', () => {
    // Rejected because the *detected* type is not allowed on this path — which fires before the
    // declared-vs-detected mismatch check. Either verdict is a rejection; this one names the real
    // problem (a PDF has no business in the media path at all) rather than the symptom.
    expect(() => assertContentMatchesDeclaredType(pdf(), 'image/png', allowed))
      .toThrow(/not allowed here|does not match/i)
  })

  it('rejects executable and script content', () => {
    const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64, 1)])
    const shell = Buffer.from('#!/bin/sh\nrm -rf /\n')
    expect(() => assertContentMatchesDeclaredType(elf, 'image/png', allowed)).toThrow()
    expect(() => assertContentMatchesDeclaredType(shell, 'image/png', allowed)).toThrow()
  })

  it('rejects SVG, which is never an approved media type', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(() => assertContentMatchesDeclaredType(svg, 'image/svg+xml', allowed)).toThrow()
  })

  it('rejects an empty body before any signature work', () => {
    expect(() => assertContentMatchesDeclaredType(Buffer.alloc(0), 'image/png', allowed)).toThrow(/empty/i)
  })

  it('never reports storage or provider detail in its error', () => {
    try {
      assertContentMatchesDeclaredType(pdf(), 'image/png', allowed)
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.message).not.toMatch(/bucket|endpoint|r2\.cloudflarestorage|accessKey|secret/i)
    }
  })
})

// Owner decision 2026-07-22: the document policy is PDF, JPEG and PNG. The formats below were
// explicitly enumerated as NOT allowed until a future owner decision expands the policy. This locks
// that list down so an allowlist edit cannot quietly re-admit one — each is tried in the most
// favourable case for an attacker, declared as an approved type.
describe('document policy — explicitly prohibited formats stay rejected', () => {
  const prohibited = {
    webp: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBP'), Buffer.alloc(32, 1)]),
    gif: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32, 1)]),
    svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    heic: Buffer.concat([Buffer.alloc(4, 0), Buffer.from('ftypheic'), Buffer.alloc(32, 1)]),
    tiff: Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(32, 1)]),
    zip: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32, 1)]),
    executable: Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(32, 1)]),
    officeDocument: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(32, 1)]),
  }

  it('the approved document policy is exactly PDF, JPEG and PNG', () => {
    expect([...DOCUMENT_SIGNATURE_TYPES].sort()).toEqual(['application/pdf', 'image/jpeg', 'image/png'])
  })

  it('rejects every prohibited format even when declared as an approved type', () => {
    for (const [name, buffer] of Object.entries(prohibited)) {
      for (const declared of DOCUMENT_SIGNATURE_TYPES) {
        expect(() => assertContentMatchesDeclaredType(buffer, declared, DOCUMENT_SIGNATURE_TYPES),
          `${name} declared as ${declared}`).toThrow()
      }
    }
  })

  it('WebP is valid media but never a valid document', () => {
    // The one format that is legitimately allowed elsewhere — proving the two allowlists are
    // genuinely separate rather than accidentally shared.
    expect(() => assertContentMatchesDeclaredType(prohibited.webp, 'image/webp', MEDIA_SIGNATURE_TYPES)).not.toThrow()
    expect(() => assertContentMatchesDeclaredType(prohibited.webp, 'image/webp', DOCUMENT_SIGNATURE_TYPES)).toThrow()
  })
})
