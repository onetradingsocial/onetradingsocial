import { windowCutoff, type Period } from '@/lib/xp'

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
