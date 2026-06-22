import { describe, it, expect } from 'vitest'
import { gradeQuiz, learningTotalXp, learningWindowXp, type LearningCompletion } from '@/lib/learning'

describe('gradeQuiz', () => {
  const correct = { q1: 'a', q2: 'b' }
  it('passes only when every answer matches', () => {
    expect(gradeQuiz({ q1: 'a', q2: 'b' }, correct)).toEqual({ passed: true, wrongQuestionIds: [] })
  })
  it('reports the wrong question ids', () => {
    expect(gradeQuiz({ q1: 'a', q2: 'c' }, correct)).toEqual({ passed: false, wrongQuestionIds: ['q2'] })
  })
  it('treats a missing answer as wrong', () => {
    expect(gradeQuiz({ q1: 'a' }, correct)).toEqual({ passed: false, wrongQuestionIds: ['q2'] })
  })
})

describe('learning XP', () => {
  const now = Date.parse('2026-06-22T12:00:00Z')
  const c = (completed_at: string, xp_reward = 100): LearningCompletion => ({ completed_at, xp_reward })
  it('total sums xp_reward', () => {
    expect(learningTotalXp([c('2026-06-01T00:00:00Z'), c('2026-06-20T00:00:00Z', 50)])).toBe(150)
  })
  it('window all equals total', () => {
    const all = [c('2026-06-01T00:00:00Z'), c('2026-06-20T00:00:00Z')]
    expect(learningWindowXp(all, 'all', now)).toBe(learningTotalXp(all))
  })
  it('week window excludes completions before the cutoff', () => {
    const items = [c('2026-06-20T00:00:00Z'), c('2026-05-01T00:00:00Z')]
    expect(learningWindowXp(items, 'week', now)).toBe(100)
  })
})
