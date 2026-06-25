import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { learningTotalXp, type LearningCompletion } from '@/lib/learning'

export type CourseCard = { id: string; slug: string; title: string; summary: string | null; difficulty: string | null; lessonCount: number; completedCount: number; minTier: string }

export async function getCourses(supabase: SupabaseClient, userId: string): Promise<CourseCard[]> {
  const { data: courses } = await supabase.from('courses').select('id, slug, title, summary, difficulty, ord, min_tier').order('ord')
  const { data: lessons } = await supabase.from('lessons').select('id, course_id')
  const { data: comps } = await supabase.from('lesson_completions').select('lesson_id').eq('user_id', userId)
  const lessonsByCourse = new Map<string, string[]>()
  for (const l of lessons ?? []) lessonsByCourse.set(l.course_id, [...(lessonsByCourse.get(l.course_id) ?? []), l.id])
  const done = new Set((comps ?? []).map((c) => c.lesson_id))
  return (courses ?? []).map((c) => {
    const ids = lessonsByCourse.get(c.id) ?? []
    return { id: c.id, slug: c.slug, title: c.title, summary: c.summary, difficulty: c.difficulty,
      lessonCount: ids.length, completedCount: ids.filter((id) => done.has(id)).length, minTier: c.min_tier ?? 'free' }
  })
}

export type CourseDetail = { title: string; summary: string | null; lessons: { id: string; slug: string; title: string; ord: number; completed: boolean }[] }

export async function getCourseWithLessons(supabase: SupabaseClient, courseSlug: string, userId: string): Promise<CourseDetail | null> {
  const { data: course } = await supabase.from('courses').select('id, title, summary').eq('slug', courseSlug).maybeSingle()
  if (!course) return null
  const { data: lessons } = await supabase.from('lessons').select('id, slug, title, ord').eq('course_id', course.id).order('ord')
  const { data: comps } = await supabase.from('lesson_completions').select('lesson_id').eq('user_id', userId)
  const done = new Set((comps ?? []).map((c) => c.lesson_id))
  return {
    title: course.title, summary: course.summary,
    lessons: (lessons ?? []).map((l) => ({ id: l.id, slug: l.slug, title: l.title, ord: l.ord, completed: done.has(l.id) })),
  }
}

export type LessonView = {
  id: string; title: string; body: string; xpReward: number; completed: boolean; courseTitle: string; minTier: string
  questions: { id: string; prompt: string; options: { id: string; label: string }[] }[]
}

// Quiz comes from the SERVICE client and strips is_correct before returning.
export async function getLessonForViewer(supabase: SupabaseClient, courseSlug: string, lessonSlug: string, userId: string): Promise<LessonView | null> {
  const { data: course } = await supabase.from('courses').select('id, title, min_tier').eq('slug', courseSlug).maybeSingle()
  if (!course) return null
  const { data: lesson } = await supabase.from('lessons')
    .select('id, title, body, xp_reward').eq('course_id', course.id).eq('slug', lessonSlug).maybeSingle()
  if (!lesson) return null
  const { data: comp } = await supabase.from('lesson_completions').select('id').eq('user_id', userId).eq('lesson_id', lesson.id).maybeSingle()

  const svc = createServiceClient()
  const { data: questions } = await svc.from('quiz_questions')
    .select('id, prompt, ord, quiz_options(id, label, ord)').eq('lesson_id', lesson.id).order('ord')
  const mapped = (questions ?? []).map((q) => ({
    id: q.id, prompt: q.prompt,
    options: ((q.quiz_options as { id: string; label: string; ord: number }[]) ?? [])
      .sort((a, b) => a.ord - b.ord).map((o) => ({ id: o.id, label: o.label })),
  }))
  return { id: lesson.id, title: lesson.title, body: lesson.body, xpReward: lesson.xp_reward, completed: !!comp, courseTitle: course.title, minTier: course.min_tier ?? 'free', questions: mapped }
}

export async function getUserLearning(supabase: SupabaseClient, userId: string): Promise<{ lessonsCompleted: number; learningXp: number }> {
  const { data } = await supabase.from('lesson_completions').select('completed_at, lessons(xp_reward)').eq('user_id', userId)
  const completions: LearningCompletion[] = (data ?? []).map((r) => {
    const l = r.lessons as { xp_reward: number } | { xp_reward: number }[] | null
    const xp = Array.isArray(l) ? (l[0]?.xp_reward ?? 0) : (l?.xp_reward ?? 0)
    return { completed_at: r.completed_at as string, xp_reward: xp }
  })
  return { lessonsCompleted: completions.length, learningXp: learningTotalXp(completions) }
}
