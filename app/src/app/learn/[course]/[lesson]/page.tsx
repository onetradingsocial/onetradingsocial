import { notFound, redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import Link from 'next/link'
import { getLessonForViewer } from '@/lib/server/learning'
import { getTier } from '@/lib/server/entitlements'
import { TIER_RANK, type Tier } from '@/lib/entitlements'
import { Quiz } from './Quiz'

// Learn hidden for now — we are not financial advisors. Flip to false when compliant.
const LEARN_HIDDEN = true

export default async function LessonPage({ params }: { params: Promise<{ course: string; lesson: string }> }) {
  if (LEARN_HIDDEN) redirect('/')
  const { course, lesson } = await params
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')
  const [view, tier] = await Promise.all([
    getLessonForViewer(supabase, course, lesson, user.id),
    getTier(supabase, user.id),
  ])
  if (!view) notFound()
  if (TIER_RANK[tier] < TIER_RANK[(view.minTier as Tier) ?? 'free']) {
    redirect('/settings/billing')
  }

  return (
    <main className="ts-page" style={{ maxWidth: 720 }}>
      <Link href={`/learn/${course}`} className="ts-link-sm">← {view.courseTitle}</Link>
      <h1 className="ts-h1 mt-3">{view.title}</h1>
      {/* Trusted HTML: lesson body is seed-only (migration-authored, no user write path).
          If a Phase 7 admin authoring UI is added, this must be sanitized (e.g. DOMPurify). */}
      <article className="ts-card learn-body mt-5" dangerouslySetInnerHTML={{ __html: view.body }} />
      <div className="mt-6">
        <Quiz lessonId={view.id} questions={view.questions} alreadyDone={view.completed} />
      </div>
    </main>
  )
}
