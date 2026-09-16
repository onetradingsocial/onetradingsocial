import { describe, it, expect } from 'vitest'
import { firstTradeHtml } from '@/lib/server/email'

/**
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * This is the one lifecycle email written to be funny, and the joke has a
 * failure mode the other templates do not: it is generated from the user's own
 * result, so a branch that celebrates the wrong thing does not read as a bad
 * joke, it reads as a product that did not look at the data it was handed.
 *
 * The tests below pin the two things the humour answers to — it never cheers a
 * loss, and it never invents a statistic out of a sample of one — plus the ask
 * that the email exists to make.
 */

const base = { name: 'Sam', instrument: 'EURUSD', direction: 'long' } as const

describe('the first-trade email reads the result before it jokes', () => {
  it('teases the 100% win rate only on a win', () => {
    expect(firstTradeHtml({ ...base, outcome: 'win' })).toContain('100%')
    for (const outcome of ['loss', 'breakeven', 'open'] as const) {
      expect(firstTradeHtml({ ...base, outcome })).not.toContain('100%')
    }
  })

  it('never congratulates a losing first trade', () => {
    const html = firstTradeHtml({ ...base, outcome: 'loss' })
    expect(html).not.toMatch(/congratulations|well done|nice (?:one|work)|🎉/i)
    // What it says instead: the red trade is the useful one to have logged.
    expect(html).toMatch(/red trades/i)
  })

  it('does not claim a result for a trade that is still open', () => {
    const html = firstTradeHtml({ ...base, outcome: 'open' })
    expect(html).toMatch(/still open/i)
    expect(html).not.toMatch(/\bit's a (?:win|loss)\b/i)
  })

  it('never prints a number a single trade cannot support', () => {
    for (const outcome of ['win', 'loss', 'breakeven', 'open'] as const) {
      const html = firstTradeHtml({ ...base, outcome })
      // No P/L, no R multiple. The weekly digest omits Net R when it cannot
      // measure it; the same rule applies harder at n = 1.
      expect(html).not.toMatch(/\d+(?:\.\d+)?R\b/)
      expect(html).not.toMatch(/[$€£]\s?\d/)
    }
  })

  it('asks for the second trade, which is the whole point of sending it', () => {
    const html = firstTradeHtml({ ...base, outcome: 'win' })
    expect(html).toMatch(/Log trade number two/)
    expect(html).toContain('/journal')
  })

  it('names the trade the way the user logged it', () => {
    expect(firstTradeHtml({ ...base, outcome: 'win' })).toContain('Long EURUSD')
    expect(firstTradeHtml({ ...base, direction: 'short', outcome: 'loss' }))
      .toContain('Short EURUSD')
  })

  it('escapes the free-text instrument and the display name', () => {
    const html = firstTradeHtml({
      name: '<script>x</script>',
      instrument: 'EUR"><b>USD',
      direction: 'long',
      outcome: 'win',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('"><b>USD')
    expect(html).toContain('&lt;script&gt;')
  })
})
