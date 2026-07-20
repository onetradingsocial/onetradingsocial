'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { validateSlug, validateNonNegInt, validateQuizOptions } from '@/lib/admin'
import { sanitizeLessonHtml } from '@/lib/sanitizeHtml'
import { isFeature, type FlagValues } from '@/lib/feature-flags'
import { FLAGS_TAG } from '@/lib/server/feature-flags'
import { logAdminAction } from '@/lib/server/admin-audit'

const FEEDBACK_STATUSES = ['open', 'triaged', 'closed'] as const
type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (!FEEDBACK_STATUSES.includes(status)) return { error: 'Bad status.' }
  const svc = createServiceClient()
  const { error } = await svc.from('feedback').update({ status }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'feedback.status', { type: 'feedback', id }, { status })
  revalidatePath('/admin/feedback')
  return {}
}

const FEEDBACK_CATEGORIES = new Set([
  'bug', 'confusing_ux', 'missing_feature', 'performance',
  'verification', 'pricing', 'trust', 'education',
])

export async function setFeedbackCategory(id: string, category: string | null): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (category !== null && !FEEDBACK_CATEGORIES.has(category)) return { error: 'Bad category.' }
  const svc = createServiceClient()
  const { error } = await svc.from('feedback').update({ category }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'feedback.category', { type: 'feedback', id }, { category })
  revalidatePath('/admin/feedback')
  return {}
}

const FR_STATUSES = new Set(['under_review', 'planned', 'in_progress', 'released', 'not_planned'])

export async function setFeatureStatus(id: number, status: string): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (!FR_STATUSES.has(status)) return { error: 'Bad status.' }
  const svc = createServiceClient()
  const { error } = await svc.from('feature_requests').update({ status }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'feature_request.status', { type: 'feature_request', id }, { status })
  revalidatePath('/feature-board')
  return {}
}

export async function setTradeReportStatus(id: number, status: string): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (!['open', 'reviewing', 'actioned', 'dismissed'].includes(status)) return { error: 'Bad status.' }
  const svc = createServiceClient()
  const { error } = await svc.from('trade_reports').update({ status }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'trade_report.status', { type: 'trade_report', id }, { status })
  revalidatePath('/admin/verification')
  return {}
}

export async function ackSystemAlert(id: number): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  const svc = createServiceClient()
  const { error } = await svc
    .from('system_alerts')
    .update({ acked: true, acked_by: admin.id, acked_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'system_alert.ack', { type: 'system_alert', id })
  revalidatePath('/admin')
  return {}
}

export type CourseInput = { slug: string; title: string; summary: string; difficulty: string; ord: number; minTier: string }

const VALID_TIERS = new Set(['free', 'trader', 'pro'])

function checkCourse(input: CourseInput): string | null {
  if (!input.title.trim()) return 'Title is required.'
  if (!VALID_TIERS.has(input.minTier)) return 'Invalid tier.'
  return validateSlug(input.slug) ?? validateNonNegInt(input.ord)
}

export async function createCourse(input: CourseInput): Promise<{ id?: string; error?: string }> {
  const admin = await requireAdmin()
  const err = checkCourse(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { data, error } = await svc.from('courses').insert({
    slug: input.slug, title: input.title, summary: input.summary || null,
    difficulty: input.difficulty || null, ord: input.ord, published: false, min_tier: input.minTier,
  }).select('id').single()
  if (error) return { error: error.message.includes('duplicate') ? 'Slug already exists.' : 'Create failed.' }
  await logAdminAction(admin, 'course.create', { type: 'course', id: data.id }, { slug: input.slug, title: input.title })
  revalidatePath('/admin/courses')
  return { id: data.id }
}

export async function updateCourse(id: string, input: CourseInput): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  const err = checkCourse(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { error } = await svc.from('courses').update({
    slug: input.slug, title: input.title, summary: input.summary || null,
    difficulty: input.difficulty || null, ord: input.ord, min_tier: input.minTier,
  }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'course.update', { type: 'course', id }, { slug: input.slug, title: input.title })
  revalidatePath('/admin/courses')
  revalidatePath(`/admin/courses/${id}`)
  revalidatePath('/learn')
  return {}
}

export async function setCoursePublished(id: string, published: boolean): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  const svc = createServiceClient()
  const { error } = await svc.from('courses').update({ published }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'course.publish', { type: 'course', id }, { published })
  revalidatePath('/admin/courses')
  revalidatePath(`/admin/courses/${id}`)
  revalidatePath('/learn')
  return {}
}

