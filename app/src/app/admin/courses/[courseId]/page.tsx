import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { setCoursePublished } from '@/app/actions/admin'
import { CourseEditForm } from '../../_components/CourseEditForm'
import { PublishToggle } from '../../_components/PublishToggle'

export default async function CourseDetail({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  const svc = createServiceClient()
  const { data: course } = await svc.from('courses')
    .select('id, slug, title, summary, difficulty, ord, published, min_tier').eq('id', courseId).maybeSingle()
  if (!course) notFound()
  const { data: lessons } = await svc.from('lessons')
    .select('id, slug, title, ord, published').eq('course_id', courseId).order('ord')

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <Link className="ts-nav-link" href="/admin/courses">← All courses</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 className="ts-h2">{course.title}</h2>
        <span style={{ marginLeft: 'auto' }}>
          <PublishToggle published={course.published} action={setCoursePublished.bind(null, course.id)} />
        </span>
      </div>
      <CourseEditForm id={course.id} initial={{
        slug: course.slug, title: course.title, summary: course.summary ?? '',
        difficulty: course.difficulty ?? '', ord: course.ord, minTier: course.min_tier ?? 'free',
      }} />

      <div>
        <h3 className="ts-h3">Lessons</h3>
        <div className="ts-card mt-3" style={{ padding: 0 }}>
          {(lessons ?? []).map((l) => (
            <Link key={l.id} href={`/admin/courses/${course.id}/lessons/${l.id}`}
              style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 12, borderTop: '1px solid var(--border)' }}>
              <span className="faint">{l.ord}</span>
              <strong>{l.title}</strong>
              <span className="eyebrow" style={{ marginLeft: 'auto' }}>{l.published ? 'Published' : 'Draft'}</span>
            </Link>
          ))}
        </div>
        <Link className="btn btn-sm mt-3" href={`/admin/courses/${course.id}/lessons/new`}>+ Add lesson</Link>
      </div>
    </div>
  )
}
