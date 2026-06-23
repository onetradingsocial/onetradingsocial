import { describe, it, expect } from 'vitest'
import { weekStart, lastNWeeks, bucketByWeek, countSince, daysAgo } from '@/lib/analytics'

const iso = (s: string) => new Date(s + 'T00:00:00.000Z')

describe('weekStart', () => {
  it('truncates to Monday 00:00 UTC', () => {
    // 2026-06-24 is a Wednesday -> Monday is 2026-06-22
    expect(weekStart(new Date('2026-06-24T15:30:00Z')).toISOString()).toBe('2026-06-22T00:00:00.000Z')
  })
  it('keeps a Monday as itself', () => {
    expect(weekStart(iso('2026-06-22')).toISOString()).toBe('2026-06-22T00:00:00.000Z')
  })
  it('maps Sunday back to the prior Monday', () => {
    // 2026-06-21 is a Sunday -> 2026-06-15
    expect(weekStart(iso('2026-06-21')).toISOString()).toBe('2026-06-15T00:00:00.000Z')
  })
})

describe('lastNWeeks', () => {
  it('returns n ascending Monday boundaries ending with the current week', () => {
    const w = lastNWeeks(new Date('2026-06-24T12:00:00Z'), 3)
    expect(w.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-06-08', '2026-06-15', '2026-06-22'])
  })
})

describe('bucketByWeek', () => {
  it('counts rows into their week and zero-fills empty weeks', () => {
    const now = new Date('2026-06-24T12:00:00Z')
    const rows = [
      { createdAt: '2026-06-23T09:00:00Z' }, // current week
      { createdAt: '2026-06-22T00:00:01Z' }, // current week
      { createdAt: '2026-06-16T00:00:00Z' }, // prior week
    ]
    const out = bucketByWeek(rows, now, 3)
    expect(out).toEqual([
      { weekStart: '2026-06-08', count: 0 },
      { weekStart: '2026-06-15', count: 1 },
      { weekStart: '2026-06-22', count: 2 },
    ])
  })
  it('ignores rows older than the window and invalid dates', () => {
    const now = new Date('2026-06-24T12:00:00Z')
    const rows = [{ createdAt: '2020-01-01T00:00:00Z' }, { createdAt: 'not-a-date' }]
    expect(bucketByWeek(rows, now, 2).every((b) => b.count === 0)).toBe(true)
  })
})

describe('countSince', () => {
  it('counts rows at or after the cutoff (inclusive)', () => {
    const since = iso('2026-06-20')
    const rows = [
      { createdAt: '2026-06-20T00:00:00Z' }, // == cutoff, counted
      { createdAt: '2026-06-21T00:00:00Z' },
      { createdAt: '2026-06-19T23:59:59Z' }, // before, excluded
    ]
    expect(countSince(rows, since)).toBe(2)
  })
})

describe('daysAgo', () => {
  it('subtracts whole days in ms', () => {
    expect(daysAgo(new Date('2026-06-24T00:00:00Z'), 7).toISOString()).toBe('2026-06-17T00:00:00.000Z')
  })
})

import { distinctActiveUsers, topCourseCompletions, buildDashboard } from '@/lib/analytics'
import type { AnalyticsInput } from '@/lib/analytics'

describe('distinctActiveUsers', () => {
  it('unions distinct userIds across sets within the window', () => {
    const since = iso('2026-06-20')
    const trades = [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }, { createdAt: '2026-06-23T00:00:00Z', userId: 'b' }]
    const posts = [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }, { createdAt: '2026-06-19T00:00:00Z', userId: 'c' }]
    expect(distinctActiveUsers([trades, posts], since)).toBe(2) // a, b (c is before cutoff)
  })
  it('ignores rows without a userId', () => {
    expect(distinctActiveUsers([[{ createdAt: '2026-06-23T00:00:00Z' }]], iso('2026-06-20'))).toBe(0)
  })
})

describe('topCourseCompletions', () => {
  it('counts per course and sorts desc, capped to limit', () => {
    const rows = [
      { courseTitle: 'Risk' }, { courseTitle: 'Risk' }, { courseTitle: 'Risk' },
      { courseTitle: 'Foundations' }, { courseTitle: 'Foundations' },
      { courseTitle: 'Psychology' },
    ]
    expect(topCourseCompletions(rows, 2)).toEqual([
      { courseTitle: 'Risk', count: 3 },
      { courseTitle: 'Foundations', count: 2 },
    ])
  })
})

describe('buildDashboard', () => {
  const now = new Date('2026-06-24T12:00:00Z')
  const base: AnalyticsInput = {
    profiles: [{ createdAt: '2026-06-23T00:00:00Z' }, { createdAt: '2026-01-01T00:00:00Z' }],
    trades: [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }],
    closedPublicTrades: [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }, { createdAt: '2026-06-23T00:00:00Z', userId: 'b' }],
    posts: [{ createdAt: '2026-06-23T00:00:00Z', userId: 'b' }],
    comments: [],
    likes: [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }],
    completions: [{ createdAt: '2026-06-23T00:00:00Z', userId: 'a' }],
    completionsByCourse: [{ courseTitle: 'Risk' }],
    publishedLessons: 4,
    feedback: [
      { createdAt: '2026-06-23T00:00:00Z', status: 'open' },
      { createdAt: '2026-06-23T00:00:00Z', status: 'triaged' },
    ],
  }

  it('rolls up growth, engagement, content, and ops', () => {
    const d = buildDashboard(base, now)
    expect(d.growth.totalUsers).toBe(2)
    expect(d.growth.new7d).toBe(1)
    expect(d.growth.signupsPerWeek).toHaveLength(12)
    expect(d.engagement.active7d).toBe(2) // a (trades/likes/completions) + b (posts)
    expect(d.engagement.totalTrades).toBe(1)
    expect(d.content.totalCompletions).toBe(1)
    expect(d.content.topCourses).toEqual([{ courseTitle: 'Risk', count: 1 }])
    expect(d.content.publishedLessons).toBe(4)
    expect(d.content.leaderboardParticipants).toBe(2) // a, b
    expect(d.ops.totalFeedback).toBe(2)
    expect(d.ops.openFeedback).toBe(1)
    expect(d.ops.closedFeedback).toBe(1)
  })
})
