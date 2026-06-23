import { notFound, redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import Link from 'next/link'
import { getLessonForViewer } from '@/lib/server/learning'
import { Quiz } from './Quiz'

export default async function LessonPage({ params }: { params: Promise<{ course: string; lesson: string }> }) {
  const { course, lesson } = await params
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')
  const view = await getLessonForViewer(supabase, course, lesson, user.id)
  if (!view) notFound()

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
