import { describe, it, expect } from 'vitest'
import { generateInsights, type InsightTrade } from '@/lib/insights'

const mk = (over: Partial<InsightTrade>): InsightTrade => ({
  rMultiple: 1, pnlAmount: 100, tradedAt: '2026-07-01T09:00:00Z',
  setupType: null, strategyTags: [], mistakeTags: [], ...over,
})

describe('generateInsights', () => {
  it('returns nothing below the minimum sample', () => {
    expect(generateInsights([mk({}), mk({})])).toEqual([])
  })

  it('surfaces a best-setup insight with sample size', () => {
    const trades = [
      ...Array.from({ length: 5 }, () => mk({ setupType: 'Breakout', rMultiple: 2 })),
      ...Array.from({ length: 5 }, () => mk({ setupType: 'Scalp', rMultiple: -1 })),
    ]
    const ins = generateInsights(trades)
    const setup = ins.find((i) => i.id === 'setup')
    expect(setup).toBeTruthy()
    expect(setup!.text).toContain('Breakout')
    expect(setup!.sample).toBe(5)
  })

  it('flags degraded win rate after two losses', () => {
    // 12 trades: mostly wins, but a losing-streak cluster that then keeps losing.
    const trades: InsightTrade[] = []
    let h = 9
    const at = () => `2026-07-01T${String(h++).padStart(2, '0')}:00:00Z`
    // establish a high base win rate
    for (let i = 0; i < 8; i++) trades.push(mk({ rMultiple: 1, tradedAt: at() }))
    // two losses then more losses (post-streak underperformance)
    h = 9
    const at2 = () => `2026-07-02T${String(h++).padStart(2, '0')}:00:00Z`
    trades.push(mk({ rMultiple: -1, tradedAt: at2() }))
    trades.push(mk({ rMultiple: -1, tradedAt: at2() }))
    for (let i = 0; i < 4; i++) trades.push(mk({ rMultiple: -1, tradedAt: at2() }))
    const ins = generateInsights(trades)
    expect(ins.some((i) => i.id === 'tilt')).toBe(true)
  })

  it('every insight carries a positive sample size', () => {
    const trades = Array.from({ length: 20 }, (_, i) =>
      mk({ setupType: 'A', rMultiple: i % 3 === 0 ? -1 : 2, tradedAt: `2026-07-0${(i % 9) + 1}T10:00:00Z` }))
    for (const ins of generateInsights(trades)) expect(ins.sample).toBeGreaterThan(0)
  })
})
