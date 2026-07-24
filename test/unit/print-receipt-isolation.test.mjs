import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// FIX 1 — "Print Receipt" must print ONLY the receipt. Root cause: no @media print CSS and no isolated
// receipt container, so window.print() renders the whole app-shell (nav, buttons, protection/stepper,
// footer). This is a source-level guard (the repo has no jsdom runner): it asserts the print isolation
// stays wired — a global @media print block that hides everything except an isolated #receipt-print
// container, and the receipt page marking its chrome .no-print and the receipt card id="receipt-print".

const css = readFileSync(new URL('../../src/shared/theme/global.css', import.meta.url), 'utf8')
const page = readFileSync(new URL('../../src/modules/payments/PaymentReceiptPage.tsx', import.meta.url), 'utf8')

// Isolate the @media print block from global.css.
function printBlock(source) {
  const start = source.indexOf('@media print')
  if (start === -1) return ''
  // Walk braces from the first "{" after "@media print" to its matching close.
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return source.slice(start)
}

describe('FIX 1 — print receipt isolation', () => {
  const block = printBlock(css)

  it('global.css defines an @media print block', () => {
    expect(block.length).toBeGreaterThan(0)
  })

  it('hides everything then reveals only #receipt-print', () => {
    expect(block).toMatch(/body\s*\*\s*\{\s*visibility:\s*hidden/)
    expect(block).toMatch(/#receipt-print[^}]*visibility:\s*visible/)
  })

  it('collapses app chrome (header/nav/footer/.no-print) in print', () => {
    expect(block).toMatch(/\.no-print\s*\{\s*display:\s*none\s*!important/)
    expect(block).toMatch(/header[^{]*nav[^{]*footer/)
  })

  it('lays the receipt out isolated on white for print', () => {
    // Positioned at the top-left, full width, forced light so dark inline styles print legibly.
    expect(block).toMatch(/#receipt-print\s*\{[^}]*position:\s*absolute/)
    expect(block).toMatch(/#receipt-print[^}]*background:\s*#fff/i)
    expect(block).toMatch(/@page\s*\{\s*margin/)
  })

  it('receipt page wraps ONLY the receipt card in id="receipt-print"', () => {
    expect(page).toMatch(/id="receipt-print"/)
  })

  it('receipt page marks its chrome blocks className="no-print"', () => {
    // flow-nav (arrows), hero, protection/stepper panel, and the action button row must be no-print.
    const noPrintCount = (page.match(/className="no-print"/g) || []).length
    expect(noPrintCount).toBeGreaterThanOrEqual(4)
  })
})
