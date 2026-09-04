'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { getAdminUser, NOT_ADMIN } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { validateSlug, validateNonNegInt, validateQuizOptions } from '@/lib/admin'
import { validateReplyBody, FEEDBACK_CATEGORY_VALUES } from '@/lib/feedback'
import { insertSystemNotification } from '@/lib/notifications'
import { sanitizeLessonHtml } from '@/lib/sanitizeHtml'
import { isFeature, type FlagValues } from '@/lib/feature-flags'
import { FLAGS_TAG } from '@/lib/server/feature-flags'
import { logAdminAction } from '@/lib/server/admin-audit'

/**
 * Read the columns a mutation is about to overwrite, so the audit row can carry
 * `{ from, to }` rather than only `to`. Audit item 18, F5.
 *
 * Without a before-value the log tells you something was touched and not what
 * it was — you cannot reconstruct state from it, only observe activity. Best
 * effort: a failed pre-read must never block the mutation, so it degrades to
 * `null` and the row says `from: null` rather than lying.
 */
async function before(
  svc: ReturnType<typeof createServiceClient>,
  table: string,
  columns: string,
  match: Record<string, string | number>,
): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await svc.from(table).select(columns).match(match).maybeSingle()
    return (data as Record<string, unknown> | null) ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Reveals — the explicit, logged path to a masked identifier. Audit item 18, F3/F4.
// ---------------------------------------------------------------------------

/**
 * Return one user's email address, and record that it was looked at.
 *
 * This is the whole point of the masking work: the address is still one click
 * away for an admin who needs it, but the click is now an auditable event
 * attributable to a named admin against a named user. `context` says which
 * screen asked, because "found them in the directory" and "was working through
 * the interview list" are different stories in an incident review.
 */
export async function revealUserEmail(
  userId: string,
  context: 'directory' | 'detail' | 'interviews' = 'directory',
): Promise<{ email?: string; error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  const svc = createServiceClient()
  const { data, error } = await svc.auth.admin.getUserById(userId)
  if (error || !data.user) return { error: 'Could not load that user.' }
  await logAdminAction(admin, 'user.email.reveal', { type: 'user', id: userId }, { context })
  return { email: data.user.email ?? '' }
}

/**
 * Return the full MT5 broker login for one user's connected account.
 *
 * Held separately from the email reveal because it is a different disclosure:
 * an identifier at a *third party*, which an admin needs when raising a case
 * with MetaApi or the broker and does not need to read a support ticket.
 */
export async function revealBrokerLogin(
  userId: string,
): Promise<{ login?: string; error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  const svc = createServiceClient()
  const { data, error } = await svc
    .from('broker_accounts')
    .select('login')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return { error: 'Could not load that connection.' }
  await logAdminAction(admin, 'broker.login.reveal', { type: 'user', id: userId })
  return { login: String(data.login ?? '') }
}

const FEEDBACK_STATUSES = ['open', 'triaged', 'closed'] as const
type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

export async function setFeedbackStatus(id: string, status: FeedbackStatus): Promise<{ error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  if (!FEEDBACK_STATUSES.includes(status)) return { error: 'Bad status.' }
  const svc = createServiceClient()
  const prev = await before(svc, 'feedback', 'status', { id })
  const { error } = await svc.from('feedback').update({ status }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'feedback.status', { type: 'feedback', id }, { from: prev?.status ?? null, to: status })
  revalidatePath('/admin/feedback')
  return {}
}

export async function setFeedbackCategory(id: string, category: string | null): Promise<{ error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  if (category !== null && !FEEDBACK_CATEGORY_VALUES.has(category)) return { error: 'Bad category.' }
  const svc = createServiceClient()
  const prev = await before(svc, 'feedback', 'category', { id })
  const { error } = await svc.from('feedback').update({ category }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'feedback.category', { type: 'feedback', id }, { from: prev?.category ?? null, to: category })
  revalidatePath('/admin/feedback')
  return {}
}

