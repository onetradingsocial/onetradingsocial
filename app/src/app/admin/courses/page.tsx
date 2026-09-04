import Link from 'next/link'
import { requireAdmin } from '@/lib/server/admin'
import { createServiceClient } from '@/lib/supabase/service'
import { NewCourseForm } from '../_components/NewCourseForm'
import { Empty, PageHead, Panel } from '../_components/ui'

export default async function AdminCourses() {
  // Audit item 18, F2. The layout gate above this page is NOT the authorisation
  // check: a layout does not re-execute on every navigation within its segment,
  // so a crafted RSC request for a nested page can reach the page without it.
  // Every page below therefore repeats the check itself, which makes the
  // service-role query and its authorisation inseparable. The layout keeps its
  // own call — it renders the nav and must not leak that either.
  await requireAdmin()
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
            <Link key={c.id} href={`/admin/courses/${c.id}`} className="adm-row">
              <span className="adm-kv" style={{ color: 'var(--faintest)' }}>{String(c.ord).padStart(2, '0')}</span>
              <strong style={{ fontSize: 14 }}>{c.title}</strong>
              <code className="adm-kv">/{c.slug}</code>
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
