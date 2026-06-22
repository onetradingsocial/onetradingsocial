import { describe, it, expect } from 'vitest'
import { XP, xpForLevel, levelFromXp } from '@/lib/xp'

describe('xpForLevel', () => {
  it('cumulative rising cost: reach(L) = 100*(L-1)*L/2', () => {
    expect(xpForLevel(1)).toBe(0)
    expect(xpForLevel(2)).toBe(100)
    expect(xpForLevel(3)).toBe(300)
    expect(xpForLevel(5)).toBe(1000)
    expect(xpForLevel(10)).toBe(4500)
    expect(xpForLevel(25)).toBe(30000)
  })
})

describe('levelFromXp', () => {
  it('returns level 1 at 0 XP with progress toward L2', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpToNext: 100, progress: 0 })
  })
  it('crosses to next level exactly at the threshold', () => {
    expect(levelFromXp(100).level).toBe(2)
    expect(levelFromXp(99).level).toBe(1)
    expect(levelFromXp(1000).level).toBe(5)
  })
  it('reports progress fraction within the current level', () => {
    const r = levelFromXp(150)
    expect(r).toEqual({ level: 2, xpIntoLevel: 50, xpToNext: 200, progress: 0.25 })
  })
  it('clamps negatives to level 1', () => {
    expect(levelFromXp(-10).level).toBe(1)
  })
  it('exposes tunable constants', () => {
    expect(XP.BASE_PER_TRADE).toBe(50)
  })
})
