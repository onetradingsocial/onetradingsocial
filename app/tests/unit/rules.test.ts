import { describe, it, expect } from 'vitest'
import { analyzeCompliance, sessionForUtcHour, hasAnyRule, EMPTY_RULES, type RuleTrade } from '@/lib/rules'

const t = (over: Partial<RuleTrade>): RuleTrade => ({
  tradedAt: '2026-07-01T08:00:00Z', plannedRr: 2, riskPercent: 1, hasStop: true,
  rMultiple: 1, pnlAmount: 100, ...over,
})

describe('sessionForUtcHour', () => {
  it('maps hours to sessions', () => {
    expect(sessionForUtcHour(9)).toBe('london')
    expect(sessionForUtcHour(15)).toBe('newyork')
    expect(sessionForUtcHour(3)).toBe('asia')
    expect(sessionForUtcHour(22)).toBe('sydney')
  })
})

describe('hasAnyRule', () => {
  it('false for empty, true when a rule is set', () => {
    expect(hasAnyRule(EMPTY_RULES)).toBe(false)
    expect(hasAnyRule({ ...EMPTY_RULES, requireStop: true })).toBe(true)
    expect(hasAnyRule({ ...EMPTY_RULES, minRr: 2 })).toBe(true)
  })
})

describe('analyzeCompliance', () => {
  it('counts a fully compliant trade as followed', () => {
    const r = analyzeCompliance({ ...EMPTY_RULES, minRr: 2, requireStop: true }, [t({})])
    expect(r.followed).toBe(1)
    expect(r.broken).toBe(0)
  })

  it('flags min R:R breach', () => {
    const r = analyzeCompliance({ ...EMPTY_RULES, minRr: 2 }, [t({ plannedRr: 1.5 })])
    expect(r.broken).toBe(1)
    expect(r.brokenByRule.min_rr).toBe(1)
  })

  it('flags missing stop', () => {
    const r = analyzeCompliance({ ...EMPTY_RULES, requireStop: true }, [t({ hasStop: false })])
    expect(r.brokenByRule.require_stop).toBe(1)
  })

  it('flags max trades per day on the 3rd trade', () => {
    const day = '2026-07-01T'
    const r = analyzeCompliance({ ...EMPTY_RULES, maxTradesPerDay: 2 }, [
      t({ tradedAt: day + '08:00:00Z' }), t({ tradedAt: day + '09:00:00Z' }), t({ tradedAt: day + '10:00:00Z' }),
    ])
    expect(r.brokenByRule.max_trades_per_day).toBe(1)
    expect(r.followed).toBe(2)
  })

  it('flags session restriction', () => {
    const r = analyzeCompliance({ ...EMPTY_RULES, session: 'london' }, [t({ tradedAt: '2026-07-01T15:00:00Z' })])
    expect(r.brokenByRule.session).toBe(1)
  })

  it('no_trade_after_losses triggers after N consecutive losses', () => {
    const r = analyzeCompliance({ ...EMPTY_RULES, noTradeAfterLosses: 2 }, [
      t({ tradedAt: '2026-07-01T08:00:00Z', rMultiple: -1, pnlAmount: -100 }),
      t({ tradedAt: '2026-07-01T09:00:00Z', rMultiple: -1, pnlAmount: -100 }),
      t({ tradedAt: '2026-07-01T10:00:00Z', rMultiple: 1, pnlAmount: 100 }), // 3rd: after 2 losses -> breach
    ])
    expect(r.brokenByRule.no_trade_after_losses).toBe(1)
  })

  it('separates compliant vs non-compliant performance and costs', () => {
    const r = analyzeCompliance({ ...EMPTY_RULES, requireStop: true }, [
      t({ hasStop: true, rMultiple: 2, pnlAmount: 200 }),   // compliant win
      t({ hasStop: false, rMultiple: -1, pnlAmount: -150 }), // broken loss
    ])
    expect(r.compliantPnl).toBe(200)
    expect(r.nonCompliantPnl).toBe(-150)
    expect(r.costOfBroken).toBe(-150)
    expect(r.compliantWinRate).toBe(1)
    expect(r.nonCompliantWinRate).toBe(0)
  })
})