/**
 * Answer one feedback item, and tell the submitter it was answered.
 *
 * One reply per item, overwritable — the same single-valued shape as status and
 * category above, and the reason 0066 put three columns on `feedback` instead
 * of opening a thread table.
 *
 * Ordering is reply-then-notify, and it matters. The reply is the durable
 * artifact and is readable at /settings/feedback on its own; the notification
 * is only a pointer to it. Notifying first would risk a bell entry that links
 * to an answer the update never wrote, which is the worse half-success —
 * whereas a reply that lands without its notice is merely quiet, and the user
 * finds it the next time they look. insertSystemNotification swallows and logs
 * its own failure (it must, or a rejected insert would take the whole action
 * down after the reply was already committed), so the notice failing cannot
 * turn a saved reply into an error the admin sees and retries.
 */
export async function replyToFeedback(id: string, body: string): Promise<{ error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  const valid = validateReplyBody(body)
  if (!valid.ok) return { error: valid.error }
  const svc = createServiceClient()
  const prev = await before(svc, 'feedback', 'user_id, admin_reply', { id })
  const { error } = await svc.from('feedback').update({
    admin_reply: valid.body,
    admin_reply_at: new Date().toISOString(),
    admin_reply_by: admin.id,
  }).eq('id', id)
  if (error) return { error: 'Update failed.' }

  // The pre-read is best effort (see `before`), so a null `prev` costs the
  // notification rather than the reply: without user_id there is nobody to
  // notify, and guessing is not an option.
  const userId = prev?.user_id as string | undefined
  if (userId) {
    await insertSystemNotification({
      supabase: svc,
      userId,
      type: 'feedback_reply',
      entityId: id,
      entityType: 'feedback',
    })
  }

  // Metadata only, never the reply text — same judgment as lesson.update. An
  // audit log that stores every answer becomes a second copy of the support
  // mailbox, with a longer retention than the thing it is describing. Length
  // and `replaced` are what an incident review actually asks: was something
  // said, and did it overwrite something the user had already read?
  await logAdminAction(admin, 'feedback.reply', { type: 'feedback', id }, {
    length: valid.body.length,
    replaced: prev?.admin_reply != null,
  })
  revalidatePath('/admin/feedback')
  revalidatePath('/settings/feedback')
  return {}
}

const FR_STATUSES = new Set(['under_review', 'planned', 'in_progress', 'released', 'not_planned'])

export async function setFeatureStatus(id: number, status: string): Promise<{ error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  if (!FR_STATUSES.has(status)) return { error: 'Bad status.' }
  const svc = createServiceClient()
  const prev = await before(svc, 'feature_requests', 'status', { id })
  const { error } = await svc.from('feature_requests').update({ status }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'feature_request.status', { type: 'feature_request', id }, { from: prev?.status ?? null, to: status })
  revalidatePath('/feature-board')
  return {}
}

export async function setTradeReportStatus(id: number, status: string): Promise<{ error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  if (!['open', 'reviewing', 'actioned', 'dismissed'].includes(status)) return { error: 'Bad status.' }
  const svc = createServiceClient()
  const prev = await before(svc, 'trade_reports', 'status', { id })
  const { error } = await svc.from('trade_reports').update({ status }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'trade_report.status', { type: 'trade_report', id }, { from: prev?.status ?? null, to: status })
  revalidatePath('/admin/verification')
  return {}
}

