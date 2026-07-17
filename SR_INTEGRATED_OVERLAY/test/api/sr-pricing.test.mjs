import { describe, expect, it } from 'vitest'
import { computeFareMultiplier, SR_PRICING_CONFIG } from '../../server/lib/sr-pricing.mjs'

// Pure function — deterministic given a UTC instant. Syria is UTC+3, so local hour = (UTC hour + 3) % 24.
// A date is passed explicitly (no reliance on the clock).
describe('SR dynamic pricing multiplier (night / traffic / holiday / high season)', () => {
  it('applies no multiplier at an off-peak daytime, non-holiday, off-season instant', () => {
    // Local Damascus: 2026-03-10 11:00 (UTC 08:00). Not night, not rush, not holiday, not high season.
    const r = computeFareMultiplier(new Date('2026-03-10T08:00:00Z'))
    expect(r.multiplier).toBe(1)
    expect(r.factors).toHaveLength(0)
  })

  it('applies the night multiplier at 23:00 local', () => {
    // Local 23:00 = UTC 20:00.
    const r = computeFareMultiplier(new Date('2026-03-10T20:00:00Z'))
    expect(r.factors.some((f) => f.label === 'Night')).toBe(true)
    expect(r.multiplier).toBeCloseTo(SR_PRICING_CONFIG.night.multiplier, 3)
  })

  it('applies the evening-traffic multiplier at 17:00 local (not night)', () => {
    // Local 17:00 = UTC 14:00.
    const r = computeFareMultiplier(new Date('2026-03-10T14:00:00Z'))
    expect(r.factors.some((f) => f.label === 'Evening traffic')).toBe(true)
    expect(r.factors.some((f) => f.label === 'Night')).toBe(false)
  })

  it('stacks holiday + night, and shows the breakdown', () => {
    // Local 2026-01-01 23:00 = UTC 2026-01-01T20:00 (Syria UTC+3). Holiday (01-01) AND night.
    const r = computeFareMultiplier(new Date('2026-01-01T20:00:00Z'))
    const labels = r.factors.map((f) => f.label)
    expect(labels).toContain('Holiday')
    expect(labels).toContain('Night')
    // 1.25 (night) * 1.5 (holiday) = 1.875, under the 2.5 cap
    expect(r.multiplier).toBeCloseTo(1.875, 3)
  })

  it('applies the high-season multiplier in summer', () => {
    // Local 2026-07-15 12:00 (UTC 09:00) — within 06-15..09-15 high season, daytime.
    const r = computeFareMultiplier(new Date('2026-07-15T09:00:00Z'))
    expect(r.factors.some((f) => f.label === 'High season')).toBe(true)
  })

  it('never exceeds the max multiplier cap', () => {
    // Force a stacked scenario and confirm the cap holds.
    const config = {
      ...SR_PRICING_CONFIG,
      night: { fromHour: 0, toHour: 24, multiplier: 2 },
      holidays: { dates: ['01-01'], multiplier: 2, label: 'Holiday' },
      highSeason: { ranges: [{ from: '01-01', to: '12-31' }], multiplier: 2, label: 'High season' },
      maxMultiplier: 2.5,
    }
    const r = computeFareMultiplier(new Date('2026-01-01T09:00:00Z'), config)
    expect(r.multiplier).toBe(2.5)
    expect(r.capped).toBe(true)
  })
})
