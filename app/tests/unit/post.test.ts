import { describe, it, expect } from 'vitest'
import { pollResults, rrBar } from '@/lib/post'

describe('pollResults', () => {
  it('tallies counts, percentages, and the viewer vote', () => {
    const { results, total } = pollResults(
      [{ id: 'a', label: 'Long' }, { id: 'b', label: 'Short' }],
      [{ option_id: 'a' }, { option_id: 'a' }, { option_id: 'b' }],
      'a',
    )
    expect(total).toBe(3)
    expect(results[0]).toEqual({ id: 'a', label: 'Long', count: 2, pct: 67, votedFor: true })
    expect(results[1]).toEqual({ id: 'b', label: 'Short', count: 1, pct: 33, votedFor: false })
  })
  it('handles no votes', () => {
    const { results, total } = pollResults([{ id: 'a', label: 'Yes' }], [], null)
    expect(total).toBe(0)
    expect(results[0]).toEqual({ id: 'a', label: 'Yes', count: 0, pct: 0, votedFor: false })
  })
})

describe('rrBar', () => {
  it('orients a long so target is at the top, stop at the bottom', () => {
    const r = rrBar(1.0856, 1.0806, 1.0936, 'long')
    expect(r.stopPos).toBeCloseTo(0, 5)
    expect(r.targetPos).toBeCloseTo(1, 5)
    expect(r.entryPos).toBeCloseTo(0.3846, 3)
  })
  it('orients a short so target is at the top, stop at the bottom', () => {
    const r = rrBar(1.1, 1.105, 1.09, 'short')
    expect(r.stopPos).toBeCloseTo(0, 5)
    expect(r.targetPos).toBeCloseTo(1, 5)
  })
  it('returns null targetPos when target missing', () => {
    expect(rrBar(10, 9, null, 'long').targetPos).toBeNull()
  })
})
