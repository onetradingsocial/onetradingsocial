'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getTier } from '@/lib/server/entitlements'
import { getFeatureFlags } from '@/lib/server/feature-flags'
import { canFlag } from '@/lib/feature-flags'
import { gradeQuiz, learningStreakDays, streakBoostPct, type QuizAnswers, type LearningCompletion } from '@/lib/learning'

export type QuizResult = { passed: boolean; wrongQuestionIds: string[]; xpAwarded: number; bonusXp?: number; error?: string }

export async function submitQuiz(lessonId: string, answers: QuizAnswers): Promise<QuizResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { passed: false, wrongQuestionIds: [], xpAwarded: 0, error: 'Not authenticated.' }

  const svc = createServiceClient()
  const { data: lesson } = await svc.from('lessons').select('id, xp_reward, published').eq('id', lessonId).maybeSingle()
  if (!lesson || !lesson.published) return { passed: false, wrongQuestionIds: [], xpAwarded: 0, error: 'Lesson not found.' }

  const { data: questions } = await svc.from('quiz_questions')
    .select('id, quiz_options(id, is_correct)').eq('lesson_id', lessonId)
  const correct: Record<string, string> = {}
  for (const q of questions ?? []) {
    const opt = ((q.quiz_options as { id: string; is_correct: boolean }[]) ?? []).find((o) => o.is_correct)
    if (opt) correct[q.id] = opt.id
  }

  const { passed, wrongQuestionIds } = gradeQuiz(answers, correct)
  if (!passed) return { passed: false, wrongQuestionIds, xpAwarded: 0 }

  const { data: existing } = await svc.from('lesson_completions')
    .select('id').eq('user_id', user.id).eq('lesson_id', lessonId).maybeSingle()
  let xpAwarded = 0
  let bonusXp = 0
  if (!existing) {
    // XP boost for learning streaks (Trader+): bonus scales with the
    // consecutive-day streak this completion extends, stored on the row so
    // the grant persists into every XP read.
    const canBoost = canFlag(await getFeatureFlags(), await getTier(supabase, user.id), 'xp_boosts')
    if (canBoost) {
      const { data: prior } = await svc.from('lesson_completions')
        .select('completed_at').eq('user_id', user.id)
      const completions = [
        ...((prior ?? []) as LearningCompletion[]),
        { completed_at: new Date().toISOString(), xp_reward: 0 }, // today's completion-in-flight
      ]
      const streak = learningStreakDays(completions, Date.now())
      bonusXp = Math.round(lesson.xp_reward * streakBoostPct(streak) / 100)
    }
    await svc.from('lesson_completions').insert({ user_id: user.id, lesson_id: lessonId, bonus_xp: bonusXp })
    xpAwarded = lesson.xp_reward + bonusXp
  }
  revalidatePath('/learn')
  revalidatePath('/achievements')
  return { passed: true, wrongQuestionIds: [], xpAwarded, bonusXp }
}