export async function ackSystemAlert(id: number): Promise<{ error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
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
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
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
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  const err = checkCourse(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  const prev = await before(svc, 'courses', 'slug, title, ord, min_tier', { id })
  const { error } = await svc.from('courses').update({
    slug: input.slug, title: input.title, summary: input.summary || null,
    difficulty: input.difficulty || null, ord: input.ord, min_tier: input.minTier,
  }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'course.update', { type: 'course', id }, {
    from: prev,
    to: { slug: input.slug, title: input.title, ord: input.ord, min_tier: input.minTier },
  })
  revalidatePath('/admin/courses')
  revalidatePath(`/admin/courses/${id}`)
  revalidatePath('/learn')
  return {}
}

export async function setCoursePublished(id: string, published: boolean): Promise<{ error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  const svc = createServiceClient()
  const prev = await before(svc, 'courses', 'published', { id })
  const { error } = await svc.from('courses').update({ published }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'course.publish', { type: 'course', id }, { from: prev?.published ?? null, to: published })
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
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
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
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  const err = checkLesson(input)
  if (err) return { error: err }
  const svc = createServiceClient()
  // Metadata only, never the body. A lesson body is kilobytes of HTML and
  // copying it into every audit row would turn the log into a content store.
  const prev = await before(svc, 'lessons', 'slug, title, ord, xp_reward', { id })
  const { error } = await svc.from('lessons').update({
    slug: input.slug, title: input.title, body: sanitizeLessonHtml(input.body),
    ord: input.ord, xp_reward: input.xpReward,
  }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'lesson.update', { type: 'lesson', id }, {
    from: prev,
    to: { slug: input.slug, title: input.title, ord: input.ord, xp_reward: input.xpReward },
  })
  revalidatePath(`/admin/courses/${id}`)
  revalidatePath('/learn')
  return {}
}

export async function setLessonPublished(id: string, published: boolean): Promise<{ error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  const svc = createServiceClient()
  const prev = await before(svc, 'lessons', 'published', { id })
  const { error } = await svc.from('lessons').update({ published }).eq('id', id)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(admin, 'lesson.publish', { type: 'lesson', id }, { from: prev?.published ?? null, to: published })
  revalidatePath('/learn')
  return {}
}

export type QuestionInput = { prompt: string; options: { label: string; isCorrect: boolean }[] }

export async function setLessonQuiz(lessonId: string, questions: QuestionInput[]): Promise<{ error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
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
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  if (!isFeature(feature)) return { error: 'Unknown feature.' }
  const svc = createServiceClient()
  const prev = await before(svc, 'feature_flags', 'free, trader, pro', { feature })
  const { error } = await svc.from('feature_flags').upsert({
    feature, free: values.free, trader: values.trader, pro: values.pro,
  })
  if (error) return { error: 'Update failed.' }
  // Feature flags change what every user can access — always audited.
  // `from: null` means no override row existed, i.e. the value was the coded default.
  await logAdminAction(admin, 'feature_flag.set', { type: 'feature', id: feature }, { from: prev, to: { ...values } })
  revalidateTag(FLAGS_TAG)
  revalidatePath('/admin/features')
  return {}
}

export async function resetFeatureFlag(feature: string): Promise<{ error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  if (!isFeature(feature)) return { error: 'Unknown feature.' }
  const svc = createServiceClient()
  const prev = await before(svc, 'feature_flags', 'free, trader, pro', { feature })
  const { error } = await svc.from('feature_flags').delete().eq('feature', feature)
  if (error) return { error: 'Reset failed.' }
  await logAdminAction(admin, 'feature_flag.reset', { type: 'feature', id: feature }, { from: prev, to: null })
  revalidateTag(FLAGS_TAG)
  revalidatePath('/admin/features')
  return {}
}

const COMP_TIERS = new Set(['trader', 'pro'])

export async function setCompTier(
  userId: string,
  tier: 'trader' | 'pro' | null,
): Promise<{ error?: string }> {
  const admin = await getAdminUser()
  if (!admin) return { error: NOT_ADMIN }
  if (tier !== null && !COMP_TIERS.has(tier)) return { error: 'Invalid tier.' }
  const svc = createServiceClient()
  const prev = await before(svc, 'profiles', 'comp_tier', { id: userId })
  const { error } = await svc.from('profiles').update({ comp_tier: tier }).eq('id', userId)
  if (error) return { error: 'Update failed.' }
  await logAdminAction(
    admin,
    tier ? 'user.comp_tier.set' : 'user.comp_tier.clear',
    { type: 'user', id: userId },
    { from: prev?.comp_tier ?? null, to: tier },
  )
  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  return {}
}
