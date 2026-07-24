import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isDateSelectable } from '../../src/modules/search/DateRangePicker'

// FIX 3 — the shared date picker (search + listing + booking) must not let a guest pick a day before
// today. isDateSelectable is the single pure predicate both the render and the click handler use, so a
// past day is greyed AND unclickable everywhere at once. ISO YYYY-MM-DD strings compare chronologically.

describe('FIX 3 — isDateSelectable blocks past + unavailable days', () => {
  const todayIso = '2026-07-24'

  it('a day before today is not selectable', () => {
    expect(isDateSelectable('2026-07-20', { todayIso })).toBe(false)
    expect(isDateSelectable('2026-07-23', { todayIso })).toBe(false)
  })

  it('today itself is selectable', () => {
    expect(isDateSelectable('2026-07-24', { todayIso })).toBe(true)
  })

  it('a future day is selectable', () => {
    expect(isDateSelectable('2026-08-01', { todayIso })).toBe(true)
  })

  it('an availability-disabled day is not selectable even when future', () => {
    expect(isDateSelectable('2026-08-01', { todayIso, disabledDates: new Set(['2026-08-01']) })).toBe(false)
  })

  it('an empty/invalid iso is not selectable', () => {
    expect(isDateSelectable('', { todayIso })).toBe(false)
  })
})

describe('FIX 3 — DateRangePicker wires isDateSelectable into render + selection', () => {
  const picker = readFileSync(new URL('../../src/modules/search/DateRangePicker.tsx', import.meta.url), 'utf8')

  it('computes a todayIso reference', () => {
    expect(picker).toMatch(/todayIso/)
  })

  it('uses isDateSelectable for both the disabled state and the click guard', () => {
    // At least twice: once deriving isDisabled in render, once guarding selectDay.
    const uses = (picker.match(/isDateSelectable\(/g) || []).length
    expect(uses).toBeGreaterThanOrEqual(2)
  })
})
