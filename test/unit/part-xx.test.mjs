import { describe, expect, it } from 'vitest'
import { PART_XX_DISCLAIMER, buildPartXXXml, buildT619TransmissionRecord, quarterBounds, renderPartXXAnnualStatement } from '../../server/lib/part-xx.mjs'

describe('quarterBounds', () => {
  it('computes the correct UTC boundaries for each quarter', () => {
    expect(quarterBounds(2026, 1)).toEqual({ periodStart: new Date(Date.UTC(2026, 0, 1)), periodEnd: new Date(Date.UTC(2026, 3, 1)) })
    expect(quarterBounds(2026, 2)).toEqual({ periodStart: new Date(Date.UTC(2026, 3, 1)), periodEnd: new Date(Date.UTC(2026, 6, 1)) })
    expect(quarterBounds(2026, 3)).toEqual({ periodStart: new Date(Date.UTC(2026, 6, 1)), periodEnd: new Date(Date.UTC(2026, 9, 1)) })
    expect(quarterBounds(2026, 4)).toEqual({ periodStart: new Date(Date.UTC(2026, 9, 1)), periodEnd: new Date(Date.UTC(2027, 0, 1)) })
  })

  it('rejects an invalid quarter', () => {
    expect(() => quarterBounds(2026, 0)).toThrow()
    expect(() => quarterBounds(2026, 5)).toThrow()
    expect(() => quarterBounds(2026, 1.5)).toThrow()
  })
})

describe('buildPartXXXml: structural export shape', () => {
  const records = [
    { sellerId: 'driver-1', activityType: 'RIDE', grossConsiderationMinor: 24000, currency: 'SYP', activityCount: 1, platformFeesMinor: 3600, taxesWithheldMinor: 0, refundsMinor: 0, propertyAddress: null },
    { sellerId: 'host-1', activityType: 'ACCOMMODATION', grossConsiderationMinor: 100000, currency: 'CAD', activityCount: 2, platformFeesMinor: 13000, taxesWithheldMinor: 3500, refundsMinor: 0, propertyAddress: '123 Rue Test, Montreal' },
  ]

  it('includes every record with its key fields, XML-escaped', () => {
    const xml = buildPartXXXml(records, { year: 2026, quarter: 3 })
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('year="2026" quarter="3"')
    expect(xml).toContain('<SellerId>driver-1</SellerId>')
    expect(xml).toContain('<ActivityType>RIDE</ActivityType>')
    expect(xml).toContain('<GrossConsiderationMinor>24000</GrossConsiderationMinor>')
    expect(xml).toContain('<PropertyAddress>123 Rue Test, Montreal</PropertyAddress>')
  })

  it('escapes XML special characters in seller-controlled fields', () => {
    const xml = buildPartXXXml([{ ...records[1], propertyAddress: '5 O\'Brien & <Test> St' }], { year: 2026, quarter: 3 })
    expect(xml).not.toContain('5 O\'Brien & <Test> St')
    expect(xml).toContain('&amp;')
    expect(xml).toContain('&lt;Test&gt;')
    expect(xml).toContain('&apos;')
  })

  it('produces valid-looking XML with matched root tags', () => {
    const xml = buildPartXXXml(records, { year: 2026, quarter: 3 })
    expect(xml.trim().startsWith('<?xml')).toBe(true)
    expect(xml.trim().endsWith('</PartXXInformationReturn>')).toBe(true)
  })

  it('labels the export as an unvalidated test artifact, never implying a real CRA-ready file', () => {
    const xml = buildPartXXXml(records, { year: 2026, quarter: 3 })
    expect(xml).toContain('UNVALIDATED TEST EXPORT')
    expect(xml).toContain('exportStatus="UNVALIDATED_TEST_EXPORT"')
  })
})

describe('buildT619TransmissionRecord', () => {
  it('produces a structural placeholder, clearly labeled as such', () => {
    const t619 = buildT619TransmissionRecord({ filingId: 'abcdef12-3456-7890-abcd-ef1234567890', year: 2026, quarter: 3, recordCount: 2 })
    expect(t619.formType).toBe('T619_STRUCTURAL_PLACEHOLDER')
    expect(t619.taxationYear).toBe(2026)
    expect(t619.quarter).toBe(3)
    expect(t619.numberOfRecords).toBe(2)
    expect(t619.transmissionRef).toContain('2026Q3')
  })
})

describe('renderPartXXAnnualStatement: bilingual Part XX Annual Platform Statement', () => {
  const records = [
    { activityType: 'RIDE', grossConsiderationMinor: 500000, currency: 'SYP', activityCount: 20, platformFeesMinor: 60000, taxesWithheldMinor: 0, refundsMinor: 5000, propertyAddress: null },
  ]

  it('carries the required non-official-slip disclaimer in English', () => {
    const doc = renderPartXXAnnualStatement(records, { year: 2026, lang: 'en', sellerName: 'Test Seller' })
    expect(doc).toContain('Part XX Annual Platform Statement')
    expect(doc).toContain(PART_XX_DISCLAIMER.en)
    expect(doc).toContain('Test Seller')
    expect(doc).toContain('500,000 SYP')
  })

  it('carries the required disclaimer in French', () => {
    const doc = renderPartXXAnnualStatement(records, { year: 2026, lang: 'fr', sellerName: 'Vendeur Test' })
    expect(doc).toContain('Relevé annuel de plateforme')
    expect(doc).toContain(PART_XX_DISCLAIMER.fr)
  })

  it("the document's own title never claims to be a T4, RL-1, RL-27, or T4A (the disclaimer line is allowed to name them, only to deny it)", () => {
    const doc = renderPartXXAnnualStatement(records, { year: 2026, lang: 'en' })
    const title = doc.split('\n')[0]
    expect(title).toBe('Part XX Annual Platform Statement')
    expect(title).not.toMatch(/T4|RL-1|RL-27|T4A/)
    // The disclaimer is required to be present verbatim, and it legitimately mentions these forms
    // in order to deny being one of them -- that's the whole point of item A's required notice.
    expect(doc).toContain('This is not a T4, RL-1, T4A or other employment slip')
  })
})
