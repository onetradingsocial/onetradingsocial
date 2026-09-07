import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MARKETS } from '@/lib/profile'

/**
 * Structural guard: the journal's Recent Trades filter row must offer every
 * market the app can store.
 *
 * The row was hand-written as crypto/forex/stocks and fell two markets behind
 * `MARKETS` without anything failing. Onboarding sells Commodities as "Gold,
 * oil & metals" and the MT5 importer classifies metals into it, so a trader
 * whose journal was entirely gold was shown three filter chips and matched none
 * of them — a filter bar that cannot select any of your own rows.
 *
 * Nothing about that is a type error while the list is literal strings, and no
 * unit test renders this component (vitest runs in `node` here). So the guard
 * is the source text, the same shape as admin-gate.test.ts: the failure mode is
 * a *future* market added to MARKETS whose chip nobody remembers to add.
 */

const SRC = join(process.cwd(), 'src', 'app', 'journal', '_components', 'RecentTrades.tsx')

describe('journal market filters', () => {
  const text = readFileSync(SRC, 'utf8')

  it('derives the filter row from MARKETS rather than a hand-written list', () => {
    // The literal list is what drifted; spreading MARKETS is what stops it.
    expect(text).toMatch(/\.\.\.MARKETS\.map\(/)
  })

  it('labels every canonical market', () => {
    for (const market of MARKETS) {
      expect(text).toContain(`${market}:`)
    }
  })

  it('covers the two markets that were missing', () => {
    expect(MARKETS).toContain('indices')
    expect(MARKETS).toContain('commodities')
    expect(text).toContain("indices: 'Indices'")
    expect(text).toContain("commodities: 'Commodities'")
  })
})