export type LessonInput = { slug: string; title: string; body: string; ord: number; xpReward: number }

function checkLesson(input: LessonInput): string | null {
  if (!input.title.trim()) return 'Title is required.'
  return validateSlug(input.slug) ?? validateNonNegInt(input.ord) ?? validateNonNegInt(input.xpReward)
}

export async function createLesson(courseId: string, input: LessonInput): Promise<{ id?: string; error?: string }> {
  const admin = await requireAdmin()
  const err = checkLesson(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { data, error } = await svc.from('lessons').insert({
    course_id: courseId, slug: input.slug, title: input.title,
    body: sanitizeLessonHtml(input.body), ord: input.ord, xp_reward: input.xpReward, published: false,
  }).select('id').single()
  if (error) return { error: error.message.includes('duplicate') ? 'Slug already used in this course.' : 'Create failed.' }
  await logAdminAction(admin, 'lesson.create', { type: 'lesson', id: data.id }, { courseId, slug: input.slug })
  revalidatePath(`/admin/courses/${courseId}`)
  return { id: data.id }
}

export async function updateLesson(id: string, input: LessonInput): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  const err = checkLesson(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { error } = await svc.from('lessons').update({
    slug: input.slug, title: input.title, body: sanitizeLessonHtml(input.body),
    ord: input.ord, xp_reward: input.xpReward,
  }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'lesson.update', { type: 'lesson', id }, { slug: input.slug, title: input.title })
  revalidatePath(`/admin/courses/${id}`)
  revalidatePath('/learn')
  return {}
}

export async function setLessonPublished(id: string, published: boolean): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  const svc = createServiceClient()
  const { error } = await svc.from('lessons').update({ published }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'lesson.publish', { type: 'lesson', id }, { published })
  revalidatePath('/learn')
  return {}
}

export type QuestionInput = { prompt: string; options: { label: string; isCorrect: boolean }[] }

export async function setLessonQuiz(lessonId: string, questions: QuestionInput[]): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  for (const q of questions) {
    if (!q.prompt.trim()) return { error: 'Every question needs a prompt.' }
    const e = validateQuizOptions(q.options)
    if (e) return { error: e }
  }
  const svc = createServiceClient()
  // Replace the whole quiz: delete existing questions (cascades to options), re-insert.
  await svc.from('quiz_questions').delete().eq('lesson_id', lessonId)
  for (let qi = 0; qi < questions.length; qi++) {
    const q = questions[qi]
    const { data: inserted, error } = await svc.from('quiz_questions')
      .insert({ lesson_id: lessonId, prompt: q.prompt, ord: qi }).select('id').single()
    if (error || !inserted) return { error: 'Save failed.' }
    const optRows = q.options.map((o, oi) => ({ question_id: inserted.id, label: o.label, is_correct: o.isCorrect, ord: oi }))
    const { error: optErr } = await svc.from('quiz_options').insert(optRows)
    if (optErr) return { error: 'Save failed.' }
  }
  await logAdminAction(admin, 'lesson.quiz.set', { type: 'lesson', id: lessonId }, { questions: questions.length })
  revalidatePath('/learn')
  return {}
}

export async function setFeatureFlag(feature: string, values: FlagValues): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (!isFeature(feature)) return { error: 'Unknown feature.' }
  const svc = createServiceClient()
  const { error } = await svc.from('feature_flags').upsert({
    feature, free: values.free, trader: values.trader, pro: values.pro,
  })
  if (error) return { error: 'Update failed.' }
  // Feature flags change what every user can access — always audited.
  await logAdminAction(admin, 'feature_flag.set', { type: 'feature', id: feature }, { ...values })
  revalidateTag(FLAGS_TAG)
  revalidatePath('/admin/features')
  return {}
}

export async function resetFeatureFlag(feature: string): Promise<{ error?: string }> {
  const admin = await requireAdmin()
  if (!isFeature(feature)) return { error: 'Unknown feature.' }
  const svc = createServiceClient()
  const { error } = await svc.from('feature_flags').delete().eq('feature', feature)
  if (error) return { error: 'Reset failed.' }
  await logAdminAction(admin, 'feature_flag.reset', { type: 'feature', id: feature })
  revalidateTag(FLAGS_TAG)
  revalidatePath('/admin/features')
  return {}
}
