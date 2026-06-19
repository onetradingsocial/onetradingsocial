import { describe, it, expect } from 'vitest'
import {
  aggregatePerformance, rankPerformance, rankConsistency, rankFollowers, windowStart,
  type PerfTrade,
} from '@/lib/leaderboard'

const t = (user_id: string, pnl_amount: number, r_multiple: number, outcome: string): PerfTrade =>
  ({ user_id, pnl_amount, r_multiple, outcome })

describe('aggregatePerformance', () => {
  it('sums pnl, counts wins/losses, means R, computes winRate per user', () => {
    const m = aggregatePerformance([
      t('u1', 100, 2, 'win'), t('u1', -50, -1, 'loss'), t('u2', 30, 1.5, 'win'),
    ])
    expect(m.get('u1')).toEqual({ userId: 'u1', pnl: 50, wins: 1, losses: 1, winRate: 0.5, avgR: 0.5, trades: 2 })
    expect(m.get('u2')).toEqual({ userId: 'u2', pnl: 30, wins: 1, losses: 0, winRate: 1, avgR: 1.5, trades: 1 })
  })
  it('treats null pnl/r as zero and ignores non win/loss outcomes in wins/losses', () => {
    const a = aggregatePerformance([t('u1', null as unknown as number, null as unknown as number, 'breakeven')]).get('u1')!
    expect(a.pnl).toBe(0); expect(a.avgR).toBe(0); expect(a.wins).toBe(0); expect(a.losses).toBe(0); expect(a.trades).toBe(1)
  })
})

describe('rankPerformance', () => {
  const aggs = [...aggregatePerformance([
    t('a', 300, 1, 'win'), t('a', 0, 1, 'win'),        // a: pnl 300, trades 2
    t('b', 300, 5, 'win'),                              // b: pnl 300, trades 1
    t('c', 100, 9, 'win'),                              // c: pnl 100, trades 1
  ]).values()]

  it('default sorts by pnl desc, tie-break trades desc then pnl desc, dense rank', () => {
    const r = rankPerformance(aggs)              // default 'pnl'
    expect(r.map((x) => x.userId)).toEqual(['a', 'b', 'c']) // a & b tie 300 -> a first (more trades)
    expect(r.map((x) => x.rank)).toEqual([1, 1, 2])         // dense: equal pnl share rank
  })
  it('sorts by trades / winRate / avgR', () => {
    expect(rankPerformance(aggs, 'trades').map((x) => x.userId)).toEqual(['a', 'b', 'c'])
    expect(rankPerformance(aggs, 'avgR').map((x) => x.userId)).toEqual(['c', 'b', 'a'])
  })
})

describe('rankConsistency', () => {
  it('counts logged trades per user, ranked desc, dense rank', () => {
    const r = rankConsistency([{ user_id: 'a' }, { user_id: 'a' }, { user_id: 'b' }])
    expect(r).toEqual([{ userId: 'a', count: 2, rank: 1 }, { userId: 'b', count: 1, rank: 2 }])
  })
})

describe('rankFollowers', () => {
  it('counts followers per following_id, ranked desc', () => {
    const r = rankFollowers([{ following_id: 'x' }, { following_id: 'x' }, { following_id: 'y' }])
    expect(r).toEqual([{ userId: 'x', count: 2, rank: 1 }, { userId: 'y', count: 1, rank: 2 }])
  })
})

describe('windowStart', () => {
  const now = new Date('2026-06-19T00:00:00Z').getTime()
  it('day = now-1d, week = now-7d, month = now-30d, all = null', () => {
    expect(windowStart('day', now)).toBe('2026-06-18T00:00:00.000Z')
    expect(windowStart('week', now)).toBe('2026-06-12T00:00:00.000Z')
    expect(windowStart('month', now)).toBe('2026-05-20T00:00:00.000Z')
    expect(windowStart('all', now)).toBeNull()
  })
})
