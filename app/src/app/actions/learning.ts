'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { gradeQuiz, type QuizAnswers } from '@/lib/learning'

export type QuizResult = { passed: boolean; wrongQuestionIds: string[]; xpAwarded: number; error?: string }

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
  if (!existing) {
    await svc.from('lesson_completions').insert({ user_id: user.id, lesson_id: lessonId })
    xpAwarded = lesson.xp_reward
  }
  revalidatePath('/learn')
  revalidatePath('/achievements')
  return { passed: true, wrongQuestionIds: [], xpAwarded }
}
