import { describe, it, expect } from 'vitest'
import { scoreTrader, recommendTraders, rankFeedByAffinity, type ViewerProfile, type CandidateTrader } from '@/lib/recommend'

const viewer: ViewerProfile = {
  markets: ['forex', 'indices'], styles: ['Swing'], experience: 'intermediate',
  strategies: ['London breakout'], lessonsCompleted: 4,
}

const cand = (over: Partial<CandidateTrader>): CandidateTrader => ({
  userId: 'u1', username: 'trader1', displayName: null, avatarUrl: null,
  markets: [], styles: [], experience: null, strategies: [], lessonsCompleted: 0,
  verification: 'self_reported', publicTrades: 10, followers: 0, ...over,
})

describe('scoreTrader', () => {
  it('returns null with no affinity, however verified', () => {
    expect(scoreTrader(viewer, cand({ markets: ['crypto'], verification: 'broker_connected' }))).toBeNull()
  })

  it('scores shared markets and explains why', () => {
    const r = scoreTrader(viewer, cand({ markets: ['forex'] }))
    expect(r).not.toBeNull()
    expect(r!.score).toBeGreaterThan(0)
    expect(r!.reasons.join(' ')).toContain('forex')
  })

  it('ranks a broker-verified match above an identical unverified one', () => {
    const verified = scoreTrader(viewer, cand({ markets: ['forex'], verification: 'broker_connected' }))!
    const plain = scoreTrader(viewer, cand({ markets: ['forex'], verification: 'self_reported' }))!
    expect(verified.score).toBeGreaterThan(plain.score)
  })

  it('is case-insensitive on overlaps', () => {
    const r = scoreTrader(viewer, cand({ markets: ['FOREX'] }))
    expect(r).not.toBeNull()
  })
})

describe('recommendTraders', () => {
  it('excludes already-followed users and respects the limit', () => {
    const candidates = [
      cand({ userId: 'a', username: 'a', markets: ['forex'] }),
      cand({ userId: 'b', username: 'b', markets: ['forex'] }),
      cand({ userId: 'c', username: 'c', markets: ['forex'] }),
    ]
    const out = recommendTraders(viewer, candidates, { exclude: new Set(['a']), limit: 2 })
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.userId)).not.toContain('a')
  })

  it('drops candidates with no affinity', () => {
    const out = recommendTraders(viewer, [cand({ userId: 'x', markets: ['crypto'] })])
    expect(out).toHaveLength(0)
  })
})

describe('rankFeedByAffinity', () => {
  it('lifts an affine author above a slightly newer unrelated post', () => {
    const now = Date.parse('2026-07-10T00:00:00Z')
    const posts = [
      { id: '1', author_id: 'stranger', created_at: '2026-07-09T23:00:00Z' },
      { id: '2', author_id: 'match', created_at: '2026-07-09T20:00:00Z' },
    ]
    const ranked = rankFeedByAffinity(posts, new Map([['match', 12]]), now)
    expect(ranked[0].id).toBe('2')
  })

  it('keeps recency dominant for equal affinity', () => {
    const now = Date.parse('2026-07-10T00:00:00Z')
    const posts = [
      { id: 'old', author_id: 'x', created_at: '2026-07-01T00:00:00Z' },
      { id: 'new', author_id: 'x', created_at: '2026-07-09T00:00:00Z' },
    ]
    const ranked = rankFeedByAffinity(posts, new Map([['x', 5]]), now)
    expect(ranked[0].id).toBe('new')
  })
})
