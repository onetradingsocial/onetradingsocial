import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { NewCourseForm } from '../_components/NewCourseForm'
import { Empty, PageHead, Panel } from '../_components/ui'

export default async function AdminCourses() {
  const svc = createServiceClient()
  const { data: courses } = await svc.from('courses').select('id, title, slug, published, ord').order('ord')
  const list = courses ?? []
  const live = list.filter((c) => c.published).length

  return (
    <>
      <PageHead
        title="Courses"
        sub="Learning hub content. Drafts are invisible to users until published; ordering controls the hub listing."
        right={<span className="v-badge">{live} of {list.length} published</span>}
      />

      <div style={{ display: 'grid', gap: 16 }}>
        <Panel title="All courses" flush>
          {list.length === 0 ? <Empty>No courses yet — create the first one below.</Empty> : list.map((c) => (
            <Link key={c.id} href={`/admin/courses/${c.id}`} className="ad-row">
              <span className="ad-kv" style={{ color: 'var(--faintest)' }}>{String(c.ord).padStart(2, '0')}</span>
              <strong style={{ fontSize: 14 }}>{c.title}</strong>
              <code className="ad-kv">/{c.slug}</code>
              <span className="sp">
                <span className={`v-badge ${c.published ? 'vb-broker' : 'vb-pending'}`}>
                  {c.published ? 'Published' : 'Draft'}
                </span>
              </span>
            </Link>
          ))}
        </Panel>

        <NewCourseForm />
      </div>
    </>
  )
}
