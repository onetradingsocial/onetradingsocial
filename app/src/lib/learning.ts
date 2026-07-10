import { windowCutoff, utcDayStart, dayKey, type Period } from '@/lib/xp'

export type QuizAnswers = Record<string, string> // questionId -> selected optionId
export type CorrectMap = Record<string, string>  // questionId -> correct optionId

export function gradeQuiz(answers: QuizAnswers, correct: CorrectMap): { passed: boolean; wrongQuestionIds: string[] } {
  const wrongQuestionIds = Object.keys(correct).filter((qid) => answers[qid] !== correct[qid])
  return { passed: wrongQuestionIds.length === 0, wrongQuestionIds }
}

export type LearningCompletion = { completed_at: string; xp_reward: number }

export function learningTotalXp(completions: LearningCompletion[]): number {
  return completions.reduce((sum, c) => sum + c.xp_reward, 0)
}
export function learningWindowXp(completions: LearningCompletion[], period: Period, now: number): number {
  const cutoff = windowCutoff(period, now)
  if (cutoff == null) return learningTotalXp(completions)
  return completions.reduce((sum, c) => sum + (Date.parse(c.completed_at) >= cutoff ? c.xp_reward : 0), 0)
}

const DAY = 864e5

/** Consecutive UTC days with at least one lesson completion, ending today (or
 *  yesterday if today has none yet — a day in progress never zeroes the streak). */
export function learningStreakDays(completions: LearningCompletion[], now: number): number {
  const days = new Set(completions.map((c) => dayKey(Date.parse(c.completed_at))))
  let cursor = utcDayStart(now)
  if (!days.has(dayKey(cursor))) cursor -= DAY
  let streak = 0
  while (days.has(dayKey(cursor))) { streak += 1; cursor -= DAY }
  return streak
}

/** Streak boost: +10% per consecutive day beyond the first, capped at +60% (day 7). */
export function streakBoostPct(streakDays: number): number {
  return Math.max(0, Math.min(streakDays, 7) - 1) * 10
}
