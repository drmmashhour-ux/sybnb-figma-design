import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../server/routes/listings.mjs', import.meta.url), 'utf8')

describe('listing visibility protocol controls', () => {
  it('public listing search/detail/quote only expose approved listings', () => {
    expect(source).toContain("status: 'APPROVED'")
    expect(source).toContain('LISTING_NOT_FOUND')
  })

  it('paid-plan divisions require an approved seller profile before publishing', () => {
    expect(source).toContain('PAID_PLAN_DIVISIONS')
    expect(source).toContain("sellerProfile.documentStatus !== 'APPROVED'")
    expect(source).toContain('SELLER_PLAN_REQUIRED')
  })
})
