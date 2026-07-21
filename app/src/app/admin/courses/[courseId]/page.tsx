import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { setCoursePublished } from '@/app/actions/admin'
import { CourseEditForm } from '../../_components/CourseEditForm'
import { PublishToggle } from '../../_components/PublishToggle'
import { Empty, PageHead, Panel } from '../../_components/ui'

export default async function CourseDetail({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  const svc = createServiceClient()
  const { data: course } = await svc.from('courses')
    .select('id, slug, title, summary, difficulty, ord, published, min_tier').eq('id', courseId).maybeSingle()
  if (!course) notFound()
  const { data: lessons } = await svc.from('lessons')
    .select('id, slug, title, ord, published').eq('course_id', courseId).order('ord')

  const list = lessons ?? []
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link className="ad-kv" href="/admin/courses">← All courses</Link>
      </div>
      <PageHead
        title={course.title}
        sub={course.summary ?? undefined}
        right={<PublishToggle published={course.published} action={setCoursePublished.bind(null, course.id)} />}
      />

      <div style={{ display: 'grid', gap: 16 }}>
        <CourseEditForm id={course.id} initial={{
          slug: course.slug, title: course.title, summary: course.summary ?? '',
          difficulty: course.difficulty ?? '', ord: course.ord, minTier: course.min_tier ?? 'free',
        }} />

        <Panel
          title={`Lessons · ${list.length}`}
          right={<Link className="btn btn-ghost btn-sm" href={`/admin/courses/${course.id}/lessons/new`}>+ Add lesson</Link>}
          flush
        >
          {list.length === 0 ? <Empty>No lessons yet.</Empty> : list.map((l) => (
            <Link key={l.id} href={`/admin/courses/${course.id}/lessons/${l.id}`} className="ad-row">
              <span className="ad-kv" style={{ color: 'var(--faintest)' }}>{String(l.ord).padStart(2, '0')}</span>
              <strong style={{ fontSize: 14 }}>{l.title}</strong>
              <span className="sp">
                <span className={`v-badge ${l.published ? 'vb-broker' : 'vb-pending'}`}>
                  {l.published ? 'Published' : 'Draft'}
                </span>
              </span>
            </Link>
          ))}
        </Panel>
      </div>
    </>
  )
}
