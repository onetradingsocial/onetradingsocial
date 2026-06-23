import { notFound, redirect } from 'next/navigation'
import { createClient, getSessionUser } from '@/lib/supabase/server'
import Link from 'next/link'
import { getCourseWithLessons } from '@/lib/server/learning'

export default async function CoursePage({ params }: { params: Promise<{ course: string }> }) {
  const { course: slug } = await params
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) redirect('/login')
  const course = await getCourseWithLessons(supabase, slug, user.id)
  if (!course) notFound()
  const doneCount = course.lessons.filter((l) => l.completed).length

  return (
    <main className="ts-page" style={{ maxWidth: 720 }}>
      <header className="lb-head"><div className="tx">
        <Link href="/learn" className="ts-link-sm">← All courses</Link>
        <h1 className="ts-h1">{course.title}</h1>
        {course.summary && <p>{course.summary}</p>}
        <p className="faint" style={{ fontSize: 13 }}>{doneCount}/{course.lessons.length} complete</p>
      </div></header>
      <ol className="learn-lessons mt-6">
        {course.lessons.map((l) => (
          <li key={l.id}>
            <Link href={`/learn/${slug}/${l.slug}`} className={'ts-card learn-lesson' + (l.completed ? ' done' : '')}>
              <span className="learn-tick" aria-hidden>{l.completed ? '✓' : l.ord}</span>
              <b>{l.title}</b>
              {l.completed && <span className="ts-chip2" style={{ marginLeft: 'auto' }}>Completed</span>}
            </Link>
          </li>
        ))}
      </ol>
    </main>
  )
}
