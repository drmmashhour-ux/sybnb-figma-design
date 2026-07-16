import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../server/routes/reviews.mjs', import.meta.url), 'utf8')

describe('review protocol controls', () => {
  it('allows reviews only for the authenticated guest own booking after completion', () => {
    expect(source).toContain("requireAuth(context, ['GUEST'])")
    expect(source).toContain('guestId: context.user.id')
    expect(source).toContain("booking.status !== 'COMPLETED'")
    expect(source).toContain('REVIEW_BOOKING_NOT_COMPLETED')
  })

  it('prevents duplicate reviews for the same booking', () => {
    expect(source).toContain('listingReview.findUnique')
    expect(source).toContain('REVIEW_ALREADY_EXISTS')
    expect(source).toContain('statusCode = 409')
  })
})
