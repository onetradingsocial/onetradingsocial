import { describe, it, expect } from 'vitest'
import { assembleFeed, tally } from '@/lib/feed'

describe('assembleFeed', () => {
  it('keeps primary first, appends unique fallback, caps to limit', () => {
    const primary = [{ id: 'a' }, { id: 'b' }]
    const fallback = [{ id: 'b' }, { id: 'c' }, { id: 'd' }]
    expect(assembleFeed(primary, fallback, 3).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
  it('returns only primary when it already fills the limit', () => {
    expect(assembleFeed([{ id: 'a' }, { id: 'b' }], [{ id: 'c' }], 2).map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('tally', () => {
  it('counts occurrences of a key', () => {
    expect(tally([{ post_id: 'a' }, { post_id: 'a' }, { post_id: 'b' }], 'post_id')).toEqual({ a: 2, b: 1 })
  })
  it('handles empty/undefined', () => {
    expect(tally(null, 'post_id')).toEqual({})
  })
})

import { timeAgo } from '@/lib/time'

describe('timeAgo', () => {
  const base = new Date('2026-06-18T12:00:00Z').getTime()
  it('formats seconds/minutes/hours/days', () => {
    expect(timeAgo('2026-06-18T11:59:30Z', base)).toBe('just now')
    expect(timeAgo('2026-06-18T11:45:00Z', base)).toBe('15m')
    expect(timeAgo('2026-06-18T09:00:00Z', base)).toBe('3h')
    expect(timeAgo('2026-06-15T12:00:00Z', base)).toBe('3d')
  })
})
