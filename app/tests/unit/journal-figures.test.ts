import { describe, it, expect } from 'vitest'
import { matchesTradeFilter, netOfTrades, profitFactorTone, type JTrade } from '@/lib/journal-stats'
import { computeMetrics, type TradeForMetrics } from '@/lib/trade'

/**
 * Audit B1, defects 1 and 2 — the two figures on the journal page that said
 * something the data did not.
 *
 * Both are pure now: the Recent Trades footer derives its net from the same
 * predicate that builds the table body, and the profit-factor tone is a
 * function of the value instead of a literal. vitest runs in `node` here, so
 * the guarantee has to live in a function rather than in a rendered component.
 */

const mk = (over: Partial<JTrade>): JTrade => ({
  id: Math.random().toString(36).slice(2),
  instrument: 'EUR/USD', market: 'forex', direction: 'long',
  status: 'closed', outcome: 'win',
  entry_price: 1, exit_price: 1.1, r_multiple: 1, pnl_amount: 100,
  planned_rr: 2, setup_type: null, strategy_tags: [],
  traded_at: '2026-09-01T10:00:00Z',
  ...over,
})

describe('Recent Trades footer net (defect 1)', () => {
  // The reported shape: rows carrying +$1,834 all-time under a footer reading
  // +$0, because the net was the current calendar month's and the count was
  // every row. September is the current month at the time of the audit, so the
  // fixture puts the money in August to reproduce it.
  const trades = [
    mk({ pnl_amount: 1000, outcome: 'win', traded_at: '2026-08-04T10:00:00Z' }),
    mk({ pnl_amount: 1200, outcome: 'win', traded_at: '2026-08-11T10:00:00Z' }),
    mk({ pnl_amount: -366, outcome: 'loss', traded_at: '2026-08-19T10:00:00Z' }),
    mk({ status: 'open', outcome: 'open', pnl_amount: null, exit_price: null, r_multiple: null }),
  ]

  it('nets the rows the table is showing, not a calendar month', () => {
    const shown = trades.filter((t) => matchesTradeFilter(t, 'all'))
    const { net, counted, excluded } = netOfTrades(shown)
    expect(shown).toHaveLength(4)
    expect(net).toBe(1834)      // was 0: no August row is in the current month
    expect(counted).toBe(3)
    expect(excluded).toBe(1)    // the open position carries no money P/L
  })

  it('moves the net with the segmented filter, not just the count', () => {
    // The specific complaint: clicking "Losses" changed shown.length and left
    // the net where it was. Count and net must move together or neither.
    const all = trades.filter((t) => matchesTradeFilter(t, 'all'))
    const losses = trades.filter((t) => matchesTradeFilter(t, 'losses'))
    const wins = trades.filter((t) => matchesTradeFilter(t, 'wins'))

    expect(losses).toHaveLength(1)
    expect(netOfTrades(losses).net).toBe(-366)
    expect(netOfTrades(wins).net).toBe(2200)
    expect(netOfTrades(all).net).not.toBe(netOfTrades(losses).net)
  })

  it('filters by market, and an unmatched market nets nothing', () => {
    const crypto = trades.filter((t) => matchesTradeFilter(t, 'crypto'))
    expect(crypto).toHaveLength(0)
    expect(netOfTrades(crypto)).toEqual({ net: 0, counted: 0, excluded: 0 })
  })

  it('counts a win by outcome, so a stop-less close is not dropped', () => {
    // Same rule the rest of the app uses: a trade closed without a stop has an
    // outcome and a P/L but no R, and must still appear under "Wins".
    const stopless = mk({ r_multiple: null, outcome: 'win', pnl_amount: 40 })
    expect(matchesTradeFilter(stopless, 'wins')).toBe(true)
    expect(netOfTrades([stopless])).toEqual({ net: 40, counted: 1, excluded: 0 })
  })

  it('excludes a closed trade with no money P/L from the net but not the count', () => {
    // An account with no balance set logs R but no money.
    const noMoney = mk({ pnl_amount: null })
    const { net, counted, excluded } = netOfTrades([noMoney, mk({ pnl_amount: 50 })])
    expect(net).toBe(50)
    expect(counted).toBe(1)
    expect(excluded).toBe(1)
  })
})

describe('profit factor tone (defect 2)', () => {
  it('is negative below break-even', () => {
    // The reported case: 0.54 rendered green because the tone was a literal.
    expect(profitFactorTone(0.54, 12)).toBe('neg')
    expect(profitFactorTone(0.98, 12)).toBe('neg')
  })

  it('is positive above break-even, and for a loss-free R history', () => {
    expect(profitFactorTone(1.02, 12)).toBe('pos')
    expect(profitFactorTone(2.1, 12)).toBe('pos')
    expect(profitFactorTone(Infinity, 4)).toBe('pos')
  })

  it('is neutral at break-even', () => {
    expect(profitFactorTone(1, 12)).toBe('muted')
    expect(profitFactorTone(0.995, 12)).toBe('muted')
  })

  it('does not paint an absence of R data as a loss', () => {
    // computeMetrics returns profitFactor 0 when nothing carries an r_multiple.
    // A `pf < 1` test would render that as the worst result on the page.
    const noR = computeMetrics([
      { status: 'closed', outcome: 'win', rMultiple: null, pnlAmount: 10, tradedAt: '2026-09-01T00:00:00Z', mistakeTags: [] },
    ] as TradeForMetrics[])
    expect(noR.rCount).toBe(0)
    expect(noR.profitFactor).toBe(0)
    expect(profitFactorTone(noR.profitFactor, noR.rCount)).toBe('muted')
  })
})

describe('Metrics.rCount', () => {
  it('is the R denominator, and can be smaller than the closed count', () => {
    // This is the number the labelling pass prints as `n=` beside avg R and
    // profit factor. It must not silently equal `total`.
    const m = computeMetrics([
      { status: 'closed', outcome: 'win', rMultiple: 2, pnlAmount: 200, tradedAt: '2026-09-01T00:00:00Z', mistakeTags: [] },
      { status: 'closed', outcome: 'loss', rMultiple: null, pnlAmount: -50, tradedAt: '2026-09-02T00:00:00Z', mistakeTags: [] },
      { status: 'open', outcome: 'open', rMultiple: null, pnlAmount: null, tradedAt: '2026-09-03T00:00:00Z', mistakeTags: [] },
    ] as TradeForMetrics[])
    expect(m.total).toBe(2)
    expect(m.rCount).toBe(1)
    expect(m.open).toBe(1)
  })
})
