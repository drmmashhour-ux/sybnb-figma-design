import { describe, expect, it } from 'vitest'
import {
  applyAdjustments,
  computeAutoAdjustments,
  hasVisibleEffect,
  NEUTRAL_ADJUSTMENTS,
  type PixelBuffer,
} from '../../src/shared/photo/enhanceImage'

// The pure pixel math backs the on-device photo editor (src/shared/photo/). It runs in the host's
// browser, but the math is DOM-free so we can pin its behaviour here without a canvas.

function solid(r: number, g: number, b: number, w = 2, h = 2): PixelBuffer {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  return { data, width: w, height: h }
}

describe('photo enhance capsule — pure adjustments', () => {
  it('brightness lifts every channel and clamps at 255', () => {
    const buf = solid(100, 100, 100)
    applyAdjustments(buf, { ...NEUTRAL_ADJUSTMENTS, brightness: 100 }) // +80 levels
    expect(buf.data[0]).toBe(180)
    expect(buf.data[1]).toBe(180)

    const bright = solid(250, 250, 250)
    applyAdjustments(bright, { ...NEUTRAL_ADJUSTMENTS, brightness: 100 })
    expect(bright.data[0]).toBe(255) // clamped, not wrapped
  })

  it('negative brightness darkens and clamps at 0', () => {
    const buf = solid(20, 20, 20)
    applyAdjustments(buf, { ...NEUTRAL_ADJUSTMENTS, brightness: -100 })
    expect(buf.data[0]).toBe(0)
  })

  it('alpha channel is preserved', () => {
    const buf = solid(120, 120, 120)
    applyAdjustments(buf, { ...NEUTRAL_ADJUSTMENTS, brightness: 50, contrast: 30 })
    expect(buf.data[3]).toBe(255)
  })

  it('saturation at -100 pushes a colour toward its own luma (desaturates)', () => {
    const buf = solid(200, 50, 50)
    const luma = Math.round(0.299 * 200 + 0.587 * 50 + 0.114 * 50) // ~87
    applyAdjustments(buf, { ...NEUTRAL_ADJUSTMENTS, saturation: -100 })
    // all channels collapse to luma
    expect(Math.abs(buf.data[0] - luma)).toBeLessThanOrEqual(1)
    expect(Math.abs(buf.data[1] - luma)).toBeLessThanOrEqual(1)
    expect(Math.abs(buf.data[2] - luma)).toBeLessThanOrEqual(1)
  })

  it('hasVisibleEffect is false only for the neutral preset', () => {
    expect(hasVisibleEffect(NEUTRAL_ADJUSTMENTS)).toBe(false)
    expect(hasVisibleEffect({ ...NEUTRAL_ADJUSTMENTS, contrast: 5 })).toBe(true)
  })
})

describe('photo enhance capsule — auto white balance', () => {
  it('cools a red-cast photo (negative warmth) and warms a blue-cast one', () => {
    const redCast = computeAutoAdjustments(solid(200, 50, 50))
    expect(redCast.warmth).toBeLessThan(0) // add blue / remove red

    const blueCast = computeAutoAdjustments(solid(50, 50, 200))
    expect(blueCast.warmth).toBeGreaterThan(0) // add red / warm up
  })

  it('auto adjustments always stay within slider ranges (no NaN / overflow)', () => {
    for (const c of [solid(10, 10, 10), solid(128, 128, 128), solid(240, 200, 160)]) {
      const a = computeAutoAdjustments(c)
      for (const v of [a.brightness, a.contrast, a.saturation, a.warmth, a.sharpen]) {
        expect(Number.isFinite(v)).toBe(true)
      }
      expect(a.brightness).toBeGreaterThanOrEqual(0)
      expect(a.contrast).toBeLessThanOrEqual(45)
      expect(a.warmth).toBeGreaterThanOrEqual(-35)
      expect(a.warmth).toBeLessThanOrEqual(35)
    }
  })
})
