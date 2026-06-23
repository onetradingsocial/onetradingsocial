'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { validateSlug, validateNonNegInt } from '@/lib/admin'
import { sanitizeLessonHtml } from '@/lib/sanitizeHtml'

const FEEDBACK_STATUSES = ['open', 'triaged', 'closed'] as const
type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<{ error?: string }> {
  await requireAdmin()
  if (!FEEDBACK_STATUSES.includes(status)) return { error: 'Bad status.' }
  const svc = createServiceClient()
  const { error } = await svc.from('feedback').update({ status }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  revalidatePath('/admin/feedback')
  return {}
}

export type CourseInput = { slug: string; title: string; summary: string; difficulty: string; ord: number }

function checkCourse(input: CourseInput): string | null {
  if (!input.title.trim()) return 'Title is required.'
  return validateSlug(input.slug) ?? validateNonNegInt(input.ord)
}

export async function createCourse(input: CourseInput): Promise<{ id?: string; error?: string }> {
  await requireAdmin()
  const err = checkCourse(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { data, error } = await svc.from('courses').insert({
    slug: input.slug, title: input.title, summary: input.summary || null,
    difficulty: input.difficulty || null, ord: input.ord, published: false,
  }).select('id').single()
  if (error) return { error: error.message.includes('duplicate') ? 'Slug already exists.' : 'Create failed.' }
  revalidatePath('/admin/courses')
  return { id: data.id }
}

export async function updateCourse(id: string, input: CourseInput): Promise<{ error?: string }> {
  await requireAdmin()
  const err = checkCourse(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { error } = await svc.from('courses').update({
    slug: input.slug, title: input.title, summary: input.summary || null,
    difficulty: input.difficulty || null, ord: input.ord,
  }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  revalidatePath('/admin/courses')
  revalidatePath(`/admin/courses/${id}`)
  revalidatePath('/learn')
  return {}
}

export async function setCoursePublished(id: string, published: boolean): Promise<{ error?: string }> {
  await requireAdmin()
  const svc = createServiceClient()
  const { error } = await svc.from('courses').update({ published }).eq('id', id)
  if (error) return { error: 'Update failed.' }
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
  await requireAdmin()
  const err = checkLesson(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { data, error } = await svc.from('lessons').insert({
    course_id: courseId, slug: input.slug, title: input.title,
    body: sanitizeLessonHtml(input.body), ord: input.ord, xp_reward: input.xpReward, published: false,
  }).select('id').single()
  if (error) return { error: error.message.includes('duplicate') ? 'Slug already used in this course.' : 'Create failed.' }
  revalidatePath(`/admin/courses/${courseId}`)
  return { id: data.id }
}

export async function updateLesson(id: string, input: LessonInput): Promise<{ error?: string }> {
  await requireAdmin()
  const err = checkLesson(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const { error } = await svc.from('lessons').update({
    slug: input.slug, title: input.title, body: sanitizeLessonHtml(input.body),
    ord: input.ord, xp_reward: input.xpReward,
  }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  revalidatePath(`/admin/courses/${id}`)
  revalidatePath('/learn')
  return {}
}

export async function setLessonPublished(id: string, published: boolean): Promise<{ error?: string }> {
  await requireAdmin()
  const svc = createServiceClient()
  const { error } = await svc.from('lessons').update({ published }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  revalidatePath('/learn')
  return {}
}
